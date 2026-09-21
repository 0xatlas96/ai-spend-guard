export interface TokenPricing {
  /** USD per 1,000,000 uncached input tokens. */
  inputPerMillionUsd: number;
  /** USD per 1,000,000 output tokens. */
  outputPerMillionUsd: number;
  /** Optional USD per 1,000,000 cached input tokens. */
  cachedInputPerMillionUsd?: number;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens?: number;
}

export function estimateTokenCostUsd(usage: TokenUsage, pricing: TokenPricing): number {
  assertNonNegative(usage.inputTokens, "inputTokens");
  assertNonNegative(usage.outputTokens, "outputTokens");
  const cached = usage.cachedInputTokens ?? 0;
  assertNonNegative(cached, "cachedInputTokens");
  if (cached > usage.inputTokens) {
    throw new RangeError("cachedInputTokens cannot exceed inputTokens");
  }

  const uncached = usage.inputTokens - cached;
  const cachedRate = pricing.cachedInputPerMillionUsd ?? pricing.inputPerMillionUsd;
  return (
    (uncached / 1_000_000) * pricing.inputPerMillionUsd +
    (cached / 1_000_000) * cachedRate +
    (usage.outputTokens / 1_000_000) * pricing.outputPerMillionUsd
  );
}

function assertNonNegative(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${label} must be a finite non-negative number`);
  }
}

export interface CompositeCostPart {
  units: number;
  pricePerUnitUsd: number;
}

/** Generic cost helper for images, searches, tool calls, storage units, credits, etc. */
export function estimateUnitCostUsd(units: number, pricePerUnitUsd: number): number {
  assertNonNegative(units, "units");
  assertNonNegative(pricePerUnitUsd, "pricePerUnitUsd");
  return units * pricePerUnitUsd;
}

/** Convenience helper for voice/video providers priced per minute. */
export function estimateDurationCostUsd(seconds: number, pricePerMinuteUsd: number): number {
  assertNonNegative(seconds, "seconds");
  assertNonNegative(pricePerMinuteUsd, "pricePerMinuteUsd");
  return (seconds / 60) * pricePerMinuteUsd;
}

/** Sum heterogeneous paid components into one reservation estimate. */
export function estimateCompositeCostUsd(parts: readonly CompositeCostPart[]): number {
  return parts.reduce(
    (sum, part) => sum + estimateUnitCostUsd(part.units, part.pricePerUnitUsd),
    0
  );
}
