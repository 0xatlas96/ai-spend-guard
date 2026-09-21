# Gemini integration pattern

```ts
const reservation = await firewall.reserve({
  context: {
    provider: "gemini",
    model,
    resource: "llm",
    userId,
    projectId
  },
  estimatedCostUsd
});

try {
  const response = await modelClient.generateContent(request);

  const actualCostUsd = yourGeminiCostCalculator(
    response.usageMetadata
  );

  await reservation.settle(actualCostUsd);
  return response;
} catch (error) {
  await reservation.release();
  throw error;
}
```

Use a conservative estimate before the request and calculate settlement from the billing/usage fields that apply to the exact Gemini API and model you deploy. Pricing and billable token categories can change independently from this library.
