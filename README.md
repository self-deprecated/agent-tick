# Agent Tick

**Least-permission approvals for coding agents.**

Agent Tick routes **Status Updates, Steering, and Sanctions** from local coding agents to trusted humans without turning the phone, hosted service, or dashboard into a remote shell.

Product surfaces:

- Marketing site: <https://agenttick.sh>
- Hosted app: <https://app.agenttick.sh>
- Hosted API: <https://api.agenttick.sh>
- Documentation: <https://docs.agenttick.sh>

## Start here

Most users should use the hosted service at <https://app.agenttick.sh>.

For the smoothest Claude Code setup, paste this prompt into your coding agent chat on the machine you want to configure:

```text
Fetch and follow the Agent Tick setup skill from:
https://agenttick.sh/skill

Use that skill to set up Agent Tick for Claude Code. Ask me how I plan to use it, enable status updates, steering, and sanctions by default unless I explicitly opt out, inspect my current Claude Code settings for conflicts, run a dry run first, explain exactly what will change, then install it after I confirm and verify the result. If Agent Tick is not installed yet, use the skill's first-time setup instructions. Do not frame questions around a specific UI surface; say Agent Tick or remote approval instead.
```

The linked prompt-based skill flow works even when the target machine does not have this repo cloned. It inspects your agent configuration, recommends local or global scope, runs a dry run, explains exactly what will change, asks for confirmation, installs, and verifies while keeping status updates, steering, and sanctions enabled by default unless you opt out.

If you prefer direct CLI setup, run the installer on the machine where your coding agents run:

```sh
npx @self-deprecated/agent-tick install
```

To only sign in and save a local token without installing hooks yet:

```sh
npx @self-deprecated/agent-tick login
```

The installer opens Agent Tick in your browser, connects this machine to your hosted Agent Tick account, detects local AI coding agents, and installs supported integrations where available: Claude Code as Verified Hook + MCP, Codex via MCP Adapter, and Pi as a Native Extension. Other detected agents are shown as disabled scaffolds until their hook/config path is verified.

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
  --choice cancel:deny="Cancel" \
  --choice-flag canary=favorite
```

Choice flags add mobile-visible cues. For example, `favorite` shows a yellow star; sanction approve choices can also be marked with warnings such as `production`, `destructive`, or `security_sensitive`.

Agents can send lightweight Status Updates that appear in Agent Tick:

```sh
agent-tick status-update --state working --next "Run the build" "Tests are passing; checking packaging next"
```

## What gets installed?

`agent-tick install` does two things:

1. Runs browser-based CLI setup against hosted Agent Tick by default, or the server passed with `--server`, and saves an Agent Tick `agent_...` token locally in `~/.config/agent-tick/config.json`.
2. Detects local agent configs and installs supported integrations:
   - Claude Code: Verified Hook + MCP support. Hooks can route `AskUserQuestion` steering and Claude Code `PermissionRequest` sanctions; MCP is available through `agent-tick mcp`.
   - Codex: MCP Adapter support through `agent-tick mcp`.
   - Pi: Native Extension support via the repo-maintained extension from `packages/cli/assets/pi/agent-tick-approval.ts`.
   - Gemini, Cursor, OpenCode, generic `AGENTS.md`: detected and shown as disabled scaffolds until their hook/config behavior is verified.

Useful installer options. Omit `--server` for hosted Agent Tick; pass it only for self-hosted or custom deployments.

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
- `agent-tick` CLI with `install`, `setup`, `mode`, `mcp`, `sanction`, `steering`, `abandon`, and `status-update`
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

- [docs/index.md](./docs/index.md) — public documentation source for docs.agenttick.sh
- [docs/quick-start.md](./docs/quick-start.md) — connect a machine and send safe test requests
- [docs/integrations.md](./docs/integrations.md) — public integration setup guides
- [docs/self-hosting.md](./docs/self-hosting.md) — self-hosting guide used by the docs site
- [SELFHOSTING.md](./SELFHOSTING.md) — full repository-level self-hosting reference
- [DEVELOPMENT.md](./DEVELOPMENT.md) — local development workflow

## License

Agent Tick is source-available under the [Business Source License 1.1](./LICENSE) (BSL 1.1). You may use, modify, and self-host it internally — including for commercial purposes — but you may not offer Agent Tick as a hosted or managed service to third parties. The license converts to Apache 2.0 on 2028-05-31.
