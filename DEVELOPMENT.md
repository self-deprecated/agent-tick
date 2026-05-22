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

## Dependency policy

Agent Tick keeps npm dependencies deliberately small, pinned, and reproducible.

Default stance:

- Prefer the TypeScript/Node standard library, browser APIs, platform APIs, or workspace code over adding a package.
- Add a new npm dependency only when it materially reduces risk or complexity compared with local code.
- Avoid small convenience packages, abandoned packages, packages with unclear ownership, and packages with broad transitive dependency trees.
- Keep the public CLI runtime dependency surface especially small.

Versioning and lockfiles:

- Pin all npm package versions exactly in `package.json`; do not use `^`, `~`, `>`, `>=`, or tag ranges such as `latest`.
- Keep `pnpm-lock.yaml` committed.
- Use Corepack and the pnpm version declared by the root `packageManager` field.
- Use frozen lockfile installs for CI, release, Docker, and reproducibility checks:

  ```sh
  corepack pnpm install --frozen-lockfile
  ```

- When intentionally updating dependencies, update package manifests and `pnpm-lock.yaml` together.
- For Nix package builds that use `fetchPnpmDeps`, update the corresponding fixed-output hash in `flake.nix` in the same dependency-change commit.

Dependency install scripts are a supply-chain risk:

- Do not broadly enable arbitrary dependency build scripts.
- Keep the `onlyBuiltDependencies` allowlist in `pnpm-workspace.yaml` minimal and explicit.
- Adding a package that requires an install/build lifecycle script requires an explicit explanation in the change.

Before adding a dependency, document or verify:

- Why local/workspace code is not the better option.
- Whether the package is maintained and has a clear upstream.
- The size and risk of its transitive dependency graph.
- Whether it runs install scripts or downloads binaries.
- Whether it handles secrets, auth, crypto, Requests, Responses, notifications, or other sensitive data.
- Whether the dependency is needed at runtime or can be dev-only.

Useful commands:

```sh
corepack pnpm install --frozen-lockfile
corepack pnpm install --lockfile-only
corepack pnpm audit
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
corepack pnpm --filter @self-deprecated/agent-tick build
```

Run it from the package during development:

```sh
node packages/cli/dist/index.js login --server http://localhost:8787
node packages/cli/dist/index.js sanction --title "Deploy?"
```

For single-mode/manual setup or CI, pass a dashboard-created token directly:

```sh
node packages/cli/dist/index.js config --server http://localhost:8787 --token agent_...
```

The browser login flow opens the dashboard, asks the signed-in user to click **Authorize CLI sign-in**, and saves the returned `agent_...` token to `~/.config/agent-tick/config.json` unless `AGENT_TICK_CONFIG` is set. The CLI intentionally does not start the server. The official server distribution is Docker. The CLI package is currently private in this repository; update README/SELFHOSTING/docs when public npm publishing is intentionally enabled.

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

The mobile app discovers runtime auth config, namespaces local session state by server URL, signs in with Clerk in hosted/Clerk mode, exchanges that login for an Agent Tick mobile session, and registers/unregisters devices for push flows. For the happy path, set up the CLI with `agent-tick setup --login`, then sign in to mobile with the same Clerk account before sending the first request.
