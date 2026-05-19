# Self-Hosting

Run Agent Tick yourself when you want approval routing and history on your own infrastructure. Most users should start with the hosted app; self-hosting is for people who want to operate the server.

Agent Tick is source-available under the BSL 1.1 license. Internal commercial self-hosting is allowed. Offering Agent Tick as a hosted or managed service to third parties is prohibited during the BSL period. The BSL conversion date is 2028-05-31.

## What you run

The self-hosted server includes:

- the Agent Tick API server
- the web dashboard served by the server
- SQLite by default, with PostgreSQL supported for production-style deployments
- optional Redis for multi-process event/rate-limit coordination
- optional Clerk auth for multi-user deployments

The iOS or Android app can connect to a self-hosted server. For launch, self-hosted deployments should expect polling/manual refresh unless you configure your own notification webhook or notifier path.

## Quick Docker Compose setup

Create `.env` next to `docker-compose.yml`:

```env
AGENT_TICK_IMAGE=ghcr.io/self-deprecated/agent-tick:latest
AGENT_TICK_MODE=single
AGENT_TICK_PUBLIC_URL=https://tick.example.com
AGENT_TICK_PORT=8787
AGENT_TICK_DATABASE_URL=file:/data/agent-tick.db

# Recommended outside localhost.
AGENT_TICK_ADMIN_TOKEN=change-me
```

Start the server:

```sh
docker compose up -d
```

Check health:

```sh
curl http://127.0.0.1:8787/healthz
curl http://127.0.0.1:8787/readyz
```

Open `AGENT_TICK_PUBLIC_URL` in a browser. If `AGENT_TICK_ADMIN_TOKEN` is set, enter it in the dashboard.

## Connect an agent machine

For an interactive agent host, run the installer against your server:

```sh
npx @self-deprecated/agent-tick install --server https://tick.example.com
```

For CI or non-interactive hosts, create or copy an `agent_...` token from the dashboard, then save it locally with the CLI available on that host:

```sh
agent-tick setup --server https://tick.example.com --token agent_...
```

If the host does not already have a persistent `agent-tick` binary for hooks or MCP, install the package globally before using `agent-tick setup`.

Send a safe test request:

```sh
npx @self-deprecated/agent-tick steering \
  --title "Self-hosted Agent Tick test" \
  --choice works="It works" \
  --choice stop:deny="Stop testing"
```

## Optional settings

Add only the pieces you need:

```env
# Limit active local members. Omit for unlimited self-hosted seats.
AGENT_TICK_MAX_ACTIVE_MEMBERS=10

# Send invite email payloads to your own mailer/webhook.
AGENT_TICK_INVITE_EMAIL_WEBHOOK_URL=https://mail.example.com/agent-tick/invites

# Notify an external system when a new approval request is created.
AGENT_TICK_APPROVAL_NOTIFICATION_WEBHOOK_URL=https://hooks.example.com/agent-tick/approvals

# Auth-sensitive endpoint rate limits.
AGENT_TICK_RATE_LIMIT_WINDOW_MS=60000
AGENT_TICK_RATE_LIMIT_MAX_REQUESTS=60

# Billing is disabled by default for self-hosted deployments.
# Hosted/product deployments that use mobile IAP set:
# AGENT_TICK_BILLING_PROVIDER=revenuecat
# AGENT_TICK_REVENUECAT_WEBHOOK_SECRET=change-me

# Retention cleanup windows. Omit to retain operational history indefinitely.
AGENT_TICK_APPROVAL_RETENTION_DAYS=180
AGENT_TICK_STATUS_UPDATE_RETENTION_DAYS=180
AGENT_TICK_AUDIT_RETENTION_DAYS=365
AGENT_TICK_UNREGISTERED_DEVICE_RETENTION_DAYS=90
AGENT_TICK_EXPIRED_INVITE_RETENTION_DAYS=90
AGENT_TICK_RETENTION_CLEANUP_ENABLED=true
AGENT_TICK_RETENTION_CLEANUP_INTERVAL_MINUTES=60
```

## PostgreSQL and Redis

SQLite is the simplest default. For a production-style deployment, use PostgreSQL for durable data and Redis for cross-process coordination:

```env
AGENT_TICK_DATABASE_URL=postgres://agent_tick:change-me@postgres:5432/agent_tick
AGENT_TICK_DATABASE_MIGRATE_ON_START=true
AGENT_TICK_REDIS_URL=redis://redis:6379
AGENT_TICK_EVENT_BUS_BACKEND=redis
AGENT_TICK_RATE_LIMIT_BACKEND=redis
AGENT_TICK_RETENTION_CLEANUP_LOCK_BACKEND=redis
```

For larger deployments, run database migrations as an explicit deployment step and set `AGENT_TICK_DATABASE_MIGRATE_ON_START=false` on normal server processes.

## Clerk mode

Use Clerk mode when you want Clerk-backed human sign-in instead of single-mode admin access. Agent Tick still owns organizations, users, devices, agent tokens, approvals, and authorization.

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

After the server is running, use the browser installer from an agent host:

```sh
npx @self-deprecated/agent-tick install --server https://tick.example.com
```

For CI or non-interactive hosts, create an agent token in the dashboard and use `agent-tick setup --server ... --token ...` with the CLI available on that host.

## Backups and security

- Back up the database. It contains users, organizations, token hashes, approval history, device registrations, and audit events.
- Run production deployments behind HTTPS.
- Set `AGENT_TICK_PUBLIC_URL` to the externally reachable dashboard/server origin.
- Treat `agent_...` tokens and `AGENT_TICK_ADMIN_TOKEN` as secrets.
- Do not put approval text, raw prompts, logs, `.env` files, or credentials into request titles, bodies, commands, or metadata.

For the full repository-level self-hosting reference, see [`SELFHOSTING.md`](https://github.com/self-deprecated/agent-tick/blob/main/SELFHOSTING.md).
