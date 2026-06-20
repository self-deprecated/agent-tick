# Self-Hosting Agent Tick

Use this guide when you want to run Agent Tick yourself. If you want the managed product instead, start at <https://app.agenttick.sh>.

Agent Tick is source-available under BSL 1.1. Internal commercial self-hosting is allowed, including use by a business on its own infrastructure. Offering Agent Tick as a hosted or managed service to third parties is prohibited. The BSL change date is 2028-05-31.

Agent Tick can run either as the published Docker image or as the Nix flake package/NixOS module. The server runs the TypeScript API server, serves the built Svelte dashboard, and stores durable data in local SQLite by default or PostgreSQL when configured.

## Single-user local mode

Create `.env`:

```env
AGENT_TICK_IMAGE=ghcr.io/self-deprecated/agent-tick:latest
AGENT_TICK_MODE=single
AGENT_TICK_PUBLIC_URL=https://tick.example.com
AGENT_TICK_PORT=8787

# Optional. Defaults to true for simple self-hosting; pre-launch builds use this
# to ensure the current schema exists on startup.
# AGENT_TICK_DATABASE_MIGRATE_ON_START=true

# Optional but recommended outside localhost.
AGENT_TICK_ADMIN_TOKEN=change-me

# Optional local active-member seat guard. Omit for unlimited self-hosted seats.
# AGENT_TICK_MAX_ACTIVE_MEMBERS=10

# Optional Request notification webhook in addition to mobile push.
# AGENT_TICK_REQUEST_NOTIFICATION_WEBHOOK_URL=https://hooks.example.com/agent-tick/requests

# Optional rate limit overrides for auth-sensitive token endpoints.
# AGENT_TICK_RATE_LIMIT_WINDOW_MS=60000
# AGENT_TICK_RATE_LIMIT_MAX_REQUESTS=60

# Optional Redis coordination for multi-process deployments. SQLite remains the
# default simple self-hosted path; use Redis when multiple server instances need
# shared event wakeups/rate limits.
# AGENT_TICK_REDIS_URL=redis://redis:6379
# AGENT_TICK_EVENT_BUS_BACKEND=redis
# AGENT_TICK_RATE_LIMIT_BACKEND=redis

# Optional retention cleanup windows. Omit to retain operational history indefinitely.
# Set Request/status update days to 0 to turn Activity History content retention off.
# AGENT_TICK_REQUEST_RETENTION_DAYS=180
# AGENT_TICK_STATUS_UPDATE_RETENTION_DAYS=180
# AGENT_TICK_AUDIT_RETENTION_DAYS=365
# AGENT_TICK_UNREGISTERED_DEVICE_RETENTION_DAYS=90
# AGENT_TICK_RETENTION_CLEANUP_ENABLED=true
# AGENT_TICK_RETENTION_CLEANUP_INTERVAL_MINUTES=60
# AGENT_TICK_RETENTION_CLEANUP_LOCK_BACKEND=redis
# AGENT_TICK_RETENTION_CLEANUP_LOCK_TTL_MS=600000
# Optional server-wide Private Requests (end-to-end encrypted) policy.
#   off     each Workspace/Routing Rule decides via its own toggle (default)
#   default new Workspaces start with Private Requests required (toggleable)
#   forced  Private Requests required for every Workspace/Routing Rule on this
#           server; plain CLI requests are rejected with HTTP 409 private_required
# AGENT_TICK_PRIVATE_REQUESTS_POLICY=off
```

Start it:

```sh
docker compose up -d
```

Open `AGENT_TICK_PUBLIC_URL`. If `AGENT_TICK_ADMIN_TOKEN` is set, enter it in the dashboard. For an interactive agent host, run setup against your server:

```sh
npx @self-deprecated/agent-tick setup --server https://tick.example.com
```

For rich agent message/tool mirroring, connect the Native App to the self-hosted server and enable **Settings → General → Private encryption** before setting `privacy.defaultContentMode` to `private` in `agent-tick features`.

For CI or non-interactive hosts, create or copy an `agent_...` token from the dashboard, then save it locally with the CLI available on that host:

```sh
agent-tick config --server https://tick.example.com --token agent_...
```

The public product surfaces are <https://agenttick.sh> for marketing, <https://app.agenttick.sh> for the hosted app and API, and <https://docs.agenttick.sh> for documentation. Self-hosted deployments use their own `AGENT_TICK_PUBLIC_URL`.

## Durable store and Redis production mode

SQLite remains the default durable store for local and simple self-hosted deployments. PostgreSQL is also supported for production-style deployments by setting `AGENT_TICK_DATABASE_URL` to a `postgres://` or `postgresql://` URL. Agent Tick is still pre-launch, so schema setup installs the current schema rather than preserving historical migrations; local/dev databases may need to be reset instead of migrated forward. Delete `agent-tick.db` or reset a pre-launch PostgreSQL schema if an older database shape no longer boots. There is no automatic SQLite-to-PostgreSQL data migration unless a separate migration tool is built.

SQLite example:

```env
AGENT_TICK_DATABASE_URL=file:/data/agent-tick.db
AGENT_TICK_DATABASE_MIGRATE_ON_START=true
```

PostgreSQL plus Redis example:

```env
# Docker Compose defaults to SQLite; set this to point the server at an external
# PostgreSQL database managed by your platform/operator.
AGENT_TICK_DATABASE_URL=postgresql://agent_tick:change-me@postgres:5432/agent_tick
AGENT_TICK_DATABASE_MIGRATE_ON_START=true
AGENT_TICK_POSTGRES_USER=agent_tick
AGENT_TICK_POSTGRES_PASSWORD=change-me
AGENT_TICK_POSTGRES_DB=agent_tick
AGENT_TICK_REDIS_URL=redis://redis:6379
AGENT_TICK_EVENT_BUS_BACKEND=redis
AGENT_TICK_RATE_LIMIT_BACKEND=redis
AGENT_TICK_RETENTION_CLEANUP_LOCK_BACKEND=redis
```

The included Compose file has an optional PostgreSQL service behind the `postgres` profile. Enable it when you want Compose to run PostgreSQL for you:

```sh
docker compose --profile postgres up -d
```

If you operate PostgreSQL separately, leave the profile disabled and point `AGENT_TICK_DATABASE_URL` at your managed PostgreSQL endpoint.

PostgreSQL pool tuning is optional. Small single-instance deployments can use the defaults. For many server instances, keep `AGENT_TICK_POSTGRES_POOL_MAX` small enough that total app connections fit the database limit, or put PgBouncer in transaction-pooling mode in front of PostgreSQL:

```env
AGENT_TICK_POSTGRES_POOL_MAX=10
AGENT_TICK_POSTGRES_POOL_IDLE_TIMEOUT_MS=30000
AGENT_TICK_POSTGRES_POOL_CONNECTION_TIMEOUT_MS=5000
AGENT_TICK_POSTGRES_STATEMENT_TIMEOUT_MS=30000
AGENT_TICK_POSTGRES_QUERY_TIMEOUT_MS=30000
```
Back up the selected durable store before upgrades. For PostgreSQL, use regular logical dumps or physical backups appropriate to your operator stack. Keep `/readyz` as the traffic readiness check so load balancers only route to tasks that can reach configured dependencies. With Redis configured, readiness checks also cover Redis-backed event/rate-limit dependencies and retention cleanup uses a Redis lock by default so duplicate cleanup workers do not run concurrently.

## Clerk multi-user mode

Clerk authenticates dashboard/mobile humans. Agent Tick still owns local users, Workspaces, Approval Devices, Agent Tokens, Requests, billing seat limits, and audit data.

Create a Clerk application, configure your dashboard origin in Clerk, then set:

```env
AGENT_TICK_IMAGE=ghcr.io/self-deprecated/agent-tick:latest
AGENT_TICK_MODE=clerk
AGENT_TICK_PUBLIC_URL=https://tick.example.com
AGENT_TICK_PORT=8787
# Keep first-party hosted billing gates off for self-hosted Clerk deployments.
AGENT_TICK_HOSTED_SERVICE=false
# AGENT_TICK_DATABASE_MIGRATE_ON_START=true
AGENT_TICK_CLERK_PUBLISHABLE_KEY=pk_...
AGENT_TICK_CLERK_SECRET_KEY=sk_...
AGENT_TICK_CLERK_AUTHORIZED_PARTIES=https://tick.example.com
```

Optional local active-member seat guard, webhooks, rate limits, Redis coordination, and retention cleanup windows (also available in single mode):

```env
AGENT_TICK_MAX_ACTIVE_MEMBERS=10
AGENT_TICK_REQUEST_NOTIFICATION_WEBHOOK_URL=https://hooks.example.com/agent-tick/requests
AGENT_TICK_RATE_LIMIT_WINDOW_MS=60000
AGENT_TICK_RATE_LIMIT_MAX_REQUESTS=60
AGENT_TICK_REDIS_URL=redis://redis:6379
AGENT_TICK_EVENT_BUS_BACKEND=redis
AGENT_TICK_RATE_LIMIT_BACKEND=redis
AGENT_TICK_REQUEST_RETENTION_DAYS=180
AGENT_TICK_AUDIT_RETENTION_DAYS=365
AGENT_TICK_UNREGISTERED_DEVICE_RETENTION_DAYS=90
AGENT_TICK_RETENTION_CLEANUP_ENABLED=true
AGENT_TICK_RETENTION_CLEANUP_LOCK_BACKEND=redis
```

Optional networkless verification key:

```env
AGENT_TICK_CLERK_JWT_KEY="-----BEGIN PUBLIC KEY-----..."
```

Start it with Docker Compose. The dashboard fetches `/v1/auth/config`, loads Clerk with the publishable key, and sends Clerk session tokens to the API. The server maps Clerk `(issuer, subject)` to local `usr_...` IDs and requires a verified primary email.

After the server is running, set up an agent host with the CLI:

```sh
npx @self-deprecated/agent-tick setup --server https://tick.example.com
```

The CLI opens the dashboard, waits while you sign in with Clerk, saves the returned Agent Tick `agent_...` token, and offers to install local coding-agent Request instructions. The token is written to `~/.config/agent-tick/config.json` by default; use `AGENT_TICK_CONFIG=/path/to/config.json` to choose a different file. For CI/non-interactive hosts, create an agent token in the dashboard and run `agent-tick config --server https://tick.example.com --token agent_...` instead.

## Local image build

```sh
docker build -f apps/server/Dockerfile -t agent-tick:dev .

AGENT_TICK_IMAGE=agent-tick:dev \
AGENT_TICK_MODE=single \
AGENT_TICK_PUBLIC_URL=http://localhost:8787 \
AGENT_TICK_PORT=8787 \
docker compose up -d
```

## NixOS module

This repository exposes a flake package and NixOS module:

```nix
{
  inputs.agent-tick.url = "github:self-deprecated/agent-tick";

  outputs = { self, nixpkgs, agent-tick, ... }: {
    nixosConfigurations.example = nixpkgs.lib.nixosSystem {
      system = "x86_64-linux";
      modules = [
        agent-tick.nixosModules.default
        {
          services.agent-tick = {
            enable = true;
            mode = "single";
            host = "127.0.0.1";
            port = 8787;
            publicUrl = "https://tick.example.com";
            hostedService = false;

            # Optional Redis coordination for multi-process deployments.
            # redisUrl = "redis://127.0.0.1:6379";
            # eventBusBackend = "redis";
            # rateLimitBackend = "redis";

            # Secret env file from agenix/sops-nix/etc.
            # Example contents: AGENT_TICK_ADMIN_TOKEN=...
            secretEnvironmentFile = "/run/agenix/agent-tick-env";
          };
        }
      ];
    };
  };
}
```

Non-secret settings should go in Nix options. Secrets should go in the environment file, for example:

```env
AGENT_TICK_ADMIN_TOKEN=change-me
# AGENT_TICK_CLERK_SECRET_KEY=sk_...
# AGENT_TICK_SESSION_SECRET=...
```

You can also run the packaged server directly:

```sh
AGENT_TICK_MODE=single \
AGENT_TICK_PUBLIC_URL=http://127.0.0.1:8787 \
AGENT_TICK_DATABASE_URL=file:./agent-tick.db \
nix run .
```

## Data, backup, and operator responsibility

SQLite data is in the `agent_tick_data` Docker volume for Docker deployments, or `/var/lib/agent-tick/agent-tick.db` by default for the NixOS module. Back up the database regularly. It contains users, Clerk identity mappings, Workspaces, Agent Token hashes, Activity history, device registrations, and audit events.

Self-hosted operators are responsible for their own deployment's data, backups, access controls, analytics, notification providers, retention windows, deletion processes, user notices, and legal compliance. Self-Deprecated ApS operates the hosted Agent Tick service and Native App, but cannot delete or control data on infrastructure it does not operate.

By default, self-hosted operational history is retained indefinitely except short-lived event tickets, Request waiter tokens, and pairing codes. Set the retention environment variables above to have startup/hourly cleanup remove old completed/expired Requests, Status Updates, audit events, and unregistered devices. Set Request/status update retention days to `0` to turn Activity History content retention off while keeping minimal operational metadata where the service requires it.

Do not store or back up Clerk session tokens; Agent Tick only verifies them at request time.

## Security notes

- Run production self-hosted deployments behind HTTPS.
- Set `AGENT_TICK_PUBLIC_URL` to the externally reachable URL.
- Use `AGENT_TICK_ADMIN_TOKEN` for non-local single-mode dashboards.
- Agent tokens are opaque `agent_...` credentials; store them like secrets.
- Clerk mode requires verified primary emails for first-pass users.
- Clerk Organizations may back Shared Workspaces, but Agent Tick authorization uses local Workspace Member records.
- The default installation path remains `single` mode with no third-party identity provider.

## Current implementation scope

The TypeScript server currently covers the core vertical slice: server health/readiness/config, SQLite schema management, local single-mode admin access, Clerk session verification, Agent Token creation, Request create/list/respond/wait/resolve, one-use ticketed event streams, Personal Console Activity UI, workspace-built CLI request/guard flow, Clerk-mode device registration, local Workspace selection, Workspace setup, basic Routing Rules, audit logs, manual Shared Workspace member management, optional active-member seat enforcement, Expo push plus optional Request notification webhooks, configurable memory or Redis-backed rate limits/event wakeups, and configurable retention cleanup.

Agent Tick is a fresh TypeScript service; no Go-era CLI/server compatibility or prototype database migration path is supported. Future work should add only product-relevant features for the current architecture.
