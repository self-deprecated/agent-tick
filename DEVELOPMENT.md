# Development

This project uses Devbox for local dependencies.

## Project Shape

- `apps/server`: Go server and CLI in one binary.
- `apps/mobile`: Expo React Native phone app.
- `devbox.json`: local development tasks and dependency management.
- `.github/workflows/server-image.yml`: GitHub Actions workflow for the server container image.

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

## Local Server Modes

Single mode is the default self-hosted setup. It uses one implicit user and an admin bearer token.

```sh
AGENT_TICK_TOKEN=change-me \
AGENT_TICK_PUBLIC_URL=http://192.168.0.111:8787 \
devbox run server
```

User mode is for one server serving many independent users. Dashboard users sign in with email/password, pair their own phones, and create their own agent tokens.

```sh
AGENT_TICK_MODE=user \
AGENT_TICK_PUBLIC_URL=http://192.168.0.111:8787 \
devbox run server
```

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

## Container Development

The published image is built by GitHub Actions from `apps/server/Dockerfile`.

Build the server image locally:

```sh
docker build -t agent-tick:dev apps/server
```

Run the local image with the root compose file:

```sh
AGENT_TICK_IMAGE=agent-tick:dev \
AGENT_TICK_MODE=user \
AGENT_TICK_PUBLIC_URL=http://localhost:8787 \
AGENT_TICK_PORT=8787 \
docker compose up -d
```

For single-user mode:

```sh
AGENT_TICK_IMAGE=agent-tick:dev \
AGENT_TICK_MODE=single \
AGENT_TICK_TOKEN=change-me \
AGENT_TICK_PUBLIC_URL=http://localhost:8787 \
AGENT_TICK_PORT=8787 \
docker compose up -d
```

Use the same commands with `podman` or `podman compose` if your development machine uses Podman.

## Publishing The Server Image

The workflow publishes to GitHub Container Registry:

```text
ghcr.io/<owner>/<repo>:latest
ghcr.io/<owner>/<repo>:main
ghcr.io/<owner>/<repo>:sha-<commit>
ghcr.io/<owner>/<repo>:v0.1.0
```

Images are pushed on `main` and on tags matching `v*`. Pull requests build the image but do not publish it.

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
