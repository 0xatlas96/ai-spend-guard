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

Use a stable `idempotencyKey` for paid side effects that may be retried. Reusing the same key with the same spend intent is blocked as a duplicate; reusing it for a different spend intent is rejected as a conflict. Result replay/deduplication remains the application's responsibility.

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

`JsonFileStore` and `NodeSqliteStore` are single-host stores. Shared/serverless/multi-host deployments can use the built-in `PostgresStore`, which serializes admission changes for a namespace with `SELECT ... FOR UPDATE`. Custom distributed stores must preserve the same atomic read/evaluate/reserve contract.

## Defense in depth

Use provider-side spend limits or alerts where available, least-privilege API keys, key rotation, separate credentials per environment/project, application rate limits, and observability in addition to AI Spend Guard.


## Ambiguous provider failures

A network error or SDK exception does not prove that a provider performed no billable work. For that reason, `SpendFirewall.protect()` keeps the reservation open by default when the protected operation throws.

This intentionally prefers temporary budget lock-up over silently forgetting a potentially billed request. Reconcile the provider request and then settle or explicitly release the reservation.

`{ onOperationError: "release" }` is available only for operation contracts where a thrown error is guaranteed to occur before billable dispatch.

Failures during actual-cost calculation or settlement also keep the reservation rather than automatically freeing budget.

## HTTP sidecar boundary

The built-in sidecar is a convenience control plane, not an internet-facing API gateway. Loopback is unauthenticated by default; non-loopback binds require a bearer token. Operators are responsible for network isolation and TLS when traffic leaves the host.

The sidecar deliberately exposes no provider credentials and does not proxy provider prompts/responses.

## AI SDK middleware boundary

The Vercel AI SDK middleware reserves before `doGenerate`/`doStream`. Successful streaming calls settle only on the final finish/usage event. Provider errors, cancelled streams, or streams that end without finish usage leave the reservation open for reconciliation unless the operator explicitly opts into release-on-error behavior.

