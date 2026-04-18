# Agent Tick

Agent Tick is a self-hosted approval broker for agent systems. Agents submit approval requests, a phone app presents them to the user, and the backend returns the selected response to the requester.

The normal flow is:

1. Run the Agent Tick server.
2. Open the dashboard and sign in or enter the single-user bearer token.
3. Pair the phone from the dashboard `Devices` panel.
4. Create an agent token from the dashboard `Agents` panel.
5. Run `agent-tick setup` once on the machine where the agent runs.
6. Agents call `agent-tick request` or `agent-tick guard`.

## Project Shape

- `apps/server`: Go server and CLI in one binary.
- `apps/mobile`: Expo React Native phone app.
- `devbox.json`: local development tasks and dependency management.

## Local CLI Build

Install the CLI into `~/.local/bin/agent-tick`:

```sh
devbox run build:local
```

Verify:

```sh
agent-tick request --help
```

Build release archives for Linux and macOS:

```sh
AGENT_TICK_VERSION=0.1.0 devbox run build:server
```

## Server Modes

### Single Mode

Single mode is the default self-hosted setup. It uses one implicit user and an admin bearer token.

```sh
AGENT_TICK_TOKEN=change-me \
AGENT_TICK_PUBLIC_URL=http://192.168.0.111:8787 \
devbox run server
```

Open:

```text
http://192.168.0.111:8787/
```

Enter the bearer token in the dashboard.

### User Mode

User mode is for one server serving many independent users. Dashboard users sign in with email/password, pair their own phones, and create their own agent tokens.

```sh
AGENT_TICK_MODE=user \
AGENT_TICK_PUBLIC_URL=http://192.168.0.111:8787 \
devbox run server
```

Open:

```text
http://192.168.0.111:8787/
```

The first sign-in for an email creates that user. The dashboard stores an HttpOnly session cookie.

`AGENT_TICK_PUBLIC_URL` is important for phone pairing. It is embedded in dashboard QR codes so the phone talks to the LAN or public URL instead of `localhost`.

## Dashboard

The dashboard supports:

- User sign-in in `AGENT_TICK_MODE=user`.
- Single-user bearer-token auth in default mode.
- Collapsed `Devices` panel with existing paired devices and QR pairing.
- Collapsed `Agents` panel with per-user agent token creation.
- Approval list with approve/deny for pending requests.

Pair a phone:

1. Sign in or connect with the bearer token.
2. Open `Devices`.
3. Click `Create QR`.
4. In the phone app, open Settings, then `Scan Pairing QR`.

Create an agent token:

1. Open `Agents`.
2. Click `Create Agent Token`.
3. Run the shown `agent-tick setup ...` command once on the machine where the agent runs.

The token is shown once. Agent tokens created by the dashboard default to `approval:write`, which lets the CLI create approval requests and poll its own request by ID. It does not let the agent approve, pair devices, create tokens, or list all approvals.

## CLI Usage

Configure the installed CLI once:

```sh
agent-tick setup --server http://192.168.0.111:8787 --token agent_...
```

This writes:

```text
<user config dir>/agent-tick/config.json
```

The CLI reads config in this order:

1. `AGENT_TICK_SERVER` and `AGENT_TICK_TOKEN` environment overrides.
2. The `agent-tick setup` config file.
3. Fallback server `http://localhost:8787`.

Submit a blocking request:

```sh
agent-tick request \
  --title "Run command?" \
  --body "codex wants to run npm install" \
  --command "npm install"
```

Guard a command so it only runs after approval:

```sh
agent-tick guard -- npm install
```

Use the stdio JSON adapter from an agent:

```sh
printf '{"title":"Run command?","command":"npm install"}' | agent-tick adapter
```

Create a pairing QR from the CLI:

```sh
agent-tick pair
```

For server-local admin token management, the binary also has:

```sh
agent-tick agent-token --name codex
agent-tick agent-token list
agent-tick agent-token revoke agent_...
agent-tick agent-token rotate agent_...
```

The dashboard is preferred for user-mode agent tokens because it scopes tokens to the signed-in user.

## Mobile

Run the Expo app:

```sh
devbox run mobile
```

For a physical phone on the same network:

```sh
devbox run mobile:lan
```

On a physical phone, `localhost` means the phone itself. Use the computer LAN address for the backend, for example:

```text
http://192.168.0.111:8787
```

The phone app:

- Stores server URL, device id, and device token.
- Shows pending approvals.
- Shows a waiting state when there is nothing to approve.
- Supports approve/deny, option choices, and short replies.
- Shows approval history.
- Can trigger local notifications while polling.

For remote push notification testing, use an EAS development build rather than Expo Go:

```sh
cd apps/mobile
npx eas init
npx eas build --profile development --platform ios
```

After `eas init`, replace the placeholder `extra.eas.projectId` in `apps/mobile/app.json` with the generated project id.

## Container Deployment

The server image runs the same Go binary as the local dev server and stores SQLite data in `/data/agent-tick.db`.

For a normal multi-user deployment:

```sh
AGENT_TICK_MODE=user \
AGENT_TICK_PUBLIC_URL=https://tick.example.com \
docker compose up -d --build
```

Open:

```sh
https://tick.example.com/
```

Then sign in, open `Devices` to pair the phone, and open `Agents` to create a request-only agent token.

For a single-user deployment with a dashboard bearer token:

```sh
AGENT_TICK_MODE=single \
AGENT_TICK_TOKEN=change-me \
AGENT_TICK_PUBLIC_URL=https://tick.example.com \
docker compose up -d --build
```

Use the same commands with `podman compose` if your server uses Podman.

Production deployments should put the container behind an HTTPS reverse proxy and set `AGENT_TICK_PUBLIC_URL` to the external HTTPS URL. Phone pairing QR codes and dashboard CLI setup commands use that value.

## Security Model

- Single mode maps all records to the implicit `usr_default` user.
- User mode scopes approvals, devices, pairing tokens, agent tokens, and audit events by user.
- Dashboard sessions are HttpOnly cookies.
- Device pairing uses short-lived one-time pairing secrets.
- Device tokens are separate from agent tokens.
- Dashboard-created agent tokens default to request-only `approval:write`.
- Production deployments should run behind HTTPS.

Optional signed approval creation:

```sh
AGENT_TICK_REQUIRE_SIGNATURE=1 \
AGENT_TICK_TOKEN=change-me \
agent-tick server
```

Signed create requests must include:

- `X-Agent-Tick-Timestamp`
- `X-Agent-Tick-Public-Key`
- `X-Agent-Tick-Signature`

The signature is over:

```text
<timestamp>.<raw-json-body>
```
