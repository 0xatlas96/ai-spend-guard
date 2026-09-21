import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { dashboardHtml } from "./dashboard.js";
import {
  DuplicateOperationError,
  IdempotencyConflictError,
  MissingSpendContextError,
  SpendPolicyError,
} from "./firewall-errors.js";
import {
  ReservationNotFoundError,
  UnknownEstimateError,
} from "./errors.js";
import type { SpendFirewall } from "./firewall.js";
import type { SpendRequest } from "./firewall-types.js";
import type { SpendContext } from "./types.js";

export interface SpendGuardServerOptions {
  host?: string;
  port?: number;
  /**
   * Required for non-loopback binds. Use an environment variable rather than
   * putting bearer tokens in shell history or process arguments.
   */
  token?: string;
  dashboard?: boolean;
  maxBodyBytes?: number;
  log?: (message: string) => void;
}

export interface RunningSpendGuardServer {
  host: string;
  port: number;
  url: string;
  close(): Promise<void>;
}

export async function startSpendGuardServer(
  firewall: SpendFirewall,
  options: SpendGuardServerOptions = {}
): Promise<RunningSpendGuardServer> {
  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? 8787;
  const token = options.token;
  const dashboard = options.dashboard ?? true;
  const maxBodyBytes = options.maxBodyBytes ?? 1_000_000;
  const log = options.log ?? (() => undefined);

  if (!isLoopback(host) && !token) {
    throw new Error(
      "Refusing to bind AI Spend Guard to a non-loopback address without a bearer token."
    );
  }

  const server = createServer(async (request, response) => {
    try {
      applySecurityHeaders(response);

      if (request.method === "GET" && request.url === "/healthz") {
        return json(response, 200, { ok: true });
      }

      if (!authorized(request, token)) {
        response.setHeader("WWW-Authenticate", 'Bearer realm="ai-spend-guard"');
        return json(response, 401, {
          error: { code: "unauthorized", message: "Bearer token required." },
        });
      }

      const url = new URL(request.url ?? "/", `http://${host}`);

      if (request.method === "GET" && url.pathname === "/") {
        if (!dashboard) return json(response, 404, notFound());
        response.statusCode = 200;
        response.setHeader("Content-Type", "text/html; charset=utf-8");
        response.end(dashboardHtml());
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/status") {
        return json(response, 200, await firewall.status());
      }

      if (request.method === "GET" && url.pathname === "/api/reservations") {
        const olderThanMs = url.searchParams.get("olderThanMs");
        return json(
          response,
          200,
          await firewall.listReservations({
            ...(olderThanMs ? { olderThanMs: nonNegativeNumber(olderThanMs, "olderThanMs") } : {}),
          })
        );
      }

      if (request.method === "POST" && url.pathname === "/api/explain") {
        const body = await readJson<SpendRequest>(request, maxBodyBytes);
        return json(response, 200, await firewall.explain(body));
      }

      if (request.method === "POST" && url.pathname === "/api/reserve") {
        const body = await readJson<SpendRequest>(request, maxBodyBytes);
        const reservation = await firewall.reserve(body);
        return json(response, 201, {
          id: reservation.id,
          estimatedCostUsd: reservation.estimatedCostUsd,
          context: reservation.context,
          decision: reservation.decision,
        });
      }

      if (request.method === "POST" && url.pathname === "/api/settle") {
        const body = await readJson<{
          id: string;
          actualCostUsd: number;
          metadata?: Record<string, unknown>;
        }>(request, maxBodyBytes);
        requireString(body.id, "id");
        return json(
          response,
          200,
          await firewall.settle(body.id, {
            actualCostUsd: nonNegativeNumber(body.actualCostUsd, "actualCostUsd"),
            ...(body.metadata ? { metadata: body.metadata } : {}),
          })
        );
      }

      if (request.method === "POST" && url.pathname === "/api/release") {
        const body = await readJson<{ id: string }>(request, maxBodyBytes);
        requireString(body.id, "id");
        await firewall.release(body.id);
        return json(response, 200, { released: true, id: body.id });
      }

      if (request.method === "POST" && url.pathname === "/api/resize") {
        const body = await readJson<{
          id: string;
          estimatedCostUsd: number;
        }>(request, maxBodyBytes);
        requireString(body.id, "id");
        return json(
          response,
          200,
          await firewall.resize(
            body.id,
            nonNegativeNumber(body.estimatedCostUsd, "estimatedCostUsd")
          )
        );
      }

      if (request.method === "POST" && url.pathname === "/api/record") {
        const body = await readJson<{
          context?: SpendContext;
          actualCostUsd: number;
          requestId?: string;
          idempotencyKey?: string;
          metadata?: Record<string, unknown>;
        }>(request, maxBodyBytes);
        return json(
          response,
          201,
          await firewall.recordActual({
            ...(body.context ? { context: body.context } : {}),
            actualCostUsd: nonNegativeNumber(body.actualCostUsd, "actualCostUsd"),
            ...(body.requestId ? { requestId: body.requestId } : {}),
            ...(body.idempotencyKey ? { idempotencyKey: body.idempotencyKey } : {}),
            ...(body.metadata ? { metadata: body.metadata } : {}),
          })
        );
      }

      return json(response, 404, notFound());
    } catch (error) {
      const mapped = mapError(error);
      log(`${request.method ?? "?"} ${request.url ?? "/"} -> ${mapped.status} ${mapped.body.error.code}`);
      return json(response, mapped.status, mapped.body);
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address() as AddressInfo;
  const shownHost =
    address.address === "::" || address.address === "0.0.0.0"
      ? host
      : address.address;
  const url = `http://${formatHost(shownHost)}:${address.port}`;

  return {
    host: shownHost,
    port: address.port,
    url,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

function authorized(request: IncomingMessage, token: string | undefined): boolean {
  if (!token) return true;
  const authorization = request.headers.authorization;
  if (!authorization?.startsWith("Bearer ")) return false;
  const supplied = authorization.slice("Bearer ".length);
  return constantTimeEqual(supplied, token);
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let index = 0; index < a.length; index += 1) {
    mismatch |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return mismatch === 0;
}

async function readJson<T>(
  request: IncomingMessage,
  maxBodyBytes: number
): Promise<T> {
  let total = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > maxBodyBytes) {
      throw new RequestError(413, "body-too-large", "JSON body is too large.");
    }
    chunks.push(buffer);
  }

  if (chunks.length === 0) return {} as T;

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as T;
  } catch {
    throw new RequestError(400, "invalid-json", "Request body must be valid JSON.");
  }
}

class RequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string
  ) {
    super(message);
  }
}

function mapError(error: unknown): {
  status: number;
  body: { error: { code: string; message: string; details?: unknown } };
} {
  if (error instanceof RequestError) {
    return {
      status: error.status,
      body: { error: { code: error.code, message: error.message } },
    };
  }

  if (error instanceof SpendPolicyError) {
    return {
      status: 402,
      body: {
        error: {
          code: "spend-policy-blocked",
          message: error.message,
          details: error.decision,
        },
      },
    };
  }

  if (
    error instanceof DuplicateOperationError ||
    error instanceof IdempotencyConflictError
  ) {
    return {
      status: 409,
      body: {
        error: {
          code:
            error instanceof IdempotencyConflictError
              ? "idempotency-conflict"
              : "duplicate-operation",
          message: error.message,
        },
      },
    };
  }

  if (error instanceof ReservationNotFoundError) {
    return {
      status: 404,
      body: {
        error: { code: "reservation-not-found", message: error.message },
      },
    };
  }

  if (
    error instanceof MissingSpendContextError ||
    error instanceof UnknownEstimateError ||
    error instanceof RangeError
  ) {
    return {
      status: 400,
      body: {
        error: {
          code: "invalid-spend-request",
          message: error instanceof Error ? error.message : String(error),
        },
      },
    };
  }

  return {
    status: 500,
    body: {
      error: {
        code: "internal-error",
        message: "Internal AI Spend Guard error.",
      },
    },
  };
}

function json(response: ServerResponse, status: number, body: unknown): void {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(body));
}

function notFound() {
  return {
    error: { code: "not-found", message: "Endpoint not found." },
  };
}

function requireString(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new RequestError(400, "invalid-input", `${label} must be a non-empty string.`);
  }
}

function nonNegativeNumber(value: unknown, label: string): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new RequestError(
      400,
      "invalid-input",
      `${label} must be a finite non-negative number.`
    );
  }
  return parsed;
}

function applySecurityHeaders(response: ServerResponse): void {
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("X-Frame-Options", "DENY");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'"
  );
  response.setHeader("Cache-Control", "no-store");
}

function isLoopback(host: string): boolean {
  const normalized = host.toLowerCase();
  return (
    normalized === "127.0.0.1" ||
    normalized === "::1" ||
    normalized === "localhost"
  );
}

function formatHost(host: string): string {
  return host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
}
