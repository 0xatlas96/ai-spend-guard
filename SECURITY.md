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
- ledger corruption that silently lowers recorded spend
- path traversal or unsafe file handling
- accidental recording/exposure of provider secrets
- code paths that fail open after persistence errors

## Secrets

AI Spend Guard does not need provider API keys. Never add keys to config examples, tests, issues, or the ledger.
