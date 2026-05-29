# Relational store abstraction and Postgres support

Agent Tick supports durable relational stores through an explicit store abstraction, targeting SQLite and PostgreSQL rather than an open-ended “any database” promise. SQLite remains the local/self-hosted default. PostgreSQL is supported for production-style deployments, including Tay, once the server is configured with a `postgres://` or `postgresql://` database URL.

The server-facing abstraction, `AsyncAgentTickStore`, is the product boundary: API routes, services, SDK-facing behavior, billing flows, Request waiters, Session derivation, and cleanup jobs depend on Agent Tick store semantics, not on a concrete database driver. `openAgentTickStore()` selects the SQLite or PostgreSQL implementation from `AGENT_TICK_DATABASE_URL` while preserving that app-facing contract.

Implementation evolved the store in layers:

1. Keep `AsyncAgentTickStore` as the stable app-facing contract.
2. Split the SQLite implementation into domain-oriented repository helpers for identity/workspaces plus status/device/billing/cleanup surfaces, while preserving the public SQLite `AgentTickStore` class for compatibility and white-box tests.
3. Introduce a small relational driver/dialect layer for the SQL differences that matter in Agent Tick: placeholders, transactions, insert/update returning behavior, JSON encoding, boolean mapping, conflict handling, timestamp comparisons, pagination, and advisory locks.
4. Run shared store behavior tests against SQLite and opt-in real PostgreSQL harnesses. PostgreSQL tests require `AGENT_TICK_TEST_POSTGRES_URL` so they exercise real `pg` behavior, constraints, transactions, and concurrency.
5. Enable PostgreSQL URL routing only after the PostgreSQL implementation covered the full `AsyncAgentTickStore` launch surface and the server smoke path could run against a PostgreSQL-backed store.

The abstraction is deliberately relational, not database-agnostic at all costs. Agent Tick depends on uniqueness constraints, transactional state changes, append/read ordering, expiry cleanup, and relational membership/routing queries. Designing for arbitrary future databases now would add complexity without a concrete product need. A well-factored relational store can still support additional SQL backends later if there is a reason.

PostgreSQL support preserves the semantics that matter most for production:

- Request creation, routing, responses, waiter liveness, and wait delivery are implemented against durable database state.
- Clerk-backed user/workspace identity and membership changes are idempotent and guarded for webhook retries.
- Billing receipt ownership, entitlement updates, and conflict records preserve uniqueness and recovery behavior.
- Status Updates, audit events, Session summaries, and timeline reads keep stable ordering.
- Retention cleanup and secret cleanup are safe to run from multiple store instances using idempotent deletes and database constraints.
- During the pre-launch reset window, schema setup installs the current schema idempotently instead of running historical migrations. After launch, future schema changes should introduce explicit migration discipline, preferably expand/contract changes that keep rollback safe.

Tay should run with PostgreSQL as the source of truth and Redis only for ephemeral coordination such as event wakeups, rate limiting, and singleton cleanup locks. Before routing production traffic to a Tay slot, operators should verify `/readyz`, database backups and restore path, real-PostgreSQL smoke tests, Redis readiness when Redis backends are configured, and rollback to the previous app slot or database backup.

Current validation lives in:

- `packages/db/test/store.contract.test.ts` for backend-neutral store behavior.
- `packages/db/test/postgres.contract.test.ts` for real PostgreSQL repository parity slices.
- `packages/db/test/store.concurrency.test.ts` for real PostgreSQL concurrency-sensitive flows.
- `packages/db/test/postgres.test.ts` for current-schema setup/idempotency and concurrent setup checks.
- `apps/server/test/postgresSmoke.test.ts` for a server-level PostgreSQL smoke path using `AGENT_TICK_DATABASE_URL`.
- `packages/db/test/schemaParity.test.ts` for the current SQLite/PostgreSQL table checklist.

The goal remains one Agent Tick store contract with tested relational backends, keeping operational choices declarative while preserving product semantics.
