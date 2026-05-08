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

Clerk authenticates dashboard/mobile humans. Agent Tick still owns local users, organizations, devices, agent tokens, approvals, and audit data.

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

Optional networkless verification key:

```env
AGENT_TICK_CLERK_JWT_KEY="-----BEGIN PUBLIC KEY-----..."
```

Start it with Docker Compose. The dashboard fetches `/v1/auth/config`, loads Clerk with the publishable key, and sends Clerk session tokens to the API. The server maps Clerk `(issuer, subject)` to local `usr_...` IDs and requires a verified primary email.

## Local image build

```sh
docker build -f apps/server-ts/Dockerfile -t agent-tick:dev .

AGENT_TICK_IMAGE=agent-tick:dev \
AGENT_TICK_MODE=single \
AGENT_TICK_PUBLIC_URL=http://localhost:8787 \
AGENT_TICK_PORT=8787 \
docker compose up -d
```

## Data and backup

SQLite data is in the `agent_tick_data` Docker volume. Back up the volume regularly. It contains users, Clerk identity mappings, organizations, agent token hashes, approval history, device registrations, and audit events.

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

The TypeScript rewrite currently covers the core vertical slice: server health/config, SQLite migrations, local single-mode admin access, Clerk session verification, agent token creation, approval create/list/respond/wait, dashboard approval UI, npm CLI request flow, and Clerk-mode device registration foundations.

Some earlier Go-era features are intentionally being reintroduced only when they are needed: advanced policy templates, invite approvals, extra notification sinks, full mobile Clerk UI, and event streaming.
