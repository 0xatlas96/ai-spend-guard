# HTTP sidecar and local dashboard

AI Spend Guard can run as a small local HTTP service. This makes the same financial firewall usable from:

- n8n
- shell scripts
- Python/Ruby/PHP applications
- low-code workflow tools
- services that cannot import the TypeScript library directly

## Start

```bash
ai-spend-guard serve
```

Default:

```text
http://127.0.0.1:8787
```

Open that address in a browser for the local dashboard.

The default bind is loopback-only and does not require authentication.

## Remote/network bind

AI Spend Guard refuses to listen on a non-loopback address without authentication.

Set a bearer token in an environment variable:

```bash
export AI_SPEND_GUARD_TOKEN="use-a-long-random-secret"
ai-spend-guard serve --host 0.0.0.0 --port 8787
```

Clients then send:

```http
Authorization: Bearer <token>
```

Do not put the token in a command-line flag; command arguments may be visible to other processes/users.

## API

### Health

```http
GET /healthz
```

Health intentionally works without authentication so container/orchestrator health checks can use it.

### Status

```http
GET /api/status
```

### Explain without reserving

```http
POST /api/explain
Content-Type: application/json

{
  "context": {
    "provider": "openai",
    "resource": "llm",
    "userId": "alice",
    "projectId": "support"
  },
  "estimatedCostUsd": 0.08
}
```

This does not change the ledger.

### Reserve before paid work

```http
POST /api/reserve
Content-Type: application/json

{
  "context": {
    "provider": "openai",
    "resource": "llm",
    "userId": "alice"
  },
  "estimatedCostUsd": 0.08,
  "idempotencyKey": "workflow-842:chat-1"
}
```

Successful response includes the reservation `id`.

A budget denial returns HTTP **402** with structured policy details.

### Settle

```http
POST /api/settle
Content-Type: application/json

{
  "id": "<reservation-id>",
  "actualCostUsd": 0.053
}
```

### Resize / progressive top-up

```http
POST /api/resize
Content-Type: application/json

{
  "id": "<reservation-id>",
  "estimatedCostUsd": 0.12
}
```

### Release

Only release after verifying the paid operation did not happen:

```http
POST /api/release
Content-Type: application/json

{
  "id": "<reservation-id>"
}
```

### Record already-incurred spend

```http
POST /api/record
Content-Type: application/json

{
  "context": {
    "provider": "custom-provider",
    "resource": "video"
  },
  "actualCostUsd": 0.75
}
```

This is accounting-only; it cannot block a provider call that already happened.

### Open reservations

```http
GET /api/reservations
```

Optional:

```http
GET /api/reservations?olderThanMs=3600000
```

## Error status codes

| Status | Meaning |
| --- | --- |
| 400 | invalid spend request / missing required context |
| 401 | missing/incorrect bearer token |
| 402 | enforced spend policy denied the operation |
| 404 | reservation/endpoint not found |
| 409 | duplicate/idempotency conflict |
| 413 | request body too large |
| 500 | internal firewall/storage error |

## Security defaults

- loopback bind by default
- mandatory bearer token for non-loopback binds
- no CORS wildcard
- 1 MB JSON body limit by default
- CSP, no-frame, no-sniff, no-referrer and no-store response headers
- dashboard uses the same API and authentication model
- the sidecar never needs provider API keys
