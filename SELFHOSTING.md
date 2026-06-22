# Self-Hosting Agent Tick

Use this guide when you want to run Agent Tick yourself. If you want the managed product instead, start at <https://app.agenttick.sh>.

Agent Tick is source-available under BSL 1.1. Internal commercial self-hosting is allowed, including use by a business on its own infrastructure. Offering Agent Tick as a hosted or managed service to third parties is prohibited. The BSL change date is 2028-05-31.

The server Docker image runs the TypeScript API server, serves the built Svelte dashboard, and stores durable data in local SQLite by default or PostgreSQL when configured. The repository also includes a Nix flake package and NixOS module for Nix-based operators.

## 5-minute Docker quickstart: localhost SQLite

This path runs a single-user local Agent Tick server with the published image and a Docker-managed SQLite volume. It does not require Clerk, PostgreSQL, Redis, billing, email, or push-provider credentials.

```sh
cp .env.example .env
cat > .env.localhost <<'EOF'
AGENT_TICK_IMAGE=ghcr.io/self-deprecated/agent-tick:latest
AGENT_TICK_MODE=single
AGENT_TICK_PUBLIC_URL=http://localhost:8787
AGENT_TICK_PORT=8787
AGENT_TICK_DATABASE_URL=file:/data/agent-tick.db
AGENT_TICK_DATABASE_MIGRATE_ON_START=true
EOF
cat .env.localhost > .env
docker compose -f docker-compose.selfhost.yml up -d
curl http://127.0.0.1:8787/healthz
curl http://127.0.0.1:8787/readyz
```

Open <http://localhost:8787>. In local single mode without `AGENT_TICK_ADMIN_TOKEN`, the dashboard can create the first local Workspace and Agent Token directly.

Connect an agent host:

```sh
npx @self-deprecated/agent-tick setup --server http://localhost:8787
```

For CI or a non-interactive machine, create or copy an `agent_...` token from the dashboard and save it locally:

```sh
agent-tick config --server http://localhost:8787 --token agent_...
```

For rich agent message/tool mirroring, connect the Native App to the self-hosted server and enable **Settings → General → Private encryption** before setting `privacy.defaultContentMode` to `private` in `agent-tick features`.

## Published-image Compose file

Use `docker-compose.selfhost.yml` for operator deployments. It uses only published images and has no `build:` stanza. The repository `docker-compose.yml` is the development Compose file and can build the server image from this checkout.

Common commands:

```sh
# Start SQLite/single-mode from .env
docker compose -f docker-compose.selfhost.yml up -d

# Include Compose-managed PostgreSQL
docker compose -f docker-compose.selfhost.yml --profile postgres up -d

# Include Redis for multi-process coordination
docker compose -f docker-compose.selfhost.yml --profile redis up -d

# Inspect rendered config before starting
docker compose -f docker-compose.selfhost.yml config

# Watch logs
docker compose -f docker-compose.selfhost.yml logs -f server
```

## Which mode should I choose?

| Choice | Use it when | Configure |
| --- | --- | --- |
| `single` mode | You want one self-hosted operator/admin path with no third-party human identity provider. This is the default and the recommended first deployment. | `AGENT_TICK_MODE=single`; optionally set `AGENT_TICK_ADMIN_TOKEN` outside localhost. |
| Clerk mode | You need multi-user browser/mobile sign-in backed by Clerk. Agent Tick still owns Workspaces, members, Agent Tokens, Requests, audit logs, and billing/seat-limit state. | `AGENT_TICK_MODE=clerk` plus Clerk keys and authorized parties. |
| SQLite | You want the simplest durable store for localhost, a small VPS, or a single server instance. | `AGENT_TICK_DATABASE_URL=file:/data/agent-tick.db`. |
| PostgreSQL | You want an external/managed database, operational backups, or production-style database operations. | `AGENT_TICK_DATABASE_URL=postgresql://...`. |
| Compose-managed PostgreSQL | You want Docker Compose to run PostgreSQL beside Agent Tick. | Use the `postgres` profile and point `AGENT_TICK_DATABASE_URL` at `postgres:5432`. |
| Redis | You run multiple Agent Tick server instances or want Redis-backed event wakeups/rate limits/retention locks. Single-instance SQLite deployments do not need Redis. | Set `AGENT_TICK_REDIS_URL` and selected `*_BACKEND=redis` values; use the `redis` profile if Compose should run Redis. |

## First-run checklist

1. Set `AGENT_TICK_PUBLIC_URL` to the URL users and agent hosts will open. For localhost, use `http://localhost:8787`. For production, use your HTTPS origin, for example `https://tick.example.com`.
2. Start the server and wait for readiness:

   ```sh
   docker compose -f docker-compose.selfhost.yml up -d
   docker compose -f docker-compose.selfhost.yml ps
   curl http://127.0.0.1:8787/readyz
   ```

3. Open the dashboard at `AGENT_TICK_PUBLIC_URL`.
4. If `AGENT_TICK_ADMIN_TOKEN` is configured, enter it when prompted. This token is an admin bootstrap/dashboard gate; protect it like a secret.
5. Create the first Workspace if the dashboard asks for one.
6. Create or authorize the first Agent Token. The token starts with `agent_...`; store it like a bearer secret.
7. Configure an agent host with either:

   ```sh
   npx @self-deprecated/agent-tick setup --server https://tick.example.com
   ```

   or, for non-interactive hosts:

   ```sh
   agent-tick config --server https://tick.example.com --token agent_...
   ```

8. Send a safe test Request:

   ```sh
   npx @self-deprecated/agent-tick send steering \
     --title "Self-hosted Agent Tick test" \
     --choice works="It works" \
     --choice stop:deny="Stop testing"
   ```

## Deployment recipes

### Localhost SQLite

Use this for first local success:

```env
AGENT_TICK_IMAGE=ghcr.io/self-deprecated/agent-tick:latest
AGENT_TICK_MODE=single
AGENT_TICK_PUBLIC_URL=http://localhost:8787
AGENT_TICK_PORT=8787
AGENT_TICK_DATABASE_URL=file:/data/agent-tick.db
AGENT_TICK_DATABASE_MIGRATE_ON_START=true
```

```sh
docker compose -f docker-compose.selfhost.yml up -d
curl http://127.0.0.1:8787/readyz
```

### VPS or reverse-proxy SQLite

Use this for a small single-server deployment behind Caddy, Traefik, nginx, or another HTTPS reverse proxy:

```env
AGENT_TICK_IMAGE=ghcr.io/self-deprecated/agent-tick:latest
AGENT_TICK_MODE=single
AGENT_TICK_PUBLIC_URL=https://tick.example.com
AGENT_TICK_PORT=8787
AGENT_TICK_DATABASE_URL=file:/data/agent-tick.db
AGENT_TICK_DATABASE_MIGRATE_ON_START=true
AGENT_TICK_ADMIN_TOKEN=replace-with-a-long-random-value
```

```sh
docker compose -f docker-compose.selfhost.yml up -d
curl http://127.0.0.1:8787/readyz
```

Point your reverse proxy at `http://127.0.0.1:8787`, terminate HTTPS at the proxy, and make sure the external URL exactly matches `AGENT_TICK_PUBLIC_URL`.

### Compose-managed PostgreSQL

Use this when you want Compose to run PostgreSQL for Agent Tick:

```env
AGENT_TICK_IMAGE=ghcr.io/self-deprecated/agent-tick:latest
AGENT_TICK_MODE=single
AGENT_TICK_PUBLIC_URL=https://tick.example.com
AGENT_TICK_PORT=8787
AGENT_TICK_DATABASE_URL=postgresql://agent_tick:change-me@postgres:5432/agent_tick
AGENT_TICK_DATABASE_MIGRATE_ON_START=true
AGENT_TICK_POSTGRES_USER=agent_tick
AGENT_TICK_POSTGRES_PASSWORD=change-me
AGENT_TICK_POSTGRES_DB=agent_tick
AGENT_TICK_ADMIN_TOKEN=replace-with-a-long-random-value
```

```sh
docker compose -f docker-compose.selfhost.yml --profile postgres up -d
docker compose -f docker-compose.selfhost.yml --profile postgres ps
curl http://127.0.0.1:8787/readyz
```

### Managed PostgreSQL with optional Redis

Use this when your platform provides PostgreSQL and, optionally, Redis:

```env
AGENT_TICK_IMAGE=ghcr.io/self-deprecated/agent-tick:latest
AGENT_TICK_MODE=single
AGENT_TICK_PUBLIC_URL=https://tick.example.com
AGENT_TICK_PORT=8787
AGENT_TICK_DATABASE_URL=postgresql://agent_tick:change-me@db.example.com:5432/agent_tick
AGENT_TICK_DATABASE_MIGRATE_ON_START=true
AGENT_TICK_ADMIN_TOKEN=replace-with-a-long-random-value

# Optional, recommended only when you need Redis-backed coordination.
AGENT_TICK_REDIS_URL=redis://redis.example.com:6379
AGENT_TICK_EVENT_BUS_BACKEND=redis
AGENT_TICK_RATE_LIMIT_BACKEND=redis
AGENT_TICK_RETENTION_CLEANUP_LOCK_BACKEND=redis
```

```sh
docker compose -f docker-compose.selfhost.yml up -d
curl http://127.0.0.1:8787/readyz
```

PostgreSQL pool tuning is optional. For many server instances, keep `AGENT_TICK_POSTGRES_POOL_MAX` small enough that total app connections fit the database limit, or put PgBouncer in transaction-pooling mode in front of PostgreSQL.

### Clerk multi-user mode

Use Clerk mode when you need multi-user dashboard/mobile sign-in. Clerk authenticates humans. Agent Tick still owns local users, Workspaces, Approval Devices, Agent Tokens, Requests, billing seat limits, and audit data.

Create a Clerk application, configure your dashboard origin in Clerk, and set real Clerk credentials:

```env
AGENT_TICK_IMAGE=ghcr.io/self-deprecated/agent-tick:latest
AGENT_TICK_MODE=clerk
AGENT_TICK_PUBLIC_URL=https://tick.example.com
AGENT_TICK_PORT=8787
AGENT_TICK_DATABASE_URL=file:/data/agent-tick.db
AGENT_TICK_DATABASE_MIGRATE_ON_START=true
AGENT_TICK_HOSTED_SERVICE=false
AGENT_TICK_CLERK_PUBLISHABLE_KEY=pk_...
AGENT_TICK_CLERK_SECRET_KEY=sk_...
AGENT_TICK_CLERK_AUTHORIZED_PARTIES=https://tick.example.com
AGENT_TICK_SESSION_SECRET=replace-with-a-long-random-value
```

Optional networkless verification key:

```env
AGENT_TICK_CLERK_JWT_KEY="-----BEGIN PUBLIC KEY-----..."
```

```sh
docker compose -f docker-compose.selfhost.yml up -d
curl http://127.0.0.1:8787/readyz
```

The dashboard fetches `/v1/auth/config`, loads Clerk with the publishable key, and sends Clerk session tokens to the API. The server maps Clerk `(issuer, subject)` to local `usr_...` IDs and requires a verified primary email. Do not expect Clerk mode to work without real Clerk credentials.

## Configuration reference

See `.env.example` for grouped settings:

- required/public server settings
- database settings for SQLite, Compose-managed PostgreSQL, and managed PostgreSQL
- single-mode access settings
- Clerk multi-user settings
- Redis coordination settings
- request notification webhooks
- rate limiting
- retention cleanup
- webhook/billing integration secrets
- server-wide Private Requests policy

Agent Tick is still pre-launch, so schema setup installs the current schema rather than preserving historical migrations; local/dev databases may need to be reset instead of migrated forward. Delete `agent-tick.db` or reset a pre-launch PostgreSQL schema if an older database shape no longer boots. There is no automatic SQLite-to-PostgreSQL data migration unless a separate migration tool is built.

## Backup and restore

Back up the selected durable store before upgrades. The database contains users, Clerk identity mappings, Workspaces, Agent Token hashes, Activity history, device registrations, and audit events.

### SQLite Docker volume backup

```sh
mkdir -p backups
docker compose -f docker-compose.selfhost.yml stop server
docker run --rm \
  -v agent_tick_data:/data:ro \
  -v "$PWD/backups:/backup" \
  alpine sh -c 'cp /data/agent-tick.db /backup/agent-tick-$(date +%Y%m%d-%H%M%S).db'
docker compose -f docker-compose.selfhost.yml up -d
```

Restore SQLite into the Docker volume:

```sh
docker compose -f docker-compose.selfhost.yml stop server
docker run --rm \
  -v agent_tick_data:/data \
  -v "$PWD/backups:/backup:ro" \
  alpine sh -c 'cp /backup/agent-tick.db /data/agent-tick.db'
docker compose -f docker-compose.selfhost.yml up -d
curl http://127.0.0.1:8787/readyz
```

### PostgreSQL backup and restore

For Compose-managed PostgreSQL:

```sh
mkdir -p backups
docker compose -f docker-compose.selfhost.yml --profile postgres exec -T postgres \
  pg_dump -U agent_tick -d agent_tick --format=custom \
  > backups/agent-tick-$(date +%Y%m%d-%H%M%S).dump
```

Restore into an empty PostgreSQL database:

```sh
cat backups/agent-tick.dump | docker compose -f docker-compose.selfhost.yml --profile postgres exec -T postgres \
  pg_restore -U agent_tick -d agent_tick --clean --if-exists
```

For managed PostgreSQL, use your provider's backups plus regular `pg_dump`/`pg_restore` from a network location allowed to reach the database.

### Upgrade checklist

1. Read the release notes for config or schema changes.
2. Back up SQLite/PostgreSQL.
3. Pull the new image:

   ```sh
   docker compose -f docker-compose.selfhost.yml pull server
   ```

4. Render config and confirm the intended image/env:

   ```sh
   docker compose -f docker-compose.selfhost.yml config
   ```

5. Restart:

   ```sh
   docker compose -f docker-compose.selfhost.yml up -d
   curl http://127.0.0.1:8787/readyz
   ```

6. Open the dashboard and send a safe test Request from an agent host.

## Troubleshooting

### `/readyz` is unhealthy

Check logs first:

```sh
docker compose -f docker-compose.selfhost.yml logs --tail=200 server
```

Common causes are a database URL typo, PostgreSQL not ready/reachable, Redis selected but unavailable, or a malformed environment value. `/healthz` only verifies that the process is alive; `/readyz` verifies configured dependencies.

### Dashboard opens the wrong URL or callbacks fail

`AGENT_TICK_PUBLIC_URL` must be the exact externally reachable origin, including scheme and host. Use `http://localhost:8787` for local testing and `https://tick.example.com` behind a production reverse proxy. Do not set it to the internal Docker service name.

### The dashboard asks for an admin token

In single mode, `AGENT_TICK_ADMIN_TOKEN` gates bootstrap/admin dashboard access. Enter the value from `.env`. If you lost it, update `.env` with a new long random value and restart the server.

### Clerk sign-in loops or fails

Confirm `AGENT_TICK_MODE=clerk`, `AGENT_TICK_CLERK_PUBLISHABLE_KEY`, `AGENT_TICK_CLERK_SECRET_KEY`, and `AGENT_TICK_CLERK_AUTHORIZED_PARTIES` are set. The authorized parties value must include the exact dashboard origin. Check Clerk's dashboard for the same allowed origin and make sure users have verified primary email addresses.

### PostgreSQL connection failures

For Compose-managed PostgreSQL, start with `--profile postgres`, confirm `docker compose -f docker-compose.selfhost.yml --profile postgres ps`, and make sure `AGENT_TICK_DATABASE_URL` uses host `postgres`, port `5432`, and credentials matching `AGENT_TICK_POSTGRES_*`. For managed PostgreSQL, check firewall rules, TLS/provider requirements, password encoding in the URL, and connection limits.

### Volume or permission issues

The server writes SQLite data under `/data` in the container. With Docker volumes, Docker owns the volume and permissions are usually automatic. If you bind mount a host directory instead, ensure the container can read and write the database file and parent directory.

### Inspecting logs and configuration

```sh
docker compose -f docker-compose.selfhost.yml ps
docker compose -f docker-compose.selfhost.yml logs -f server
docker compose -f docker-compose.selfhost.yml config
```

## Local image build for development

Use the repository development Compose file when you want to build from this checkout:

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

## Data and operator responsibility

SQLite data is in the `agent_tick_data` Docker volume for Docker deployments, or `/var/lib/agent-tick/agent-tick.db` by default for the NixOS module. Self-hosted operators are responsible for their own deployment's data, backups, access controls, analytics, notification providers, retention windows, deletion processes, user notices, and legal compliance. Self-Deprecated ApS operates the hosted Agent Tick service and Native App, but cannot delete or control data on infrastructure it does not operate.

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
