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
