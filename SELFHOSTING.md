# Self-Hosting Agent Tick

Agent Tick is Docker-first. The server image runs the TypeScript API server, serves the built Svelte dashboard, and stores SQLite data in `/data/agent-tick.db`.

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

# Optional retention cleanup windows. Omit to retain operational history indefinitely.
# AGENT_TICK_APPROVAL_RETENTION_DAYS=180
# AGENT_TICK_AUDIT_RETENTION_DAYS=365
# AGENT_TICK_UNREGISTERED_DEVICE_RETENTION_DAYS=90
# AGENT_TICK_EXPIRED_INVITE_RETENTION_DAYS=90
# AGENT_TICK_RETENTION_CLEANUP_INTERVAL_MINUTES=60
```

Start it:

```sh
docker compose up -d
```

Open `AGENT_TICK_PUBLIC_URL`. If `AGENT_TICK_ADMIN_TOKEN` is set, enter it in the dashboard. Create an agent token and configure your agent machine:

```sh
npx agent-tick setup --server https://tick.example.com --token agent_...
```

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

Optional local active-member seat guard, invite email webhook, and retention cleanup windows (also available in single mode):

```env
AGENT_TICK_MAX_ACTIVE_MEMBERS=10
AGENT_TICK_INVITE_EMAIL_WEBHOOK_URL=https://mail.example.com/agent-tick/invites
AGENT_TICK_APPROVAL_RETENTION_DAYS=180
AGENT_TICK_AUDIT_RETENTION_DAYS=365
AGENT_TICK_UNREGISTERED_DEVICE_RETENTION_DAYS=90
AGENT_TICK_EXPIRED_INVITE_RETENTION_DAYS=90
```

Optional networkless verification key:

```env
AGENT_TICK_CLERK_JWT_KEY="-----BEGIN PUBLIC KEY-----..."
```

Start it with Docker Compose. The dashboard fetches `/v1/auth/config`, loads Clerk with the publishable key, and sends Clerk session tokens to the API. The server maps Clerk `(issuer, subject)` to local `usr_...` IDs and requires a verified primary email.

## Local image build

```sh
docker build -f apps/server/Dockerfile -t agent-tick:dev .

AGENT_TICK_IMAGE=agent-tick:dev \
AGENT_TICK_MODE=single \
AGENT_TICK_PUBLIC_URL=http://localhost:8787 \
AGENT_TICK_PORT=8787 \
docker compose up -d
```

## Data and backup

SQLite data is in the `agent_tick_data` Docker volume. Back up the volume regularly. It contains users, Clerk identity mappings, organizations, agent token hashes, approval history, device registrations, and audit events.

By default, operational history is retained indefinitely except short-lived event tickets and pairing codes. Set the retention environment variables above to have startup/hourly cleanup remove old completed/expired approvals, audit events, unregistered devices, and expired/revoked invites that have no acceptance history.

Do not store or back up Clerk session tokens; Agent Tick only verifies them at request time.

## Security notes

- Run production deployments behind HTTPS.
- Set `AGENT_TICK_PUBLIC_URL` to the externally reachable URL.
- Use `AGENT_TICK_ADMIN_TOKEN` for non-local single-mode dashboards.
- Agent tokens are opaque `agent_...` credentials; store them like secrets.
- Clerk mode requires verified primary emails for first-pass users.
- Clerk Organizations are not used for Agent Tick authorization in this pass.
- The default installation path remains `single` mode with no third-party identity provider.

## Current implementation scope

The TypeScript server currently covers the core vertical slice: server health/config, SQLite migrations, local single-mode admin access, Clerk session verification, agent token creation, approval create/list/respond/wait, dashboard approval UI, npm CLI request flow, Clerk-mode device registration, local organization selection, projects, teams, basic policies, audit logs, organization invites, optional active-member seat enforcement, optional invite email webhooks/resend, and configurable retention cleanup.

Some earlier Go-era features are intentionally being reintroduced only when they are needed: advanced policy templates, extra notification sinks, richer mobile Clerk flows, and hosted billing/operator tooling.
