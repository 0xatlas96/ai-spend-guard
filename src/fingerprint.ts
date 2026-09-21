import { createHash } from "node:crypto";
import type { SpendContext } from "./types.js";

export function spendFingerprint(
  context: SpendContext,
  estimatedCostUsd: number,
  requestId?: string
): string {
  const payload = stableStringify({
    context: normalizeContext(context),
    estimatedCostUsd,
    requestId: requestId ?? null,
  });
  return createHash("sha256").update(payload).digest("hex");
}

export function normalizeContext(context: SpendContext | undefined): SpendContext {
  if (!context) return {};
  const tags = context.tags
    ? Object.fromEntries(
        Object.entries(context.tags)
          .filter(([, value]) => value !== "")
          .sort(([a], [b]) => a.localeCompare(b))
      )
    : undefined;

  return {
    ...(context.provider ? { provider: context.provider } : {}),
    ...(context.model ? { model: context.model } : {}),
    ...(context.resource ? { resource: context.resource } : {}),
    ...(context.projectId ? { projectId: context.projectId } : {}),
    ...(context.userId ? { userId: context.userId } : {}),
    ...(context.sessionId ? { sessionId: context.sessionId } : {}),
    ...(context.agentId ? { agentId: context.agentId } : {}),
    ...(context.route ? { route: context.route } : {}),
    ...(context.environment ? { environment: context.environment } : {}),
    ...(tags && Object.keys(tags).length ? { tags } : {}),
  };
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(",")}}`;
}
