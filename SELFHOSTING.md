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

Open the dashboard at your public URL. Sign in, open **Devices** to pair your phone, then open **Agents** to create a request-only agent token.

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

## Security Notes

- Run production deployments behind HTTPS.
- `AGENT_TICK_PUBLIC_URL` must be the URL your phone can reach.
- Pairing QR codes are short-lived and one-time use.
- Dashboard-created agent tokens can create approval requests but cannot approve requests, pair devices, or create more tokens.
- SQLite data is stored in the `agent_tick_data` Docker volume. Back it up.
- Single mode maps all records to one implicit user.
- User mode scopes approvals, devices, pairing tokens, agent tokens, and audit events by user.
- Dashboard sessions use HttpOnly cookies.
