# Using Agent Tick

Agent Tick's default path is the hosted product at <https://app.agenttick.sh>. Self-hosting is available for teams that need it, but it is documented separately in [SELFHOSTING.md](../SELFHOSTING.md). Public documentation lives at <https://docs.agenttick.sh>.

## Hosted product quickstart

For the smoothest Claude Code setup, paste this prompt into your coding agent chat on the machine you want to configure:

```text
Fetch and follow the Agent Tick setup skill from:
https://agenttick.sh/skill

Use that skill to set up Agent Tick for Claude Code. Ask me how I plan to use it, enable status updates, steering, and sanctions by default unless I explicitly opt out, inspect my current Claude Code settings for conflicts, run a dry run first, explain exactly what will change, then install it after I confirm and verify the result. If Agent Tick is not installed yet, use the skill's first-time setup instructions. Do not frame questions around a specific UI surface; say Agent Tick or remote approval instead.
```

The linked prompt-based skill flow works even when the target machine does not have this repo cloned. It is recommended because it can inspect your local setup, recommend local or global scope, run a dry run, explain conflicts and planned changes, ask for confirmation, install, and verify while keeping status updates, steering, and sanctions enabled by default unless you opt out.

For direct CLI setup, run the installer on the machine where your AI coding agents run:

```sh
npx @self-deprecated/agent-tick install
```

The installer:

1. Opens <https://app.agenttick.sh> in your browser.
2. Lets you sign in and authorize CLI setup.
3. Saves an Agent Tick `agent_...` token in `~/.config/agent-tick/config.json`.
4. Detects local agent configs and installs supported integrations. Claude Code is supported as Verified Hook + MCP, Codex via MCP Adapter, and Pi as a Native Extension. Gemini, Cursor, OpenCode, and generic `AGENTS.md` targets are visible as disabled scaffolds until verified.

Global install alternative:

```sh
npm install -g @self-deprecated/agent-tick
agent-tick install
```

## Status Updates, Steering, and Sanctions

Ask for a sanction and wait for approval before sensitive work:

```sh
agent-tick sanction \
  --title "Deploy production?" \
  --body "Deploy commit abc123" \
  --command "deploy production"
```

Run a command only after sanction approval:

```sh
agent-tick sanction --title "Run migration?" -- ./migrate.sh
```

Ask a steering question with structured choices:

```sh
agent-tick steering \
  --title "Which rollout?" \
  --choice canary="Canary" \
  --choice blue_green="Blue/green" \
  --choice cancel:deny="Cancel" \
  --choice-flag canary=favorite
```

Use `--choice-flag choiceId=favorite` to mark the agent's recommended steering choice; the mobile app shows a yellow star. Other supported flags include `safest`, `fastest`, `reversible`, `experimental`, `destructive`, `production`, and `security_sensitive`. Use `--choice-tag choiceId=tag` for a short custom label.

Cancel a pending request:

```sh
agent-tick abandon req_...
```

Send a lightweight progress update without asking for approval:

```sh
agent-tick status-update --state working --next "Run typecheck" "Finished edits; validating now"
```

Use `--thread` or `AGENT_TICK_THREAD_ID` when an integration can provide a chat/thread id. Otherwise the CLI defaults to the current machine and working directory so the mobile app can show the latest update for that local repo context.

## Installer options

```sh
agent-tick install --target claude --target codex
agent-tick install --all
agent-tick install --dry-run
agent-tick install --server https://app.agenttick.sh
agent-tick install --target claude --claude-scope local
agent-tick install --target claude --claude-scope global
agent-tick install --target claude --claude-sandbox allow
agent-tick install --target claude --claude-profile headless --claude-steering always --claude-sanctions always
agent-tick install --no-login --target agents-md
```

Supported install targets:

- `claude` — supported as Verified Hook + MCP. Hooks can route `AskUserQuestion` steering and Claude Code `PermissionRequest` sanctions, plus `Bash(agent-tick:*)` so Agent Tick can run without recursive permission prompts. Hooks start in pass-through mode; use `agent-tick mode afk` to route prompts through Agent Tick and `agent-tick mode pass-through` to restore Claude Code's native prompts. See [Claude Code Verified Hook verification and demo](./claude-code-verified-hook-demo.md) for the launch-safe demo script and disclosure boundaries.
- `codex` — supported via MCP Adapter through `agent-tick mcp`.
- `pi` — supported as a Native Extension. Installs the repo-maintained `packages/cli/assets/pi/agent-tick-approval.ts` into `~/.pi/agent/extensions/agent-tick-approval.ts`, a Pi `tool_call` extension for risky bash commands.
- `gemini` — scaffold only until its hook/config path is verified.
- `cursor` — scaffold only until its hook/config path is verified.
- `opencode` — scaffold only until its hook/config path is verified.
- `agents-md` — scaffold only; plain instruction files are not treated as a real enforcement integration.

## Manual setup

If browser login is not possible, create an agent token in the dashboard and configure the CLI manually:

```sh
agent-tick setup --server https://api.agenttick.sh --token agent_...
```

For CI, pass `AGENT_TICK_SERVER` and `AGENT_TICK_TOKEN` as secrets instead of committing tokens.

## Self-hosted flow

Use self-hosting when you want Agent Tick on your own infrastructure. The short version is:

1. Deploy the server with Docker Compose or the NixOS module.
2. Set `AGENT_TICK_PUBLIC_URL` to your deployment URL.
3. Run `agent-tick install --server <your-url>` for Clerk-backed deployments, or `agent-tick setup --server <your-url> --token agent_...` for single-mode/manual token setup.

See [SELFHOSTING.md](../SELFHOSTING.md) for environment variables, Docker commands, backup notes, and security guidance.

## What Agent Tick owns

Even when Clerk is enabled, Agent Tick owns product authorization and data:

- local organizations and memberships
- teams and approval policies
- approval requests and responses
- agent tokens
- device registrations and notification routing
- audit logs
- local billing/seat-limit state

Clerk is only the human identity provider.

## Current integration surface

Implemented today:

- `agent-tick install`
- `agent-tick setup`
- `agent-tick mode`
- `agent-tick mcp`
- `agent-tick sanction`
- `agent-tick steering`
- `agent-tick abandon`
- `agent-tick status-update`
- dashboard approvals
- GitHub Actions composite action
- optional outbound approval notification webhook

## Codex MCP notes

See [Codex MCP Adapter verification and demo](./codex-mcp-adapter-demo.md) for the launch-safe demo script, failure modes, and disclosure boundaries.

Codex should launch Agent Tick through the local stdio MCP adapter. Configure Codex manually until `agent-tick install --target codex` config writing is implemented and tested:

```toml
[mcp_servers.agent_tick]
command = "agent-tick"
args = ["mcp"]
startup_timeout_sec = 10
tool_timeout_sec = 1800
default_tools_approval_mode = "approve"

[mcp_servers.agent_tick.tools.agent_tick_status_update]
approval_mode = "approve"

[mcp_servers.agent_tick.tools.agent_tick_steering]
approval_mode = "approve"

[mcp_servers.agent_tick.tools.agent_tick_sanction]
approval_mode = "approve"
```

For local Codex elicitation prompts, Codex must allow MCP elicitations. With granular policy, set `mcp_elicitations = true`. `localElicitation: "auto"` is the default and recommended mode: it shows both the local Codex dialog and a remote Agent Tick mobile/web request, with the first answer winning. Use `localElicitation: "off"` only when testing phone/mobile routing by itself.

Not currently implemented:

- JSON stdin adapter command
- Slack/Teams/SMTP-specific notification providers

Those surfaces should be documented only when implementation and tests are added.
