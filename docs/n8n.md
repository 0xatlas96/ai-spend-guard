# n8n: protect paid AI nodes without writing application code

The HTTP sidecar lets n8n use AI Spend Guard through normal **HTTP Request** nodes.

## Pattern

```text
Trigger
  ↓
AI Spend Guard: RESERVE
  ↓
Paid AI node
  ↓
calculate actual cost
  ↓
AI Spend Guard: SETTLE
```

If RESERVE returns an error/402, the paid node must not run.

## 1. Run the sidecar

If n8n runs on the same machine:

```bash
ai-spend-guard serve
```

For Docker/network access, bind to an interface and require authentication:

```bash
export AI_SPEND_GUARD_TOKEN="long-random-secret"
ai-spend-guard serve --host 0.0.0.0
```

Keep the service on a private/internal network rather than exposing it directly to the public internet.

## 2. Add an HTTP Request node before the paid AI node

Method:

```text
POST
```

URL:

```text
http://YOUR-GUARD:8787/api/reserve
```

JSON body:

```json
{
  "context": {
    "provider": "openai",
    "resource": "llm",
    "projectId": "{{$workflow.id}}",
    "userId": "{{$json.userId}}",
    "route": "n8n"
  },
  "estimatedCostUsd": 0.10,
  "idempotencyKey": "{{$execution.id}}:openai-step"
}
```

For a remote/network bind, add:

```text
Authorization: Bearer <AI_SPEND_GUARD_TOKEN>
```

Store that token in n8n credentials/environment handling rather than hard-coding it into exported workflow JSON.

## 3. Only run the AI node if reserve succeeds

A denied reservation returns HTTP 402.

Configure the workflow so the paid AI node is never reached on a failed reserve request.

## 4. Settle after a successful paid call

Add another HTTP Request node:

```text
POST http://YOUR-GUARD:8787/api/settle
```

Body:

```json
{
  "id": "{{$node['AI Spend Guard - Reserve'].json.id}}",
  "actualCostUsd": "{{$json.actualCostUsd}}"
}
```

If the provider node does not expose exact USD cost, you can settle the same conservative amount you reserved. That over-counts rather than under-counts.

## 5. Failure handling

Do **not** automatically call `/api/release` on every provider error.

Timeouts and connection failures can be ambiguous: the provider may have completed billable work even though n8n received an error.

Release only when you can prove the paid operation did not occur. Otherwise leave the reservation open, investigate/reconcile it, then settle or explicitly release it.

## Media and tools

The same pattern works for:

```text
resource=image
resource=audio
resource=video
resource=search
resource=tool
resource=api
```

No provider-specific integration is required in the firewall. Your workflow provides the conservative estimate and actual settlement value.
