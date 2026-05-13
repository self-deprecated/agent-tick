# Agent Tick

Agent Tick is a human loop for AI agents: **status** updates, **steering** questions, and **sanctions** for actions that need approval.

Website: <https://agenttick.sh>

## Start here

Most users should use the hosted service at <https://agenttick.sh>.

For the smoothest Claude Code setup, paste this prompt into your coding agent chat on the machine you want to configure:

```text
Fetch and follow the Agent Tick setup skill from:
https://raw.githubusercontent.com/self-deprecated/agent-tick/main/skills/agent-tick/SKILL.md

Use that skill to set up Agent Tick for Claude Code. Ask me how I plan to use it, enable status, steering, and sanctions by default unless I explicitly opt out, inspect my current Claude Code settings for conflicts, run a dry run first, explain exactly what will change, then install it after I confirm and verify the result. If Agent Tick is not installed yet, use the skill's first-time setup instructions. Do not frame questions around a specific UI surface; say Agent Tick or remote approval instead.
```

The linked skill-led flow works even when the target machine does not have this repo cloned. It guides you through interactive vs headless usage, AFK vs pass-through routing, permissions, dry-run, install, verification, and restart instructions while keeping status, steering, and sanctions enabled by default.

If you prefer direct CLI setup, run the installer on the machine where your coding agents run:

```sh
npx @self-deprecated/agent-tick install
```

To only sign in without installing hooks yet:

```sh
npx @self-deprecated/agent-tick login
```

The installer opens Agent Tick in your browser, connects this machine to your hosted Agent Tick account, detects local AI coding agents, and installs verified hook integrations where available. Claude Code and Pi currently get real hooks; other detected agents are shown as disabled scaffolds until their hook/config path is verified.

If you prefer a global install:

```sh
npm install -g @self-deprecated/agent-tick
agent-tick install
```

After setup, agents can ask for a sanction before sensitive work:

```sh
agent-tick sanction \
  --title "Deploy production?" \
  --body "Deploy commit abc123 to production." \
  --command "deploy production"
```

Or run a command only after sanction approval:

```sh
agent-tick sanction --title "Run migration?" -- ./migrate.sh
```

Agents can ask steering questions with structured choices:

```sh
agent-tick steering \
  --title "Which rollout?" \
  --choice canary="Canary" \
  --choice blue_green="Blue/green" \
  --choice cancel:deny="Cancel"
```

Agents can send lightweight status updates that appear in Agent Tick:

```sh
agent-tick status --state working --next "Run the build" "Tests are passing; checking packaging next"
```

## What gets installed?

`agent-tick install` does two things:

1. Runs browser-based CLI setup against `https://agenttick.sh` and saves an Agent Tick `agent_...` token locally in `~/.config/agent-tick/config.json`.
2. Detects local agent configs and installs verified hook integrations:
   - Claude Code: adds mode-aware hooks globally in `~/.claude/settings.json` or locally in `.claude/settings.local.json` for `AskUserQuestion` steering and Claude Code `PermissionRequest` sanctions; starts in pass-through mode and adds `Bash(agent-tick:*)` so the Agent Tick CLI itself is never permission-gated.
   - Pi: installs the repo-maintained extension from `packages/cli/assets/pi/agent-tick-approval.ts` into `~/.pi/agent/extensions/agent-tick-approval.ts`; it gates risky bash commands through Agent Tick and always allows Agent Tick commands.
   - Codex, Gemini, Cursor, OpenCode, generic `AGENTS.md`: detected and shown as disabled scaffolds until their hook/config behavior is verified.

Useful installer options:

```sh
agent-tick install --target claude --target codex
agent-tick install --all
agent-tick install --dry-run
agent-tick install --server https://tick.example.com
agent-tick install --target claude --claude-scope local
agent-tick install --target claude --claude-scope global
agent-tick install --target claude --claude-sandbox allow
agent-tick install --target claude --claude-profile headless --claude-steering always --claude-sanctions always
```

## Self-hosting

Agent Tick is source-available and self-hostable. That matters for trust, privacy, and teams that need to operate approvals on their own infrastructure.

Self-hosting is not the default onboarding path. If you want it, use [SELFHOSTING.md](./SELFHOSTING.md).

## What is in this repo

- Fastify API server
- Svelte dashboard served by the server
- Expo mobile app
- `agent-tick` CLI with `install`, `setup`, `mode`, `sanction`, `steering`, `abandon`, and `status`
- SQLite persistence
- optional Clerk human authentication for multi-user mode
- local Agent Tick organizations, policies, approvals, audit logs, devices, and agent tokens

Clerk, when enabled, is only the human identity provider. Agent Tick owns authorization and product data.

## Development

Development details are in [DEVELOPMENT.md](./DEVELOPMENT.md). A local contributor can bootstrap the repo with:

```sh
corepack pnpm install
corepack pnpm build
```

## Documentation

- [docs/using-agent-tick.md](./docs/using-agent-tick.md) — hosted-product usage flow
- [docs/integrations.md](./docs/integrations.md) — CLI and integration examples
- [docs/agent-install-research.md](./docs/agent-install-research.md) — verified hook install matrix and Preloop research
- [SELFHOSTING.md](./SELFHOSTING.md) — run your own Agent Tick server
- [DEVELOPMENT.md](./DEVELOPMENT.md) — local development workflow
- [docs/competitor-analysis.md](./docs/competitor-analysis.md) — market scan and setup inspiration

## License

Agent Tick is licensed under the [Business Source License 1.1](./LICENSE) (BSL 1.1). You may use, modify, and self-host it — including for commercial purposes — but you may not offer Agent Tick as a hosted or managed service to third parties. The license converts to Apache 2.0 on 2028-04-18.
