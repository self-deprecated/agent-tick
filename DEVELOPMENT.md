# Development

This project uses Devbox for local dependencies.

Run the full local check loop:

```sh
devbox run check
```

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

The token is shown once. Agent tokens created by the dashboard default to `approval:write`, which lets the CLI create approval requests, poll its own request by ID, and abandon pending requests it no longer needs. It does not let the agent approve, pair devices, create tokens, or list all approvals.

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

For agent integrations, stream machine-readable request lifecycle events and wait indefinitely with no request expiry:

```sh
agent-tick request --json-events --timeout 0 --expires-in 0 --title "Run command?"
agent-tick abandon <request-id> --json
```

The first JSON event includes `requestId` immediately; a later terminal event includes the final status/response. `abandon` cancels a pending request from the creator side without approving or denying it.

Guard a command so it only runs after approval:

```sh
agent-tick guard -- npm install
```

Use the stdio JSON adapter from an agent:

```sh
printf '{"title":"Run command?","command":"npm install"}' | agent-tick adapter
```

Bridge Claude Code `AskUserQuestion` through Agent Tick:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "AskUserQuestion",
        "hooks": [
          {
            "type": "command",
            "command": "\"$CLAUDE_PROJECT_DIR\"/scripts/claude-code-ask-user-question-hook.sh"
          }
        ]
      }
    ]
  }
}
```

The hook script converts Claude Code question payloads into an Agent Tick `questionnaire` request, waits for the answer on your phone, then returns `updatedInput.answers` back to Claude Code. It needs `jq` and a configured `agent-tick` CLI.

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

## Agent Skill

The repo ships a Codex-compatible skill in `skills/agent-tick`.

Validate it after edits:

```sh
devbox run skill:validate
```

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

For remote push notification testing and any native-module work, use an EAS development build rather than Expo Go. Build and install it once:

```sh
devbox run mobile:dev-build:ios
# or
devbox run mobile:dev-build:android
```

Then iterate against that installed app without rebuilding native code:

```sh
# Physical phone on the same network:
devbox run mobile:dev-client:lan

# Simulator/emulator or USB/local tunneling setup:
devbox run mobile:dev-client
```

Open the installed development build on the phone and select the local development server from the dev-client launcher. JavaScript and asset changes reload through Metro; a new EAS build is only needed after changing native dependencies, native config, or the Expo SDK/runtime version.

To publish a persistent JavaScript/assets update that the development build can load without your laptop running Metro:

```sh
devbox run mobile:update:development -- --message "Describe the change"
```

The development EAS build profile uses the `development` update channel. The app is configured for EAS Update with project id `66c26d86-bff7-4681-a7b8-bc865a5212af`.

## Publishing CLI Binaries

The CLI release workflow builds archives with:

```sh
sh scripts/build-server-release.sh
```

Pull requests upload the archives as workflow artifacts. Tags matching `v*` create or update a GitHub Release and attach:

```text
agent-tick_<version>_linux_amd64.tar.gz
agent-tick_<version>_linux_arm64.tar.gz
agent-tick_<version>_darwin_amd64.tar.gz
agent-tick_<version>_darwin_arm64.tar.gz
checksums.txt
```

Create a release by pushing a version tag:

```sh
git tag v0.1.0
git push origin v0.1.0
```
