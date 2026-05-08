# TypeScript-First Rewrite Plan

## Status

Decision: pivot to a TypeScript-first architecture before implementing Clerk.

This project is still in the shaping phase and has no production users. We can therefore optimize for the desired long-term architecture instead of preserving every current Go implementation detail or database migration path.

## Executive summary

Replace the current Go CLI/server with:

- a TypeScript Node server distributed primarily as a Docker image
- a lean npm-installable agent CLI
- shared TypeScript schemas and API client packages used by the CLI, Svelte admin app, and Expo app
- the existing Svelte admin app served as static assets by the Node server
- the existing Expo mobile app, updated to use the shared SDK and Clerk Expo auth

Keep:

- SQLite as the server-owned persistence layer
- the Svelte admin app as a SPA
- the Expo mobile app
- Agent Tick-owned users, organizations, teams, projects, policies, devices, agent tokens, approvals, billing limits, and audit logs
- Clerk as human identity provider only

Drop/rethink:

- Go as the main implementation language
- the server command inside the agent CLI
- local multi-user email/password auth
- Go-specific Clerk middleware/integration work
- database compatibility with the current prototype schema unless a table/shape is clearly worth copying

## Why this pivot makes sense

The original Go choice was mostly about easy single-binary distribution. That advantage matters less if:

- the server is distributed and run primarily as a container
- agents typically run in Node/npm-centric environments
- the CLI can be installed through `npm`, `npx`, `pnpm dlx`, or bundled by agent packages
- Clerk integration, admin UI, mobile UI, and typed API contracts all benefit from TypeScript

A TypeScript-first architecture reduces language boundaries across the project. The same schemas, API client, auth token plumbing, and request/response types can be shared by server, CLI, admin, and mobile.

## Non-goals

- Do not preserve Go CLI/server compatibility for its own sake.
- Do not maintain the current local multi-user password/session-cookie auth path.
- Do not make Clerk required for single-user self-hosted mode.
- Do not move Agent Tick authorization or app data into Clerk.
- Do not adopt Clerk Organizations as the Agent Tick organization source of truth in the first pass.
- Do not require database migrations from the current prototype unless we later decide to support early testers.
- Do not put SQLite/server-only dependencies in mobile/admin/CLI packages.

## Target repository layout

Long-term layout:

```text
apps/
  server/             # TypeScript Fastify API server + static admin asset host
  admin/              # Svelte/Vite SPA
  mobile/             # Expo app

packages/
  cli/                # npm package with `agent-tick` bin for agents
  sdk/                # environment-neutral typed HTTP client
  shared/             # Zod schemas, TypeScript types, constants
  db/                 # server-only SQLite migrations and repository helpers
  config/             # optional shared env/config parsing helpers
```

Transition status:

```text
apps/
  server/             # TypeScript Fastify API server + static dashboard host
```

The Go implementation has been removed from the active tree. The TypeScript server now lives at `apps/server`, and Docker, Compose, CI, and docs point at that path.

## Tooling decisions

### Package manager

Use pnpm workspaces for development.

Reasons:

- strict dependency boundaries
- fast installs
- good monorepo ergonomics
- packages can still be published to npm normally

Add:

```text
pnpm-workspace.yaml
package.json
packageManager field
```

### Runtime

Use the current Node LTS line, pinned through repo tooling and Docker.

Example:

```text
Node 24 LTS or current active LTS
```

Pin with one of:

- `.nvmrc`
- Volta fields in `package.json`
- Docker base image tag

### TypeScript/build/test

Recommended defaults:

- TypeScript strict mode
- ESM packages
- `tsup` for CLI/server package builds
- `tsx` for local dev scripts
- `vitest` for unit/integration tests
- `zod` for runtime API validation and inferred types
- `undici`/native `fetch` APIs where possible

### Server framework

Use Fastify.

Recommended dependencies:

- `fastify`
- `@fastify/static`
- `@fastify/websocket` if we keep WebSockets
- `@clerk/backend`
- `better-sqlite3`
- `zod`

Why Fastify instead of SvelteKit:

- this product is primarily an API server with a static dashboard
- WebSocket/event endpoints are straightforward
- Docker/container deployment is simple
- it stays close to the current architecture
- SvelteKit SSR/routing is not needed yet

SvelteKit can be reconsidered later if the admin app needs SSR or richer web-app routing.

## Distribution model

### Server

Official distribution: Docker image.

The container runs:

```sh
node apps/server/dist/index.js
```

or a small package binary such as:

```sh
agent-tick-server serve
```

The server image contains:

- compiled Fastify server
- built Svelte admin assets
- production Node dependencies
- SQLite native dependency support

Use a Debian/Ubuntu-based Node image, not Alpine, to reduce native SQLite friction:

```Dockerfile
node:24-bookworm-slim
```

Runtime data lives in:

```text
/data/agent-tick.db
```

### CLI

Official distribution: npm.

Preferred package:

```text
agent-tick
```

Fallback if the name is unavailable:

```text
@agent-tick/cli
```

The binary name remains:

```sh
agent-tick
```

Install/run examples:

```sh
npx agent-tick request --title "Deploy to production?"
npm install -g agent-tick
agent-tick request --title "Deploy to production?"
pnpm dlx agent-tick request --title "Deploy to production?"
```

The CLI package must stay lean:

- no SQLite
- no Fastify
- no Clerk backend package
- no Svelte/mobile dependencies
- only shared schemas, SDK, argument parsing, and small Node utilities

## Product/auth modes

Simplify to two modes.

### `single`

Local self-hosted mode.

- no Clerk required
- one implicit local user/org or locally bootstrapped admin context
- dashboard protected by localhost fallback and/or admin bearer token
- QR phone pairing exchanges short-lived pairing code for long-lived device token
- mobile can use device token
- agents use Agent Tick agent tokens

### `clerk`

Multi-user mode with Clerk as human identity provider.

- Clerk authenticates dashboard/mobile humans
- server verifies Clerk session JWTs
- Agent Tick maps Clerk `sub` to local `usr_...` via `auth_identities`
- Agent Tick local organizations remain authoritative
- agents still use Agent Tick agent tokens
- device tokens are not used as human identity secrets
- QR codes are server/org discovery and device registration hints, not auth secrets

Recommended env:

```sh
AGENT_TICK_MODE=single|clerk
AGENT_TICK_PUBLIC_URL=https://tick.example.com
AGENT_TICK_DATABASE_URL=file:/data/agent-tick.db

# single mode
AGENT_TICK_ADMIN_TOKEN=...

# clerk mode
AGENT_TICK_CLERK_PUBLISHABLE_KEY=pk_...
AGENT_TICK_CLERK_SECRET_KEY=sk_...
AGENT_TICK_CLERK_AUTHORIZED_PARTIES=https://tick.example.com,http://localhost:8787
```

Do not carry forward the local `user+local` password mode unless a future product need appears.

## Clerk integration model

The Clerk decisions from `docs/clerk-auth-migration.md` still apply, but implementation should be TypeScript-native.

Use:

- server: `@clerk/backend`
- admin: `@clerk/clerk-js`
- mobile: `@clerk/expo`

Human API calls use Clerk session tokens:

```ts
await getToken()
```

not custom JWT templates.

Server maps identity by:

```text
provider = "clerk"
issuer = token.iss
subject = token.sub
```

to a local Agent Tick user:

```text
usr_...
```

Do not replace local user IDs with Clerk `user_...` IDs.

Profile policy:

- fetch Clerk Backend User on first login/profile refresh
- require verified primary email for first pass
- store minimal local profile cache: email, email verified flag, display name
- reject unsafe collisions with existing unmapped local users
- do not trust client-supplied email/name fields

## Database plan

Keep SQLite, but start with a clean schema.

Recommended implementation:

- `better-sqlite3` for the driver
- SQL migration files under `packages/db/migrations`
- explicit repository/store functions for authorization-sensitive queries
- optional Kysely later if query typing becomes valuable, but do not start with a heavy ORM

### Migration runner

Add a simple migration table:

```sql
CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL
);
```

Migrations should be:

- ordered
- idempotent where practical
- run automatically at server startup
- runnable through a server maintenance command/script for debugging

### Core tables

First-pass schema should cover:

```text
users
  id usr_...
  email
  email_verified
  name
  created_at
  updated_at

auth_identities
  provider
  issuer
  subject
  user_id
  email
  email_verified
  name
  first_seen_at
  last_seen_at
  updated_at
  unique(provider, issuer, subject)

organizations
  id org_...
  name
  created_at
  updated_at

organization_memberships
  organization_id
  user_id
  role
  created_at
  updated_at
  unique(organization_id, user_id)

projects
teams
team_memberships
policies
agent_tokens
approval_requests
approval_choices
approval_responses
audit_events
devices
pairing_codes
event_tickets
```

Start with the minimum tables needed for the vertical slice, then add teams/projects/policies/invites as their product flows are rebuilt.

### IDs

Keep readable prefixed IDs:

```text
usr_...
org_...
prj_...
team_...
req_...
dev_...
atk_... or agent_...
```

Use cryptographically strong randomness. Do not use sequential public IDs for sensitive resources.

### Secrets at rest

Hash all opaque tokens before storing:

- agent tokens
- device tokens
- pairing codes
- event tickets

Use constant-time comparison for token verification.

Do not store Clerk session tokens.

## API design

Use JSON REST endpoints with runtime validation from `packages/shared` schemas.

Standard response/error shape:

```json
{
  "error": {
    "code": "not_authenticated",
    "message": "Authentication required",
    "requestId": "reqlog_..."
  }
}
```

All handlers should have:

- request ID
- structured logging
- schema validation
- typed response body
- explicit auth requirements

### Initial route set

Health/config:

```http
GET /healthz
GET /v1/auth/config
GET /v1/me
```

Approvals:

```http
POST /v1/approval-requests
GET /v1/approval-requests
GET /v1/approval-requests/:id
POST /v1/approval-requests/:id/respond
POST /v1/approval-requests/:id/abandon
GET /v1/approval-requests/:id/wait
```

Agent tokens:

```http
POST /v1/agent-tokens
GET /v1/agent-tokens
POST /v1/agent-tokens/:id/revoke
```

Organizations:

```http
GET /v1/organizations
POST /v1/organizations
GET /v1/organizations/:id/members
```

Devices/pairing:

```http
POST /v1/devices/pair              # single mode only
POST /v1/devices/register          # clerk mode human auth
POST /v1/devices/:id/push-token
POST /v1/devices/:id/unregister
```

Events:

```http
POST /v1/events/ticket
GET /v1/events?ticket=...
```

The exact path names can change, but auth semantics should be explicit per route.

## Authorization model

Define a server auth context like:

```ts
type AuthContext = {
  source: 'loopback' | 'admin' | 'agent' | 'device' | 'clerk' | 'eventTicket'
  isHuman: boolean
  userId?: string
  organizationId?: string
  role?: 'owner' | 'admin' | 'member' | 'viewer'
  agentTokenId?: string
  deviceId?: string
  provider?: 'clerk'
  providerIssuer?: string
  providerSubject?: string
  sessionId?: string
}
```

Credential precedence:

1. public endpoints
2. single-mode loopback/admin token
3. agent tokens
4. single-mode device tokens
5. Clerk bearer session tokens in `clerk` mode
6. event tickets only on event routes
7. reject

Agent/device/admin tokens are opaque. Clerk tokens are JWTs. Avoid running expensive Clerk verification for obvious opaque token prefixes.

### Organization selection

Use local Agent Tick organization selection:

```http
X-Agent-Tick-Organization-ID: org_...
```

Behavior:

- if present, validate membership and set auth org/role
- if absent, use default/personal org
- never trust Clerk active organization claims for Agent Tick authorization in the first pass

## Shared packages

### `packages/shared`

Contains only environment-neutral code:

- Zod schemas
- inferred TypeScript request/response types
- enum/constants
- ID prefix helpers
- API error codes

No Node-only APIs, no React, no Svelte, no SQLite.

### `packages/sdk`

Typed HTTP client used by:

- CLI
- admin
- mobile
- tests

Design:

```ts
type TokenProvider = () => Promise<string | null>

type AgentTickClientOptions = {
  baseUrl: string
  tokenProvider?: TokenProvider
  organizationIdProvider?: () => string | null | Promise<string | null>
  fetch?: typeof fetch
}
```

Responsibilities:

- attach `Authorization: Bearer ...` when token provider returns a token
- attach selected organization header
- validate responses with shared schemas
- expose useful typed methods, not raw route strings everywhere
- support retry hooks for Clerk token refresh where appropriate

Do not make SDK depend on Clerk directly. Clerk token retrieval belongs to admin/mobile integrations.

### `packages/db`

Server-only package.

Contains:

- migrations
- migration runner
- SQLite connection setup
- repositories/stores
- test DB helpers

Must not be imported by CLI/admin/mobile.

### `packages/cli`

Agent-facing npm CLI.

Recommended dependencies:

- `commander` or `clipanion`
- `packages/sdk`
- `packages/shared`

Commands to keep first:

```sh
agent-tick setup
agent-tick request
agent-tick abandon
agent-tick guard
```

Commands to port later if still product-relevant:

```sh
agent-tick adapter
agent-tick mcp
agent-tick steer
```

Commands to remove from the agent CLI:

```sh
agent-tick server
agent-tick maintenance
agent-tick agent-token
```

Those belong to the server container/dashboard/operator tooling, not the agent CLI.

## Server package design

Suggested internal layout:

```text
apps/server/src/
  index.ts                 # process entrypoint
  config.ts                # env parsing and validation
  app.ts                   # Fastify app factory
  plugins/
    db.ts
    auth.ts
    staticAdmin.ts
    logging.ts
  routes/
    health.ts
    authConfig.ts
    me.ts
    approvalRequests.ts
    agentTokens.ts
    organizations.ts
    devices.ts
    events.ts
  services/
    clerkIdentity.ts
    approvalService.ts
    eventBus.ts
    notifier.ts
    retention.ts
  auth/
    verifyAgentToken.ts
    verifyDeviceToken.ts
    verifyClerkSession.ts
    requireAuth.ts
  test/
    appHarness.ts
```

Server startup:

1. parse config
2. open SQLite
3. run migrations
4. initialize services
5. register routes/plugins
6. serve API and static admin assets

Server should be constructible in tests without opening a real port.

## Admin app plan

Keep Svelte/Vite.

Changes:

- consume `packages/sdk`
- consume `packages/shared` types/schemas where useful
- fetch `GET /v1/auth/config` at boot
- in `single` mode, show existing/simple admin-token UI
- in `clerk` mode, initialize `@clerk/clerk-js`
- mount Clerk sign-in/user controls via Clerk JS DOM APIs
- pass async `clerk.session?.getToken()` to the SDK token provider
- send selected local organization ID through SDK organization provider

Dev mode:

- Vite dev server can proxy `/v1` to local Fastify server
- or admin can read `VITE_AGENT_TICK_API_BASE`

Production:

- server serves built `apps/admin/dist`
- SPA fallback routes to `index.html`

## Mobile app plan

Keep Expo.

Changes:

- consume `packages/sdk` where React Native-compatible
- add `@clerk/expo`
- add `expo-secure-store`
- fetch server runtime config after user enters/scans server URL
- initialize/remount `ClerkProvider` using returned publishable key
- namespace Clerk token cache by server URL/publishable key
- in `clerk` mode, get API token via `useAuth().getToken()`
- support Clerk email/password sign-in, email-code account creation, and OAuth SSO buttons via Expo AuthSession/WebBrowser before broader provider-specific polish
- in `single` mode, preserve existing QR/device-token pairing
- add Clerk-mode device registration for push tokens
- on sign-out/server switch, best-effort unregister current push/device association

## Events and waiting strategy

For the first vertical slice, prefer simple HTTP waiting/polling over complex streaming.

CLI request flow:

1. CLI creates approval request.
2. CLI calls `GET /v1/approval-requests/:id/wait?timeout=...`.
3. Server waits in memory with DB fallback and returns terminal result or timeout.
4. CLI repeats if needed.

Dashboard/mobile can initially poll pending approvals.

Current TypeScript support includes short-lived event tickets, SSE `ready`/`audit` events, SDK helpers for creating stream URLs or opening an injectable `EventSource`, dashboard EventSource refresh wiring, and configurable retention cleanup for operational history. Mobile EventSource/SSE wiring can be enabled where polling becomes insufficient.

Recommended event streaming design:

```http
POST /v1/events/ticket
Authorization: Bearer <human/agent/device token>

GET /v1/events?ticket=<short-lived opaque ticket>
```

Reasons:

- browser WebSocket/EventSource custom headers are awkward
- Clerk session tokens are short-lived
- query-string Clerk JWTs should not be used directly
- tickets can be scoped, short-lived, and opaque

## Docker plan

Multi-stage build outline:

1. install pnpm dependencies
2. build shared packages
3. build admin SPA
4. build server
5. produce runtime image with production dependencies, server dist, admin dist

Runtime image:

- based on `node:24-bookworm-slim` or current LTS slim
- non-root user
- `/data` volume
- exposes `8787`
- healthcheck hits `/healthz`

Environment:

```sh
AGENT_TICK_MODE=single|clerk
AGENT_TICK_PUBLIC_URL=https://tick.example.com
AGENT_TICK_DATABASE_URL=file:/data/agent-tick.db
AGENT_TICK_ADMIN_TOKEN=...
AGENT_TICK_CLERK_PUBLISHABLE_KEY=pk_...
AGENT_TICK_CLERK_SECRET_KEY=sk_...
AGENT_TICK_CLERK_AUTHORIZED_PARTIES=https://tick.example.com
```

Compose should no longer reference the Go binary.

## Rewrite phases

### Phase 0: Confirm decisions and freeze Go implementation

Deliverables:

- this plan committed
- agree on Fastify, pnpm, SQLite driver, auth modes, and CLI distribution
- stop adding significant new features to the Go server unless needed as reference

Acceptance criteria:

- team agrees TypeScript server/CLI is the new target
- Clerk implementation work targets TypeScript, not Go

### Phase 1: Monorepo foundation

Deliverables:

- pnpm workspace
- base TypeScript config
- test runner setup
- package boundaries
- lint/format scripts if desired
- empty `packages/shared`, `packages/sdk`, `packages/db`, `packages/cli`
- `apps/server` Fastify skeleton

Acceptance criteria:

- `pnpm install` works
- `pnpm typecheck` works
- `pnpm test` runs
- `apps/server` can return `GET /healthz`

### Phase 2: Shared schemas and SDK skeleton

Deliverables:

- shared API error schema
- auth config schema
- approval request/response schemas
- SDK client with async token provider
- SDK tests using mocked fetch

Acceptance criteria:

- admin/mobile/CLI can import SDK without Node-only dependency errors
- response validation catches malformed server responses

### Phase 3: Database package and migrations

Deliverables:

- SQLite connection helper
- migration runner
- initial schema for users/orgs/agent tokens/approval requests/audit events
- repository/store tests with temporary DBs

Acceptance criteria:

- migrations run on empty DB
- migrations are idempotent enough for repeated startup
- core repository tests pass

### Phase 4: Server core vertical slice in `single` mode

Deliverables:

- config parsing
- Fastify app factory
- auth middleware for loopback/admin and agent tokens
- create/list/respond/wait approval APIs
- audit event writes
- static admin placeholder or existing admin build serving

Acceptance criteria:

- server starts in `single` mode without Clerk config
- an agent token can create an approval request
- a human/admin can approve/reject it
- waiting client receives terminal result
- tests cover auth success/failure and approval lifecycle

### Phase 5: npm CLI MVP

Deliverables:

- `packages/cli` with `agent-tick` bin
- `setup` command saves server URL and agent token
- `request` command creates request and waits for result
- `abandon` command if needed by agent workflows
- basic JSON output mode for agents

Acceptance criteria:

- `pnpm --filter agent-tick-cli build` produces executable CLI
- local `npx`/linked CLI can create a request against the TypeScript server
- CLI package does not depend on server/db/admin/mobile packages

### Phase 6: Admin app integration

Deliverables:

- admin uses SDK for API calls
- admin fetches runtime config
- single-mode admin token flow works
- admin can list/respond to approvals using TypeScript server
- server serves built admin assets

Acceptance criteria:

- local dashboard can approve a CLI-created request
- production server image can serve dashboard and API from one origin

### Phase 7: Clerk mode server/admin

Deliverables:

- Clerk config validation
- `@clerk/backend` session verification
- `auth_identities` table/repository
- Clerk user profile sync
- `/v1/auth/config`
- `/v1/me`
- admin Clerk JS sign-in
- SDK async Clerk token provider

Acceptance criteria:

- server starts in `clerk` mode only with valid Clerk config
- signed-in dashboard user maps to stable local `usr_...`
- invalid/expired/wrong-origin Clerk tokens are rejected
- local organization selection works
- no local password/session-cookie path exists

### Phase 8: Mobile integration

Deliverables:

- mobile consumes runtime auth config
- mobile uses SDK where compatible
- single-mode pairing preserved
- Clerk Expo auth added
- Clerk-mode device registration added
- push token association by authenticated local user

Acceptance criteria:

- single-mode QR pairing still works
- Clerk-mode mobile sign-in can list/respond to approvals
- push token registration does not leak between users/server tenants

### Phase 9: Events/notifications

Deliverables:

- event ticket endpoint
- event stream endpoint or polling improvements
- mobile/admin event subscription
- notification service ported/rethought; current TypeScript server supports Expo push and an optional approval notification webhook
- retention cleanup service/script

Acceptance criteria:

- dashboard/mobile update without excessive polling
- Clerk JWTs are not placed directly in event query strings
- cleanup can run automatically or as an operator command; current TypeScript server runs configurable startup/hourly cleanup for old completed/expired approvals, audit events, unregistered devices, and expired/revoked invites without acceptance history

### Phase 10: Port remaining product features intentionally

Inventory each current Go feature and decide keep/drop/redesign.

Likely keep:

- approval choices/freeform responses
- project/team/policy concepts, including team-scoped approval responder eligibility
- agent token management
- invites, if multi-user onboarding still needs them with Clerk
- audit logs
- mobile push notification registration
- MCP/adapter/guard flows if agent use cases need them

Likely drop from CLI/server split:

- `server` command in agent CLI
- local multi-user password login
- Go maintenance command shape

Acceptance criteria:

- all features needed for the next product milestone exist in TS
- obsolete Go-era flows are removed from docs/UI

### Phase 11: Delete Go implementation

Deliverables:

- remove Go `apps/server` or move to archived branch
- keep `apps/server` as the TypeScript server path
- remove Go Dockerfile/build docs
- update `docker-compose.yml`
- update `SELFHOSTING.md`
- update Clerk migration doc to remove Go-specific implementation steps

Acceptance criteria:

- repository builds without Go installed
- server Docker image builds from TypeScript workspace
- CLI installs/runs through npm package build

## Current Go feature inventory

Use the Go implementation as reference, not as a strict compatibility target.

| Current area | New plan |
| --- | --- |
| `agent-tick server` | Remove from agent CLI; server has its own package/container entrypoint. |
| `agent-tick setup` | Keep in npm CLI for saving server URL/agent token. |
| `agent-tick request` | Keep; core agent workflow. |
| `agent-tick guard` | Keep if guard workflow remains important. |
| `agent-tick abandon` | Keep if long-running agent requests need cleanup. |
| `agent-tick steer` | Re-evaluate; port later if still needed. |
| `agent-tick pair` | Re-evaluate; pairing should mostly live in dashboard/mobile. |
| `agent-tick agent-token` | Remove from agent CLI; manage through dashboard/API/operator tooling. |
| `agent-tick maintenance` | Replace with server startup cleanup, scheduled cleanup, or server maintenance script. |
| local email/password users | Drop. Clerk is multi-user human auth. |
| session cookie + CSRF | Drop unless needed for a future non-Clerk auth provider. |
| admin static embedding in Go | Replace with server serving built admin assets from filesystem/container. |
| Go WebSocket auth | Replace with event tickets/polling-first design. |

## Testing strategy

### Package tests

- shared schemas validate expected payloads
- SDK attaches auth/org headers and validates errors
- DB repositories enforce authorization constraints
- CLI command parsing and request behavior with mocked server

### Server tests

Use Fastify app injection where possible.

Cover:

- health/config
- mode validation
- admin/loopback auth
- agent token auth
- Clerk token verification with test keys/mocks
- approval lifecycle
- org membership checks
- device pairing/registration
- event ticket issuance/use
- audit event writes

### Integration tests

- CLI against in-process/test server
- admin built assets served by server
- SQLite migration on fresh temp DB
- Docker image smoke test if CI permits

### Mobile tests

- runtime config discovery
- token provider wiring
- single-mode pairing state
- Clerk-mode signed-out blocking
- device/push registration state transitions

## Documentation updates required

Update or create:

- `SELFHOSTING.md`
- `docker-compose.yml` comments/envs
- Clerk/BYO Clerk setup docs
- CLI README/package docs
- API/auth docs
- mobile setup docs

`docs/clerk-auth-migration.md` should remain useful for Clerk product/security decisions, but after the rewrite begins it should be edited to remove Go-specific implementation details and reference this TypeScript-first plan.

## Risks and mitigations

### Loss of single-binary distribution

Risk: users who want `curl | run one binary` self-hosting lose that path.

Mitigation:

- make Docker the official self-hosted path
- optionally provide Node package or prebuilt server bundle later
- do not optimize for this before product-market fit

### npm supply-chain surface

Risk: more dependencies and transitive packages.

Mitigation:

- keep CLI dependency graph small
- avoid heavy server dependencies unless needed
- pin lockfile
- use dependency review/audit in CI later

### Native SQLite friction

Risk: `better-sqlite3` native builds can be painful across platforms.

Mitigation:

- server is Docker-first
- use Debian slim image, not Alpine
- keep SQLite dependency out of CLI
- consider `node:*-bookworm-slim` with prebuild-friendly environment

### Runtime blocking from synchronous SQLite

Risk: `better-sqlite3` is synchronous and can block Node under high concurrency.

Mitigation:

- expected load is low/moderate for approval workflows
- use short transactions and indexes
- move heavy cleanup to scheduled tasks
- revisit worker thread/async driver/Postgres if scale demands it

### Monorepo dependency leaks

Risk: mobile/admin accidentally import server-only code.

Mitigation:

- strict package boundaries
- workspace dependency rules
- conditional exports
- tests/typechecks for each package

### Clerk coupling

Risk: multi-user mode becomes Clerk-specific.

Mitigation:

- keep auth provider mapping table generic
- keep local Agent Tick authorization/data independent
- keep SDK independent of Clerk
- revisit generic OIDC only when real demand appears

## Decisions still worth confirming before coding

1. Package manager: pnpm workspaces is recommended.
2. Server framework: Fastify is recommended.
3. SQLite layer: `better-sqlite3` + explicit repositories is recommended.
4. CLI parser: `commander` is sufficient unless we want a richer command framework.
5. Event strategy: polling-first, event tickets later is recommended.
6. Whether to start in a temporary TypeScript server directory or delete Go upfront. Completed: the active server path is now `apps/server`.

## Definition of done for the rewrite

The rewrite is complete when:

- no Go toolchain is required to build or run the project
- Docker image runs the TypeScript server and serves the admin SPA
- npm CLI can create and wait for approval requests
- dashboard can approve/reject requests
- single mode works without Clerk
- Clerk mode works for dashboard and mobile humans
- Agent Tick still owns orgs, policies, tokens, devices, approvals, and audit logs
- docs describe the new install/development/auth flows
