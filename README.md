# Agent Tick

Agent Tick is an approval broker for agent systems. An agent submits a request, a human reviews it in the dashboard or mobile app, and the agent continues only after approval.

The project is now TypeScript-first:

- Dockerized Node/Fastify server
- Svelte dashboard served by the server
- `agent-tick` CLI package for agents (currently workspace-built; npm publishing is deferred)
- Expo mobile app
- SQLite persistence
- optional Clerk human authentication for multi-user mode

## Quick start

Start the server locally:

```sh
docker compose up --build
```

Open the dashboard:

```text
http://localhost:8787
```

Create an agent token in the dashboard, then configure the workspace-built CLI:

```sh
corepack pnpm --filter agent-tick build
corepack pnpm --filter agent-tick exec agent-tick setup --server http://localhost:8787 --token agent_...
```

Send an approval request:

```sh
corepack pnpm --filter agent-tick exec agent-tick request \
  --title "Run command?" \
  --body "codex wants to run npm install" \
  --command "npm install"
```

The CLI package is currently private in this repository, so `npx agent-tick`/global npm installs are not documented as available until publishing is intentionally enabled.

Approve or reject it in the dashboard.

## Auth modes

### `single`

Default local self-hosted mode.

- no Clerk account required
- one local admin/user context
- optional `AGENT_TICK_ADMIN_TOKEN`
- agents use Agent Tick `agent_...` tokens

### `clerk`

Multi-user mode.

- Clerk authenticates humans
- Agent Tick verifies Clerk session JWTs
- Agent Tick still owns orgs, approvals, devices, agent tokens, policies, and audit data
- agents still use Agent Tick `agent_...` tokens

See [SELFHOSTING.md](./SELFHOSTING.md) for configuration.

## Development

Install dependencies:

```sh
corepack pnpm install
```

Useful commands:

```sh
corepack pnpm typecheck
corepack pnpm test
corepack pnpm --filter @agent-tick/server dev
corepack pnpm --filter agent-tick-admin dev
corepack pnpm --filter agent-tick build
```

The root test command runs server/package/admin tests and the mobile Jest suite through the pnpm workspace.

## License

agent-tick is licensed under the [Business Source License 1.1](./LICENSE) (BSL 1.1). You are free to use, modify, and self-host it — including for commercial purposes — but you may not offer agent-tick as a hosted or managed service to third parties. The license converts to Apache 2.0 on 2028-04-18.

---

- [SELFHOSTING.md](./SELFHOSTING.md) — run your own Agent Tick server
- [docs/typescript-first-rewrite-plan.md](./docs/typescript-first-rewrite-plan.md) — architecture migration plan
- [docs/clerk-auth-migration.md](./docs/clerk-auth-migration.md) — Clerk auth design notes
