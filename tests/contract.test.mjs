import assert from "node:assert/strict";
import test from "node:test";
import { verifyBudgetContract } from "../dist/index.js";

test("budget contract combines doctor, policy tests, and spend plans", async () => {
  const report = await verifyBudgetContract({
    version: 1,
    name: "ci-contract",
    now: "2026-09-21T12:00:00.000Z",
    firewall: {
      requiredContext: ["provider", "resource", "userId"],
      policies: [
        {
          id: "global",
          window: "utc-month",
          limitUsd: 10,
          maxOperationUsd: 1,
        },
        {
          id: "per-user",
          groupBy: ["userId"],
          window: "utc-day",
          limitUsd: 1,
        },
      ],
    },
    policyTests: {
      cases: [
        {
          name: "normal request",
          request: {
            context: {
              provider: "openai",
              resource: "llm",
              userId: "alice",
            },
            estimatedCostUsd: 0.1,
          },
          expect: {
            allowed: true,
            blockingPolicyIds: [],
          },
        },
      ],
    },
    plans: [
      {
        id: "workload",
        maxTotalUsd: 1,
        plan: {
          operations: [
            {
              name: "chat",
              context: {
                provider: "openai",
                resource: "llm",
                userId: "alice",
              },
              estimatedCostUsd: 0.02,
              count: 20,
              concurrent: 3,
            },
          ],
        },
      },
    ],
  });

  assert.equal(report.passed, true);
  assert.equal(report.policyTests.passed, true);
  assert.equal(report.plans[0].passed, true);
  assert.deepEqual(report.failures, []);
});

test("budget contract fails on policy regression or expensive plan", async () => {
  const report = await verifyBudgetContract({
    version: 1,
    firewall: {
      requiredContext: ["provider", "resource", "userId"],
      policies: [
        {
          id: "per-user",
          groupBy: ["userId"],
          window: "utc-day",
          limitUsd: 0.5,
        },
      ],
    },
    policyTests: {
      cases: [
        {
          name: "intentionally wrong expectation",
          request: {
            context: {
              provider: "openai",
              resource: "llm",
              userId: "alice",
            },
            estimatedCostUsd: 0.6,
          },
          expect: {
            allowed: true,
          },
        },
      ],
    },
    plans: [
      {
        id: "too-expensive",
        maxTotalUsd: 0.4,
        plan: {
          operations: [
            {
              name: "chat",
              context: {
                provider: "openai",
                resource: "llm",
                userId: "alice",
              },
              estimatedCostUsd: 0.1,
              count: 6,
            },
          ],
        },
      },
    ],
  });

  assert.equal(report.passed, false);
  assert.equal(report.policyTests.passed, false);
  assert.equal(report.plans[0].passed, false);
  assert.ok(report.failures.length >= 2);
});
