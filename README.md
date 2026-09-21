# AI Spend Guard

[![CI](https://github.com/0xatlas96/ai-spend-guard/actions/workflows/ci.yml/badge.svg)](https://github.com/0xatlas96/ai-spend-guard/actions/workflows/ci.yml)
[![CodeQL](https://github.com/0xatlas96/ai-spend-guard/actions/workflows/codeql.yml/badge.svg)](https://github.com/0xatlas96/ai-spend-guard/actions/workflows/codeql.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

**The universal financial firewall for AI apps.**

AI Spend Guard sits **before** paid AI work and decides whether it is allowed to run.

It can protect:
- LLM calls
- image generation
- audio / TTS / STT
- video generation
- embeddings
- search APIs
- paid tools
- agent actions
- any other metered API call

It is **local-first, provider-agnostic, zero-runtime-dependency, and fail-closed by default**.

---

## The problem

A normal AI app often looks like this:

```text
user
  ↓
your app
  ↓
OpenAI / Anthropic / Gemini / image / audio / video / tools
  ↓
money
```

If a bug, retry loop, abusive user, or runaway agent starts calling paid services repeatedly, the bill can grow before anyone notices.

AI Spend Guard changes the path:

```text
user
  ↓
your app
  ↓
AI SPEND GUARD
  ↓
"Is this operation still inside policy?"
  ↓
YES → run paid operation
NO  → block before money is spent
```

---

# What makes it different

AI Spend Guard is not only a token counter.

It combines:

- **pre-call dollar enforcement**
- **atomic reserve → settle accounting**
- **per-user budgets**
- **per-project budgets**
- **per-agent budgets**
- **per-session budgets**
- **provider/model/resource budgets**
- **rolling windows**
- **call-count limits**
- **concurrency limits**
- **per-operation cost caps**
- **idempotency protection against duplicate paid side effects**
- **observe/shadow mode**
- **budget-as-code simulation before deployment**
- **CLI doctor for unsafe configurations**
- **persistent local JSON or SQLite ledgers**
- **no telemetry**
- **no provider API keys required by the library**
- **no runtime dependencies**

The goal is simple:

> **Do not merely report overspend after it happens. Prevent the next paid operation from happening.**

---

# Install

Until the npm release is published, install directly from GitHub:

```bash
npm install github:0xatlas96/ai-spend-guard
```

Or clone the repository:

```bash
git clone https://github.com/0xatlas96/ai-spend-guard.git
cd ai-spend-guard
npm install
npm run build
npm test
```

Runtime: **Node.js 20+**

The optional built-in SQLite store requires **Node.js 22.5+**.

---

# 60-second example

```ts
import {
  SpendFirewall,
  JsonFileStore,
} from "ai-spend-guard";

const firewall = new SpendFirewall(
  new JsonFileStore(".ai-spend-guard/ledger.json"),
  {
    policies: [
      {
        id: "global-monthly",
        window: "utc-month",
        limitUsd: 50,
        maxOperationUsd: 2,
        maxConcurrent: 20,
      },
      {
        id: "per-user-daily",
        groupBy: ["userId"],
        window: "utc-day",
        limitUsd: 1,
      },
    ],
  }
);

const reservation = await firewall.reserve({
  context: {
    provider: "openai",
    model: "your-model",
    resource: "llm",
    userId: "user_123",
    projectId: "support-bot",
  },
  estimatedCostUsd: 0.05,
});

try {
  const response = await callYourAIProvider();

  const actualCostUsd = calculateRealCost(response);

  await reservation.settle(actualCostUsd);
} catch (error) {
  await reservation.release();
  throw error;
}
```

If the request would exceed any matching enforced policy, it is blocked **before** the provider call.

---

# Why reserve first?

A naive limiter can fail under concurrency.

Imagine $1 remains.

```text
Request A checks budget → sees $1 → allowed
Request B checks budget → sees $1 → allowed

A spends $0.70
B spends $0.70

Total = $1.40
```

AI Spend Guard reserves money first:

```text
A reserves $0.70
remaining = $0.30

B tries to reserve $0.70
→ BLOCKED
```

That reserve → settle model is the core safety invariant.

---

# Universal spend context

Every operation can describe itself with context:

```ts
{
  provider: "openai",
  model: "example-model",
  resource: "llm",
  projectId: "support",
  userId: "user_42",
  sessionId: "session_9",
  agentId: "research-agent",
  route: "/api/chat",
  environment: "production",
  tags: {
    customerTier: "free"
  }
}
```

Policies can match any of these dimensions.

## Fail closed when context is missing

A scoped budget is only safe if the application always supplies the identity it depends on. Require critical context fields:

```json
{
  "requiredContext": ["provider", "resource", "userId"]
}
```

If a protected call forgets `userId`, it is rejected instead of silently falling outside a per-user policy. Tags can also be required with values such as `"tag:plan"`.

---

# Dynamic per-user / per-project / per-agent budgets

This is one of the most important features.

You do **not** need to create one policy for every user.

```json
{
  "id": "every-user-daily-budget",
  "groupBy": ["userId"],
  "window": "utc-day",
  "limitUsd": 1
}
```

That means:

```text
alice → independent $1/day
bob   → independent $1/day
carla → independent $1/day
...
```

Same idea for projects:

```json
{
  "id": "every-project-monthly-budget",
  "groupBy": ["projectId"],
  "window": "utc-month",
  "limitUsd": 20
}
```

Or agent runs:

```json
{
  "id": "agent-run-budget",
  "groupBy": ["agentId", "sessionId"],
  "window": { "rollingMs": 3600000 },
  "limitUsd": 2,
  "limitCalls": 100,
  "maxConcurrent": 8
}
```

---

# Policies

A policy can control four independent things:

```json
{
  "id": "production-hard-cap",
  "window": "utc-month",
  "limitUsd": 100,
  "limitCalls": 50000,
  "maxOperationUsd": 2,
  "maxConcurrent": 25
}
```

### `limitUsd`

Maximum settled + reserved dollar spend inside the window.

### `limitCalls`

Stops runaway loops even when individual calls are very cheap.

### `maxOperationUsd`

Stops one unusually expensive operation.

### `maxConcurrent`

Stops excessive fan-out even when the dollar budget still has room.

---

# Match only specific workloads

Example: stricter controls for video generation.

```json
{
  "id": "video-generation",
  "match": {
    "resource": "video"
  },
  "window": "utc-day",
  "limitUsd": 10,
  "maxOperationUsd": 1.5,
  "maxConcurrent": 2
}
```

Match values can also be arrays:

```json
{
  "match": {
    "provider": ["openai", "anthropic"],
    "resource": ["llm", "embedding"]
  }
}
```

---

# Rolling budgets

Built-in windows:

```text
utc-day
utc-month
lifetime
```

Or arbitrary rolling windows:

```json
{
  "window": {
    "rollingMs": 3600000
  }
}
```

That example means: **last 60 minutes**.

---

# Observe mode

Want to test a tighter policy without breaking production?

```json
{
  "id": "future-llm-limit",
  "match": {
    "resource": "llm",
    "environment": "production"
  },
  "limitUsd": 3,
  "window": "utc-day",
  "mode": "observe"
}
```

Violations are reported, but calls are not blocked.

Once you trust the rule:

```json
{
  "mode": "enforce"
}
```

---

# Idempotency protection

Retries can accidentally execute the same paid side effect twice.

Use:

```ts
const reservation = await firewall.reserve({
  context: {
    resource: "video",
    provider: "video-provider",
  },
  estimatedCostUsd: 0.80,
  idempotencyKey: "job:84:video:1",
});
```

Reusing that key is blocked.

If the same key is reused with different cost/context, AI Spend Guard throws an idempotency conflict instead of guessing.

---

# Protect an operation in one call

```ts
const result = await firewall.protect(
  {
    context: {
      provider: "openai",
      resource: "llm",
      userId: "user_123",
    },
    estimatedCostUsd: 0.08,
  },

  async () => {
    return callYourProvider();
  },

  async (response) => {
    return calculateActualCost(response);
  }
);
```

On success, actual spend is settled.

If the provider operation throws, AI Spend Guard **keeps the reservation open by default** because a timeout/error can be ambiguous: the provider may already have completed and billed the request. The thrown `SpendReconciliationRequiredError` contains the reservation ID so you can reconcile it safely.

Only when your operation contract guarantees that a thrown error means **nothing billable happened** should you opt into automatic release:

```ts
await firewall.protect(
  request,
  operation,
  calculateActualCost,
  { onOperationError: "release" }
);
```

A failure while calculating actual cost or settling the ledger also remains fail-closed; the reservation is not silently discarded.

---

# Budget-as-code: catch cost regressions before deploy

Commit a spend plan:

```json
{
  "name": "production-day worst case",
  "operations": [
    {
      "name": "chat-turn",
      "context": {
        "provider": "openai",
        "resource": "llm",
        "userId": "example-user"
      },
      "estimatedCostUsd": 0.02,
      "count": 20,
      "concurrent": 5
    }
  ]
}
```

Then run:

```bash
ai-spend-guard plan \
  --file spend-plan.json \
  --config ai-spend-firewall.config.json
```

If the plan violates an enforced policy, the CLI exits with code **2**.

That means it can be used in CI:

```bash
ai-spend-guard plan \
  --file spend-plan.json \
  --config ai-spend-firewall.config.json \
  --max-total 100
```

A pull request can therefore fail **before** code that creates an unacceptable worst-case AI bill reaches production.

## Policy contract tests

Cost policies are production behavior, so they should be testable like code.

Create a policy test suite:

```json
{
  "cases": [
    {
      "name": "spent user is denied",
      "setup": [
        {
          "type": "record",
          "context": {
            "provider": "openai",
            "resource": "llm",
            "userId": "alice"
          },
          "actualCostUsd": 0.98
        }
      ],
      "request": {
        "context": {
          "provider": "openai",
          "resource": "llm",
          "userId": "alice"
        },
        "estimatedCostUsd": 0.05
      },
      "expect": {
        "allowed": false,
        "blockingPolicyIds": ["every-user-daily-budget"]
      }
    }
  ]
}
```

Run it in CI:

```bash
ai-spend-guard test-policies \
  --file policy-tests.json \
  --config ai-spend-firewall.config.json
```

Every case runs against an isolated in-memory ledger. A failed contract exits with code **2**, so policy changes cannot silently weaken expected allow/deny behavior.

---

# Configuration doctor

Run:

```bash
ai-spend-guard doctor --config ai-spend-firewall.config.json
```

It detects common configuration weaknesses such as:

- no enforced global cap
- all policies accidentally left in observe mode
- unknown/unpriced operations being allowed
- no per-operation ceiling
- no call-count protection
- no concurrency protection

---

# Explain a decision before executing

```bash
ai-spend-guard explain \
  --provider openai \
  --resource llm \
  --user user_42 \
  --project support \
  --cost 0.08 \
  --config ai-spend-firewall.config.json
```

You get the matched policies, projected usage, warnings, and blocking reason.

---

# CLI

```text
status
doctor
test-policies
explain
reserve
settle
release
record
reservations
plan
```

Run:

```bash
ai-spend-guard help
```

---

# Stale reservation recovery

If a process crashes after reserving money but before settlement, AI Spend Guard intentionally remains **fail-closed**.

Inspect old reservations:

```bash
ai-spend-guard reservations \
  --older-than 1h \
  --config ai-spend-firewall.config.json
```

Then explicitly release the reservation only after you know the external operation did not complete:

```bash
ai-spend-guard release \
  --id <reservation-id> \
  --config ai-spend-firewall.config.json
```

It never silently releases stale reservations.

---

# Storage

## MemoryStore

Best for:
- tests
- scripts
- ephemeral use

Not durable.

---

## JsonFileStore

Best for:
- local apps
- CLIs
- one-host deployments

Uses:
- atomic file replacement
- process mutex
- lock file

For stronger local durability/concurrency, use SQLite.

---

## NodeSqliteStore

Node **22.5+** only.

No third-party dependency.

```ts
import {
  NodeSqliteStore,
  SpendFirewall,
} from "ai-spend-guard";

const store = await NodeSqliteStore.open(
  ".ai-spend-guard/ledger.sqlite"
);

const firewall = new SpendFirewall(store, config);
```

Uses SQLite transactions so multiple workers using the same local database share one budget ledger.

For multi-host/serverless systems, implement `LedgerStore` with a transactional shared database.

---

# Cost calculation

AI Spend Guard intentionally does not ship timeless provider pricing tables.

Provider pricing changes.

Instead, the application supplies the pricing that actually applies to it.

## Tokens

```ts
import { estimateTokenCostUsd } from "ai-spend-guard";

const cost = estimateTokenCostUsd(
  {
    inputTokens: 8_000,
    outputTokens: 2_000,
  },
  {
    inputPerMillionUsd: 1.25,
    outputPerMillionUsd: 10,
  }
);
```

## Images / tools / API units

```ts
import { estimateUnitCostUsd } from "ai-spend-guard";

const cost = estimateUnitCostUsd(
  4,    // four generations
  0.05  // $0.05 each
);
```

## Audio / video duration

```ts
import { estimateDurationCostUsd } from "ai-spend-guard";

const cost = estimateDurationCostUsd(
  90,   // seconds
  0.60  // price per minute
);
```

## Composite workflows

```ts
import { estimateCompositeCostUsd } from "ai-spend-guard";

const total = estimateCompositeCostUsd([
  { units: 1, pricePerUnitUsd: 0.04 },
  { units: 3, pricePerUnitUsd: 0.08 },
  { units: 1, pricePerUnitUsd: 0.50 },
]);
```

That makes one shared reservation possible for a workflow containing multiple paid components.

---

# Example use cases

## AI chatbot

```text
global app budget
+ per-user daily budget
+ per-request cost cap
```

## Multi-tenant SaaS

```text
global budget
+ groupBy projectId
+ groupBy userId
+ route-specific limits
```

## Autonomous research agent

```text
groupBy agentId + sessionId
+ rolling 1-hour budget
+ call-count cap
+ concurrency cap
```

## Image generation app

```text
resource=image
+ per-user quota
+ max cost per generation
```

## Voice AI

```text
resource=audio
+ LLM spend
+ search/tool spend
+ one combined session budget
```

## Video pipeline

```text
resource=video
+ strict per-operation ceiling
+ concurrency=1 or 2
+ project monthly budget
```

## n8n / background automation

Reserve before the paid node/script runs, settle after the provider returns, and use an idempotency key derived from the workflow execution/job ID.

---

# Safety model

AI Spend Guard can protect against:

- runaway loops routed through the firewall
- accidental retry duplication when idempotency keys are used
- excessive parallel requests
- one user/project/agent consuming the whole application budget
- expensive individual operations
- budget races under supported transactional storage
- cost regressions caught by pre-deployment spend plans

It cannot magically protect against:

- calls that bypass the firewall
- leaked API keys used somewhere else
- provider prices that your estimator got wrong
- actual provider charges higher than the amount you reserved
- provider-side taxes, rounding, credits, account-specific contracts, or delayed billing

For serious production systems use AI Spend Guard **together with** provider-side limits, alerts, rate limits, and least-privilege API keys.

See [docs/threat-model.md](docs/threat-model.md).

---

# Configuration schema

JSON Schema is included for editor autocomplete and validation:

- [Firewall config schema](schema/ai-spend-firewall.schema.json)
- [Spend plan schema](schema/spend-plan.schema.json)
- [Policy test schema](schema/policy-tests.schema.json)

Example files:

- [ai-spend-firewall.config.example.json](ai-spend-firewall.config.example.json)
- [spend-plan.example.json](spend-plan.example.json)
- [policy-tests.example.json](policy-tests.example.json)

---

# Legacy simple guard

The original `AiSpendGuard` API is still available for simple global/provider daily/monthly limits.

New projects should generally use **`SpendFirewall`**.

---

# Project status

**v0.2 — active public beta**

Current implemented core:

- universal spend context
- hierarchical matching
- dynamic `groupBy` budgets
- rolling windows
- dollar/call/concurrency/per-operation limits
- observe mode
- idempotency protection
- reserve/settle accounting
- plan simulation
- policy contract tests
- required-context fail-closed enforcement
- CLI doctor
- stale-reservation inspection
- Memory / JSON / SQLite storage
- CI + CodeQL

See [ROADMAP.md](ROADMAP.md).

---

# Contributing

Read:

- [CONTRIBUTING.md](CONTRIBUTING.md)
- [AGENTS.md](AGENTS.md)
- [GOVERNANCE.md](GOVERNANCE.md)

Focused issues and pull requests are welcome.

---

# Security

Do not publish:

- provider API keys
- secrets
- private billing exports
- production `.env` files

See [SECURITY.md](SECURITY.md).

---

# License

MIT — see [LICENSE](LICENSE).
