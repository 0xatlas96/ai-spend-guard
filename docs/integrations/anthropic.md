# Anthropic integration pattern

The firewall pattern is provider-independent:

1. calculate a conservative maximum cost
2. reserve
3. call Anthropic
4. calculate actual cost from returned usage
5. settle
6. release only on a confirmed non-billed failure

```ts
const reservation = await firewall.reserve({
  context: {
    provider: "anthropic",
    model,
    resource: "llm",
    userId,
    projectId
  },
  estimatedCostUsd
});

try {
  const message = await anthropic.messages.create(request);

  const actualCostUsd = yourAnthropicCostCalculator(message.usage);

  await reservation.settle(actualCostUsd);
  return message;
} catch (error) {
  await reservation.release();
  throw error;
}
```

Anthropic pricing can distinguish normal input, cache reads, cache writes, output tokens, model families, and account terms. Keep that pricing logic in your application or a versioned pricing module rather than assuming one permanent table inside AI Spend Guard.
