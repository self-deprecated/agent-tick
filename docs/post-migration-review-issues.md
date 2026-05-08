# Post-migration review issues

This document captures follow-up issues found after the TypeScript-first and Clerk auth migration validation. The migration itself is in a clean, passing state; these items are product-surface consistency, hardening, and polish work.

## Current validated state

- Working copy was clean at review time.
- Latest committed change at review time: `chore(compose): expose optional runtime env`.
- No tracked Go files, `go.mod`, `go.sum`, root `package-lock.json`, or `devbox.lock` remain.
- Active stack:
  - Fastify TypeScript server
  - Svelte admin app
  - Expo mobile app
  - pnpm workspace packages: shared, db, sdk, cli
  - SQLite persistence
  - Optional Clerk human-auth mode

## Validation passed

The following commands passed during the review:

- `docker compose config`
- `corepack pnpm typecheck`
- `corepack pnpm test`
- `corepack pnpm build`
- `corepack pnpm --filter agent-tick-admin check`

Observed test coverage:

- Shared: 6 tests passed
- DB: 19 tests passed
- SDK: 15 tests passed
- CLI: 4 tests passed
- Admin: 13 tests passed
- Server: 27 tests passed
- Mobile: 6 suites / 57 tests passed
- Svelte check: 0 errors / 0 warnings

## High priority

Compatibility-doc status: addressed in `docs/integrations.md`, `examples/mcp/README.md`, `examples/github-actions/approval-gate.yml`, `skills/agent-tick/SKILL.md`, and `integrations/github-actions/request-approval/action.yml`; the incompatible Claude Code hook script was removed.

### Stale docs and examples reference missing CLI/server features

Some docs/examples claim commands or integration surfaces that do not currently exist in the TypeScript CLI/server.

Affected areas:

- `docs/integrations.md` references `agent-tick steer`, `agent-tick adapter`, and `agent-tick mcp`.
- `examples/mcp/README.md` documents `agent-tick mcp` and `agent-tick adapter`.
- `skills/agent-tick/SKILL.md` references `steer`, `adapter`, and broader CLI flags.

Current CLI commands are:

- `setup`
- `request`
- `abandon`
- `guard`

Recommended action: either remove/update these docs and examples, or implement the missing commands intentionally.

### GitHub Actions integration is incompatible with the current CLI

`integrations/github-actions/request-approval/action.yml` calls unsupported CLI flags:

- `--json-events`
- `--expires-in`
- `--requester`
- `--agent-id`
- `--project`
- `--team`
- `--approval-policy`
- `--metadata`

It also fetches `install.sh`, but no `install.sh` exists in the repo.

Recommended action: update the action to match the current CLI, add tests/fixtures for it, or remove it until the integration is rebuilt.

### Claude Code hook is incompatible with the current CLI

`scripts/claude-code-ask-user-question-hook.sh` calls `agent-tick adapter`, but the `adapter` command no longer exists.

Recommended action: update the hook to the current `request`/`guard` flow or remove it until adapter support is intentionally rebuilt.

### Management route authorization may be too broad

Status: addressed for agent token, project, team, policy, and audit routes by requiring organization owner/admin roles.

`requirePrivilegedHuman` still only excludes mobile device auth; management routes that require owner/admin authorization should use the stricter organization-admin guard.

Audited route groups include:

- Agent token management
- Projects
- Teams
- Policies
- Audit listing

Billing and invites already had stronger explicit admin/owner checks.

Recommended action: keep using the stricter organization-admin guard for future management routes unless a route is intentionally self-service/member-readable.

## Medium priority

### CI is less thorough than manual validation

CI currently runs `pnpm typecheck` and `pnpm test`, but manual validation also runs:

- `pnpm build`
- `pnpm --filter agent-tick-admin check`

Root `pnpm typecheck` does not cover Svelte diagnostics because the admin app uses `check`, not `typecheck`.

Recommended action: add build and Svelte check jobs/steps to CI.

### Approval expiration is stored but not actively enforced

`expiresAt` exists in schemas and the database. Retention cleanup can remove old expired approvals if configured, but pending approvals do not appear to automatically transition to `expired` or reject late responses in response/wait flows.

Recommended action: enforce expiration when reading, waiting on, or responding to approval requests, and add tests for late responses.

### Clerk profile lookup happens on every authenticated request

`verifyClerkSession()` verifies the token and then fetches the Clerk user profile for every authenticated request.

Risks:

- Added latency
- Dependency on Clerk API availability for every request
- Clerk API rate-limit exposure

Recommended action: add a short-lived local profile cache keyed by Clerk subject/user ID, while still verifying session tokens locally.

### Docker runtime image can be slimmer

The runtime stage copies the full workspace `node_modules` and package directories from the build stage. This likely includes dev dependencies and source not needed at runtime.

Recommended action: prune production dependencies or build a slimmer runtime package layout.

### Published install story is inconsistent

README/SELFHOSTING mention `npx agent-tick`, but `packages/cli/package.json` is marked `"private": true`.

Recommended action: either prepare/publish the CLI package or change docs to avoid implying npm availability.

## Lower priority / polish

### Notification docs mention unimplemented sinks

`docs/integrations.md` documents Slack, Teams, SMTP, and multiple webhook env vars. Current implementation supports Expo push plus `AGENT_TICK_APPROVAL_NOTIFICATION_WEBHOOK_URL`.

Recommended action: align docs with current support or implement the additional sinks intentionally.

### Additive database migration helpers remain

The database layer still includes additive `ensureColumn(...)` compatibility logic. This is not harmful, but it slightly conflicts with the “fresh TypeScript app, no prototype migration path” messaging.

Recommended action: decide whether to keep this as normal schema evolution support or simplify fresh-app initialization.

### Event tickets are reusable until expiry

Current event stream tickets are short-lived opaque tickets, satisfying the requirement to avoid bearer tokens in query strings. However, they are reusable until expiry.

Recommended action: consider one-use or stream-bound tickets if stricter replay resistance is desired.

### Rate limiting is in-memory and per-process

This is fine for self-hosted/single-node deployments, but hosted/multi-instance deployments need distributed backing.

Recommended action: add Redis or another distributed rate-limit backend before multi-instance hosted deployment.

### Admin bundle has a large Clerk chunk warning

The admin production build passes, but Vite warns about a large Clerk chunk of roughly 1.46 MB.

Recommended action: perform bundle analysis and consider further code splitting if admin load time becomes an issue.

### Local ignored artifacts exist

Local ignored artifacts such as `agent-tick.db`, WAL/SHM files, `node_modules`, and build outputs may exist in working directories. They are ignored/untracked and are not a repository cleanliness issue.

Recommended action: none required, beyond occasional local cleanup if desired.
