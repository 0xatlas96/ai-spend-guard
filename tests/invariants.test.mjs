import assert from "node:assert/strict";
import test from "node:test";
import {
  MemoryStore,
  SpendFirewall,
  SpendPolicyError,
} from "../dist/index.js";

function rng(seed) {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

test("invariant: admitted reservations never push an enforced dollar budget above its limit", async () => {
  const random = rng(0x5eed);
  const limit = 10;
  const firewall = new SpendFirewall(new MemoryStore(), {
    policies: [
      {
        id: "global",
        window: "lifetime",
        limitUsd: limit,
      },
    ],
  });

  const reservations = [];

  for (let index = 0; index < 1000; index += 1) {
    const estimate = Math.round((0.001 + random() * 0.5) * 1_000_000) / 1_000_000;
    try {
      const reservation = await firewall.reserve({
        context: { provider: "fuzz", resource: "other" },
        estimatedCostUsd: estimate,
      });
      reservations.push(reservation);

      const status = await firewall.status();
      assert.ok(
        status.policies[0].usage.projectedUsd <= limit + 1e-9,
        `projected spend escaped limit after admission ${index}`
      );
    } catch (error) {
      assert.ok(error instanceof SpendPolicyError);
      const status = await firewall.status();
      assert.ok(status.policies[0].usage.projectedUsd <= limit + 1e-9);
    }
  }

  await Promise.all(reservations.map((reservation) => reservation.release()));
});

test("invariant: grouped user budgets do not consume each other's allowance", async () => {
  const random = rng(0xc0ffee);
  const firewall = new SpendFirewall(new MemoryStore(), {
    requiredContext: ["userId"],
    policies: [
      {
        id: "per-user",
        groupBy: ["userId"],
        window: "lifetime",
        limitUsd: 1,
      },
    ],
  });

  const users = ["alice", "bob", "carla", "dina"];
  const reservations = [];

  for (let index = 0; index < 200; index += 1) {
    const userId = users[Math.floor(random() * users.length)];
    const estimate = 0.02 + Math.floor(random() * 4) * 0.01;
    try {
      reservations.push(
        await firewall.reserve({
          context: { userId, provider: "fuzz", resource: "llm" },
          estimatedCostUsd: estimate,
        })
      );
    } catch (error) {
      assert.ok(error instanceof SpendPolicyError);
    }
  }

  const status = await firewall.status();
  const policy = status.policies[0];
  assert.ok(policy.groups);
  for (const group of policy.groups) {
    assert.ok(
      group.usage.projectedUsd <= 1 + 1e-9,
      `group ${group.group.key} escaped its independent limit`
    );
  }

  await Promise.all(reservations.map((reservation) => reservation.release()));
});
