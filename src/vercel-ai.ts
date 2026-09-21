import type {
  LanguageModelV3,
  LanguageModelV3CallOptions,
  LanguageModelV3GenerateResult,
  LanguageModelV3Middleware,
  LanguageModelV3StreamPart,
  LanguageModelV3Usage,
} from "@ai-sdk/provider";
import {
  SpendReconciliationRequiredError,
} from "./errors.js";
import type { SpendFirewall } from "./firewall.js";
import type { SpendContext } from "./types.js";

export interface VercelAiSpendMetadata extends SpendContext {
  /** Per-request conservative upper bound. Overrides the middleware estimator. */
  estimatedCostUsd?: number;
  requestId?: string;
  idempotencyKey?: string;
}

export interface VercelAiSpendHookContext {
  type: "generate" | "stream";
  params: LanguageModelV3CallOptions;
  model: LanguageModelV3;
  spendContext: SpendContext;
  metadata?: VercelAiSpendMetadata;
}

export interface VercelAiActualCostContext
  extends VercelAiSpendHookContext {
  usage: LanguageModelV3Usage;
  estimatedCostUsd: number;
  result?: LanguageModelV3GenerateResult;
}

export interface VercelAiReconciliationEvent {
  reservationId: string;
  phase: "operation" | "cost-calculation" | "settlement";
  type: "generate" | "stream";
  context: SpendContext;
  error: unknown;
}

export interface VercelAiSpendMiddlewareOptions {
  firewall: SpendFirewall;
  /**
   * Base context for every call or a resolver. provider/model/resource are
   * filled from the AI SDK model when omitted.
   */
  context?:
    | SpendContext
    | ((
        input: Omit<VercelAiSpendHookContext, "spendContext">
      ) => SpendContext | Promise<SpendContext>);
  /**
   * Conservative pre-call cost estimate. May be omitted when every request
   * passes providerOptions.aiSpendGuard.estimatedCostUsd or when
   * defaultEstimatedCostUsd is configured.
   */
  estimateCostUsd?: (
    input: VercelAiSpendHookContext
  ) => number | Promise<number>;
  /** Safe fallback upper bound used when no request-specific estimate exists. */
  defaultEstimatedCostUsd?: number;
  /**
   * Convert returned usage into actual USD. When omitted, settlement uses the
   * reserved estimate, which is conservative but may over-count spend.
   */
  actualCostUsd?: (
    input: VercelAiActualCostContext
  ) => number | Promise<number>;
  /**
   * By default provider errors remain reserved because a thrown network/SDK
   * error can still represent billable work. Set true only if your provider
   * contract guarantees thrown calls were not billed.
   */
  releaseOnProviderError?: boolean;
  onReconciliationRequired?: (
    event: VercelAiReconciliationEvent
  ) => void | Promise<void>;
}

/**
 * Vercel AI SDK 7 / LanguageModelV3 middleware.
 *
 * Usage:
 *   wrapLanguageModel({ model, middleware: createVercelAiSpendMiddleware(...) })
 *
 * Request-specific context can be supplied through:
 *   providerOptions: { aiSpendGuard: { userId, projectId, estimatedCostUsd } }
 */
export function createVercelAiSpendMiddleware(
  options: VercelAiSpendMiddlewareOptions
): LanguageModelV3Middleware {
  const { firewall } = options;

  return {
    specificationVersion: "v3",

    wrapGenerate: async ({ doGenerate, params, model }) => {
      const prepared = await prepareCall("generate", params, model, options);
      const reservation = await firewall.reserve({
        context: prepared.spendContext,
        estimatedCostUsd: prepared.estimatedCostUsd,
        ...(prepared.metadata?.requestId
          ? { requestId: prepared.metadata.requestId }
          : {}),
        ...(prepared.metadata?.idempotencyKey
          ? { idempotencyKey: prepared.metadata.idempotencyKey }
          : {}),
      });

      let result: LanguageModelV3GenerateResult;
      try {
        result = await doGenerate();
      } catch (error) {
        if (options.releaseOnProviderError) {
          await reservation.release();
          throw error;
        }
        const reconciliation = new SpendReconciliationRequiredError(
          reservation.id,
          "operation",
          error
        );
        await notifyReconciliation(options, {
          reservationId: reservation.id,
          phase: "operation",
          type: "generate",
          context: prepared.spendContext,
          error,
        });
        throw reconciliation;
      }

      let actualCostUsd: number;
      try {
        actualCostUsd = options.actualCostUsd
          ? await options.actualCostUsd({
              type: "generate",
              params,
              model,
              spendContext: prepared.spendContext,
              metadata: prepared.metadata,
              usage: result.usage,
              estimatedCostUsd: prepared.estimatedCostUsd,
              result,
            })
          : prepared.estimatedCostUsd;
        assertMoney(actualCostUsd, "actualCostUsd");
      } catch (error) {
        const reconciliation = new SpendReconciliationRequiredError(
          reservation.id,
          "cost-calculation",
          error
        );
        await notifyReconciliation(options, {
          reservationId: reservation.id,
          phase: "cost-calculation",
          type: "generate",
          context: prepared.spendContext,
          error,
        });
        throw reconciliation;
      }

      try {
        await reservation.settle(actualCostUsd);
      } catch (error) {
        const reconciliation = new SpendReconciliationRequiredError(
          reservation.id,
          "settlement",
          error
        );
        await notifyReconciliation(options, {
          reservationId: reservation.id,
          phase: "settlement",
          type: "generate",
          context: prepared.spendContext,
          error,
        });
        throw reconciliation;
      }

      return result;
    },

    wrapStream: async ({ doStream, params, model }) => {
      const prepared = await prepareCall("stream", params, model, options);
      const reservation = await firewall.reserve({
        context: prepared.spendContext,
        estimatedCostUsd: prepared.estimatedCostUsd,
        ...(prepared.metadata?.requestId
          ? { requestId: prepared.metadata.requestId }
          : {}),
        ...(prepared.metadata?.idempotencyKey
          ? { idempotencyKey: prepared.metadata.idempotencyKey }
          : {}),
      });

      let streamResult;
      try {
        streamResult = await doStream();
      } catch (error) {
        if (options.releaseOnProviderError) {
          await reservation.release();
          throw error;
        }
        await notifyReconciliation(options, {
          reservationId: reservation.id,
          phase: "operation",
          type: "stream",
          context: prepared.spendContext,
          error,
        });
        throw new SpendReconciliationRequiredError(
          reservation.id,
          "operation",
          error
        );
      }

      const { stream, ...rest } = streamResult;
      const reader = stream.getReader();
      let finalized = false;
      let reconciliationNotified = false;

      const notifyOnce = async (
        phase: VercelAiReconciliationEvent["phase"],
        error: unknown
      ) => {
        if (reconciliationNotified) return;
        reconciliationNotified = true;
        await notifyReconciliation(options, {
          reservationId: reservation.id,
          phase,
          type: "stream",
          context: prepared.spendContext,
          error,
        });
      };

      const guardedStream = new ReadableStream<LanguageModelV3StreamPart>({
        async pull(controller) {
          let next: ReadableStreamReadResult<LanguageModelV3StreamPart>;
          try {
            next = await reader.read();
          } catch (error) {
            await notifyOnce("operation", error);
            controller.error(
              new SpendReconciliationRequiredError(
                reservation.id,
                "operation",
                error
              )
            );
            return;
          }

          if (next.done) {
            if (!finalized) {
              await notifyOnce(
                "operation",
                new Error("AI SDK stream ended without a finish usage event.")
              );
            }
            controller.close();
            return;
          }

          const part = next.value;

          if (part.type === "error") {
            await notifyOnce("operation", part.error);
            controller.enqueue(part);
            return;
          }

          if (part.type !== "finish") {
            controller.enqueue(part);
            return;
          }

          let actualCostUsd: number;
          try {
            actualCostUsd = options.actualCostUsd
              ? await options.actualCostUsd({
                  type: "stream",
                  params,
                  model,
                  spendContext: prepared.spendContext,
                  metadata: prepared.metadata,
                  usage: part.usage,
                  estimatedCostUsd: prepared.estimatedCostUsd,
                })
              : prepared.estimatedCostUsd;
            assertMoney(actualCostUsd, "actualCostUsd");
          } catch (error) {
            await notifyOnce("cost-calculation", error);
            controller.error(
              new SpendReconciliationRequiredError(
                reservation.id,
                "cost-calculation",
                error
              )
            );
            return;
          }

          try {
            await reservation.settle(actualCostUsd);
            finalized = true;
            controller.enqueue(part);
          } catch (error) {
            await notifyOnce("settlement", error);
            controller.error(
              new SpendReconciliationRequiredError(
                reservation.id,
                "settlement",
                error
              )
            );
          }
        },

        async cancel(reason) {
          if (!finalized) {
            await notifyOnce(
              "operation",
              reason ?? new Error("AI SDK stream was cancelled before settlement.")
            );
          }
          await reader.cancel(reason);
        },
      });

      return {
        ...rest,
        stream: guardedStream,
      };
    },
  };
}

async function prepareCall(
  type: "generate" | "stream",
  params: LanguageModelV3CallOptions,
  model: LanguageModelV3,
  options: VercelAiSpendMiddlewareOptions
): Promise<{
  spendContext: SpendContext;
  metadata?: VercelAiSpendMetadata;
  estimatedCostUsd: number;
}> {
  const metadata = readMetadata(params);
  const base =
    typeof options.context === "function"
      ? await options.context({ type, params, model, metadata })
      : options.context ?? {};

  const spendContext: SpendContext = {
    ...base,
    ...contextOnly(metadata),
    provider: metadata?.provider ?? base.provider ?? model.provider,
    model: metadata?.model ?? base.model ?? model.modelId,
    resource: metadata?.resource ?? base.resource ?? "llm",
    tags: {
      ...(base.tags ?? {}),
      ...(metadata?.tags ?? {}),
    },
  };

  if (spendContext.tags && Object.keys(spendContext.tags).length === 0) {
    delete spendContext.tags;
  }

  const hookContext: VercelAiSpendHookContext = {
    type,
    params,
    model,
    spendContext,
    ...(metadata ? { metadata } : {}),
  };

  const estimatedCostUsd =
    metadata?.estimatedCostUsd ??
    (options.estimateCostUsd
      ? await options.estimateCostUsd(hookContext)
      : options.defaultEstimatedCostUsd);

  if (estimatedCostUsd === undefined) {
    throw new Error(
      "Vercel AI middleware needs a conservative estimate: configure estimateCostUsd/defaultEstimatedCostUsd or providerOptions.aiSpendGuard.estimatedCostUsd."
    );
  }
  assertMoney(estimatedCostUsd, "estimatedCostUsd");

  return {
    spendContext,
    ...(metadata ? { metadata } : {}),
    estimatedCostUsd,
  };
}

function readMetadata(
  params: LanguageModelV3CallOptions
): VercelAiSpendMetadata | undefined {
  const providerOptions = params.providerOptions as
    | Record<string, unknown>
    | undefined;
  const raw = providerOptions?.aiSpendGuard;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  return raw as VercelAiSpendMetadata;
}

function contextOnly(
  metadata: VercelAiSpendMetadata | undefined
): SpendContext {
  if (!metadata) return {};
  const {
    estimatedCostUsd: _estimatedCostUsd,
    requestId: _requestId,
    idempotencyKey: _idempotencyKey,
    ...context
  } = metadata;
  return context;
}

async function notifyReconciliation(
  options: VercelAiSpendMiddlewareOptions,
  event: VercelAiReconciliationEvent
): Promise<void> {
  if (!options.onReconciliationRequired) return;
  try {
    await options.onReconciliationRequired(event);
  } catch {
    // Observability callbacks must never change budget/accounting semantics.
  }
}

function assertMoney(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${label} must be a finite non-negative number`);
  }
}
