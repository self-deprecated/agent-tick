# Agent Tick

Agent Tick is a self-hosted approval broker for agent systems. Agents submit approval requests, your phone shows the approval, and the backend returns the response to the requester.

## Run The Server

Create a `.env` file on your server:

```env
AGENT_TICK_IMAGE=ghcr.io/your-org/agent-tick:latest
AGENT_TICK_MODE=user
AGENT_TICK_PUBLIC_URL=https://tick.example.com
AGENT_TICK_PORT=8787
```

Replace:

- `ghcr.io/your-org/agent-tick:latest` with your published Agent Tick image.
- `https://tick.example.com` with the public HTTPS URL for your server.

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

Open the dashboard:

```text
https://tick.example.com/
```

Sign in, open `Devices` to pair your phone, then open `Agents` to create a request-only agent token.

## Single-User Mode

For a private one-user server, use a dashboard bearer token instead of user logins:

```env
AGENT_TICK_IMAGE=ghcr.io/your-org/agent-tick:latest
AGENT_TICK_MODE=single
AGENT_TICK_TOKEN=change-me
AGENT_TICK_PUBLIC_URL=https://tick.example.com
AGENT_TICK_PORT=8787
```

Open the dashboard and enter `AGENT_TICK_TOKEN`.

## Configure An Agent

The dashboard creates request-only agent tokens. After creating a token, run the shown setup command on the machine where your agent runs:

```sh
agent-tick setup --server https://tick.example.com --token agent_...
```

Then an agent can request approval:

```sh
agent-tick request \
  --title "Run command?" \
  --body "codex wants to run npm install" \
  --command "npm install"
```

Or guard a command:

```sh
agent-tick guard -- npm install
```

## Security Notes

- Run production deployments behind HTTPS.
- `AGENT_TICK_PUBLIC_URL` must be the URL your phone can reach.
- Pairing QR codes are short-lived and one-time use.
- Dashboard-created agent tokens can create approval requests, but cannot approve requests, pair devices, or create more tokens.
- SQLite data is stored in the `agent_tick_data` Docker volume. Back it up.

## Development

See [DEVELOPMENT.md](./DEVELOPMENT.md) for local builds, source-based container runs, mobile app development, and release image publishing.
