import assert from "node:assert/strict";
import test from "node:test";
import {
  AiSpendGuard,
  BudgetExceededError,
  MemoryStore,
  UnknownEstimateError,
  estimateTokenCostUsd,
} from "../dist/index.js";

const fixedNow = () => new Date("2026-09-21T12:00:00.000Z");

test("blocks a reservation that would exceed the global daily budget", async () => {
  const guard = new AiSpendGuard(new MemoryStore(), { global: { dailyUsd: 1 } }, { now: fixedNow });
  const first = await guard.reserve({ provider: "openai", estimatedCostUsd: 0.8 });
  await assert.rejects(
    () => guard.reserve({ provider: "anthropic", estimatedCostUsd: 0.3 }),
    BudgetExceededError
  );
  await first.release();
});

test("reservations count against budget before settlement", async () => {
  const guard = new AiSpendGuard(new MemoryStore(), { global: { monthlyUsd: 1 } }, { now: fixedNow });
  const reservation = await guard.reserve({ provider: "openai", estimatedCostUsd: 0.6 });
  const status = await guard.status();
  assert.equal(status.global.monthly.reservedUsd, 0.6);
  await reservation.settle(0.4);
  const after = await guard.status();
  assert.equal(after.global.monthly.reservedUsd, 0);
  assert.equal(after.global.monthly.actualUsd, 0.4);
});

test("provider budget is enforced independently", async () => {
  const guard = new AiSpendGuard(
    new MemoryStore(),
    { global: { monthlyUsd: 10 }, providers: { openai: { monthlyUsd: 0.5 } } },
    { now: fixedNow }
  );
  await guard.record({ provider: "openai", costUsd: 0.45 });
  await assert.rejects(
    () => guard.reserve({ provider: "openai", estimatedCostUsd: 0.1 }),
    BudgetExceededError
  );
  const anthropic = await guard.reserve({ provider: "anthropic", estimatedCostUsd: 1 });
  await anthropic.release();
});

test("unknown estimates are denied by default", async () => {
  const guard = new AiSpendGuard(new MemoryStore(), { global: { monthlyUsd: 10 } }, { now: fixedNow });
  await assert.rejects(() => guard.reserve({ provider: "openai" }), UnknownEstimateError);
});

test("per-request ceiling blocks oversized requests", async () => {
  const guard = new AiSpendGuard(new MemoryStore(), { global: { perRequestUsd: 0.2 } }, { now: fixedNow });
  await assert.rejects(
    () => guard.reserve({ provider: "openai", estimatedCostUsd: 0.21 }),
    BudgetExceededError
  );
});

test("token cost estimator handles cached tokens", () => {
  const cost = estimateTokenCostUsd(
    { inputTokens: 1_000_000, cachedInputTokens: 500_000, outputTokens: 100_000 },
    { inputPerMillionUsd: 2, cachedInputPerMillionUsd: 0.5, outputPerMillionUsd: 10 }
  );
  assert.equal(cost, 2.25);
});
