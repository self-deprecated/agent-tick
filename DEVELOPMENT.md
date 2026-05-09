# Development

Agent Tick is now a TypeScript-first monorepo.

## Project shape

- `apps/server`: Fastify API server and static dashboard host.
- `apps/admin`: Svelte 5 + TypeScript dashboard built with Vite.
- `apps/mobile`: Expo React Native phone app.
- `packages/cli`: private workspace CLI package with the `agent-tick` binary.
- `packages/sdk`: environment-neutral typed HTTP client.
- `packages/shared`: Zod schemas, shared API types, constants.
- `packages/db`: SQLite migrations and repository helpers.

The old Go server/CLI has been removed from the active implementation.

## Setup

Use Corepack and pnpm:

```sh
corepack pnpm install
```

## Check loop

```sh
corepack pnpm typecheck
corepack pnpm test
```

The root test command runs server/package/admin tests and the mobile Jest suite through the pnpm workspace.

## Product-flow E2E tests

The product-flow E2E suite runs against a temporary Clerk-mode server with deterministic test auth and a temporary SQLite database:

```sh
corepack pnpm test:e2e:flows
```

The script builds the admin and server, starts the server with `AGENT_TICK_TEST_AUTH=1`, waits for `/healthz`, runs `tests/e2e/flows`, then removes the temporary database. If Playwright browsers are not installed, set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` to a local Chromium binary or run `corepack pnpm exec playwright install`.

## Server

Run the TypeScript server locally:

```sh
AGENT_TICK_MODE=single \
AGENT_TICK_PUBLIC_URL=http://localhost:8787 \
corepack pnpm --filter @agent-tick/server dev
```

The server uses SQLite. By default it writes `./agent-tick.db`; override with:

```sh
AGENT_TICK_DATABASE_URL=file:/path/to/agent-tick.db
```

Single mode optionally accepts an admin token:

```sh
AGENT_TICK_ADMIN_TOKEN=change-me
```

Clerk mode requires:

```sh
AGENT_TICK_MODE=clerk
AGENT_TICK_CLERK_PUBLISHABLE_KEY=pk_...
AGENT_TICK_CLERK_SECRET_KEY=sk_...
AGENT_TICK_CLERK_AUTHORIZED_PARTIES=http://localhost:8787
```

## Dashboard

Run the dashboard dev server:

```sh
corepack pnpm --filter agent-tick-admin dev
```

The Vite dev server proxies `/v1` to `http://localhost:8787`.

Build production dashboard assets:

```sh
corepack pnpm --filter agent-tick-admin build
```

The build writes to `apps/server/public/admin`, which the server serves in Docker/runtime builds. Generated dashboard assets are not intended to be committed.

## CLI

Build the workspace CLI:

```sh
corepack pnpm --filter agent-tick build
```

Run it from the package during development:

```sh
node packages/cli/dist/index.js setup --server http://localhost:8787 --token agent_...
node packages/cli/dist/index.js request --title "Deploy?"
```

The CLI intentionally does not start the server. The official server distribution is Docker. The CLI package is currently private in this repository; update README/SELFHOSTING/docs when public npm publishing is intentionally enabled.

## Docker

Build the server image:

```sh
docker build -f apps/server/Dockerfile -t agent-tick:dev .
```

Run with Compose:

```sh
AGENT_TICK_IMAGE=agent-tick:dev docker compose up -d
```

## Mobile

Validate the mobile app:

```sh
corepack pnpm --filter @agent-tick/mobile typecheck
corepack pnpm --filter @agent-tick/mobile test --runInBand
```

The mobile app discovers runtime auth config, namespaces local session state by server URL, supports Clerk sign-in/account creation/OAuth buttons, and registers/unregisters devices for push flows.
