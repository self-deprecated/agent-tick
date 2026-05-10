# Using Agent Tick

Agent Tick's default path is the hosted product at <https://agenttick.sh>. Self-hosting is available for teams that need it, but it is documented separately in [SELFHOSTING.md](../SELFHOSTING.md).

## Hosted product quickstart

Run the installer on the machine where your AI coding agents run:

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

## Ask for approval

Create an approval request and wait for a response:

```sh
agent-tick request \
  --title "Deploy production?" \
  --body "Deploy commit abc123" \
  --command "deploy production"
```

Run a command only after approval:

```sh
agent-tick guard --title "Run migration?" -- ./migrate.sh
```

Ask a multiple-choice question:

```sh
agent-tick request \
  --title "Which rollout?" \
  --choice canary="Canary" \
  --choice blue_green="Blue/green" \
  --choice cancel:deny="Cancel"
```

Cancel a pending request:

```sh
agent-tick abandon req_...
```

Review requests in the Agent Tick web dashboard. Public onboarding should not depend on private mobile beta access.

## Installer options

```sh
agent-tick install --target claude --target codex
agent-tick install --all
agent-tick install --dry-run
agent-tick install --server https://tick.example.com
agent-tick install --no-login --target agents-md
```

Supported install targets:

- `claude` — enabled. Adds `PreToolUse` hooks in `~/.claude/settings.json` for risky `Bash` commands and `AskUserQuestion`, plus allow rules for Agent Tick CLI commands.
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
- `agent-tick request`
- `agent-tick guard`
- `agent-tick abandon`
- dashboard approvals
- GitHub Actions composite action
- optional outbound approval notification webhook

Not currently implemented:

- MCP server command
- JSON stdin adapter command
- steering command
- Slack/Teams/SMTP-specific notification providers

Those surfaces should be documented only when implementation and tests are added.
