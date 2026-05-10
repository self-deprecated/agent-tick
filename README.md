# Agent Tick

Agent Tick is a human approval gate for AI agents. An agent asks before doing something sensitive, a person approves or rejects it in the dashboard or mobile app, and the agent continues only after approval.

Website: <https://agenttick.sh>

## Choose your path

### Use the hosted product

Go to <https://agenttick.sh> when you want Agent Tick operated for you.

Hosted-product flow:

1. Sign in at <https://agenttick.sh>.
2. Run `agent-tick setup --login`; the CLI opens a browser tab, asks you to authorize CLI setup, and saves an Agent Tick `agent_...` token locally.
3. Sign in to the Agent Tick mobile app with the same Clerk account.
4. Add `agent-tick request` or `agent-tick guard` around sensitive actions.
5. Approve or reject requests from the mobile app, with the web dashboard as a secondary approval surface.

The CLI package is currently private in this repository while publishing is deferred. Until a public npm package is intentionally released, local development and self-hosting examples use the workspace-built CLI.

### Self-host Agent Tick

Use Docker Compose when you want to run Agent Tick yourself. See [SELFHOSTING.md](./SELFHOSTING.md) for single-user and Clerk-backed multi-user deployments.

```sh
docker compose up --build
```

Open <http://localhost:8787>. In Clerk mode, configure the workspace-built CLI with browser sign-in:

```sh
corepack pnpm install
corepack pnpm --filter agent-tick build
node packages/cli/dist/index.js setup --login --server http://localhost:8787
```

The browser flow creates an Agent Tick agent token after you sign in and click **Authorize CLI setup**. In single-user mode, or for CI, you can still create a token in the dashboard and save it manually:

```sh
node packages/cli/dist/index.js setup --server http://localhost:8787 --token agent_...
```

Send an approval request:

```sh
node packages/cli/dist/index.js request \
  --title "Run command?" \
  --body "An agent wants to run npm install" \
  --command "npm install"
```

Ask a multiple-choice question by repeating `--choice`:

```sh
node packages/cli/dist/index.js request \
  --title "Which rollout?" \
  --choice canary="Canary" \
  --choice blue_green="Blue/green" \
  --choice cancel:deny="Cancel"
```

Run a command only after approval:

```sh
node packages/cli/dist/index.js guard \
  --title "Run migration?" \
  -- ./migrate.sh
```

## What is in this repo

Agent Tick is a fresh TypeScript-first service:

- Fastify API server
- Svelte dashboard served by the server
- Expo mobile app
- `agent-tick` CLI with `setup`, `request`, `abandon`, and `guard`
- SQLite persistence
- optional Clerk human authentication for multi-user mode
- local Agent Tick organizations, policies, approvals, audit logs, devices, and agent tokens

Clerk, when enabled, is only the human identity provider. Agent Tick owns authorization and product data.

## Auth modes

### `single`

Default local/self-hosted mode:

- no Clerk account required
- one local admin/user context
- optional `AGENT_TICK_ADMIN_TOKEN`
- agents use Agent Tick `agent_...` tokens

### `clerk`

Multi-user mode:

- Clerk authenticates humans
- Agent Tick verifies Clerk session tokens
- Agent Tick still owns orgs, teams, policies, approvals, devices, billing seat limits, audit logs, and agent tokens
- agents still use Agent Tick `agent_...` tokens

## Development

```sh
corepack pnpm install
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
corepack pnpm --filter agent-tick-admin check
```

More details are in [DEVELOPMENT.md](./DEVELOPMENT.md).

## Documentation

- [docs/using-agent-tick.md](./docs/using-agent-tick.md) — managed-product vs self-hosted usage flow
- [SELFHOSTING.md](./SELFHOSTING.md) — run your own Agent Tick server
- [DEVELOPMENT.md](./DEVELOPMENT.md) — local development workflow
- [docs/integrations.md](./docs/integrations.md) — current CLI and integration examples
- [docs/competitor-analysis.md](./docs/competitor-analysis.md) / [HTML review site](./docs/competitor-analysis.html) — market scan of human-approval competitors and setup ideas
- [docs/clerk-auth-migration.md](./docs/clerk-auth-migration.md) — Clerk auth design notes
- [docs/typescript-first-rewrite-plan.md](./docs/typescript-first-rewrite-plan.md) — architecture migration plan and current implementation status

## License

Agent Tick is licensed under the [Business Source License 1.1](./LICENSE) (BSL 1.1). You may use, modify, and self-host it — including for commercial purposes — but you may not offer Agent Tick as a hosted or managed service to third parties. The license converts to Apache 2.0 on 2028-04-18.
