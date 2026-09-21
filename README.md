# AI Spend Guard

[![CI](https://github.com/0xatlas96/ai-spend-guard/actions/workflows/ci.yml/badge.svg)](https://github.com/0xatlas96/ai-spend-guard/actions/workflows/ci.yml)
[![CodeQL](https://github.com/0xatlas96/ai-spend-guard/actions/workflows/codeql.yml/badge.svg)](https://github.com/0xatlas96/ai-spend-guard/actions/workflows/codeql.yml)

**Stop unexpected AI API spend before the request leaves your app.**

AI Spend Guard is a provider-agnostic, local-first budget firewall for LLM and AI API calls. It reserves a conservative cost estimate **before** a paid request runs, counts concurrent reservations against the same budget, and blocks new work when a daily, monthly, provider, or per-request ceiling would be exceeded.

> [!IMPORTANT]
> AI Spend Guard is an application-side control, not a provider billing control. To get hard-stop behavior, route every paid request through the guard and reserve a conservative **upper-bound** cost before sending the request. A provider can still bill more than your estimate, and calls made outside the guard are invisible to it.

## Why

AI applications often fail in the same way: a loop runs longer than expected, concurrency spikes, retries multiply, or a model silently becomes more expensive. Provider dashboards are useful after the fact, but developers also need a control in front of the request.

AI Spend Guard is designed around four rules:

1. **Reserve first.** Concurrent requests consume budget before they run.
2. **Fail closed by default.** Requests without a cost estimate are denied unless you explicitly allow them.
3. **Separate scopes.** Apply global limits and tighter limits per provider.
4. **Own your data.** No telemetry, no hosted service, no API keys sent anywhere.

## Features

- Global **daily**, **monthly**, and **per-request** USD limits
- Independent limits for OpenAI, Anthropic, Gemini, or any custom provider name
- Reservation → settlement flow to prevent parallel requests from racing past a limit
- Warning thresholds such as 80% and 95%
- Persistent JSON ledger with a cross-process lock for local/single-host workloads
- In-memory store for tests and ephemeral workers
- Pluggable `LedgerStore` interface for Postgres/Redis/SQLite or other transactional backends
- Generic token-cost estimator with caller-supplied pricing
- CLI for status, reserve, settle, release, and manual charge recording
- Zero runtime dependencies
- TypeScript-first, Node.js 20+

## Install

The repository can be used directly today. npm publishing is planned after the first public release cycle.

```bash
npm install
npm run build
```

When published to npm, the intended install is:

```bash
npm install ai-spend-guard
```

## 60-second example

```ts
import { AiSpendGuard, JsonFileStore } from "ai-spend-guard";

const guard = new AiSpendGuard(
  new JsonFileStore(".ai-spend-guard/ledger.json"),
  {
    global: {
      dailyUsd: 5,
      monthlyUsd: 50,
      perRequestUsd: 1,
    },
    providers: {
      openai: { monthlyUsd: 25 },
      anthropic: { monthlyUsd: 15 },
      gemini: { monthlyUsd: 10 },
    },
  }
);

const reservation = await guard.reserve({
  provider: "openai",
  estimatedCostUsd: 0.05, // use a conservative upper bound
});

try {
  // const response = await openai.responses.create(...)
  const actualCostUsd = 0.031;
  await reservation.settle(actualCostUsd);
} catch (error) {
  await reservation.release();
  throw error;
}
```

If the new reservation would push a configured budget over its ceiling, `reserve()` throws `BudgetExceededError` **before** your paid API call executes.

## Protect a call in one block

```ts
const result = await guard.protect(
  { provider: "openai", estimatedCostUsd: 0.08 },
  async () => {
    return callYourProvider();
  },
  async (response) => {
    return calculateActualCost(response.usage);
  }
);
```

If the operation throws, the reservation is released automatically. If it succeeds, the real cost is settled into the ledger.

## Cost estimation

AI Spend Guard deliberately does **not** hard-code provider pricing because model prices change. Your application owns the pricing table it wants to enforce.

```ts
import { estimateTokenCostUsd } from "ai-spend-guard";

const estimatedCostUsd = estimateTokenCostUsd(
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

For strict budget protection, estimate from the maximum input/output tokens the request is allowed to consume rather than from an optimistic average.

## Configuration file

Copy `ai-spend-guard.config.example.json`:

```json
{
  "global": {
    "dailyUsd": 5,
    "monthlyUsd": 50,
    "perRequestUsd": 1
  },
  "providers": {
    "openai": { "monthlyUsd": 25 },
    "anthropic": { "monthlyUsd": 15 },
    "gemini": { "monthlyUsd": 10 }
  },
  "warnAt": [0.8, 0.95],
  "unknownEstimate": "deny",
  "ledgerPath": ".ai-spend-guard/ledger.json"
}
```

Daily and monthly windows currently use **UTC**.

## CLI

After `npm run build`:

```bash
node dist/cli.js status --config ai-spend-guard.config.json
node dist/cli.js reserve --provider openai --cost 0.05
node dist/cli.js settle --id <reservation-id> --cost 0.031
node dist/cli.js release --id <reservation-id>
node dist/cli.js record --provider openai --cost 0.02
```

`record` is useful for importing historical/manual spend but cannot protect a request that already happened.

## Concurrency model

A naive budget check can still overspend:

```text
Request A checks: $9 / $10 → allowed
Request B checks: $9 / $10 → allowed
A spends $1
B spends $1
Result: $11
```

AI Spend Guard reserves the estimated cost transactionally:

```text
Request A reserves $1 → projected $10
Request B tries $1    → blocked
```

`MemoryStore` serializes transactions in-process. `JsonFileStore` additionally uses a lock file so multiple Node processes on the same host do not update the ledger simultaneously. Distributed deployments should provide a transactional `LedgerStore` backed by their database.

## What a hard limit can and cannot guarantee

**Can protect against:**

- accidental loops routed through the guard
- excessive parallelism routed through the guard
- requests whose conservative estimate would exceed your configured budget
- one provider consuming a budget intended for another

**Cannot independently protect against:**

- requests made outside AI Spend Guard
- provider-side minimums, rounding, taxes, credits, delayed usage, or pricing changes
- actual cost exceeding the amount your application reserved
- compromised provider credentials used elsewhere

Use provider-side budgets/alerts as a second line of defense whenever available.

See [`docs/threat-model.md`](docs/threat-model.md) for the security and guarantee model.

## Project status

**v0.1 — public beta.** The core budget/reservation model is implemented. The next priorities are battle-testing integrations, a database-backed reference store, better import/report tooling, and published provider examples.

See [`ROADMAP.md`](ROADMAP.md).

## Contributing

Issues and focused PRs are welcome. Start with [`CONTRIBUTING.md`](CONTRIBUTING.md). Agent-assisted contributions should also follow [`AGENTS.md`](AGENTS.md).

## Security

Do not post API keys, provider credentials, `.env` files, or private billing exports in issues. See [`SECURITY.md`](SECURITY.md) for responsible reporting.

## License

MIT — see [`LICENSE`](LICENSE).
