# Threat model and guarantee boundaries

AI Spend Guard is an application-side accounting and admission-control component. Its purpose is to prevent a cooperating application from initiating a paid request when the application's own configured budget would be exceeded.

## Assets

- configured spend ceilings
- ledger integrity
- reservation integrity
- accurate provider attribution
- predictable fail-closed behavior

## Trust assumptions

The guard assumes:

1. all protected paid requests pass through `reserve()` before the provider call
2. the application supplies a conservative upper-bound estimate if it wants a strict ceiling
3. actual usage is settled after successful requests
4. the selected `LedgerStore` provides transaction semantics appropriate for the deployment topology
5. the host/process and configuration are trusted

## Covered failure modes

### Concurrent requests

Outstanding reservations count toward projected spend. Two requests therefore cannot both consume the same remaining budget inside one transactional store.

### Application retries

Retries are safe only when each retry receives its own reservation or future idempotency helpers are used. The project does not currently deduplicate arbitrary retries.

### Store write failures

A reservation or settlement transaction that cannot be persisted throws. Callers should treat store errors as blocking errors, not as permission to bypass the guard.

## Not covered

### Calls outside the guard

The library cannot see or stop requests made by another service, leaked key, provider console, or code path that bypasses it.

### Underestimated cost

A provider can charge more than reserved. Settlement records the actual cost and subsequent requests will see the overage, but it cannot retroactively stop the completed provider call.

### Provider billing semantics

Taxes, rounding, batch discounts, cached-token rules, credits, asynchronous usage, minimum charges, and model price changes remain provider concerns. The caller should calculate estimates and actual cost using the commercial terms that apply to it.

### Distributed transactions

`JsonFileStore` is a single-host reference store. Shared/serverless/multi-host deployments need a transactional database-backed implementation of `LedgerStore`.

## Defense in depth

Use provider-side spend limits or alerts where available, least-privilege API keys, key rotation, separate credentials per environment/project, application rate limits, and observability in addition to AI Spend Guard.
