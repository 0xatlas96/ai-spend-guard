# Budget Contracts

A **Budget Contract** turns AI cost safety into a versioned artifact that can be reviewed and tested like code.

Instead of only asking:

> "What did we spend last month?"

a contract asks before deployment:

> "Which operations are allowed, what must be denied, and can our modeled worst case fit inside policy?"

## One file, three proofs

A contract combines:

1. **Firewall policy** — the actual runtime limits.
2. **Policy contract tests** — deterministic allow/deny expectations.
3. **Spend plans** — modeled workloads that must stay inside budget.

Example:

```json
{
  "version": 1,
  "name": "production AI spend contract",
  "firewall": {
    "requiredContext": ["provider", "resource", "userId"],
    "policies": [
      {
        "id": "global",
        "window": "utc-month",
        "limitUsd": 50
      },
      {
        "id": "per-user",
        "groupBy": ["userId"],
        "window": "utc-day",
        "limitUsd": 1
      }
    ]
  },
  "policyTests": {
    "cases": [
      {
        "name": "spent user is denied",
        "setup": [
          {
            "type": "record",
            "context": {
              "provider": "openai",
              "resource": "llm",
              "userId": "alice"
            },
            "actualCostUsd": 0.98
          }
        ],
        "request": {
          "context": {
            "provider": "openai",
            "resource": "llm",
            "userId": "alice"
          },
          "estimatedCostUsd": 0.05
        },
        "expect": {
          "allowed": false,
          "blockingPolicyIds": ["per-user"]
        }
      }
    ]
  },
  "plans": [
    {
      "id": "representative-day",
      "maxTotalUsd": 10,
      "plan": {
        "operations": [
          {
            "name": "chat",
            "context": {
              "provider": "openai",
              "resource": "llm",
              "userId": "example-user"
            },
            "estimatedCostUsd": 0.02,
            "count": 20,
            "concurrent": 5
          }
        ]
      }
    }
  ]
}
```

## Verify

```bash
ai-spend-guard verify-contract --file budget-contract.json
```

Exit codes:

```text
0 = contract passes
2 = cost/policy contract fails
1 = malformed input/runtime error
```

Use it in CI:

```yaml
- run: npx ai-spend-guard verify-contract --file budget-contract.json
```

## What can fail a contract?

- invalid firewall config
- doctor errors
- doctor warnings when `doctorWarningsAsErrors: true`
- a policy test that changes from allow → deny or deny → allow
- a spend plan that violates an enforced policy
- a spend plan that exceeds its explicit `maxTotalUsd`

## Why this matters

A dashboard can tell you that spend changed after deployment.

A Budget Contract can reject a pull request because:

- a model change increases the modeled workload above budget;
- a policy edit accidentally removes an expected denial;
- a required identity field is no longer enforced;
- a new concurrency pattern exceeds a limit.

It is intentionally deterministic and does not call an AI model.

## Review practice

Treat contract changes like infrastructure/security policy changes.

A useful pull request should make it obvious whether it is changing:

- the business budget;
- who gets an independent budget;
- an expected allow/deny rule;
- the workload model;
- a maximum operation cost;
- concurrency/call-count behavior.

Do not silently increase both the workload estimate and the limit in the same change without explaining why.

## Schema

Editor/CI validation:

[budget-contract.schema.json](../schema/budget-contract.schema.json)

Starter example:

[budget-contract.example.json](../budget-contract.example.json)
