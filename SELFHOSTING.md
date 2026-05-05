# Self-Hosting Agent Tick

## Run The Server

Create a `.env` file on your server:

```env
AGENT_TICK_IMAGE=ghcr.io/self-deprecated/agent-tick:latest
AGENT_TICK_MODE=user
AGENT_TICK_PUBLIC_URL=https://tick.example.com
AGENT_TICK_PORT=8787
```

Replace:

- `https://tick.example.com` with the public HTTPS URL for your server.
- `ghcr.io/self-deprecated/agent-tick:latest` with another image tag if you do not want `latest`.

Create `docker-compose.yml`:

```yaml
services:
  server:
    image: ${AGENT_TICK_IMAGE}
    environment:
      AGENT_TICK_MODE: ${AGENT_TICK_MODE}
      AGENT_TICK_PUBLIC_URL: ${AGENT_TICK_PUBLIC_URL}
    ports:
      - "${AGENT_TICK_PORT:-8787}:8787"
    volumes:
      - agent_tick_data:/data
    restart: unless-stopped

volumes:
  agent_tick_data:
```

Start it:

```sh
docker compose up -d
```

Open the dashboard at your public URL. Sign in, open **Devices** to pair your phone, then open **Agents** to create a request-only agent token. The **Billing** panel shows your self-hosted plan, current usage, retention defaults, and hosted-service contact placeholders without blocking local use. The **Audit** panel lets organization admins inspect recent security events or export them as CSV. Agent Tick creates a default organization and project automatically; use **Teams** and **Projects** later if you want team grouping.

## Single-User Mode

For a private one-user server, use a dashboard bearer token instead of user logins:

```env
AGENT_TICK_IMAGE=ghcr.io/self-deprecated/agent-tick:latest
AGENT_TICK_MODE=single
AGENT_TICK_TOKEN=change-me
AGENT_TICK_PUBLIC_URL=https://tick.example.com
AGENT_TICK_PORT=8787
```

Open the dashboard and enter your `AGENT_TICK_TOKEN` to sign in.

## Container Image

The published image is built by GitHub Actions from `apps/server/Dockerfile`:

```text
ghcr.io/self-deprecated/agent-tick:latest
ghcr.io/self-deprecated/agent-tick:main
ghcr.io/self-deprecated/agent-tick:sha-<commit>
ghcr.io/self-deprecated/agent-tick:v0.1.0
```

Images are pushed on `main` and on tags matching `v*`.

To run a locally built image instead:

```sh
docker build -t agent-tick:dev apps/server

AGENT_TICK_IMAGE=agent-tick:dev \
AGENT_TICK_MODE=single \
AGENT_TICK_TOKEN=change-me \
AGENT_TICK_PUBLIC_URL=http://localhost:8787 \
AGENT_TICK_PORT=8787 \
docker compose up -d
```

Use the same commands with `podman` or `podman compose` if your machine uses Podman.

## Production Hardening

Run Agent Tick behind an HTTPS reverse proxy for production. Set `AGENT_TICK_PUBLIC_URL` to the public `https://` URL and make sure the proxy forwards `X-Forwarded-Proto: https` and `X-Forwarded-Host` so dashboard QR codes and secure-cookie behavior match the public origin.

Back up the `agent_tick_data` Docker volume. It contains the SQLite database with users, devices, coarse last-seen/availability state, team on-call schedules, agent tokens, approval history, policy definitions, approval votes, sessions, and audit events. For a simple backup, stop the container or take a filesystem-consistent snapshot before copying the volume contents.

Rotate credentials deliberately. In single-user mode, change `AGENT_TICK_TOKEN` and restart the server if the dashboard token is exposed. For agent tokens, use **Rotate** in the dashboard Agents panel or the server-local `agent-tick agent-token rotate <agent-id>` command, then rerun `agent-tick setup` on the machine where that agent runs. Revoke devices from the dashboard if a phone is lost or replaced.

The phone app can show local notifications while it polls. Expo remote push requires an EAS development or production build with a real EAS project id; Expo Go and placeholder project ids are limited to local notification behavior.

Dashboard sessions in user mode use HttpOnly session cookies plus a readable CSRF token cookie for browser writes. Cookies are marked secure when the server sees HTTPS directly, receives `X-Forwarded-Proto: https`, or has an HTTPS `AGENT_TICK_PUBLIC_URL`. Browser CORS responses are restricted to the configured public origin, the request host, or loopback development origins instead of using a wildcard, write request bodies are capped at 1 MiB, and each server process applies a simple per-client-IP rate limit (stricter on login, pairing, and token-creation paths).

## Plan and Billing Defaults

Self-hosted organizations use the `self-hosted` plan by default. Seat, team, active-agent, and 30-day approval-request limits are stored as `-1`, which means unlimited. If an operator sets any of those limits to a non-negative value, the server enforces them when teams, new organization seats, active agent tokens, or rolling 30-day approval requests are created and returns HTTP 402 with a plan-limit message. Audit and approval retention settings are stored per organization and currently default to 365 days so operators can plan cleanup/backup policies explicitly. The dashboard/API billing status endpoint is safe to expose to organization viewers and reports only the current organization's plan, limits, and usage counters. Organization admins can review security-sensitive events through `GET /v1/audit-events` and download CSV exports from `GET /v1/audit-events/export`; both are scoped to the authenticated organization.

Hosted deployments can later replace the placeholder upgrade/contact links with a billing provider portal or invoice URL without changing the core approval flow.

## Security Notes

- Run production deployments behind HTTPS.
- `AGENT_TICK_PUBLIC_URL` must be the URL your phone can reach.
- Pairing QR codes are short-lived and one-time use.
- Dashboard-created agent tokens can create approval requests but cannot approve requests, pair devices, or create more tokens.
- SQLite data is stored in the `agent_tick_data` Docker volume. Back it up.
- Single mode maps all records to one implicit user.
- User mode scopes approvals, devices, pairing tokens, agent tokens, and audit events by user. Organization, team, project, approval-policy, availability, and on-call records provide grouping and quorum/sequence/on-call approvals for hosted/team setups without changing the single-user flow.
- Dashboard sessions use HttpOnly cookies plus a CSRF token cookie for browser writes. When the server sees HTTPS directly, `X-Forwarded-Proto: https`, or an HTTPS `AGENT_TICK_PUBLIC_URL`, these cookies are marked secure.
