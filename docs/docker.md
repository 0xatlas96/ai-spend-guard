# Docker quickstart

For users who do not want to integrate the TypeScript library directly, AI Spend Guard can run as a small self-hosted sidecar with a browser dashboard.

## 1. Choose a bearer token

Linux/macOS:

```bash
export AI_SPEND_GUARD_TOKEN="$(openssl rand -hex 32)"
```

Keep it in your secret manager / environment handling. Do not commit it.

## 2. Review the starter budget

Edit:

```text
docker/ai-spend-firewall.config.json
```

The supplied example starts with:

```text
$5/day
$20/month
$1 max operation
20 max concurrent operations
```

Adjust those numbers before relying on them.

## 3. Run

```bash
docker compose -f docker-compose.example.yml up --build -d
```

Dashboard:

```text
http://127.0.0.1:8787
```

Paste the bearer token when the dashboard asks to connect.

## 4. Use from n8n or another app

When the caller runs on the same host:

```text
http://127.0.0.1:8787/api/reserve
```

When another container needs access, put the services on a private Docker network and call the service name. Do not expose the sidecar directly to the public internet.

See:

- [HTTP sidecar API](http-sidecar.md)
- [n8n integration](n8n.md)

## Data

The compose file stores the JSON ledger in a named Docker volume:

```text
ai-spend-guard-data
```

The config is mounted read-only.

The container itself runs:

- as the unprivileged `node` user
- with a read-only root filesystem
- with Linux capabilities dropped
- with `no-new-privileges`

## Production

For several replicas/hosts, do not let each container keep an independent local JSON ledger. Use `PostgresStore` in an application/sidecar deployment backed by shared Postgres, or implement another transactional shared `LedgerStore`.

The included Docker quickstart is optimized for one sidecar instance on one host.
