import { AiSpendGuard, JsonFileStore, estimateTokenCostUsd } from "ai-spend-guard";

// This example intentionally does not depend on the OpenAI SDK.
// Route the real SDK call through the protected section in your application.
const guard = new AiSpendGuard(
  new JsonFileStore(".ai-spend-guard/ledger.json"),
  {
    global: { monthlyUsd: 20, perRequestUsd: 0.5 },
    providers: { openai: { monthlyUsd: 15 } },
  }
);

const pricing = {
  inputPerMillionUsd: 1.25,
  outputPerMillionUsd: 10,
};

// Use a conservative upper-bound estimate before making the paid request.
const estimatedCostUsd = estimateTokenCostUsd(
  { inputTokens: 8_000, outputTokens: 2_000 },
  pricing
);

const reservation = await guard.reserve({ provider: "openai", estimatedCostUsd });

try {
  // const response = await openai.responses.create(...)
  const usageFromProvider = { inputTokens: 2_300, outputTokens: 500 };
  const actualCostUsd = estimateTokenCostUsd(usageFromProvider, pricing);
  await reservation.settle(actualCostUsd);
} catch (error) {
  await reservation.release();
  throw error;
}
