# Using Agent Tick

Agent Tick's default path is the hosted product at <https://agenttick.sh>. Self-hosting is available for teams that need it, but it is documented separately in [SELFHOSTING.md](../SELFHOSTING.md).

## Hosted product quickstart

For the smoothest Claude Code setup, paste this prompt into your coding agent chat on the machine you want to configure:

```text
Fetch and follow the Agent Tick setup skill from:
https://raw.githubusercontent.com/self-deprecated/agent-tick/main/skills/agent-tick/SKILL.md

Use that skill to set up Agent Tick for Claude Code. Ask me how I plan to use it, enable status, steering, and sanctions by default unless I explicitly opt out, inspect my current Claude Code settings for conflicts, run a dry run first, explain exactly what will change, then install it after I confirm and verify the result. If Agent Tick is not installed yet, use the skill's first-time setup instructions. Do not frame questions around a specific UI surface; say Agent Tick or remote approval instead.
```

The linked skill-led flow works even when the target machine does not have this repo cloned. It is recommended because it can inspect your local setup, explain conflicts, and choose the right AFK/pass-through behavior before writing hook settings while keeping status, steering, and sanctions enabled by default.

For direct CLI setup, run the installer on the machine where your AI coding agents run:

```sh
npx @self-deprecated/agent-tick install
```

The installer:

1. Opens <https://agenttick.sh> in your browser.
2. Lets you sign in and authorize CLI setup.
3. Saves an Agent Tick `agent_...` token in `~/.config/agent-tick/config.json`.
4. Detects local agent configs and installs verified hook integrations. Claude Code and Pi hooks are enabled today; Codex, Gemini, Cursor, OpenCode, and generic `AGENTS.md` targets are visible as disabled scaffolds until verified.

Global install alternative:

```sh
npm install -g @self-deprecated/agent-tick
agent-tick install
```

## Status, steering, and sanctions

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
  --choice cancel:deny="Cancel"
```

Cancel a pending request:

```sh
agent-tick abandon req_...
```

Send a lightweight progress update without asking for approval:

```sh
agent-tick status --state working --next "Run typecheck" "Finished edits; validating now"
```

Use `--thread` or `AGENT_TICK_THREAD_ID` when an integration can provide a chat/thread id. Otherwise the CLI defaults to the current machine and working directory so the mobile app can show the latest update for that local repo context.

## Installer options

```sh
agent-tick install --target claude --target codex
agent-tick install --all
agent-tick install --dry-run
agent-tick install --server https://tick.example.com
agent-tick install --target claude --claude-scope local
agent-tick install --target claude --claude-scope global
agent-tick install --target claude --claude-sandbox allow
agent-tick install --target claude --claude-profile headless --claude-steering always --claude-sanctions always
agent-tick install --no-login --target agents-md
```

Supported install targets:

- `claude` — enabled. Adds mode-aware hooks globally in `~/.claude/settings.json` or locally in `.claude/settings.local.json` for `AskUserQuestion` steering and Claude Code `PermissionRequest` sanctions, plus `Bash(agent-tick:*)` so Agent Tick can run without recursive permission prompts. Hooks start in pass-through mode; use `agent-tick mode afk` to route prompts through Agent Tick and `agent-tick mode pass-through` to restore Claude Code's native prompts.
- `pi` — enabled. Installs the repo-maintained `packages/cli/assets/pi/agent-tick-approval.ts` into `~/.pi/agent/extensions/agent-tick-approval.ts`, a Pi `tool_call` extension for risky bash commands.
- `codex` — scaffold only until its hook/config path is verified.
- `gemini` — scaffold only until its hook/config path is verified.
- `cursor` — scaffold only until its hook/config path is verified.
- `opencode` — scaffold only until its hook/config path is verified.
- `agents-md` — scaffold only; plain instruction files are not treated as a real enforcement integration.

## Manual setup

If browser login is not possible, create an agent token in the dashboard and configure the CLI manually:

```sh
agent-tick setup --server https://agenttick.sh --token agent_...
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
- `agent-tick sanction`
- `agent-tick steering`
- `agent-tick abandon`
- `agent-tick status`
- dashboard approvals
- GitHub Actions composite action
- optional outbound approval notification webhook

Not currently implemented:

- MCP server command
- JSON stdin adapter command
- Slack/Teams/SMTP-specific notification providers

Those surfaces should be documented only when implementation and tests are added.
