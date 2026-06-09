---
title: Self-hosting operator reference
description: Configure databases, Redis, Clerk mode, retention, backups, and security for self-hosted Agent Tick.
---

# Self-hosting operator reference

Use this after the [Self-hosting Quick Start](./self-hosting.md).

## Optional settings

```env
# Limit active local members. Omit for unlimited self-hosted seats.
AGENT_TICK_MAX_ACTIVE_MEMBERS=10

# Notify an external system when a new Request is created.
AGENT_TICK_REQUEST_NOTIFICATION_WEBHOOK_URL=https://hooks.example.com/agent-tick/requests

# Auth-sensitive endpoint rate limits.
AGENT_TICK_RATE_LIMIT_WINDOW_MS=60000
AGENT_TICK_RATE_LIMIT_MAX_REQUESTS=60

# Retention cleanup windows. Omit to retain operational history indefinitely.
AGENT_TICK_REQUEST_RETENTION_DAYS=180
AGENT_TICK_STATUS_UPDATE_RETENTION_DAYS=180
AGENT_TICK_AUDIT_RETENTION_DAYS=365
AGENT_TICK_UNREGISTERED_DEVICE_RETENTION_DAYS=90
AGENT_TICK_RETENTION_CLEANUP_ENABLED=true
AGENT_TICK_RETENTION_CLEANUP_INTERVAL_MINUTES=60
```

## SQLite

SQLite is the default durable store for local and simple self-hosted deployments.

```env
AGENT_TICK_DATABASE_URL=file:/data/agent-tick.db
AGENT_TICK_DATABASE_MIGRATE_ON_START=true
```

Back up the selected durable store before upgrades.

## PostgreSQL and Redis

PostgreSQL is supported for production-style deployments with `postgres://` or `postgresql://` database URLs. Redis can coordinate event wakeups, rate limits, and cleanup locks across multiple server instances.

```env
AGENT_TICK_DATABASE_URL=postgresql://agent_tick:change-me@postgres:5432/agent_tick
AGENT_TICK_DATABASE_MIGRATE_ON_START=true
AGENT_TICK_REDIS_URL=redis://redis:6379
AGENT_TICK_EVENT_BUS_BACKEND=redis
AGENT_TICK_RATE_LIMIT_BACKEND=redis
AGENT_TICK_RETENTION_CLEANUP_LOCK_BACKEND=redis
```

Optional PostgreSQL pool tuning:

```env
AGENT_TICK_POSTGRES_POOL_MAX=10
AGENT_TICK_POSTGRES_POOL_IDLE_TIMEOUT_MS=30000
AGENT_TICK_POSTGRES_POOL_CONNECTION_TIMEOUT_MS=5000
AGENT_TICK_POSTGRES_STATEMENT_TIMEOUT_MS=30000
AGENT_TICK_POSTGRES_QUERY_TIMEOUT_MS=30000
```

Use `/readyz` rather than `/healthz` as the load-balancer readiness check.

## Clerk mode

Use Clerk mode when you want Clerk-backed human sign-in instead of single-mode admin access. Agent Tick still owns Workspaces, users, Approval Devices, Agent Tokens, Requests, and authorization.

```env
AGENT_TICK_MODE=clerk
AGENT_TICK_PUBLIC_URL=https://tick.example.com
AGENT_TICK_CLERK_PUBLISHABLE_KEY=pk_...
AGENT_TICK_CLERK_SECRET_KEY=sk_...
AGENT_TICK_CLERK_AUTHORIZED_PARTIES=https://tick.example.com
```

Optional networkless verification key:

```env
AGENT_TICK_CLERK_JWT_KEY="-----BEGIN PUBLIC KEY-----..."
```

## Backups and security

- Back up the database. It contains users, Workspaces, token hashes, Activity history, device registrations, and audit events.
- Run production deployments behind HTTPS.
- Treat `agent_...` tokens and `AGENT_TICK_ADMIN_TOKEN` as secrets.
- Do not put Request text, raw prompts, logs, `.env` files, or credentials into request titles, bodies, commands, choices, metadata, or diagnostics.
- Define retention and deletion responsibilities for your deployment.
