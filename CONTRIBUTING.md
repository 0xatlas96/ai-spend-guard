# Contributing

Thanks for helping improve AI Spend Guard.

## Before opening a PR

1. Search existing issues and pull requests.
2. For a behavior change or larger feature, open an issue first so the design can be discussed.
3. Keep the change focused. Avoid drive-by refactors in the same PR.
4. Add or update tests for behavior changes.
5. Run:

```bash
npm install
npm run ci
```

## Design principles

- **Safety before convenience.** Budget enforcement should fail closed when uncertainty could cause silent overspend.
- **No hidden network traffic.** Core code must not phone home or send usage data anywhere.
- **No provider secrets in the ledger.** Store cost/accounting metadata only.
- **Provider agnostic.** Keep provider SDKs out of the core package unless there is a strong reason.
- **Explicit guarantees.** Do not describe an estimate-based control as stronger than it is.
- **Small dependency surface.** Runtime dependencies require clear justification.

## Pull requests

A good PR includes:

- what problem it solves
- the chosen behavior and edge cases
- tests
- documentation for public API changes
- no secrets or unrelated generated files

Maintainers may ask to split broad PRs into smaller changes.

## Commit style

Use short imperative commit subjects, for example:

- `Add stale reservation inspection`
- `Fix monthly provider snapshot`
- `Document distributed store contract`

## Reporting security problems

Follow `SECURITY.md`; do not open a public issue for a vulnerability that could lead to bypassing budget enforcement or exposing sensitive data.
