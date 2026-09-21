# Changelog

All notable changes will be documented here.

## 0.3.0 - unreleased

### Added

- authenticated local HTTP sidecar and no-build control-center dashboard
- OpenAPI 3.1 contract for sidecar integrations
- n8n/no-code reserve → paid operation → settle integration pattern
- Vercel AI SDK 7 / LanguageModelV3 middleware for generate and streaming calls
- optional transactional Postgres store with shared multi-worker budget enforcement
- real Postgres concurrency tests in CI
- versioned Budget Contracts combining firewall config, policy tests, and spend plans
- `verify-contract` CLI command for CI/deployment budget gates
- guided `init` flags for global, per-user, and per-project budgets
- multi-OS CI across Linux, Windows, and macOS plus Node 20/22/24
- OIDC-based npm Trusted Publishing workflow scaffold
- first-class integration examples for firewall, Vercel AI SDK, Postgres, and HTTP sidecar

### Changed

- package version moved to 0.3.0 for the production-integration release
- README quickstart now uses fail-closed `protect()` instead of unsafe blanket release-on-error logic
- optional integration dependencies are exposed through subpath exports so the core stays lightweight
- production storage guidance now distinguishes single-host JSON/SQLite from multi-host Postgres

### Security

- non-loopback HTTP binds require bearer authentication
- sidecar uses constant-time token comparison, body-size limits, no-store/CSP/frame/referrer headers, and no wildcard CORS
- ambiguous provider failures in the Vercel middleware remain reserved for reconciliation
- distributed Postgres reservations use row-level transactional locking


## 0.2.0 - 2026-09-21

### Added

- universal `SpendFirewall` API
- multi-dimensional spend context for provider, model, resource, project, user, session, agent, route, environment and tags
- dynamic grouped budgets via `groupBy`
- arbitrary rolling budget windows
- call-count, per-operation and concurrency controls
- observe/shadow mode for safe policy rollouts
- idempotency-key protection for duplicate paid side effects
- non-mutating `explain()` decisions
- budget-as-code plan simulation and CI-friendly exit codes
- configuration doctor
- stale reservation inspection
- generic unit, duration and composite cost helpers
- zero-runtime-dependency `NodeSqliteStore` using Node's built-in SQLite module
- JSON Schemas for firewall configuration and spend plans
- expanded firewall and SQLite tests
- direct GitHub installation support
- fail-closed required-context enforcement for identity-scoped policies
- deterministic policy contract test suites and `test-policies` CLI
- one-command `init` scaffolding with self-validating starter files
- fail-closed reconciliation for ambiguous provider/cost/settlement failures
- parallel admission stress tests for MemoryStore and JsonFileStore
- deterministic budget invariant tests
- progressive reservation `resize()` / `topUp()` for streams and multi-step jobs
- blocked-decision observability hooks
- immutable cloned firewall configuration after validation
- agent-readable `llms.txt` project guide
- package subpath exports for JSON Schemas
- immutable-SHA pinned GitHub Actions for stronger CI supply-chain integrity

### Changed

- project positioning from LLM-only budget limiter to universal AI financial firewall
- CLI now targets the policy-based firewall by default
- package metadata updated for v0.2
- README rewritten around real-world deployment patterns and guarantees

### Compatibility

- the original `AiSpendGuard` API remains available for simple global/provider limits
- `NodeSqliteStore` requires Node >= 22.5; the rest of the package continues to support Node >= 20

## 0.1.0 - 2026-09-21

### Added

- global and provider daily/monthly/per-request budgets
- reservation and settlement accounting
- in-memory transactional store
- local JSON store with cross-process lock file
- generic token cost estimation
- CLI for status and manual ledger operations
- tests, CI, security, contribution, governance, and agent guidance
