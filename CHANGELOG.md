# Changelog

All notable changes will be documented here.

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
