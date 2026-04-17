# Agent Tick

Agent Tick is a self-hosted approval broker for agent systems. Agents submit approval requests, a phone app presents them to the user, and the backend returns the selected response to the requester.

## MVP Shape

- `apps/server`: Go backend and CLI in one binary.
- `apps/mobile`: Expo React Native phone app.

The first transport is intentionally small: HTTP API plus mobile polling. Push notifications, WebSockets, and queue/chat adapters can be added after the request/response model is stable.

## Backend

Run the server:

```sh
cd apps/server
go run ./cmd/agent-tick server --addr :8787 --data ./agent-tick.db
```

The server stores approvals, responses, and audit events in SQLite.

Run with Docker Compose:

```sh
AGENT_TICK_TOKEN=change-me docker compose up --build
```

Submit a blocking approval request:

```sh
cd apps/server
go run ./cmd/agent-tick request --title "Run command?" --body "codex wants to run npm install"
```

Guard a command so it only runs after phone approval:

```sh
cd apps/server
go run ./cmd/agent-tick guard -- npm install
```

Create a short-lived pairing code for a phone:

```sh
cd apps/server
go run ./cmd/agent-tick pair
```

For non-localhost deployments, set `AGENT_TICK_TOKEN` on the server and clients. Requests must include `Authorization: Bearer <token>`.

## Mobile

Run the Expo app:

```sh
devbox run mobile
```

For a physical phone on the same network, use:

```sh
devbox run mobile:lan
```

Enter the backend URL and token in the app. On a physical phone, `localhost` means the phone itself, so use your computer's LAN address for the backend, for example `http://192.168.1.20:8787`.

The app polls for pending approvals and lets the user approve, deny, choose an option, or attach a short reply.

## Security Baseline

- Localhost works without a token for development.
- Non-localhost requests require `AGENT_TICK_TOKEN`.
- Approval responses are stored with timestamped request records.
- Production deployments should run behind HTTPS.

Planned hardening:

- QR-code device pairing.
- Per-agent scoped tokens.
- Append-only audit log.
- Push notifications for wake-up.
- Signed request envelopes for high-trust integrations.
