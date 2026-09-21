import type {
  FirewallConfig,
  SpendPlan,
} from "./firewall-types.js";
import type { PolicyTestSuite } from "./policy-tests.js";

export const starterFirewallConfig: FirewallConfig = {
  requiredContext: ["provider", "resource"],
  unknownEstimate: "deny",
  staleAfterMs: 60 * 60 * 1000,
  ledgerPath: ".ai-spend-guard/firewall-ledger.json",
  policies: [
    {
      id: "global-daily-hard-cap",
      description: "Hard daily safety ceiling across all paid AI work.",
      window: "utc-day",
      limitUsd: 5,
      limitCalls: 5_000,
      maxOperationUsd: 1,
      maxConcurrent: 20,
      warnAt: [0.8, 0.95],
    },
    {
      id: "global-monthly-hard-cap",
      description: "Hard monthly safety ceiling across all paid AI work.",
      window: "utc-month",
      limitUsd: 20,
      warnAt: [0.8, 0.95],
    },
  ],
};

export const starterSpendPlan: SpendPlan = {
  name: "starter worst-case workload",
  operations: [
    {
      name: "chat-turn",
      context: {
        provider: "openai",
        resource: "llm",
        environment: "production",
      },
      estimatedCostUsd: 0.05,
      count: 20,
      concurrent: 5,
    },
  ],
};

export const starterPolicyTests: PolicyTestSuite = {
  name: "starter policy contract",
  now: "2026-01-01T12:00:00.000Z",
  cases: [
    {
      name: "normal operation is allowed",
      request: {
        context: {
          provider: "openai",
          resource: "llm",
        },
        estimatedCostUsd: 0.05,
      },
      expect: {
        allowed: true,
        blockingPolicyIds: [],
      },
    },
    {
      name: "oversized single operation is denied",
      request: {
        context: {
          provider: "video-provider",
          resource: "video",
        },
        estimatedCostUsd: 1.5,
      },
      expect: {
        allowed: false,
        blockingPolicyIds: ["global-daily-hard-cap"],
      },
    },
  ],
};
