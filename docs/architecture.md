# Architecture

AI Spend Guard is intentionally split into four layers.

```text
application
   │
   ▼
SpendFirewall
   │
   ├── policy evaluation
   ├── idempotency check
   ├── reserve / settle accounting
   └── warnings / decisions
   │
   ▼
LedgerStore
   │
   ├── MemoryStore
   ├── JsonFileStore
   ├── NodeSqliteStore
   └── custom transactional stores
```

## Core invariant

Before a protected operation runs:

```text
projected spend =
  settled spend
+ outstanding reservations
+ new conservative estimate
```

The operation is admitted only if every matching enforced policy permits that projected state.

This is deliberately different from post-call observability. A callback that learns the cost after the provider responds cannot prevent that provider call.

## Policy evaluation

A request has a `SpendContext`:

```text
provider
model
resource
projectId
userId
sessionId
agentId
route
environment
tags
```

Policies first filter by `match`. All matching enforced policies apply; there is no "first match wins" behavior.

A policy may then `groupBy` one or more context fields. Grouping turns one policy into an independent budget for every identity value.

Example:

```json
{
  "id": "per-user",
  "groupBy": ["userId"],
  "limitUsd": 1
}
```

The same policy produces separate ledgers for Alice, Bob, and every other user value encountered.

## Transaction requirement

`LedgerStore.transact(fn)` is the most important storage contract.

A correct implementation must make this sequence atomic relative to competing writers:

1. read current settled/reserved spend
2. evaluate policy
3. add reservation

A plain `get()` followed later by `set()` is not sufficient because concurrent requests can both observe the same remaining budget.

## Stores

### MemoryStore

Serializes transactions with an in-process mutex.

### JsonFileStore

Adds an exclusive lock file and atomic file replacement. It is intended for local/single-host workloads.

### NodeSqliteStore

Uses `BEGIN IMMEDIATE` SQLite transactions and a process-level path mutex. It is the preferred built-in durable store when Node >= 22.5 is available.

### Distributed stores

Multi-host/serverless deployments should implement `LedgerStore` on a transactional shared database. The critical requirement is atomic read/evaluate/write semantics.

## Why settlement can exceed a policy

The reservation is an estimate.

If a provider later charges more than reserved, settlement records the full real amount. Rejecting the settlement would hide money already spent.

The resulting overrun is returned to the caller and future reservations see the higher ledger total.

## Idempotency

An optional `idempotencyKey` is stored with the reservation/charge together with a stable fingerprint of context, estimate, and request ID.

- same key + same intent: duplicate execution is blocked
- same key + different intent: conflict is thrown

The firewall does not replay application results. It prevents duplicate paid execution; result replay remains the application's responsibility.

## Observe mode

An observe-only policy runs the same evaluator and emits violations, but those violations are not included in the blocking set.

This lets teams deploy a new budget rule as a shadow policy before making it authoritative.

## Budget-as-code

Spend plans run the same policy model without mutating the ledger. They can model:

- operation count
- estimated unit cost
- worst-case concurrency
- grouped identities

CLI exit code 2 makes policy violations usable as a CI gate.

## Trust boundary

The firewall assumes:

- protected calls actually pass through it
- estimates are conservative enough for the desired guarantee
- actual spend is settled
- the selected store is appropriate for the deployment topology

See `docs/threat-model.md` for the full boundary.
