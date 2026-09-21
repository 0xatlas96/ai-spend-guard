import assert from "node:assert/strict";
import test from "node:test";
import {
  DuplicateOperationError,
  IdempotencyConflictError,
  MemoryStore,
  MissingSpendContextError,
  SpendFirewall,
  SpendPolicyError,
  SpendReconciliationRequiredError,
  inspectFirewallConfig,
  runPolicyTests,
} from "../dist/index.js";

const fixed = new Date("2026-09-21T12:00:00.000Z");
const fixedNow = () => fixed;

test("universal firewall blocks a global hard-cap overspend", async () => {
  const firewall = new SpendFirewall(
    new MemoryStore(),
    {
      policies: [
        {
          id: "global",
          window: "utc-day",
          limitUsd: 1,
          maxOperationUsd: 0.8,
        },
      ],
    },
    { now: fixedNow }
  );

  const first = await firewall.reserve({
    context: { provider: "openai", resource: "llm" },
    estimatedCostUsd: 0.75,
  });

  await assert.rejects(
    () =>
      firewall.reserve({
        context: { provider: "video-provider", resource: "video" },
        estimatedCostUsd: 0.3,
      }),
    SpendPolicyError
  );

  await first.release();
});

test("groupBy gives every user an independent budget", async () => {
  const firewall = new SpendFirewall(
    new MemoryStore(),
    {
      policies: [
        {
          id: "per-user",
          groupBy: ["userId"],
          window: "utc-day",
          limitUsd: 1,
        },
      ],
    },
    { now: fixedNow }
  );

  await firewall.recordActual({
    context: { userId: "alice", provider: "openai", resource: "llm" },
    actualCostUsd: 0.8,
  });

  const bob = await firewall.reserve({
    context: { userId: "bob", provider: "openai", resource: "llm" },
    estimatedCostUsd: 0.8,
  });

  await assert.rejects(
    () =>
      firewall.reserve({
        context: { userId: "alice", provider: "openai", resource: "llm" },
        estimatedCostUsd: 0.3,
      }),
    SpendPolicyError
  );

  await bob.release();

  const status = await firewall.status();
  const policy = status.policies.find((entry) => entry.policy.id === "per-user");
  assert.ok(policy?.groups);
  assert.equal(policy.groups.length, 1);
  assert.equal(policy.groups[0].group.values.userId, "alice");
});

test("grouped concurrency caps isolate agent sessions", async () => {
  const firewall = new SpendFirewall(
    new MemoryStore(),
    {
      policies: [
        {
          id: "agent-concurrency",
          groupBy: ["agentId", "sessionId"],
          maxConcurrent: 1,
        },
      ],
    },
    { now: fixedNow }
  );

  const one = await firewall.reserve({
    context: { agentId: "research", sessionId: "a", resource: "tool" },
    estimatedCostUsd: 0.01,
  });

  await assert.rejects(
    () =>
      firewall.reserve({
        context: { agentId: "research", sessionId: "a", resource: "tool" },
        estimatedCostUsd: 0.01,
      }),
    SpendPolicyError
  );

  const otherSession = await firewall.reserve({
    context: { agentId: "research", sessionId: "b", resource: "tool" },
    estimatedCostUsd: 0.01,
  });

  await one.release();
  await otherSession.release();
});

test("idempotency blocks duplicate paid side effects", async () => {
  const firewall = new SpendFirewall(
    new MemoryStore(),
    { policies: [{ id: "global", limitUsd: 10 }] },
    { now: fixedNow }
  );

  const reservation = await firewall.reserve({
    context: { provider: "openai", resource: "llm" },
    estimatedCostUsd: 0.1,
    idempotencyKey: "order-123",
  });

  await assert.rejects(
    () =>
      firewall.reserve({
        context: { provider: "openai", resource: "llm" },
        estimatedCostUsd: 0.1,
        idempotencyKey: "order-123",
      }),
    DuplicateOperationError
  );

  await assert.rejects(
    () =>
      firewall.reserve({
        context: { provider: "openai", resource: "llm" },
        estimatedCostUsd: 0.2,
        idempotencyKey: "order-123",
      }),
    IdempotencyConflictError
  );

  await reservation.settle(0.08);

  await assert.rejects(
    () =>
      firewall.reserve({
        context: { provider: "openai", resource: "llm" },
        estimatedCostUsd: 0.1,
        idempotencyKey: "order-123",
      }),
    DuplicateOperationError
  );
});

test("observe-mode policies report violations without blocking", async () => {
  const firewall = new SpendFirewall(
    new MemoryStore(),
    {
      policies: [
        { id: "hard-global", limitUsd: 10 },
        { id: "shadow", limitUsd: 0.05, mode: "observe" },
      ],
    },
    { now: fixedNow }
  );

  const decision = await firewall.explain({
    context: { provider: "openai", resource: "llm" },
    estimatedCostUsd: 0.1,
  });

  assert.equal(decision.allowed, true);
  assert.equal(decision.blockingViolations.length, 0);
  assert.equal(decision.observedViolations.length, 1);

  const reservation = await firewall.reserve({
    context: { provider: "openai", resource: "llm" },
    estimatedCostUsd: 0.1,
  });
  await reservation.release();
});

test("rolling windows ignore spend outside the configured duration", async () => {
  let now = new Date("2026-09-21T12:00:00.000Z");
  const firewall = new SpendFirewall(
    new MemoryStore(),
    {
      policies: [
        {
          id: "last-hour",
          window: { rollingMs: 60 * 60 * 1000 },
          limitUsd: 1,
        },
      ],
    },
    { now: () => now }
  );

  await firewall.recordActual({
    context: { provider: "openai", resource: "llm" },
    actualCostUsd: 0.9,
  });

  now = new Date("2026-09-21T13:01:00.000Z");

  const reservation = await firewall.reserve({
    context: { provider: "openai", resource: "llm" },
    estimatedCostUsd: 0.9,
  });

  await reservation.release();
});

test("plan simulation catches budget regressions before deployment", async () => {
  const firewall = new SpendFirewall(
    new MemoryStore(),
    {
      policies: [
        {
          id: "per-user-day",
          groupBy: ["userId"],
          window: "utc-day",
          limitUsd: 1,
        },
      ],
    },
    { now: fixedNow }
  );

  const result = await firewall.simulate({
    name: "candidate",
    operations: [
      {
        name: "chat-turn",
        context: { userId: "alice", provider: "openai", resource: "llm" },
        estimatedCostUsd: 0.1,
        count: 11,
        concurrent: 2,
      },
      {
        name: "chat-turn-bob",
        context: { userId: "bob", provider: "openai", resource: "llm" },
        estimatedCostUsd: 0.05,
        count: 5,
        concurrent: 1,
      },
    ],
  });

  assert.equal(result.totalCalls, 16);
  assert.equal(result.policyResults.length, 2);
  assert.equal(result.blockingViolations.length, 1);
  const alice = result.policyResults.find(
    (entry) => entry.group?.values.userId === "alice"
  );
  assert.ok(alice);
  assert.equal(alice.projectedUsd, 1.1);
});

test("stale reservations are visible but never auto-released", async () => {
  let now = new Date("2026-09-21T12:00:00.000Z");
  const firewall = new SpendFirewall(
    new MemoryStore(),
    {
      staleAfterMs: 60_000,
      policies: [{ id: "global", limitUsd: 10 }],
    },
    { now: () => now }
  );

  const reservation = await firewall.reserve({
    context: { provider: "video-provider", resource: "video" },
    estimatedCostUsd: 0.5,
  });

  now = new Date("2026-09-21T12:02:00.000Z");
  const stale = await firewall.listReservations({ olderThanMs: 60_000 });
  assert.equal(stale.length, 1);
  assert.equal(stale[0].stale, true);

  const status = await firewall.status();
  assert.equal(status.openReservations, 1);
  assert.equal(status.staleReservations, 1);

  await reservation.release();
});

test("doctor warns when there is no global enforced cap", () => {
  const report = inspectFirewallConfig({
    policies: [
      {
        id: "only-video",
        match: { resource: "video" },
        limitUsd: 10,
      },
    ],
  });

  assert.equal(report.ok, true);
  assert.ok(report.findings.some((finding) => finding.code === "no-global-cap"));
});


test("requiredContext fails closed before a scoped policy can be bypassed", async () => {
  const firewall = new SpendFirewall(
    new MemoryStore(),
    {
      requiredContext: ["provider", "resource", "userId"],
      policies: [
        {
          id: "per-user",
          groupBy: ["userId"],
          window: "utc-day",
          limitUsd: 1,
        },
      ],
    },
    { now: fixedNow }
  );

  await assert.rejects(
    () =>
      firewall.reserve({
        context: { provider: "openai", resource: "llm" },
        estimatedCostUsd: 0.1,
      }),
    MissingSpendContextError
  );

  const reservation = await firewall.reserve({
    context: {
      provider: "openai",
      resource: "llm",
      userId: "alice",
    },
    estimatedCostUsd: 0.1,
  });

  await reservation.release();
});


test("policy contract suite proves allow/deny behavior before deployment", async () => {
  const result = await runPolicyTests(
    {
      requiredContext: ["provider", "resource", "userId"],
      policies: [
        {
          id: "per-user",
          groupBy: ["userId"],
          window: "utc-day",
          limitUsd: 1,
        },
        {
          id: "shadow",
          match: { resource: "llm" },
          window: "utc-day",
          limitUsd: 0.5,
          mode: "observe",
        },
      ],
    },
    {
      name: "contract",
      now: "2026-09-21T12:00:00.000Z",
      cases: [
        {
          name: "fresh user allowed",
          request: {
            context: { provider: "openai", resource: "llm", userId: "alice" },
            estimatedCostUsd: 0.1,
          },
          expect: {
            allowed: true,
            blockingPolicyIds: [],
          },
        },
        {
          name: "spent user denied",
          setup: [
            {
              type: "record",
              context: { provider: "openai", resource: "llm", userId: "alice" },
              actualCostUsd: 0.95,
            },
          ],
          request: {
            context: { provider: "openai", resource: "llm", userId: "alice" },
            estimatedCostUsd: 0.1,
          },
          expect: {
            allowed: false,
            blockingPolicyIds: ["per-user"],
            observedPolicyIds: ["shadow"],
          },
        },
      ],
    }
  );

  assert.equal(result.passed, true);
  assert.equal(result.passedCases, 2);
  assert.equal(result.failedCases, 0);
});


test("required provider cannot be satisfied by the implicit custom fallback", async () => {
  const firewall = new SpendFirewall(
    new MemoryStore(),
    {
      requiredContext: ["provider", "resource"],
      policies: [{ id: "global", limitUsd: 10 }],
    },
    { now: fixedNow }
  );

  await assert.rejects(
    () =>
      firewall.reserve({
        context: { resource: "llm" },
        estimatedCostUsd: 0.1,
      }),
    MissingSpendContextError
  );
});

test("doctor warns when grouped identity fields are not required", () => {
  const report = inspectFirewallConfig({
    policies: [
      { id: "global", limitUsd: 10 },
      {
        id: "per-user",
        groupBy: ["userId"],
        limitUsd: 1,
      },
    ],
  });

  assert.ok(
    report.findings.some(
      (finding) => finding.code === "group-context-not-required"
    )
  );
});


test("protect keeps an ambiguous failed operation reserved by default", async () => {
  const firewall = new SpendFirewall(
    new MemoryStore(),
    {
      policies: [{ id: "global", limitUsd: 1 }],
    },
    { now: fixedNow }
  );

  let error;
  try {
    await firewall.protect(
      {
        context: { provider: "openai", resource: "llm" },
        estimatedCostUsd: 0.2,
      },
      async () => {
        throw new Error("network timeout after request dispatch");
      },
      async () => 0.1
    );
  } catch (caught) {
    error = caught;
  }

  assert.ok(error instanceof SpendReconciliationRequiredError);
  assert.equal(error.phase, "operation");

  const status = await firewall.status();
  assert.equal(status.openReservations, 1);
  assert.equal(status.policies[0].usage.reservedUsd, 0.2);

  await firewall.release(error.reservationId);
});

test("protect can explicitly release when operation failures are guaranteed unbilled", async () => {
  const firewall = new SpendFirewall(
    new MemoryStore(),
    {
      policies: [{ id: "global", limitUsd: 1 }],
    },
    { now: fixedNow }
  );

  await assert.rejects(
    () =>
      firewall.protect(
        {
          context: { provider: "openai", resource: "llm" },
          estimatedCostUsd: 0.2,
        },
        async () => {
          throw new Error("local validation failed before provider dispatch");
        },
        async () => 0.1,
        { onOperationError: "release" }
      ),
    /local validation failed/
  );

  const status = await firewall.status();
  assert.equal(status.openReservations, 0);
  assert.equal(status.policies[0].usage.reservedUsd, 0);
});

test("protect keeps reservation when actual-cost calculation fails after provider success", async () => {
  const firewall = new SpendFirewall(
    new MemoryStore(),
    {
      policies: [{ id: "global", limitUsd: 1 }],
    },
    { now: fixedNow }
  );

  let error;
  try {
    await firewall.protect(
      {
        context: { provider: "openai", resource: "llm" },
        estimatedCostUsd: 0.2,
      },
      async () => ({ ok: true }),
      async () => {
        throw new Error("usage response shape changed");
      }
    );
  } catch (caught) {
    error = caught;
  }

  assert.ok(error instanceof SpendReconciliationRequiredError);
  assert.equal(error.phase, "cost-calculation");

  const status = await firewall.status();
  assert.equal(status.openReservations, 1);

  await firewall.release(error.reservationId);
});


test("blocked attempts are observable without creating reservations", async () => {
  const decisions = [];
  const firewall = new SpendFirewall(
    new MemoryStore(),
    {
      policies: [{ id: "global", limitUsd: 0.05 }],
    },
    {
      now: fixedNow,
      onDecision: (decision) => {
        decisions.push(decision);
      },
    }
  );

  await assert.rejects(
    () =>
      firewall.reserve({
        context: { provider: "openai", resource: "llm" },
        estimatedCostUsd: 0.1,
      }),
    SpendPolicyError
  );

  assert.equal(decisions.length, 1);
  assert.equal(decisions[0].allowed, false);
  assert.equal(decisions[0].blockingViolations[0].policyId, "global");

  const status = await firewall.status();
  assert.equal(status.openReservations, 0);
});


test("progressive top-up is atomically blocked without losing the original reservation", async () => {
  const firewall = new SpendFirewall(
    new MemoryStore(),
    {
      policies: [
        {
          id: "global",
          window: "lifetime",
          limitUsd: 1,
          maxOperationUsd: 0.8,
        },
      ],
    },
    { now: fixedNow }
  );

  const first = await firewall.reserve({
    context: { provider: "openai", resource: "llm" },
    estimatedCostUsd: 0.6,
  });
  const second = await firewall.reserve({
    context: { provider: "search", resource: "search" },
    estimatedCostUsd: 0.3,
  });

  await assert.rejects(() => first.topUp(0.2), SpendPolicyError);
  assert.equal(first.estimatedCostUsd, 0.6);

  let status = await firewall.status();
  assert.ok(Math.abs(status.policies[0].usage.reservedUsd - 0.9) < 1e-9);

  const shrunk = await first.resize(0.4);
  assert.equal(shrunk.previousEstimatedCostUsd, 0.6);
  assert.equal(first.estimatedCostUsd, 0.4);

  const grown = await first.topUp(0.2);
  assert.ok(grown.decision);
  assert.ok(Math.abs(first.estimatedCostUsd - 0.6) < 1e-9);

  status = await firewall.status();
  assert.ok(Math.abs(status.policies[0].usage.reservedUsd - 0.9) < 1e-9);

  await first.release();
  await second.release();
});


test("firewall clones and freezes validated config against runtime mutation", async () => {
  const config = {
    policies: [{ id: "global", window: "lifetime", limitUsd: 1 }],
  };

  const firewall = new SpendFirewall(
    new MemoryStore(),
    config,
    { now: fixedNow }
  );

  config.policies[0].limitUsd = 1000;

  await assert.rejects(
    () =>
      firewall.reserve({
        context: { provider: "openai", resource: "llm" },
        estimatedCostUsd: 2,
      }),
    SpendPolicyError
  );

  assert.equal(firewall.config.policies[0].limitUsd, 1);
  assert.equal(Object.isFrozen(firewall.config), true);
  assert.equal(Object.isFrozen(firewall.config.policies), true);
  assert.equal(Object.isFrozen(firewall.config.policies[0]), true);
});
