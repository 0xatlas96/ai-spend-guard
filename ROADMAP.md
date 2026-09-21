# Roadmap

The roadmap is directional, not a promise of delivery dates.

## v0.1 — Core guard

- [x] global daily/monthly/per-request limits
- [x] provider-specific limits
- [x] reservation + settlement workflow
- [x] in-memory transactional store
- [x] persistent single-host JSON store with lock file
- [x] generic token-cost estimator
- [x] CLI status/accounting commands
- [x] CI, security policy, contribution workflow

## v0.2 — Universal financial firewall

- [x] universal spend context: provider/model/resource/project/user/session/agent/route/environment/tags
- [x] exact-match and multi-value policy selectors
- [x] dynamic grouped budgets with `groupBy`
- [x] per-user, per-project, per-agent, per-session and per-model budgets
- [x] UTC day/month, lifetime and arbitrary rolling windows
- [x] dollar, call-count, per-operation and concurrency limits
- [x] observe/shadow policy mode
- [x] idempotency conflict/duplicate protection
- [x] stale reservation inspection without unsafe auto-release
- [x] budget-as-code spend-plan simulation
- [x] CLI configuration doctor
- [x] generic unit/duration/composite cost estimators
- [x] zero-dependency Node SQLite store (Node 22.5+)
- [x] JSON Schemas for config and spend plans
- [x] expanded test suite, CI and CodeQL

## v0.3 — Production integrations

- [ ] publish npm package and automate trusted releases
- [ ] OpenAI integration recipe/helper
- [ ] Anthropic integration recipe/helper
- [ ] Gemini integration recipe/helper
- [ ] Vercel AI SDK middleware
- [ ] n8n/community-node integration
- [ ] LiveKit/Pipecat voice examples
- [ ] versioned pricing-catalog format with explicit source/date metadata
- [ ] Postgres transactional store
- [ ] Redis transactional store/reference
- [ ] serverless deployment recipes
- [ ] structured metrics / OpenTelemetry hooks
- [ ] import/export ledger tooling

## v0.4 — Audit and governance

- [ ] tamper-evident audit receipts
- [ ] policy-decision export
- [ ] optional approval requirement above a spend threshold
- [ ] signed policy bundles
- [ ] organization/team policy inheritance
- [ ] policy test fixtures / golden files
- [ ] configuration migration tooling

## Quality / hardening

- [ ] high-concurrency benchmarks
- [ ] fuzz/property tests for policy evaluation
- [ ] crash/recovery tests for storage backends
- [ ] adversarial idempotency/retry tests
- [ ] long-running rolling-window tests
- [ ] public benchmark suite comparing limiter designs
- [ ] formal documentation of the reserve/settle invariant

## Research

- [ ] optional proxy/gateway mode
- [ ] cost-aware model routing hints
- [ ] PR-level spend regression reports
- [ ] historical cost forecasting
- [ ] optional hosted dashboard built on the same local-first core
