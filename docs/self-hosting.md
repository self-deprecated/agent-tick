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

## 5-minute Docker quickstart

In a checkout of the Agent Tick repository, use the published-image Compose file. It has no `build:` stanza and runs the same image operators deploy in production.

Create `.env`:

```env
AGENT_TICK_IMAGE=ghcr.io/self-deprecated/agent-tick:latest
AGENT_TICK_MODE=single
AGENT_TICK_PUBLIC_URL=http://localhost:8787
AGENT_TICK_PORT=8787
AGENT_TICK_DATABASE_URL=file:/data/agent-tick.db
AGENT_TICK_DATABASE_MIGRATE_ON_START=true
```

Start the server:

```sh
docker compose -f docker-compose.selfhost.yml up -d
curl http://127.0.0.1:8787/healthz
curl http://127.0.0.1:8787/readyz
```

Open [http://localhost:8787](http://localhost:8787). For non-local servers, set `AGENT_TICK_PUBLIC_URL` to the HTTPS origin and set `AGENT_TICK_ADMIN_TOKEN` to a long random value; the dashboard will ask for that token during bootstrap/admin flows.

## Which mode should I choose?

- **Single mode + SQLite**: recommended first path and simplest VPS deployment. No Clerk, PostgreSQL, Redis, billing, email, or push-provider credentials are required.
- **Single mode + PostgreSQL**: use when you want managed database operations or production-style backups.
- **Clerk mode**: use when you need multi-user browser/mobile sign-in. Clerk authenticates humans; Agent Tick still owns Workspaces, Agent Tokens, Requests, devices, audit logs, and authorization.
- **Redis**: optional coordination for multi-process deployments. Single-server deployments can skip it.

## Connect an agent machine

First connect the Native App to your self-hosted server and enable **Settings → General → Private encryption** if you want rich agent message/tool mirroring. Then run setup against your server:

```sh
npx @self-deprecated/agent-tick setup --server http://localhost:8787
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

## Common deployment recipes

The repository `SELFHOSTING.md` includes copy-paste recipes for:

- localhost SQLite
- VPS/reverse-proxy SQLite
- Compose-managed PostgreSQL
- managed PostgreSQL with optional Redis
- Clerk multi-user mode

It also covers readiness checks, backups, upgrades, and troubleshooting.

## Connect the Native App

In the Native App, choose the self-hosted server option and enter your server URL. Where the product provides a pairing QR code, scan it instead of manually typing the URL.

Use HTTPS for production and shared self-hosted servers. Android release builds do not allow broad cleartext HTTP traffic; local HTTP testing is intended for development builds. When testing a local server from Android, install a development build and prefer `adb reverse` with a loopback URL such as `http://127.0.0.1:8787` so the device reaches the server on your development machine.

After sign-in, open **Settings → General → Private encryption** and enable/repair private encryption before turning on rich mirrored agent content.

## Production checklist

Before relying on a production self-hosted deployment:

- run behind HTTPS
- set `AGENT_TICK_PUBLIC_URL` to the public origin
- protect `AGENT_TICK_ADMIN_TOKEN` and `agent_...` tokens
- choose SQLite or PostgreSQL intentionally
- back up the database
- decide retention windows
- decide how Requests should notify humans

For deeper configuration, see [Self-hosting operator reference](./self-hosting-operator-reference.md) and the repository [`SELFHOSTING.md`](https://github.com/self-deprecated/agent-tick/blob/main/SELFHOSTING.md).
