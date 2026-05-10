# Agent Tick

Agent Tick is a human approval gate for AI agents. Your agent asks before doing something sensitive, a human approves or rejects it in Agent Tick, and the agent continues only after approval.

Website: <https://agenttick.sh>

## Start here

Most users should use the hosted service at <https://agenttick.sh>.

Run one command on the machine where your coding agents run:

```sh
npx @self-deprecated/agent-tick install
```

The installer opens Agent Tick in your browser, connects this machine to your hosted Agent Tick account, and offers to install approval instructions for local AI coding agents such as Claude Code, Codex CLI, Gemini CLI, Pi, Cursor, OpenCode, or a local `AGENTS.md` file.

If you prefer a global install:

```sh
npm install -g @self-deprecated/agent-tick
agent-tick install
```

After setup, agents can request approval with:

```sh
agent-tick request \
  --title "Deploy production?" \
  --body "Deploy commit abc123 to production." \
  --command "deploy production"
```

Or run a command only after approval:

```sh
agent-tick guard --title "Run migration?" -- ./migrate.sh
```

Approve or reject requests from the Agent Tick web dashboard. Mobile approval apps are part of the product direction, but public setup should not depend on private beta access.

## What gets installed?

`agent-tick install` does two things:

1. Runs browser-based CLI setup against `https://agenttick.sh` and saves an Agent Tick `agent_...` token locally in `~/.config/agent-tick/config.json`.
2. Adds a small Agent Tick approval instruction block to the agent targets you choose, so coding agents know to call `agent-tick guard` or `agent-tick request` before risky actions.

Useful installer options:

```sh
agent-tick install --target claude --target codex
agent-tick install --all
agent-tick install --dry-run
agent-tick install --server https://tick.example.com
```

## Self-hosting

Agent Tick is source-available and self-hostable. That matters for trust, privacy, and teams that need to operate approvals on their own infrastructure.

Self-hosting is not the default onboarding path. If you want it, use [SELFHOSTING.md](./SELFHOSTING.md).

## What is in this repo

- Fastify API server
- Svelte dashboard served by the server
- Expo mobile app
- `agent-tick` CLI with `install`, `setup`, `request`, `abandon`, and `guard`
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
- [SELFHOSTING.md](./SELFHOSTING.md) — run your own Agent Tick server
- [DEVELOPMENT.md](./DEVELOPMENT.md) — local development workflow
- [docs/competitor-analysis.md](./docs/competitor-analysis.md) — market scan and setup inspiration

## License

Agent Tick is licensed under the [Business Source License 1.1](./LICENSE) (BSL 1.1). You may use, modify, and self-host it — including for commercial purposes — but you may not offer Agent Tick as a hosted or managed service to third parties. The license converts to Apache 2.0 on 2028-04-18.
