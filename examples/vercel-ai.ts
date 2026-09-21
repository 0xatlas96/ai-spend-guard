import { openai } from "@ai-sdk/openai";
import { streamText, wrapLanguageModel } from "ai";
import {
  JsonFileStore,
  SpendFirewall,
  estimateTokenCostUsd,
} from "ai-spend-guard";
import { createVercelAiSpendMiddleware } from "ai-spend-guard/vercel-ai";

const firewall = new SpendFirewall(
  new JsonFileStore(".ai-spend-guard/ledger.json"),
  {
    requiredContext: ["provider", "resource", "userId"],
    policies: [
      {
        id: "global",
        window: "utc-month",
        limitUsd: 50,
      },
      {
        id: "per-user",
        groupBy: ["userId"],
        window: "utc-day",
        limitUsd: 1,
      },
    ],
  }
);

// Replace with current pricing for the exact model/account you deploy.
const pricing = {
  inputPerMillionUsd: 1,
  outputPerMillionUsd: 5,
};

const model = wrapLanguageModel({
  model: openai("your-model"),
  middleware: createVercelAiSpendMiddleware({
    firewall,
    defaultEstimatedCostUsd: 0.10,
    actualCostUsd: ({ usage }) =>
      estimateTokenCostUsd(
        {
          inputTokens: usage.inputTokens.total ?? 0,
          cachedInputTokens: usage.inputTokens.cacheRead ?? 0,
          outputTokens: usage.outputTokens.total ?? 0,
        },
        pricing
      ),
  }),
});

const result = streamText({
  model,
  prompt: "Explain serializable transaction isolation.",
  providerOptions: {
    aiSpendGuard: {
      userId: "alice",
      projectId: "docs-example",
      idempotencyKey: "example-request-1",
    },
  },
});

for await (const chunk of result.textStream) {
  process.stdout.write(chunk);
}
