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
- [x] fail-closed required context enforcement
- [x] policy contract test suites and CI command

## v0.3 — Production integrations

- [~] npm Trusted Publishing workflow implemented; registry publisher setup/release still required
- [x] OpenAI integration recipe
- [x] Anthropic integration recipe
- [x] Gemini integration recipe
- [ ] first-class provider helpers/adapters
- [x] Vercel AI SDK 7 / LanguageModelV3 middleware
- [x] n8n via authenticated HTTP sidecar; native community node remains optional
- [ ] LiveKit/Pipecat voice examples
- [ ] versioned pricing-catalog format with explicit source/date metadata
- [x] Postgres transactional store + real concurrent CI integration tests
- [ ] Redis transactional store/reference
- [x] multi-host Postgres deployment guidance; provider-specific serverless recipes can expand
- [ ] structured metrics / OpenTelemetry hooks
- [ ] import/export ledger tooling

### v0.3 completed differentiation

- [x] authenticated HTTP sidecar + local dashboard
- [x] OpenAPI sidecar contract
- [x] versioned Budget Contracts
- [x] one-command contract verification for CI
- [x] guided no-code-ish initializer flags
- [x] Linux/macOS/Windows + Node 20/22/24 CI matrix

## v0.4 — Audit and governance

- [ ] tamper-evident audit receipts
- [ ] policy-decision export
- [ ] optional approval requirement above a spend threshold
- [ ] signed policy bundles
- [ ] organization/team policy inheritance
- [x] policy test fixtures / golden files
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
- [x] local/self-hosted dashboard + HTTP sidecar; hosted service remains optional
