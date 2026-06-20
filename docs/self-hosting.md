---
title: Self-hosting Quick Start
description: Run your own Agent Tick server with Docker Compose, then connect the app and agent machines.
---

# Self-hosting Quick Start

Self-host Agent Tick when you want request routing and history on your own infrastructure.

Agent Tick is source-available under the BSL 1.1 license. Internal commercial self-hosting is allowed. Offering Agent Tick as a hosted or managed service to third parties is prohibited during the BSL period. The BSL conversion date is 2028-05-31.

## What you run

A simple self-hosted deployment includes:

- Agent Tick API server and web dashboard
- SQLite durable storage by default
- optional PostgreSQL for production-style durable data
- optional Redis for multi-process coordination
- optional Clerk auth for multi-user deployments

The iOS/Android app can connect to a self-hosted server. Push behavior for self-hosted deployments depends on the notification path you operate.

## Docker Compose quickstart

Create `docker-compose.yml`:

```yaml
services:
  server:
    image: ${AGENT_TICK_IMAGE:-ghcr.io/self-deprecated/agent-tick:latest}
    env_file: .env
    ports:
      - "${AGENT_TICK_PORT:-8787}:8787"
    volumes:
      - agent_tick_data:/data
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('http://127.0.0.1:8787/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
      interval: 30s
      timeout: 5s
      retries: 5

volumes:
  agent_tick_data:
```

Create `.env`:

```env
AGENT_TICK_IMAGE=ghcr.io/self-deprecated/agent-tick:latest
AGENT_TICK_MODE=single
AGENT_TICK_PUBLIC_URL=https://tick.example.com
AGENT_TICK_PORT=8787
AGENT_TICK_DATABASE_URL=file:/data/agent-tick.db
AGENT_TICK_DATABASE_MIGRATE_ON_START=true
AGENT_TICK_ADMIN_TOKEN=change-me
```

Start the server:

```sh
docker compose up -d
```

Check health and readiness:

```sh
curl http://127.0.0.1:8787/healthz
curl http://127.0.0.1:8787/readyz
```

Open `AGENT_TICK_PUBLIC_URL` in a browser and enter the admin token if configured.

## Connect an agent machine

First connect the Native App to your self-hosted server and enable **Settings → General → Private encryption** if you want rich agent message/tool mirroring. Then run setup against your server:

```sh
npx @self-deprecated/agent-tick setup --server https://tick.example.com
```

For CI or non-interactive hosts, create or copy an `agent_...` token from the dashboard and save it locally:

```sh
agent-tick config --server https://tick.example.com --token agent_...
```

Send a safe test:

```sh
npx @self-deprecated/agent-tick send steering \
  --title "Self-hosted Agent Tick test" \
  --choice works="It works" \
  --choice stop:deny="Stop testing"
```

## Connect the Native App

In the Native App, choose the self-hosted server option and enter your server URL. Where the product provides a pairing QR code, scan it instead of manually typing the URL.

After sign-in, open **Settings → General → Private encryption** and enable/repair private encryption before turning on rich mirrored agent content.

## Production checklist

Before relying on a production self-hosted deployment:

- run behind HTTPS
- set `AGENT_TICK_PUBLIC_URL` to the public origin
- back up the database
- protect `AGENT_TICK_ADMIN_TOKEN` and `agent_...` tokens
- choose SQLite or PostgreSQL intentionally
- decide retention windows
- decide how Requests should notify humans

For deeper configuration, see [Self-hosting operator reference](./self-hosting-operator-reference.md) and the repository [`SELFHOSTING.md`](https://github.com/self-deprecated/agent-tick/blob/main/SELFHOSTING.md).
