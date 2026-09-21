import { AiSpendGuard, MemoryStore } from "ai-spend-guard";

const guard = new AiSpendGuard(new MemoryStore(), {
  global: { dailyUsd: 5, monthlyUsd: 50, perRequestUsd: 1 },
  providers: { openai: { monthlyUsd: 25 } },
});

const reservation = await guard.reserve({
  provider: "openai",
  estimatedCostUsd: 0.05,
});

try {
  // Call your provider here.
  const actualCostUsd = 0.031;
  await reservation.settle(actualCostUsd);
} catch (error) {
  await reservation.release();
  throw error;
}

console.log(await guard.status());
