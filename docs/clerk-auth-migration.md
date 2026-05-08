# Clerk Auth Migration

## Goal

Move multi-user human authentication to Clerk while preserving the single-user self-hosted flow.

Clerk authenticates people. Agent Tick continues to own authorization and product data: local users, local organizations, memberships, teams, projects, policies, approvals, agent tokens, devices, billing limits, and audit logs. This is a fresh TypeScript service; no Go-era or prototype compatibility path is required.

This document now tracks the TypeScript-first implementation. See also `docs/typescript-first-rewrite-plan.md`.

## Non-goals

- Do not require Clerk for default single-user self-hosting.
- Do not replace Agent Tick agent tokens used by CLIs/agents.
- Do not move approval, policy, project, team, device, or audit data into Clerk.
- Do not adopt Clerk Organizations as Agent Tick's authorization source in the first pass.
- Do not build generic OIDC/SAML support until there is clear demand.
- Do not store Clerk session tokens or Clerk secrets in SQLite.
- Do not require Clerk JWT templates for Agent Tick API auth.

## Key decisions

1. **Use Clerk session tokens for Agent Tick API calls.**
   - Browser/mobile call `getToken()`.
   - The server verifies Clerk session JWTs.
   - Avoid `getToken({ template })` for normal Agent Tick API calls.

2. **Keep Agent Tick local user IDs (`usr_...`).**
   - Clerk `sub` (`user_...`) maps through `auth_identities`.
   - Agent Tick local IDs remain the primary keys for app data.

3. **Map Clerk identity by `(provider, issuer, subject)`.**
   - `provider = 'clerk'`
   - `issuer = token.iss`
   - `subject = token.sub`

4. **Fetch profile data with the Clerk Backend API.**
   - Require a verified primary email in the first pass.
   - Cache only minimal local profile data: verified email and display name.
   - Do not trust client-supplied email/name claims.

5. **Keep Agent Tick organizations local.**
   - Ignore Clerk active organization claims for authorization.
   - Use `X-Agent-Tick-Organization-ID` for local organization selection.

6. **Split phone behavior by mode.**
   - `single`: QR pairing exchanges a short-lived pairing code for a long-lived Agent Tick device token.
   - `clerk`: mobile signs in with Clerk; QR/server discovery does not act as an auth secret.

## Product modes

### `single`

Self-hosted single-user mode.

- No Clerk required.
- One implicit local user/org is bootstrapped.
- Dashboard is protected by admin bearer token or localhost fallback.
- Mobile can pair with a short-lived pairing code and then use an Agent Tick device token.
- Agents use Agent Tick agent tokens.

### `clerk`

Multi-user mode with Clerk as the human identity provider.

- Dashboard users sign in with Clerk JS.
- Mobile users sign in with Clerk Expo.
- Browser/mobile API calls send `Authorization: Bearer <Clerk session token>`.
- Server verifies Clerk session JWTs and maps Clerk users to local `usr_...` users.
- Agent Tick organizations, approvals, devices, agent tokens, billing, and audit logs remain local SQLite data.
- Agent tokens continue to authorize CLI/agent requests.
- Device tokens are not human identity secrets in Clerk mode.

## Configuration

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

# optional networkless verification key
AGENT_TICK_CLERK_JWT_KEY=-----BEGIN PUBLIC KEY-----...
```

Runtime public config endpoint:

```http
GET /v1/auth/config
```

Response shape:

```json
{
  "mode": "clerk",
  "authProvider": "clerk",
  "clerkPublishableKey": "pk_...",
  "publicURL": "https://tick.example.com"
}
```

The endpoint must never expose secret keys.

## Auth credential precedence

The TypeScript server should not wrap all routes in Clerk-required middleware because Agent Tick also accepts local opaque tokens.

Recommended order:

1. Public endpoints:
   - `GET /healthz`
   - `GET /v1/auth/config`
   - static admin assets
   - single-mode `/v1/devices/pair`
2. Single-mode admin bearer token.
3. Agent tokens (`agent_...`) in all modes.
4. Single-mode device tokens (`device_...`).
5. Single-mode localhost fallback only when no bearer token is present and no admin token is configured.
6. Clerk bearer session JWTs in `clerk` mode.
7. Event tickets only on event-stream routes.
8. Otherwise reject with 401.

Invalid bearer tokens should not silently fall back to localhost/admin behavior.

## Auth context semantics

Server auth context should distinguish credential source and human/agent status:

```ts
type AuthContext = {
  source: 'loopback' | 'admin' | 'agent' | 'device' | 'clerk'
  isHuman: boolean
  userId?: string
  organizationId: string
  role?: string
  agentId?: string
  deviceId?: string
  provider?: 'clerk'
  providerIssuer?: string
  providerSubject?: string
  sessionId?: string
}
```

Authorization should use `isHuman` and route-specific privilege checks rather than assuming all bearer tokens are equivalent.

## Local organization selection

Use Agent Tick's local organization ID header:

```http
X-Agent-Tick-Organization-ID: org_...
```

Behavior:

- If present, validate the authenticated human's local membership.
- If absent, use the user's default/personal local organization.
- Never trust Clerk organization claims for Agent Tick authorization in the first pass.
- Dashboard stores the selected organization and sends it through the SDK organization provider.

## Implemented TypeScript status

Implemented so far:

- TypeScript/Fastify server with SQLite store and migrations.
- `single` and `clerk` runtime modes.
- Public `/healthz` and `/v1/auth/config`.
- Clerk session verification with `@clerk/backend`.
- Clerk Backend User profile sync into local users and `auth_identities`.
- Verified primary email requirement and safe email-collision behavior.
- Local organization creation, selection, membership validation, and member listing.
- Project, team, policy foundations, basic quorum approval policy handling, and team-scoped approval responder eligibility with dashboard management.
- Team member add/update/remove APIs and dashboard management for local organization members.
- Organization invite create/list/preview/accept/revoke APIs with hashed invite tokens, email/domain restrictions, pending membership self-status, revoked-invite request visibility, pending membership approval/rejection, invite team assignment, and dashboard invite/member-request management.
- Approval request create/list/get/respond/abandon/wait APIs with local-organization scoping on detail and mutation routes.
- Agent token create/list/revoke APIs, including optional project/team/default-policy scoping and owning-agent abandon checks.
- Single-mode mobile pairing and device-token auth.
- Clerk-mode device registration and push token APIs, plus optional approval notification webhooks in addition to mobile push.
- Short-lived opaque event tickets for event streams, SSE audit-event streaming, SDK stream URL/EventSource helpers, and startup/hourly cleanup for expired tickets and pairing codes.
- Configurable startup/hourly retention cleanup for old completed/expired approvals, audit events, unregistered devices, and expired/revoked invites without acceptance history.
- Mobile Clerk runtime discovery, ClerkProvider sign-in/account-creation wiring with email-code verification, and OAuth SSO provider buttons using Expo AuthSession/WebBrowser.
- Mobile local organization selection for Clerk-mode multi-org users, with server-scoped local storage for selected organization/device state.
- Best-effort Clerk-mode mobile device unregister on sign-out/server switch, plus local state cleanup for server changes.
- Mobile heartbeat and availability APIs.
- Mobile uses the shared SDK for organization discovery, approval list/respond, presence, and device pair/register/unregister/push flows.
- Audit-event table, event recording, route, SDK method, and dashboard display.
- Local billing seat usage for active vs pending members, optional `AGENT_TICK_MAX_ACTIVE_MEMBERS` enforcement, SDK method, and dashboard display.
- Optional invite email webhook delivery/resend owned by Agent Tick, including delivery audit state and resend token rotation.
- SDK token provider and organization provider support.
- Svelte dashboard Clerk sign-in, invite preview/continuation, local organization selector, token management, audit view, pairing code UI, and ticketed EventSource refreshes.
- Docker image build for the TypeScript server plus static Svelte admin assets.
- Initial in-memory rate limits for auth-sensitive token endpoints.

## Remaining work

High priority:

- Broaden mobile provider-specific OAuth/deep-link coverage beyond the built-in Google/GitHub SSO buttons.
- Broaden mobile provider/runtime coverage for ticketed EventSource/SSE listeners; the Expo app now feature-detects EventSource, subscribes with short-lived tickets when available, and keeps polling as the fallback.
- Broaden signed-out invite continuation coverage with deep-link/OAuth provider-specific tests.

Future product work to evaluate for the current architecture:

- Richer team role/eligibility management beyond basic add/update/remove and team-scoped approval eligibility.
- Policy templates and richer multi-step eligibility/routing policy engine.
- Notification delivery polish beyond mobile push and the current generic approval webhook.
- MCP/adapter/guard integrations that still fit the npm CLI model.
- Hosted-service billing portals, plan sync, and operator tooling beyond the current local seat guard.
- SMTP/provider-specific invite email templates and retry tooling beyond the current webhook handoff.

Operational hardening:

- Configurable/distributed rate limits for hosted deployments.
- Continue audit/authorization coverage review for all mutable routes.
- Docker release workflow and published npm CLI package.
- Broaden mobile Jest/Expo coverage now that the pnpm harness runs in the workspace test suite.
