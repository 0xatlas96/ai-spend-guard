# Postgres store for multi-host and serverless deployments

`JsonFileStore` and `NodeSqliteStore` are excellent for one host. They are not a shared transaction boundary across multiple machines/functions.

Use `PostgresStore` when several application instances must enforce **one shared budget**.

## Install

```bash
npm install ai-spend-guard pg
```

`pg` is an optional peer dependency. The core package does not require Postgres.

## Usage

```ts
import { SpendFirewall } from "ai-spend-guard";
import { PostgresStore } from "ai-spend-guard/postgres";

const store = await PostgresStore.open({
  connectionString: process.env.DATABASE_URL!,
  namespace: "production-api",
});

const firewall = new SpendFirewall(store, {
  policies: [
    {
      id: "global-monthly",
      window: "utc-month",
      limitUsd: 500,
    },
  ],
});
```

## Existing Pool

```ts
import { Pool } from "pg";
import { PostgresStore } from "ai-spend-guard/postgres";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

const store = await PostgresStore.open({
  pool,
  namespace: "production-api",
});
```

When you pass your own pool, `store.close()` does not close it.

## Transaction model

The reference implementation keeps a versioned ledger document in one Postgres row per namespace.

Every reservation transaction does:

```sql
BEGIN;
SELECT payload ... FOR UPDATE;
-- evaluate policies + update reservation atomically
UPDATE ...;
COMMIT;
```

That intentionally serializes writes within one namespace. It favors correctness and a simple auditable transaction invariant over maximum write throughput.

Different namespaces use different rows and can proceed independently.

## Why a row lock matters

Without an atomic transaction:

```text
worker A reads $9 / $10
worker B reads $9 / $10
A allows $1
B allows $1
→ budget race
```

With `SELECT ... FOR UPDATE`, only one worker can read/evaluate/write that namespace's ledger at a time.

The CI suite starts a real Postgres service and sends concurrent reservations through independent store instances to verify that they cannot spend the same remaining headroom.

## Namespaces

Use a namespace to isolate independent ledgers:

```ts
namespace: "prod"
namespace: "staging"
namespace: "customer-a"
```

For high-cardinality tenants, prefer policy `groupBy` inside a smaller number of application namespaces rather than creating a database row for every end user.

## Table

Default table:

```text
ai_spend_guard_state
```

Override only with a trusted static identifier:

```ts
tableName: "company_ai_budget_state"
```

The implementation rejects unsafe identifier characters.

## Operational notes

- Back up the ledger like other application state.
- Use a database geographically close to the callers that need synchronous admission decisions.
- Monitor transaction latency and pool saturation.
- A database outage should be treated as **fail closed**; do not bypass the firewall on store errors.
- The JSON document reference implementation is correctness-first. Extremely high-throughput installations may implement a normalized custom `LedgerStore` while preserving the same atomic transaction contract.
