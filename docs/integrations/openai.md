# OpenAI integration pattern

AI Spend Guard intentionally does not import or own the OpenAI SDK. Keep the provider SDK in your application and put the firewall immediately before the paid call.

## 1. Keep pricing in your application

Use pricing that is current for the exact model/account conditions you are using. Do not copy an old README value and assume it is permanent.

```ts
const pricing = {
  inputPerMillionUsd: YOUR_CURRENT_INPUT_PRICE,
  outputPerMillionUsd: YOUR_CURRENT_OUTPUT_PRICE,
  cachedInputPerMillionUsd: YOUR_CURRENT_CACHED_INPUT_PRICE,
};
```

## 2. Calculate a conservative pre-call estimate

Use the maximum input/output token envelope you are willing to allow.

```ts
import {
  SpendFirewall,
  estimateTokenCostUsd,
} from "ai-spend-guard";

const estimatedCostUsd = estimateTokenCostUsd(
  {
    inputTokens: estimatedMaximumInputTokens,
    outputTokens: configuredMaximumOutputTokens,
    cachedInputTokens: 0
  },
  pricing
);
```

For a hard-cap guarantee, prefer an upper bound over an average observed cost.

## 3. Reserve before the OpenAI call

```ts
const reservation = await firewall.reserve({
  context: {
    provider: "openai",
    model: modelName,
    resource: "llm",
    userId,
    projectId,
    route: "/api/chat",
    environment: "production"
  },
  estimatedCostUsd,
  idempotencyKey: requestId
});
```

If this throws `SpendPolicyError`, do not call OpenAI.

## 4. Execute, then settle actual usage

A typical Responses-style integration can map returned usage into your own cost calculator:

```ts
try {
  const response = await openai.responses.create({
    model: modelName,
    input,
    max_output_tokens: configuredMaximumOutputTokens
  });

  const actualCostUsd = estimateTokenCostUsd(
    {
      inputTokens: response.usage?.input_tokens ?? 0,
      outputTokens: response.usage?.output_tokens ?? 0,
      cachedInputTokens:
        response.usage?.input_tokens_details?.cached_tokens ?? 0
    },
    pricing
  );

  await reservation.settle(actualCostUsd);

  return response;
} catch (error) {
  await reservation.release();
  throw error;
}
```

Confirm the usage fields against the OpenAI SDK/API version you actually deploy. Provider response shapes and billing rules can evolve.

## Important failure rule

Only release a reservation when you know the paid operation did not complete.

For ambiguous network failures where the provider may have completed the request, use provider request IDs/idempotency/reconciliation rather than blindly releasing the budget hold.
