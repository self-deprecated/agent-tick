# AWS Fargate Readiness Implementation Plan

## Goal

Prepare Agent Tick to run cleanly on AWS Fargate with managed PostgreSQL and Redis while preserving the current simple SQLite-based self-hosting path.

The target infrastructure lives separately in **Agent Tick Infra**. This document covers the application-side changes needed in this repository.

## Desired production shape

Initial AWS shape:

- ECS Fargate runs the Agent Tick server container.
- PostgreSQL, via RDS or Aurora PostgreSQL, is the durable source of truth.
- Redis, via ElastiCache, is used for ephemeral cross-task coordination.
- The app remains horizontally scalable and does not depend on local persistent disk.
- The Nix flake and NixOS module remain current so the same functionality can be tested on a NixOS VPS.

SQLite should remain supported for local development and simple self-hosted deployments.

## Key architectural finding

The current database layer is synchronous SQLite via `better-sqlite3`. PostgreSQL and Redis clients in Node are normally asynchronous.

Therefore, the main application change is:

> Refactor persistence and ephemeral coordination behind async interfaces, then provide SQLite/PostgreSQL and memory/Redis implementations.

This should be done in small, testable phases rather than as one large rewrite.

## Required changes

### 1. Async store abstraction

Current server code imports and uses the concrete `AgentTickStore` from `@agent-tick/db`.

Introduce a store interface and separate implementations:

- `SqliteAgentTickStore`
- `PostgresAgentTickStore`
- `openAgentTickStore(...)` factory

Supported URLs:

```text
file:/var/lib/agent-tick/agent-tick.db
:memory:
postgres://...
postgresql://...
```

Most store methods should become async or promise-returning. This affects:

- `apps/server/src/index.ts`
- `apps/server/src/app.ts`
- server routes
- auth helpers
- mobile session helpers
- notification helpers
- retention cleanup
- server tests
- db tests

### 2. PostgreSQL backend

Add PostgreSQL support in `packages/db`.

Likely dependencies:

- `pg`
- `@types/pg`

Implementation requirements:

- connection pool
- schema migrations
- transaction helper
- query helper
- row mapping
- test database helper
- clean close lifecycle
- real PostgreSQL tests, not only mocks

PostgreSQL becomes the durable source of truth for:

- users
- auth identities
- organizations
- memberships
- teams
- policies
- approvals
- approval recipients/votes
- audit events
- agent token hashes
- devices
- invites
- pairing codes
- event tickets
- approval waiter tokens
- status updates
- mobile diagnostics

Important SQLite-to-Postgres differences:

- `INTEGER PRIMARY KEY AUTOINCREMENT` becomes identity/serial style columns.
- `INSERT OR IGNORE` becomes `INSERT ... ON CONFLICT DO NOTHING`.
- SQLite `?` placeholders become `$1`, `$2`, etc.
- SQLite change-count handling differs from Postgres row counts.
- Transactions are async and connection-scoped.
- Boolean-ish integer columns need explicit mapping.
- Partial indexes mostly map to Postgres partial indexes.

### 3. Migration strategy

Current migrations are embedded SQL strings in `packages/db/src/index.ts`.

Add backend-specific migration support:

- SQLite migrations
- PostgreSQL migrations
- shared `schema_migrations` tracking
- safe startup behavior

Initial config can support startup migrations:

```env
AGENT_TICK_DATABASE_MIGRATE_ON_START=true
```

Default can remain friendly for self-hosting, but the implementation should allow Agent Tick Infra to later run migrations as a one-off ECS task.

### 4. Redis-backed ephemeral coordination

Redis should be used for cross-task coordination in multi-Fargate deployments.

Likely dependency:

- `redis`

Redis should not store durable Agent Tick state. PostgreSQL remains the source of truth.

Redis use cases:

- cross-task event wakeups
- shared rate limiting counters
- optional distributed cleanup locks
- short-lived coordination where cache loss is acceptable

Possible config:

```env
AGENT_TICK_REDIS_URL=redis://...
AGENT_TICK_EPHEMERAL_BACKEND=memory|redis
AGENT_TICK_RATE_LIMIT_BACKEND=memory|redis
AGENT_TICK_EVENT_BUS_BACKEND=memory|redis
```

A simpler first pass could automatically use Redis when `AGENT_TICK_REDIS_URL` is present.

### 5. Event bus abstraction

Current event bus is in-memory and lives in:

```text
apps/server/src/services/eventBus.ts
```

It currently supports in-process waiters and is patched into audit writes.

Needed:

- explicit `OrganizationEventBus` interface
- memory implementation
- Redis implementation
- lifecycle management for subscriptions
- tests for cross-instance wakeups

Example cross-task flow:

1. CLI creates a sanction or steering request.
2. CLI wait request lands on ECS Task A.
3. Dashboard/mobile response lands on ECS Task B.
4. Task B writes the result to PostgreSQL.
5. Task B publishes an event to Redis.
6. Task A receives the Redis message, re-reads PostgreSQL, and returns the result.

Redis is only the wake-up channel.

### 6. Approval wait flow

Current wait flow polls the database every 25–250ms while an approval is pending.

With Redis:

- correctness still comes from PostgreSQL reads
- Redis reduces polling and wakes waiters across tasks
- fallback polling should remain for resilience

Desired behavior:

```text
while approval is pending and wait timeout has not elapsed:
  wait for org/request event or short fallback timeout
  re-read approval from database
return terminal approval or pending timeout response
```

### 7. Event stream and poll flow

Current event routes use audit events plus in-memory wakeups.

Needed:

- Redis-backed wakeups for `/v1/events/poll`
- keep audit events in PostgreSQL as the source of truth
- keep SSE/long-poll compatible with ALB timeouts
- test two app instances sharing PostgreSQL and Redis

### 8. Shared rate limiting

Current rate limiting in `apps/server/src/app.ts` uses an in-memory `Map`.

Extract a rate limiter service:

- memory implementation for local/single-node
- Redis implementation for multi-task AWS

Existing route rules should be preserved.

Current rate-limited surfaces include:

- invite lookup/accept
- device pairing
- mobile session exchange
- mobile diagnostics
- pairing token creation
- event ticket creation
- event poll

### 9. Retention cleanup coordination

Current startup and interval cleanup run in every server process.

In multi-task Fargate, every task may run cleanup unless coordinated.

Options:

1. Accept duplicate cleanup because deletes are mostly idempotent.
2. Use Redis locks.
3. Use PostgreSQL advisory locks.
4. Move cleanup to a dedicated scheduled ECS task.

Recommended app-level changes:

- add `AGENT_TICK_RETENTION_CLEANUP_ENABLED`
- add cleanup locking abstraction
- support memory/no-op lock for SQLite/local
- support Redis or PostgreSQL lock for production

Agent Tick Infra can later choose a scheduled ECS task model.

### 10. Readiness endpoint

Current app has `/healthz`.

Add:

```text
/healthz -> process is alive
/readyz  -> required dependencies are reachable
```

`/readyz` should check:

- store/database connectivity
- Redis connectivity if configured
- optionally migration status

ECS and ALB should use the endpoint appropriate for traffic routing.

### 11. Graceful shutdown

Current shutdown closes Fastify and SQLite.

Extend lifecycle management to:

- stop retention timer
- close Fastify
- close PostgreSQL pool
- close Redis publisher/subscriber clients
- stop event bus subscriptions
- unblock or end long-lived wait/event requests where practical

### 12. Nix flake and NixOS module updates

Keep Nix support current in the same implementation work so the new ephemeral-state support can be tested on a NixOS VPS.

Expected flake changes:

- update `pnpmDeps` hash after package dependency changes
- keep current SQLite native build support for `better-sqlite3`
- likely no native dependency for `pg`
- likely no native dependency for `redis`
- ensure `nix build .#agent-tick-server` works

NixOS module changes:

- update `databaseUrl` description to mention SQLite and PostgreSQL
- add `redisUrl`
- add backend options if explicit backends are chosen
- add `retention.cleanupEnabled`
- map new options to environment variables

Possible module shape:

```nix
services.agent-tick = {
  databaseUrl = "postgres://...";
  redisUrl = "redis://...";
  ephemeralBackend = "redis";
  rateLimitBackend = "redis";
  retention.cleanupEnabled = true;
};
```

Environment variables:

```text
AGENT_TICK_REDIS_URL
AGENT_TICK_EPHEMERAL_BACKEND
AGENT_TICK_RATE_LIMIT_BACKEND
AGENT_TICK_EVENT_BUS_BACKEND
AGENT_TICK_RETENTION_CLEANUP_ENABLED
AGENT_TICK_DATABASE_MIGRATE_ON_START
```

### 13. Docker and Compose updates

Keep Docker's default simple self-hosting path as SQLite:

```env
AGENT_TICK_DATABASE_URL=file:/data/agent-tick.db
```

Add documented Postgres/Redis support without requiring it for default Compose.

Optional later improvement:

- Compose profile for Postgres
- Compose profile for Redis

Do not make local self-hosting more complex than necessary.

### 14. Documentation updates

Update:

- `SELFHOSTING.md`
- NixOS module example
- Docker/Compose docs if applicable
- development docs if local Postgres/Redis tests require setup

Documentation should clearly distinguish:

- SQLite simple self-hosting
- PostgreSQL production self-hosting
- Redis multi-instance coordination
- optional webhooks/email are not required for AWS readiness

## Test plan

Targeted checks during implementation:

```sh
corepack pnpm --filter @agent-tick/db typecheck
corepack pnpm --filter @agent-tick/db test
corepack pnpm --filter @agent-tick/server typecheck
corepack pnpm --filter @agent-tick/server test
```

Broader checks before completing major phases:

```sh
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
```

Nix checks:

```sh
nix flake check
nix build .#agent-tick-server
```

If new files are added before Nix builds, snapshot with jj first so Nix can see them.

PostgreSQL tests should cover:

- migrations
- identity/user creation
- organization membership flows
- agent token creation/verification/revocation
- approval create/list/respond/wait/abandon
- approval expiration
- audit event listing
- invite flows
- device registration
- retention cleanup

Redis tests should cover:

- memory event bus parity
- Redis event bus publish/wait
- wait endpoint wakes after response
- two app instances sharing PostgreSQL and Redis
- memory rate limiter parity
- Redis shared rate limiting across app instances
- cleanup lock acquisition/skip behavior

## Suggested implementation phases

### Phase 1: Async interfaces with SQLite behavior unchanged

- introduce async store interface
- rename or split current store into SQLite implementation
- update server/routes/auth/tests to await store calls
- keep behavior unchanged
- validate current SQLite tests pass

This is the largest mechanical change and should be isolated.

### Phase 2: PostgreSQL backend

- add `pg`
- add Postgres migrations/schema
- implement Postgres store methods
- add Postgres test helper
- run DB matrix tests

### Phase 3: Readiness and lifecycle

- add `/readyz`
- add store `ping`
- add Redis readiness hook placeholder
- normalize close/shutdown lifecycle

### Phase 4: Ephemeral abstractions with memory implementations

- extract event bus abstraction
- extract rate limiter abstraction
- add cleanup lock abstraction
- preserve current memory behavior

### Phase 5: Redis implementations

- add `redis`
- implement Redis event bus
- implement Redis rate limiter
- implement Redis cleanup lock if chosen
- add cross-instance tests

### Phase 6: NixOS/VPS support

- update `flake.nix` dependency hash
- update NixOS module options
- expose Postgres/Redis env vars
- build Nix package
- test service on NixOS VPS with PostgreSQL and Redis

### Phase 7: Docker and docs

- update Docker/Compose env docs
- update `SELFHOSTING.md`
- document SQLite default and PostgreSQL/Redis production mode

## Likely files touched

Server:

```text
apps/server/src/index.ts
apps/server/src/app.ts
apps/server/src/config.ts
apps/server/src/auth/*.ts
apps/server/src/routes/*.ts
apps/server/src/services/eventBus.ts
apps/server/src/services/retention.ts
apps/server/test/*.ts
```

Database package:

```text
packages/db/package.json
packages/db/src/index.ts
packages/db/src/types.ts
packages/db/src/sqlite.ts
packages/db/src/postgres.ts
packages/db/src/migrations/*
packages/db/test/*
```

Nix/Docker/docs:

```text
flake.nix
nix/modules/agent-tick.nix
apps/server/Dockerfile
docker-compose.yml
SELFHOSTING.md
DEVELOPMENT.md
```

## Commit slicing

Recommended commit sequence:

1. `refactor(db): introduce async store interface`
2. `feat(db): add postgres store backend`
3. `feat(server): add dependency readiness checks`
4. `refactor(server): abstract event bus and rate limiting`
5. `feat(server): add redis coordination backend`
6. `feat(nix): expose postgres and redis service options`
7. `docs: document postgres redis self-hosting mode`

## Main risks

- Async store refactor touches many files and tests.
- PostgreSQL parity with the existing SQLite store is easy to get subtly wrong.
- Multi-instance behavior must be tested explicitly; single-process tests are insufficient.
- Retention cleanup can run concurrently unless intentionally coordinated.
- Nix package hash updates are required after dependency changes.

## Non-goals for this phase

- Active-active multi-region support.
- Webhook delivery infrastructure.
- SES/email delivery.
- EventBridge/SQS workers.
- Removing SQLite support.
- Replacing Clerk email/auth flows.

## Bottom line

The Agent Tick app can support the AWS Fargate direction cleanly by making PostgreSQL the durable production backend and Redis the ephemeral multi-task coordination backend. The implementation should proceed incrementally: async store first, PostgreSQL second, readiness/lifecycle third, Redis coordination fourth, then Nix/Docker/docs hardening.
