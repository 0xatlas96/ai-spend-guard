# Design notes

## Reservation accounting

The ledger contains two money classes:

- **actual**: completed charges already incurred
- **reserved**: conservative estimates for requests admitted but not yet settled/released

Budget admission uses:

```text
projected = actual + reserved + new_estimate
allow only when projected <= configured_limit
```

That is the core invariant.

## Why prices are not bundled

AI provider prices change independently from library releases and can vary by account, batch mode, caching, region, contract, or product. The core therefore accepts cost values and offers a generic token calculator with caller-supplied rates.

## Storage contract

A `LedgerStore` must provide `transact(fn)` so read-check-write happens atomically relative to other transactions using that store. A plain `get()` + `set()` interface is intentionally insufficient because it makes concurrent overspend easy.

`MemoryStore` serializes in one process. `JsonFileStore` combines an in-process mutex with an exclusive lock file for cooperating Node processes on one host.

## Settlement overruns

Settlement never rejects a real charge because the money may already have been spent. If actual cost is above the reservation, the ledger records the full actual amount and reports `overrunUsd`. Future reservations are then evaluated against the higher actual spend.
