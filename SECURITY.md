# Security Policy

## Supported versions

During the public beta, security fixes are applied to the latest release/main branch.

## Reporting a vulnerability

Please do **not** publish exploitable details in a public issue.

Use GitHub's private vulnerability reporting feature for this repository when available. If that is unavailable, open a minimal public issue asking for a private contact channel without including the exploit, credentials, or sensitive logs.

Useful reports include:

- affected version/commit
- threat scenario
- minimal reproduction with fake credentials/data
- expected vs actual behavior
- suggested mitigation, if known

## High-priority security classes

We especially care about:

- budget bypasses caused by race conditions
- policy bypasses caused by missing/misclassified spend context
- incorrect `groupBy` isolation between users/projects/agents
- retry/idempotency flaws that execute paid side effects twice
- ledger corruption that silently lowers recorded spend
- path traversal or unsafe file handling
- accidental recording/exposure of provider secrets
- code paths that fail open after persistence errors
- SQLite/JSON transaction or recovery behavior that loses settled/reserved spend

## Secrets

AI Spend Guard does not need provider API keys. Never add keys to config examples, tests, issues, or the ledger.

## Policy safety

For policies scoped to identities such as `userId`, `projectId`, or `agentId`, configure `requiredContext` for fields that must never be omitted. Otherwise an application bug that forgets an identity may fall into a different group than intended.

Policy changes should be covered by `test-policies` contract fixtures when they change expected allow/deny behavior.
