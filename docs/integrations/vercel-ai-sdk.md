# Vercel AI SDK 7 middleware

AI Spend Guard ships a first-class `LanguageModelV3Middleware` adapter for the Vercel AI SDK.

The budget reservation happens **before** `doGenerate()` or `doStream()` reaches the provider.

## Install

```bash
npm install ai ai-spend-guard
```

The integration expects the AI SDK 7 provider specification (`@ai-sdk/provider` v4).

## Wrap any LanguageModelV3

```ts
import { wrapLanguageModel, streamText } from "ai";
import { openai } from "@ai-sdk/openai";
import {
  SpendFirewall,
  JsonFileStore,
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

const pricing = {
  inputPerMillionUsd: YOUR_CURRENT_INPUT_PRICE,
  outputPerMillionUsd: YOUR_CURRENT_OUTPUT_PRICE,
};

const guardedModel = wrapLanguageModel({
  model: openai("your-model"),
  middleware: createVercelAiSpendMiddleware({
    firewall,

    // Safe upper bound before provider dispatch.
    defaultEstimatedCostUsd: 0.10,

    // Optional: settle from real usage rather than the conservative estimate.
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
  model: guardedModel,
  prompt: "Explain transaction isolation.",
  providerOptions: {
    aiSpendGuard: {
      userId: "user_123",
      projectId: "support",
      idempotencyKey: "request_842",
    },
  },
});
```

Use prices that are current for the exact provider/model/account terms you deploy. AI Spend Guard deliberately does not pretend a pricing table is timeless.

## Request-specific estimates

For tighter enforcement, pass a conservative upper bound for the individual request:

```ts
providerOptions: {
  aiSpendGuard: {
    userId,
    projectId: "support",
    estimatedCostUsd: 0.037,
  },
}
```

Priority:

1. `providerOptions.aiSpendGuard.estimatedCostUsd`
2. `estimateCostUsd(...)`
3. `defaultEstimatedCostUsd`

If none exists, the middleware refuses to dispatch the provider call.

## Generate and stream

The adapter handles both:

- `generateText()` / non-streaming generation
- `streamText()` / LanguageModelV3 streams

For streams, settlement happens when the SDK emits the final `finish` part containing usage.

If a stream errors, is cancelled, or ends without a finish usage event, the reservation remains open for reconciliation instead of being silently discarded.

## Context

The adapter automatically fills:

```text
provider = model.provider
model    = model.modelId
resource = llm
```

Add your application identity with either a static/resolver context:

```ts
createVercelAiSpendMiddleware({
  firewall,
  defaultEstimatedCostUsd: 0.1,
  context: {
    projectId: "my-app",
    environment: "production",
  },
});
```

or request metadata:

```ts
providerOptions: {
  aiSpendGuard: {
    userId,
    sessionId,
    agentId,
    route: "/api/chat",
  },
}
```

Request metadata overrides matching base context values.

## Conservative settlement mode

If `actualCostUsd` is omitted, successful calls settle the full amount that was reserved.

That is intentionally conservative:

```text
reserved $0.10
actual unknown
ledger settles $0.10
```

You may over-count, but the firewall does not under-count a successful call just because a price calculator was not configured.

## Provider errors

The default behavior is fail-closed.

A thrown network/SDK error after dispatch does **not** prove no provider work occurred. The middleware keeps the reservation open and throws `SpendReconciliationRequiredError`.

If you have a specific operation contract that guarantees a thrown call was never billable:

```ts
createVercelAiSpendMiddleware({
  firewall,
  defaultEstimatedCostUsd: 0.1,
  releaseOnProviderError: true,
});
```

Do not enable this merely for convenience.

## Reconciliation hook

```ts
createVercelAiSpendMiddleware({
  firewall,
  defaultEstimatedCostUsd: 0.1,
  onReconciliationRequired(event) {
    console.error(
      "Investigate provider request before releasing reservation",
      event.reservationId,
      event.phase,
    );
  },
});
```

The hook is observability-only; failures in the callback cannot change budget semantics.
