# Development

This project uses Devbox for local dependencies.

Run the full local check loop:

```sh
devbox run check
```

## Project Shape

- `apps/server`: Go server and CLI in one binary.
- `apps/admin`: Svelte 5 + TypeScript dashboard built with Vite and embedded into the Go server.
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

The dashboard is a Svelte 5 + TypeScript app in `apps/admin`. Build and validate it with:

```sh
devbox run admin:check
```

For dashboard-only iteration against a local server, run:

```sh
devbox run admin:dev
```

Production dashboard assets are written to `apps/server/internal/approval/admin_static` and embedded in the Go binary. Run `npm run build` in `apps/admin` (or any build/check task above) after dashboard source changes so the embedded assets stay current.

The dashboard supports:

- User sign-in and session resume in `AGENT_TICK_MODE=user`.
- Single-user bearer-token auth in default mode.
- Responsive Approvals, Devices, Agents, Teams, and Projects sections with loading, empty, and error states.
- Organization-aware first-run defaults: single-user installs get a default organization and default project automatically, while user-mode sign-in creates a personal organization.
- Basic organization creation plus team and project listing/creation from the dashboard.
- Phone pairing with short-lived QR codes and device revocation.
- Approval policy builder with human-readable templates, previews, project defaults, and agent default-policy selection.
- Agent registration wizard with project/team/owner/default-policy metadata, config-file setup commands, environment-variable setup commands, token listing, and revocation.
- Approval list with approve/deny or constrained choice responses for pending requests.

Pair a phone:

1. Sign in or connect with the bearer token.
2. Open `Devices`.
3. Click `Create QR`.
4. In the phone app, open Settings, then `Scan Pairing QR`.

Register an agent:

1. Open `Agents`.
2. Enter the agent name, choose an existing project or create one inline, choose the owner user, optionally choose team access, and choose a default approval behavior.
3. Click `Create Agent Token`.
4. Run either the shown `agent-tick setup ...` command or export the shown environment variables on the machine where the agent runs.

The token is shown once. Agent tokens created by the dashboard default to `approval:write`, which lets the CLI create approval requests, poll its own request by ID, and abandon pending requests it no longer needs. It does not let the agent approve, pair devices, create tokens, or list all approvals. Project, team, and policy hints are validated server-side against the token metadata.

## Teams and Projects

Agent Tick stores organizations, memberships, teams, team members, projects, and invite-ready records in SQLite. Existing single-user records are backfilled into `org_default` and `prj_default`, so self-hosted users can continue pairing phones and creating agent tokens without thinking about organizations.

Organization roles are `owner`, `admin`, `approver`, and `viewer`. Owners can manage team membership; owners and admins can create or update teams and projects; viewers can list team and project context. Current approval, device, and agent-token endpoints remain user-scoped for compatibility while storing organization/project columns for hosted/team features.

Approval policies are stored as organization-scoped templates plus ordered policy steps. Supported templates are owner-only, any-team-member, on-call, recently-active, quorum, sequence, and risk-based. The dashboard exposes friendly labels like "Just me", "Anyone on a team", "On-call person", "Most recently active", "Require multiple approvals", and "Multi-step flow" instead of raw workflow JSON.

Policy-backed approval requests now collect auditable votes before writing the final response. Owner-only, any-team-member, quorum, and sequence policies are enforced by the backend; a request can stay `pending` after one approver votes until the current step's quorum is satisfied. Deny-veto steps finalize the request as denied immediately. Approval API responses include `policyProgress` with the current step, required and received approvals, waiting count, eligible approvers, whether the current user is eligible or already voted, the current user's vote, and vote history. The CLI still waits for the final `responded` decision, so existing automation does not unblock on partial approvals.

The mobile app uses that progress data to show project, agent, owner, team, and policy context on the request detail screen. Eligible approvers keep the fast approve/deny buttons; people who already voted or are not eligible see read-only progress copy such as “You approved. Waiting for 1 more approval.” Completed history rows include the final vote trail for auditability. Policy progress intentionally exposes eligible approver IDs and vote user IDs to users who can view that request; do not treat those IDs as anonymous when designing hosted/team visibility.

Presence and coverage features are intentionally coarse. Mobile clients send periodic authenticated heartbeats that update `lastSeenAt`; users can set availability to available, busy, do-not-disturb, or off-call. The dashboard team detail view shows current coverage, member availability, and primary/secondary on-call routing. On-call and recently-active policy templates use this data to choose the current approver, and timeout settings can escalate to a fallback user.

Organizations carry hosted-service plan metadata in SQLite: plan name, seat/team/agent/request limits, audit retention days, and approval retention days. New and migrated self-hosted organizations default to the `self-hosted` plan with unlimited seat/team/agent/request counts (`-1`) and 365-day audit/approval retention values. Non-negative limits are enforced when creating teams, adding a new organization member through team membership, creating active agent tokens, and creating approval requests in the rolling 30-day window; API callers receive HTTP 402 with a clear plan-limit error. `GET /v1/billing` returns the current organization's plan, limits, 30-day usage counters, retained audit-event count, and placeholder upgrade/contact links without coupling the core server to a specific billing provider. Admins can inspect tenant-scoped audit events with `GET /v1/audit-events` or download CSV from `GET /v1/audit-events/export`; both endpoints are scoped to the authenticated organization. Hosted hardening keeps browser CORS scoped to the configured or same public origin (plus loopback development origins), caps write request bodies at 1 MiB, and applies an in-process per-client-IP rate limit with stricter budgets for login/pairing/token creation.

Agent tokens can now carry an owner user, project, optional team, and optional default approval policy. When an agent-token-authenticated request supplies project/team/policy hints, the server validates them against the token and fills missing hints from the token defaults before storing request metadata. Request creation resolves the effective policy from the request hint, agent default, project default, or organization default and stores it in request metadata for the policy engine.

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
devbox run mobile:update:development
```

To pass an explicit update message, run EAS directly from the mobile app directory:

```sh
cd apps/mobile
npx eas-cli update --channel development --message "Describe the change"
```

The development EAS build profile uses the `development` update channel. The app is configured for EAS Update with project id `66c26d86-bff7-4681-a7b8-bc865a5212af`.

Validate the mobile EAS config after changing `app.json`, `eas.json`, or mobile Expo dependencies:

```sh
devbox run mobile:validate-config
```

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
