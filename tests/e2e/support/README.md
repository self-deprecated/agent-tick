# E2E support harness plan

This directory contains shared helpers used by the product-flow E2E tests.

## Helpers

- `auth.ts` — deterministic test auth / mock-Clerk sign-in helpers.
- `db.ts` — test-state inspection helpers for Playwright assertions.
- `fixtures.ts` — Workspace, Agent Token, Routing Rule, Approval Device, and Agent Tick Request fixtures.
- `pages.ts` — common page-object selectors for setup and Agent Activity screens.
- `../docker/support/selfhost.ts` — black-box Docker self-host helpers for admin auth, agent tokens, spoofed devices, request lifecycle assertions, Compose restarts, and readiness polling.

## Docker self-host coverage

Docker self-host tests live in `tests/e2e/docker` and should be run through the Docker harness instead of against a manually started dev server:

```sh
corepack pnpm test:e2e:docker:single
corepack pnpm test:e2e:docker:rate-limits
corepack pnpm test:e2e:docker:redis
corepack pnpm test:e2e:docker:postgres
corepack pnpm test:e2e:docker:postgres-clerk-test
corepack pnpm test:e2e:docker:retention
corepack pnpm test:e2e:docker:webhook
corepack pnpm test:e2e:docker:migration
corepack pnpm test:e2e:docker:config-negative
corepack pnpm test:e2e:docker
```

The harness builds the production Dockerfile via Compose and records Docker diagnostics on failure. Focused modes start isolated Compose projects for deliberately low rate limits, Redis-backed readiness/event/rate-limit checks, PostgreSQL-backed single-mode lifecycle/persistence plus dashboard/static/invalid-payload/waiter/admin-token/request-expiration/concurrent-response checks, PostgreSQL-backed Clerk test-auth authorization checks, test-auth retention cleanup, local webhook capture, retained SQLite data, and intentionally invalid startup configuration. Set `AGENT_TICK_E2E_KEEP_DOCKER=1` to keep the Compose project and durable-store volumes for local debugging.

## Constraints

- Full product-flow E2E tests should not depend on real hosted Clerk for every run.
- Real Clerk should remain covered by a small smoke suite.
- Tests must assert both UI state and database state.
- Do not commit active non-skipped tests for UI that does not exist yet.
