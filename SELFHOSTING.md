# Self-Hosting Agent Tick

Use this guide when you want to run Agent Tick yourself. If you want the managed product instead, start at <https://agenttick.sh>.

Agent Tick can run either as the published Docker image or as the Nix flake package/NixOS module. The server runs the TypeScript API server, serves the built Svelte dashboard, and stores SQLite data in a local SQLite database.

## Single-user local mode

Create `.env`:

```env
AGENT_TICK_IMAGE=ghcr.io/self-deprecated/agent-tick:latest
AGENT_TICK_MODE=single
AGENT_TICK_PUBLIC_URL=https://tick.example.com
AGENT_TICK_PORT=8787

# Optional but recommended outside localhost.
AGENT_TICK_ADMIN_TOKEN=change-me

# Optional local active-member seat guard. Omit for unlimited self-hosted seats.
# AGENT_TICK_MAX_ACTIVE_MEMBERS=10

# Optional invite email delivery. Agent Tick POSTs invite JSON to this webhook.
# AGENT_TICK_INVITE_EMAIL_WEBHOOK_URL=https://mail.example.com/agent-tick/invites

# Optional approval notification webhook in addition to mobile push.
# AGENT_TICK_APPROVAL_NOTIFICATION_WEBHOOK_URL=https://hooks.example.com/agent-tick/approvals

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
# AGENT_TICK_APPROVAL_RETENTION_DAYS=180
# AGENT_TICK_AUDIT_RETENTION_DAYS=365
# AGENT_TICK_UNREGISTERED_DEVICE_RETENTION_DAYS=90
# AGENT_TICK_EXPIRED_INVITE_RETENTION_DAYS=90
# AGENT_TICK_RETENTION_CLEANUP_ENABLED=true
# AGENT_TICK_RETENTION_CLEANUP_INTERVAL_MINUTES=60
```

Start it:

```sh
docker compose up -d
```

Open `AGENT_TICK_PUBLIC_URL`. If `AGENT_TICK_ADMIN_TOKEN` is set, enter it in the dashboard. Install the CLI and configure your agent machine:

```sh
npm install -g @self-deprecated/agent-tick
agent-tick setup --server https://tick.example.com --token agent_...
```

The public product site is <https://agenttick.sh>, but self-hosted deployments use their own `AGENT_TICK_PUBLIC_URL`.

## Clerk multi-user mode

Clerk authenticates dashboard/mobile humans. Agent Tick still owns local users, organizations, devices, agent tokens, approvals, billing seat limits, and audit data.

Create a Clerk application, configure your dashboard origin in Clerk, then set:

```env
AGENT_TICK_IMAGE=ghcr.io/self-deprecated/agent-tick:latest
AGENT_TICK_MODE=clerk
AGENT_TICK_PUBLIC_URL=https://tick.example.com
AGENT_TICK_PORT=8787
AGENT_TICK_CLERK_PUBLISHABLE_KEY=pk_...
AGENT_TICK_CLERK_SECRET_KEY=sk_...
AGENT_TICK_CLERK_AUTHORIZED_PARTIES=https://tick.example.com
```

Optional local active-member seat guard, webhooks, rate limits, Redis coordination, and retention cleanup windows (also available in single mode):

```env
AGENT_TICK_MAX_ACTIVE_MEMBERS=10
AGENT_TICK_INVITE_EMAIL_WEBHOOK_URL=https://mail.example.com/agent-tick/invites
AGENT_TICK_APPROVAL_NOTIFICATION_WEBHOOK_URL=https://hooks.example.com/agent-tick/approvals
AGENT_TICK_RATE_LIMIT_WINDOW_MS=60000
AGENT_TICK_RATE_LIMIT_MAX_REQUESTS=60
AGENT_TICK_REDIS_URL=redis://redis:6379
AGENT_TICK_EVENT_BUS_BACKEND=redis
AGENT_TICK_RATE_LIMIT_BACKEND=redis
AGENT_TICK_APPROVAL_RETENTION_DAYS=180
AGENT_TICK_AUDIT_RETENTION_DAYS=365
AGENT_TICK_UNREGISTERED_DEVICE_RETENTION_DAYS=90
AGENT_TICK_EXPIRED_INVITE_RETENTION_DAYS=90
AGENT_TICK_RETENTION_CLEANUP_ENABLED=true
```

Optional networkless verification key:

```env
AGENT_TICK_CLERK_JWT_KEY="-----BEGIN PUBLIC KEY-----..."
```

Start it with Docker Compose. The dashboard fetches `/v1/auth/config`, loads Clerk with the publishable key, and sends Clerk session tokens to the API. The server maps Clerk `(issuer, subject)` to local `usr_...` IDs and requires a verified primary email.

After the server is running, set up an agent host with the installer:

```sh
npm install -g @self-deprecated/agent-tick
agent-tick install --server https://tick.example.com
```

The CLI opens the dashboard, waits while you sign in with Clerk, saves the returned Agent Tick `agent_...` token, and offers to install local coding-agent approval instructions. The token is written to `~/.config/agent-tick/config.json` by default; use `AGENT_TICK_CONFIG=/path/to/config.json` to choose a different file. For CI/non-interactive hosts, create an agent token in the dashboard and run `agent-tick setup --server https://tick.example.com --token agent_...` instead.

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
            publicUrl = "https://agenttick.sh";

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

## Data and backup

SQLite data is in the `agent_tick_data` Docker volume for Docker deployments, or `/var/lib/agent-tick/agent-tick.db` by default for the NixOS module. Back up the database regularly. It contains users, Clerk identity mappings, organizations, agent token hashes, approval history, device registrations, and audit events.

By default, operational history is retained indefinitely except short-lived event tickets, approval waiter tokens, and pairing codes. Set the retention environment variables above to have startup/hourly cleanup remove old completed/expired approvals, audit events, unregistered devices, and expired/revoked invites that have no acceptance history.

Do not store or back up Clerk session tokens; Agent Tick only verifies them at request time.

## Security notes

- Run production self-hosted deployments behind HTTPS.
- Set `AGENT_TICK_PUBLIC_URL` to the externally reachable URL.
- Use `AGENT_TICK_ADMIN_TOKEN` for non-local single-mode dashboards.
- Agent tokens are opaque `agent_...` credentials; store them like secrets.
- Clerk mode requires verified primary emails for first-pass users.
- Clerk Organizations are not used for Agent Tick authorization in this pass.
- The default installation path remains `single` mode with no third-party identity provider.

## Current implementation scope

The TypeScript server currently covers the core vertical slice: server health/readiness/config, SQLite schema management, local single-mode admin access, Clerk session verification, agent token creation, approval create/list/respond/wait/abandon, one-use ticketed event streams, dashboard approval UI, workspace-built CLI request/guard flow, Clerk-mode device registration, local organization selection, projects, teams, basic policies, audit logs, organization invites, optional active-member seat enforcement, optional invite email webhooks/resend, Expo push plus optional approval notification webhooks, configurable memory or Redis-backed rate limits/event wakeups, and configurable retention cleanup.

Agent Tick is a fresh TypeScript service; no Go-era CLI/server compatibility or prototype database migration path is supported. Future work should add only product-relevant features for the current architecture.
