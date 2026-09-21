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

## v0.2 — Production ergonomics

- [ ] stale reservation inspection/recovery command
- [ ] richer structured warning events
- [ ] import/export usage ledger
- [ ] reference OpenAI integration helper
- [ ] reference Anthropic integration helper
- [ ] reference Gemini integration helper
- [ ] model-pricing file format with explicit version/date metadata
- [ ] benchmark concurrent reservation throughput

## v0.3 — Shared infrastructure

- [ ] reference SQLite store
- [ ] reference Postgres store
- [ ] idempotency helpers for retries/webhooks
- [ ] optional project/team budget scopes
- [ ] rolling-window budgets
- [ ] audit-log integrity checks

## Later / research

- [ ] proxy mode for compatible HTTP APIs
- [ ] n8n/community-node integration
- [ ] Vercel/serverless recipes
- [ ] Prometheus/OpenTelemetry metrics without hosted telemetry
- [ ] cost forecast / dry-run mode
- [ ] policy-as-code for model/provider routing
