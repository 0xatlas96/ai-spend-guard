import {
  JsonFileStore,
  SpendFirewall,
} from "ai-spend-guard";

const firewall = new SpendFirewall(
  new JsonFileStore(".ai-spend-guard/ledger.json"),
  {
    requiredContext: ["provider", "resource", "userId"],
    policies: [
      {
        id: "global-monthly",
        window: "utc-month",
        limitUsd: 50,
        maxOperationUsd: 2,
        maxConcurrent: 20,
      },
      {
        id: "per-user-day",
        groupBy: ["userId"],
        window: "utc-day",
        limitUsd: 1,
      },
    ],
  }
);

const protectedCall = await firewall.protect(
  {
    context: {
      provider: "your-provider",
      resource: "llm",
      userId: "alice",
      projectId: "demo",
    },
    estimatedCostUsd: 0.08,
    idempotencyKey: "request-123",
  },
  async () => {
    // Replace with the real paid provider call.
    return { usage: { costUsd: 0.052 } };
  },
  (result) => result.usage.costUsd
);

console.log(protectedCall.settlement);
