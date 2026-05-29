# Development

Agent Tick is now a TypeScript-first monorepo.

## Project shape

- `apps/server`: Fastify API server and static dashboard host.
- `apps/admin`: Svelte 5 + TypeScript dashboard built with Vite.
- `apps/mobile`: Expo React Native phone app.
- `packages/cli`: private workspace CLI package with the `agent-tick` binary.
- `packages/sdk`: environment-neutral typed HTTP client.
- `packages/shared`: Zod schemas, shared API types, constants.
- `packages/db`: SQLite and PostgreSQL current-schema setup plus repository helpers.

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

## Docker self-host E2E tests

The Docker self-host E2E suite builds the real server image through Compose, runs it with isolated durable stores, waits for `/healthz` and `/readyz`, then exercises black-box API and dashboard flows against the container:

```sh
corepack pnpm test:e2e:docker:single
```

To run every Docker self-host mode, including deterministic Clerk test-auth, Redis, PostgreSQL single-mode, PostgreSQL Clerk test-auth, retention, webhook, migration, rate-limit, and startup/config-negative modes, use:

```sh
corepack pnpm test:e2e:docker
```

Focused modes are also available when debugging a narrower surface:

```sh
corepack pnpm test:e2e:docker:redis
corepack pnpm test:e2e:docker:postgres
corepack pnpm test:e2e:docker:postgres-clerk-test
corepack pnpm test:e2e:docker:retention
corepack pnpm test:e2e:docker:webhook
corepack pnpm test:e2e:docker:migration
corepack pnpm test:e2e:docker:config-negative
```

The runner picks a unique Compose project name and port by default. Useful debug knobs:

```sh
AGENT_TICK_E2E_PORT=18787 corepack pnpm test:e2e:docker:single
AGENT_TICK_E2E_KEEP_DOCKER=1 corepack pnpm test:e2e:docker:single
```

When `AGENT_TICK_E2E_KEEP_DOCKER=1` is set, the runner prints the exact cleanup command. Leaked projects can also be inspected with `docker compose ls` and removed with:

```sh
docker compose -p <project-name> -f docker-compose.yml down -v --remove-orphans
```

Docker failures print `docker compose ps`, server logs, and the effective `docker compose config`. PostgreSQL single-mode runs lifecycle/persistence plus high-risk dashboard/static, invalid-payload, waiter, admin-token, request-expiration, and concurrent-response flows against a real PostgreSQL container. PostgreSQL Clerk test-auth reruns deterministic Clerk multi-user and authorization-boundary flows against PostgreSQL. Do not advertise or use `AGENT_TICK_TEST_AUTH` in operator self-hosting docs; it is only for deterministic test harnesses.

## Server

Run the TypeScript server locally:

```sh
AGENT_TICK_MODE=single \
AGENT_TICK_PUBLIC_URL=http://localhost:8787 \
corepack pnpm --filter @agent-tick/server dev
```

The server uses SQLite by default and writes `./agent-tick.db`; override with either a SQLite file URL or a PostgreSQL URL:

```sh
AGENT_TICK_DATABASE_URL=file:/path/to/agent-tick.db
# or
AGENT_TICK_DATABASE_URL=postgresql://agent_tick:change-me@localhost:5432/agent_tick
```

Pre-launch databases are resettable. The DB lifecycle currently ensures the latest schema exists; it does not preserve historical schema migrations. If a local dogfood database was created by an older build and no longer boots cleanly, delete `agent-tick.db` or reset the test PostgreSQL schema and recreate it with the current code. There is no automatic SQLite-to-PostgreSQL data migration.

Optional PostgreSQL pool knobs are available for Tay/production-style deployments:

```sh
AGENT_TICK_POSTGRES_POOL_MAX=10
AGENT_TICK_POSTGRES_POOL_IDLE_TIMEOUT_MS=30000
AGENT_TICK_POSTGRES_POOL_CONNECTION_TIMEOUT_MS=5000
AGENT_TICK_POSTGRES_STATEMENT_TIMEOUT_MS=30000
AGENT_TICK_POSTGRES_QUERY_TIMEOUT_MS=30000
```

Use PgBouncer or another pooler when many server instances would otherwise exceed the database connection limit.

Real PostgreSQL tests are opt-in. When `AGENT_TICK_TEST_POSTGRES_URL` is set, the full public store contract runs against both SQLite and isolated PostgreSQL schemas:

```sh
AGENT_TICK_TEST_POSTGRES_URL=postgresql://agent_tick_test:change-me@localhost:5432/agent_tick_test \
  corepack pnpm --filter @agent-tick/db test

AGENT_TICK_TEST_POSTGRES_URL=postgresql://agent_tick_test:change-me@localhost:5432/agent_tick_test \
  corepack pnpm --filter @agent-tick/server test -- postgresSmoke.test.ts
```

Production rollouts should gate traffic on `/readyz`, verify database backups, run the Postgres smoke coverage, verify Redis readiness when Redis backends are configured, and keep a rollback path to the previous app slot or previous database backup.

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

The browser login flow opens the dashboard, asks the signed-in user to click **Authorize CLI sign-in**, and saves the returned `agent_...` token to `~/.config/agent-tick/config.json` unless `AGENT_TICK_CONFIG` is set. The CLI intentionally does not start the server. The official server distribution is Docker.

### Publishing the CLI to npm

The CLI package publishes publicly as `@self-deprecated/agent-tick` from the public GitHub mirror. Publishing is intentionally manual-only through the **Publish npm CLI** GitHub Actions workflow; publishing does not run automatically when a GitHub Release is published.

Before running a real publish:

1. Bump `packages/cli/package.json`, `CLI_VERSION` in `packages/cli/src/index.ts`, and `agent-tick-cli.version` in `flake.nix` together.
2. Run `nix build .#agent-tick-cli --no-link --print-build-logs` to catch stale `pnpmDeps.hash` values.
3. Ensure the target npm version is not already published.
4. Push/mirror the release candidate to `self-deprecated/agent-tick`.

The workflow inputs are:

| Input | Default | Purpose |
| --- | --- | --- |
| `dry-run` | `true` | Runs build, pack smoke test, and `pnpm publish --dry-run`. Set to `false` only for a real publish. |
| `release-tag` | `v<packages/cli/package.json version>` | Used in the Agent Tick Sanction title/body and GitHub Release changelog URL. |

The public GitHub repository must define these Actions secrets for a real publish:

| Secret | Purpose |
| --- | --- |
| `NPM_TOKEN` | npm token with publish rights for `@self-deprecated/agent-tick`. |
| `AGENT_TICK_SERVER` | Agent Tick server URL used by the release Sanction. |
| `AGENT_TICK_RELEASE_TOKEN` | Agent Tick agent token allowed to create the release Sanction. |

For real publishes, the workflow verifies secrets, checks `npm whoami`, confirms the package version is unpublished, sends an Agent Tick Sanction, and then runs `pnpm --filter @self-deprecated/agent-tick publish --access public --provenance --no-git-checks`.

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

The mobile app discovers runtime auth config, namespaces local session state by server URL, signs in with Clerk in hosted/Clerk mode, exchanges that login for an Agent Tick mobile session, and registers/unregisters devices for push flows. For the happy path, set up the CLI with `agent-tick install --login`, then sign in to mobile with the same Clerk account before sending the first request.
