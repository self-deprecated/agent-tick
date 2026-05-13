# Agent instructions for Agent Tick

## Project snapshot

Agent Tick is a fresh TypeScript-first human-approval service for AI agents.

- `apps/server` — Fastify API server, static dashboard host, Docker runtime entrypoint.
- `apps/admin` — Svelte 5 + Vite dashboard.
- `apps/mobile` — Expo React Native mobile approval app.
- `packages/cli` — private workspace CLI package exposing `agent-tick`.
- `packages/sdk` — typed HTTP client.
- `packages/shared` — shared Zod schemas, API types, constants.
- `packages/db` — SQLite schema management, migrations, store/repository helpers, test DB helpers.

The old Go server/CLI and prototype compatibility paths are not active product surfaces. Do not add Go-era compatibility unless explicitly requested.

Public product site: <https://agenttick.sh>. Self-hosting docs live in `SELFHOSTING.md`.

## Source-control workflow

This repository uses Jujutsu (`jj`). Do not use direct `git` commands.

Useful commands:

```sh
jj status --no-pager
jj diff --summary --no-pager
jj diff --no-pager
jj commit -m "type(scope): message" <paths...>
jj new
```

There is no staging area. If an unrelated local file is present, commit only the intended paths. `.pi-scratch.md` may exist as an uncommitted local scratch file; do not commit it unless the user asks.

## Package manager and runtime

Use Corepack + pnpm:

```sh
corepack pnpm install
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
```

Docker is the official server distribution path:

```sh
docker compose config
docker compose up --build
docker build -f apps/server/Dockerfile -t agent-tick:dev .
```

## CLI surface

Current implemented CLI commands only:

- `agent-tick install`
- `agent-tick setup`
- `agent-tick mode`
- `agent-tick sanction`
- `agent-tick steering`
- `agent-tick abandon`
- `agent-tick status`

The CLI package is prepared for public npm publishing as `@self-deprecated/agent-tick` and exposes the `agent-tick` binary. When bumping `packages/cli/package.json`, also bump `CLI_VERSION` in `packages/cli/src/index.ts` and the `agent-tick-cli.version` in `flake.nix` in the same change. For local repo development without a global install, use the workspace package name:

```sh
corepack pnpm --filter @self-deprecated/agent-tick build
node packages/cli/dist/index.js setup --server http://localhost:8787 --token agent_...
```

Do not document or call missing commands such as `agent-tick mcp`, `agent-tick adapter`, or `agent-tick steer` as current functionality.

## Auth and product model

- Default self-hosted mode is `single` and should require no Clerk, billing provider, email provider, or notification provider.
- Clerk mode is for human identity only.
- Agent Tick owns local users, organizations, memberships, teams, policies, approvals, agent tokens, devices, billing/seat-limit state, and audit logs.
- Use Clerk session tokens from clients; do not introduce Clerk JWT-template assumptions.
- Agent Tick organization context is local and selected with `X-Agent-Tick-Organization-ID`.
- Agents use Agent Tick `agent_...` tokens, not Clerk tokens.

## Security expectations

- Do not put bearer tokens in event-stream query strings. The current event stream flow uses short-lived one-use tickets.
- Management routes should require owner/admin roles where appropriate.
- Approval responders must be eligible for the relevant org/team/policy.
- Approval expiration is enforced in list/get/respond/abandon/wait flows.
- Treat sanction titles, steering bodies, status messages, commands, metadata, webhooks, logs, and notifications as disclosure surfaces. Do not include secrets.

## Documentation expectations

Keep the first-time user flow simple:

- README should point users to either hosted product usage (`https://agenttick.sh`) or self-hosting.
- Self-hosting details belong in `SELFHOSTING.md`.
- Product-vs-self-hosted usage flow belongs in `docs/using-agent-tick.md`.
- Integration details belong in `docs/integrations.md`.
- Development workflow belongs in `DEVELOPMENT.md`.

When docs mention install commands, remember that public npm/`npx agent-tick` install is deferred until the CLI package is intentionally published.

## Testing and validation

Use the narrowest meaningful validation for the change, then run broader checks before large commits.

Common full gate:

```sh
docker compose config
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
corepack pnpm --filter agent-tick-admin check
```

Targeted checks:

```sh
corepack pnpm --filter @agent-tick/server typecheck
corepack pnpm --filter @agent-tick/server test
corepack pnpm --filter @agent-tick/db typecheck
corepack pnpm --filter @agent-tick/db test
corepack pnpm --filter @self-deprecated/agent-tick typecheck
corepack pnpm --filter @self-deprecated/agent-tick test
corepack pnpm --filter @agent-tick/mobile typecheck
corepack pnpm --filter @agent-tick/mobile test --runInBand
corepack pnpm --filter agent-tick-admin check
```

Mobile Jest gotcha: pass `--runInBand` directly as shown above. Avoid `corepack pnpm --filter @agent-tick/mobile test -- --runInBand`; that form can be treated as a Jest pattern and report "No tests found".

Admin/Svelte changes: load the Svelte skills if available, and run `corepack pnpm --filter agent-tick-admin check`.

Docker/runtime changes: validate at least `docker compose config`; for Dockerfile/runtime changes, build the image and smoke-test `/healthz` when practical.

## Commit guidance

Commit substantial, coherent slices with conventional messages, for example:

```sh
jj commit -m "docs: update agent instructions" AGENTS.md
```

After committing, verify:

```sh
jj status --no-pager
```
