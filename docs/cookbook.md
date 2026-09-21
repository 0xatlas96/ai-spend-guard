# Cookbook

Practical policy patterns for common AI products.

## 1. Consumer chatbot

Goals:

- entire app <= $100/month
- each user <= $0.50/day
- no single turn > $0.10
- no user fans out more than 3 calls at once

```json
{
  "policies": [
    {
      "id": "global",
      "window": "utc-month",
      "limitUsd": 100
    },
    {
      "id": "user-day",
      "groupBy": ["userId"],
      "window": "utc-day",
      "limitUsd": 0.5,
      "maxOperationUsd": 0.1,
      "maxConcurrent": 3
    }
  ]
}
```

## 2. Multi-tenant SaaS

Goals:

- global safety ceiling
- independent monthly budget per customer/project
- independent daily abuse cap per end user

```json
{
  "policies": [
    {
      "id": "company-global",
      "window": "utc-month",
      "limitUsd": 1000
    },
    {
      "id": "tenant",
      "groupBy": ["projectId"],
      "window": "utc-month",
      "limitUsd": 50
    },
    {
      "id": "tenant-user",
      "groupBy": ["projectId", "userId"],
      "window": "utc-day",
      "limitUsd": 2,
      "limitCalls": 1000
    }
  ]
}
```

## 3. Autonomous agent

A runaway agent often fails through repeated cheap calls rather than one huge request.

Use both money and call count:

```json
{
  "id": "agent-run",
  "match": {
    "resource": ["llm", "tool", "search"]
  },
  "groupBy": ["agentId", "sessionId"],
  "window": {
    "rollingMs": 3600000
  },
  "limitUsd": 3,
  "limitCalls": 120,
  "maxConcurrent": 6
}
```

Use an idempotency key for irreversible/paid tool actions.

## 4. Image generation

```json
{
  "id": "image-user",
  "match": {
    "resource": "image"
  },
  "groupBy": ["userId"],
  "window": "utc-day",
  "limitUsd": 2,
  "maxOperationUsd": 0.5,
  "maxConcurrent": 2
}
```

Estimate the request with `estimateUnitCostUsd()`.

## 5. Voice AI

A voice session may contain LLM, STT, TTS and tool costs. Put all of them under one session budget:

```json
{
  "id": "voice-session",
  "groupBy": ["sessionId"],
  "window": {
    "rollingMs": 7200000
  },
  "limitUsd": 2,
  "limitCalls": 500
}
```

Each provider call still gets its own reservation, but they share one session ledger.

## 6. Video generation

Video calls can be large relative to an LLM turn.

```json
{
  "id": "video",
  "match": {
    "resource": "video"
  },
  "groupBy": ["projectId"],
  "window": "utc-day",
  "limitUsd": 20,
  "maxOperationUsd": 2,
  "maxConcurrent": 1
}
```

## 7. Background queue / n8n-style automation

Pattern:

1. derive an idempotency key from workflow execution ID + node/job identity
2. reserve before the paid operation
3. execute provider call
4. settle actual cost
5. release only if the provider call definitely failed before billing

Never auto-release simply because a worker disappeared; first verify the external operation did not complete.

## 8. Free tier vs paid tier

Use tags:

```ts
context: {
  userId,
  resource: "llm",
  tags: {
    plan: "free"
  }
}
```

Then:

```json
{
  "id": "free-users",
  "match": {
    "tags": {
      "plan": "free"
    }
  },
  "groupBy": ["userId"],
  "window": "utc-day",
  "limitUsd": 0.2
}
```

A separate paid-tier policy can set a larger allowance.

## 9. Shadow-test a stricter budget

```json
{
  "id": "next-policy",
  "match": {
    "environment": "production"
  },
  "limitUsd": 25,
  "window": "utc-month",
  "mode": "observe"
}
```

Watch the decisions first. Change to `enforce` only after the proposed limit behaves as intended.

## 10. CI cost regression gate

Model a worst-case workload in `spend-plan.json` and run:

```bash
ai-spend-guard plan \
  --file spend-plan.json \
  --config ai-spend-firewall.config.json \
  --max-total 100
```

Exit code 2 means the plan violates a policy or the explicit total ceiling.
