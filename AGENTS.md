# AGENTS.md

Instructions for coding agents and automated contributors working in this repository.

## Mission

Keep AI Spend Guard a small, auditable **financial firewall and budget-as-code layer** for paid AI work: LLMs, media generation, tools, agents, and metered APIs.

## Required checks

Before proposing or committing a change:

1. Read `README.md`, `CONTRIBUTING.md`, and `docs/threat-model.md`.
2. Preserve fail-closed behavior for unknown/untrusted cost estimates unless an option explicitly documents otherwise.
3. Do not add telemetry, external network calls, analytics SDKs, or secret collection to the core package.
4. Do not hard-code current commercial model prices as timeless truth. Pricing data must be caller-owned or explicitly versioned/date-stamped.
5. Add tests for every budget-enforcement behavior change. Add/update policy contract fixtures when policy semantics change.
6. Run `npm run ci`. Integration changes must remain green on the supported OS/Node matrix and Postgres job.
7. Keep PRs scoped; do not refactor unrelated code.

## Security-sensitive areas

Treat these as high risk:

- `SpendFirewall.reserve()` / `settle()` accounting
- policy matching, `groupBy`, rolling windows, and `requiredContext`
- store transaction semantics, including Postgres row locking
- concurrent requests
- retry/idempotency behavior
- filesystem paths and lock handling
- HTTP authentication/network binding and request parsing
- Vercel AI SDK generate/stream settlement semantics
- Budget Contract verification semantics
- logic that can turn a denied request into an allowed request

For changes in those areas, include a short threat analysis in the PR description.

## Definition of done

A change is not done until tests pass, public behavior is documented, no secrets are included, and the stated hard-cap limitations remain accurate.
