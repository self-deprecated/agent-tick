# Implementation Task: Clerk Auth Migration

> Note: the implementation phases in this document were drafted for the original Go server. The project direction has since shifted to a TypeScript-first rewrite; see `docs/typescript-first-rewrite-plan.md`. The Clerk product/security decisions here still apply, but Go-specific implementation details should be translated into the TypeScript server/admin/mobile architecture before coding.

## Goal

Move multi-user human authentication to Clerk while preserving the current single-user self-hosted flow.

Clerk authenticates people. Agent Tick continues to own application authorization and data: approval requests, agent tokens, devices, projects, local organizations, teams, policies, billing limits, and audit logs.

## Non-goals

- Do not require Clerk for default single-user self-hosting.
- Do not replace agent tokens used by CLIs/agents.
- Do not move approval, policy, project, team, device, or audit data into Clerk.
- Do not adopt Clerk Organizations as the source of truth in the first pass; keep Agent Tick organizations local.
- Do not build generic OIDC/SAML support until there is clear demand.
- Do not store Clerk session tokens or Clerk secrets in SQLite.

## Clerk facts this plan relies on

Verified from Clerk docs/CLI before implementation:

- Clerk session tokens are JWTs intended for authenticating requests to our backend.
- Default Clerk session token claims include:
  - `sub`: Clerk user ID, e.g. `user_...`
  - `sid`: Clerk session ID
  - `iss`: Clerk Frontend API URL / issuer
  - `azp`: authorized party/origin when available
  - `exp`, `nbf`, `iat`
  - optional active Clerk organization claim `o`
- Clerk users have stable unique IDs (`user_...`). We use these as identity-provider subjects, not as Agent Tick primary user IDs in the first pass.
- Clerk custom JWT templates are for third-party JWT integrations. They are not inherently session-bound and can omit session claims such as `sid`.
- For Agent Tick API auth, use Clerk session tokens from `getToken()` rather than `getToken({ template })`.
- If we need extra identity claims in the token, Clerk's recommended path is **customizing the session token**, not creating a JWT template.
- The Go SDK supports Clerk bearer-session verification through `clerkhttp.WithHeaderAuthorization`, `clerk.SessionClaimsFromContext`, authorized-party checks, and optional networkless public-key verification.
- The JavaScript SDK (`@clerk/clerk-js`) works without React and can mount Clerk UI widgets into ordinary DOM nodes, which fits the current Svelte dashboard better than relying on unofficial Svelte wrappers.
- The Expo SDK (`@clerk/expo`) supports Clerk auth in React Native/Expo and uses `expo-secure-store`/token cache for persisted sessions.

## Key decisions for this migration

1. **Use Clerk session tokens for Agent Tick API calls.**
   - Browser/mobile call `getToken()`.
   - Server verifies Clerk session JWTs.
   - Do not require a Clerk JWT template for normal Agent Tick API calls.

2. **Keep Agent Tick local user IDs (`usr_...`).**
   - Clerk `sub` (`user_...`) is mapped to a local Agent Tick user through an identity table.
   - This preserves existing foreign keys and keeps single-user mode independent from Clerk.

3. **Map Clerk identity by `(provider, issuer, subject)`.**
   - `provider = 'clerk'`
   - `issuer = iss`
   - `subject = sub`
   - This avoids collisions between BYO Clerk tenants.

4. **Fetch profile data from Clerk Backend API by default.**
   - On first login and periodic refresh, fetch the Backend User with `CLERK_SECRET_KEY`.
   - Cache only minimum profile metadata locally: verified primary email and display name.
   - Custom session claims for email/name are optional optimization, not required setup.

5. **Require verified primary email for first-pass Clerk users.**
   - Agent Tick invites support email/domain constraints, and current local `users.email` is unique.
   - Phone-only/no-email Clerk accounts can be supported later with a users table migration.

6. **Do not auto-link existing local users by email in the first pass.**
   - Clerk can verify email, but current local email/password users were not necessarily verified.
   - If a Clerk user email collides with an unmapped local user, return a clear "identity link required" error.
   - Add an explicit migration/linking tool later if needed.

7. **Keep local Agent Tick organizations.**
   - Ignore Clerk Organizations for authorization in the first pass.
   - Add explicit local organization selection to Agent Tick APIs instead of relying only on "default organization".

8. **Split phone pairing by mode.**
   - Single mode QR remains an auth mechanism that exchanges a short-lived pairing code for a long-lived Agent Tick device token.
   - Clerk mode QR is server/org discovery only; user identity comes from Clerk.

## Product modes

### `single` mode: local self-hosted

Current behavior stays intact.

- One implicit local user and organization.
- Dashboard is protected by the admin bearer token or localhost fallback.
- Phone pairing uses the existing QR code flow.
- Paired phones use Agent Tick device tokens.
- Agent/CLI clients use Agent Tick agent tokens.
- No Clerk keys or Clerk account required.

### `user` mode with `local` auth provider: legacy/development multi-user

Current local email/password user mode remains available during migration.

- Dashboard signs in through `/v1/session` cookies.
- Existing CSRF/session-cookie behavior remains.
- This mode is a compatibility/development path, not the target hosted auth path.

### `user` mode with `clerk` auth provider: authenticated multi-user

Clerk becomes the human identity provider.

- Dashboard users sign in with Clerk.
- Mobile users sign in with Clerk.
- Browser/mobile API calls send Clerk session JWTs as `Authorization: Bearer <token>`.
- Server verifies Clerk tokens and maps Clerk subjects to local Agent Tick users.
- Agent Tick organizations, teams, projects, policies, agent tokens, approvals, devices, billing, and audit logs remain local SQLite data.
- Agent tokens continue to authorize CLI/agent requests.
- Device tokens are not used as user identity secrets in Clerk mode.

### Unsupported/invalid combinations

- `AGENT_TICK_MODE=single` with `AGENT_TICK_AUTH_PROVIDER=clerk` is invalid.
- `AGENT_TICK_MODE=user` with `AGENT_TICK_AUTH_PROVIDER=clerk` requires valid Clerk publishable and secret keys.

## Configuration

Add an auth-provider model to server config.

```sh
AGENT_TICK_MODE=single|user
AGENT_TICK_AUTH_PROVIDER=local|clerk
```

Defaults:

- `single` => `local`
- `user` => `local` when `AGENT_TICK_AUTH_PROVIDER` is omitted, to preserve current installs during migration
- hosted deployments can set `user+clerk` explicitly

Clerk config:

```sh
AGENT_TICK_CLERK_PUBLISHABLE_KEY=pk_...
AGENT_TICK_CLERK_SECRET_KEY=sk_...

# Optional: networkless verification key copied from Clerk API keys page.
AGENT_TICK_CLERK_JWT_KEY=-----BEGIN PUBLIC KEY-----...

# Optional explicit allowlist for Clerk token azp checks.
# Defaults should include AGENT_TICK_PUBLIC_URL and loopback dev origins.
AGENT_TICK_CLERK_AUTHORIZED_PARTIES=https://tick.example.com,http://localhost:8787
```

Runtime public config endpoint:

```http
GET /v1/auth/config
```

Response shape:

```json
{
  "mode": "user",
  "authProvider": "clerk",
  "clerkPublishableKey": "pk_...",
  "publicURL": "https://tick.example.com"
}
```

The embedded dashboard should receive the same public values through the current HTML runtime config injection.

## Auth credential precedence

The server should not wrap the entire mux in Clerk's required-auth middleware because Agent Tick also accepts non-Clerk bearer tokens. Instead, the existing auth middleware should call a Clerk verifier only for Clerk-mode human requests.

Recommended order:

1. Public endpoints:
   - `GET /`
   - static assets
   - `GET /healthz`
   - `GET /v1/auth/config`
   - public invite preview
   - billing webhook
   - single-mode `/v1/devices/pair`
2. Legacy local session cookie only in `user+local`.
3. Loopback/admin bearer only in `single+local` by default.
4. Agent tokens in all modes.
5. Device tokens only in `single+local` and legacy `user+local` device flows.
6. Clerk bearer session JWT only in `user+clerk`.
7. Otherwise reject with 401.

Notes:

- Clerk session JWTs are JWT-shaped; Agent Tick agent/device/admin tokens are opaque prefixed tokens. Avoid unnecessary Clerk verification for obvious `agent_`, `device_`, `pair_`, or non-JWT values.
- In `user+clerk`, local `/v1/session` password login should be hidden or disabled.
- If a break-glass admin bearer is ever needed in user mode, add a separate explicit config flag later rather than reusing `AGENT_TICK_TOKEN` silently.

## Auth context semantics

Current code uses `authContext.Source` and `FromSession` for authorization decisions. Clerk mode needs a clearer human-session concept.

Add/adjust auth context fields along these lines:

```go
type authContext struct {
    UserID         string // local usr_...
    OrganizationID string // local org_...
    Role           string
    Source         string // admin, agent, device, session, clerk, loopback
    IsHuman        bool
    Provider       string // clerk for Clerk sessions
    ProviderIssuer string // iss
    ProviderSubject string // sub/user_...
    SessionID      string // Clerk sid when available
}
```

Update authorization checks to use `IsHuman` instead of assuming only local cookie sessions are human. Examples:

- Invite acceptance should allow Clerk human sessions.
- Human dashboard/mobile sessions should not be allowed to abandon requests as the agent/request creator unless explicitly designed.
- Audit votes should record source `clerk` for Clerk-authenticated human approvals.

## Data model

Keep the existing local `users` table and add a provider identity mapping table.

Example migration:

```sql
CREATE TABLE IF NOT EXISTS auth_identities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider TEXT NOT NULL,
  issuer TEXT NOT NULL DEFAULT '',
  subject TEXT NOT NULL,
  user_id TEXT NOT NULL,
  email TEXT NOT NULL DEFAULT '',
  email_verified INTEGER NOT NULL DEFAULT 0,
  name TEXT NOT NULL DEFAULT '',
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(provider, issuer, subject)
);

CREATE INDEX IF NOT EXISTS auth_identities_user_idx
  ON auth_identities(user_id);
```

First-pass profile policy:

- Require Clerk Backend User to have a verified primary email.
- Store verified primary email in `users.email` and `auth_identities.email`.
- Store display name in `users.name` and `auth_identities.name`.
- If `users.email` collides with an unmapped local user, reject with an identity-link-required error.
- Repeated Clerk login reuses the mapped local user.
- Periodically refresh cached email/name from Clerk, but never trust client-supplied profile fields.

Future migration option:

- If importing existing local users into Clerk, set Clerk `external_id` to the existing `usr_...` ID and include it in a customized session token if useful.
- Do not require this for the first pass.

## Local organization selection

Current API behavior mostly uses `DefaultOrganizationForUser`. That is fragile for multi-org users and invite acceptance.

Add explicit local organization selection:

```http
X-Agent-Tick-Organization-ID: org_...
```

Server behavior:

- If header is present, validate active membership and set `auth.OrganizationID` and `auth.Role` from that membership.
- If header is absent, fall back to current default organization logic.
- Dashboard stores selected local organization and sends the header on organization-scoped requests.
- Mobile can use default org initially, but QR discovery may include an `organizationId` hint.
- Do not use Clerk active organization claims for Agent Tick authorization in this pass.

## Phase 0: Config, public runtime config, and auth-provider plumbing

1. Add `AuthProvider` to server config/API state.
2. Add Clerk config values and startup validation.
3. Add `GET /v1/auth/config`.
4. Extend embedded dashboard runtime config with:
   - mode
   - auth provider
   - Clerk publishable key
   - public URL
5. Document valid deployment combinations.

Acceptance criteria:

- Existing `single` mode starts with no Clerk config.
- Existing `user+local` mode still works.
- `single+clerk` fails fast with a clear operator error.
- `user+clerk` fails fast if publishable/secret keys are missing.
- Public config endpoint never exposes secret keys.

## Phase 1: Server Clerk verification and local identity mapping

1. Add Clerk session verification to the Go server.
   - Prefer Clerk Go SDK verification.
   - Use `AGENT_TICK_CLERK_JWT_KEY` when provided for networkless verification.
   - Otherwise use Clerk JWKS/secret-key-backed SDK behavior.
   - Validate `azp` against configured authorized parties when present.
2. Add identity mapping and profile sync.
   - Add `auth_identities` table.
   - Fetch Backend User by Clerk `sub` on first login/profile refresh.
   - Require verified primary email for first pass.
   - Create local `usr_...` on first verified Clerk identity.
   - Ensure personal local organization/membership exists.
3. Map Clerk identity to `authContext`.
   - `UserID` remains local Agent Tick `usr_...`.
   - `Source = clerk`.
   - `IsHuman = true`.
   - Store `ProviderIssuer`, `ProviderSubject`, and `SessionID` for audit/debugging.
4. Add `GET /v1/me` for authenticated human clients.
   - Returns local user ID, email/name, auth provider/source, selected/default org, and memberships if useful.
5. Update middleware precedence so agent tokens and single-mode auth keep working.

Acceptance criteria:

- API endpoints authorize Clerk users with `Authorization: Bearer <Clerk session token>`.
- Repeated Clerk login reuses the same local `usr_...`.
- Wrong issuer/signature/expiry/authorized party is rejected.
- Email collision with an unmapped local user fails safely with a clear error.
- Agent tokens still work in all modes.
- Single-mode QR/device/admin auth still works.

## Phase 2: Svelte dashboard Clerk sign-in

1. Add official Clerk JS dependency.
   - Use `@clerk/clerk-js`.
   - Avoid `svelte-clerk` as a hard dependency in the first pass.
2. In `user+clerk` mode:
   - initialize Clerk from runtime publishable key
   - render Clerk sign-in/sign-up/user controls via Clerk JS DOM mount APIs
   - call `clerk.session?.getToken()` before API requests
   - send `Authorization: Bearer <Clerk session token>`
3. Update `AdminApiClient` to support an async bearer token provider.
   - Current sync `bearerToken()` callback is insufficient because Clerk `getToken()` is async.
   - On 401, optionally retry once with `getToken({ skipCache: true })`.
4. Use `GET /v1/me` to resume the mapped Agent Tick session after Clerk loads.
5. Keep single-mode UI unchanged.
   - Admin bearer token entry remains for `single+local`.
6. Hide/disable local email/password form when `authProvider=clerk`.
7. Preserve invite hash/redirect state across Clerk sign-in.

Acceptance criteria:

- Dashboard signs in through Clerk in `AGENT_TICK_MODE=user` + `AGENT_TICK_AUTH_PROVIDER=clerk`.
- Dashboard can list/create approvals, devices, agents, teams, projects, policies, invites, billing, and audit data as the mapped local user.
- Dashboard can accept invite links after Clerk sign-in.
- Dashboard still works in `single` mode without Clerk config at runtime.

## Phase 3: Mobile Expo Clerk sign-in

1. Add Expo Clerk dependencies.
   - `@clerk/expo`
   - `expo-secure-store`
2. Add runtime server auth discovery.
   - User enters/scans server URL.
   - App fetches `GET /v1/auth/config`.
   - App mounts/remounts `ClerkProvider` with the returned publishable key.
   - Namespace or clear Clerk token cache when server URL/publishable key changes to avoid cross-tenant token reuse.
3. In Clerk user mode:
   - show Clerk sign-in before approvals
   - use `useAuth().getToken()` for API requests
   - centralize mobile fetch logic around async token retrieval
   - send Clerk bearer tokens to approvals, responses, heartbeat, availability, history, events, and device registration endpoints
4. Keep single-mode pairing UI unchanged.
   - QR pairing continues to set server URL and device token.
   - Existing device bearer token path remains valid only for local/single device auth.
5. For hosted/user mode, keep device records for push registration.
   - Device registration associates the Expo push token with the Clerk-mapped local user.
   - QR may be used for server/org discovery, not as a user identity secret.
6. Document mobile SSO/native constraints.
   - BYO Clerk SSO or native OAuth may require Clerk native application settings, redirect URLs, and an EAS/dev build depending on chosen Clerk Expo UI flow.

Acceptance criteria:

- A Clerk-signed-in mobile user can view and respond to eligible approvals.
- Single self-hosted QR pairing still works exactly as before.
- Push registration stores Expo push tokens for the correct local user.
- Switching server/Clerk tenant does not reuse a token from the previous tenant.

## Phase 4: Clerk-mode device registration and QR split

### Single mode

QR pairing remains an auth mechanism.

- Dashboard creates a short-lived pairing code.
- Mobile exchanges code for a device token.
- Device token authorizes mobile API calls.

### Clerk user mode

QR pairing becomes server/org discovery and device registration.

Example QR payload:

```json
{
  "serverURL": "https://tick.example.com",
  "mode": "user",
  "authProvider": "clerk",
  "organizationId": "org_..."
}
```

No long-lived auth secret is included.

Add Clerk-authenticated device endpoints, for example:

```http
POST /v1/devices/register
Authorization: Bearer <Clerk session token>

{
  "deviceName": "iOS phone",
  "platform": "ios",
  "installationId": "locally-generated-random-id",
  "expoPushToken": "ExponentPushToken[...]"
}
```

Response:

```json
{
  "deviceId": "dev_..."
}
```

Implementation notes:

- Current `devices.token_hash` is `UNIQUE NOT NULL`; first pass can generate an internal random device token/hash but not return it in Clerk mode.
- Add store methods that set push tokens by authenticated local user and device ID.
- When registering an Expo push token in Clerk mode, clear that same push token from other devices first so shared phones do not keep receiving another user's pushes.
- On mobile sign-out, best-effort unregister/unpair the current Clerk-mode device before calling Clerk `signOut()`.

Acceptance criteria:

- No long-lived user auth secret is embedded in a user-mode QR.
- User-mode device registration cannot register a phone to another user's account.
- Signing into a different Clerk user on the same phone does not leave push notifications attached to the previous local user.
- Single-mode pairing remains backward compatible.

## Phase 5: WebSocket/events auth

Current mobile events use:

```text
/v1/events?token=<device-token>
```

Clerk session tokens are short-lived, and query-string tokens are easy to leak in logs. For Clerk mode, choose one of these before implementation:

1. Short-lived event ticket endpoint.
   - Client calls `POST /v1/events/ticket` with Clerk Authorization header.
   - Server returns a short-lived opaque event ticket.
   - WebSocket connects with the ticket query param.
2. Reconnect with fresh Clerk token.
   - Client calls `getToken()` before opening `/v1/events?token=...`.
   - Client reconnects periodically or on close/401.
3. Replace WebSocket with SSE/fetch stream where Authorization headers are straightforward.

First pass recommendation: implement short-lived event tickets for Clerk mode and leave single-mode device-token WebSocket behavior unchanged.

Acceptance criteria:

- Clerk session JWTs are not stored long-term or reused past expiry for event streams.
- Single-mode mobile event streaming remains compatible.
- Event stream authorization remains scoped to the authenticated local user.

## Phase 6: Bring-your-own-Clerk for self-hosted orgs

Document BYO Clerk setup.

1. Create a Clerk application.
2. Copy publishable and secret keys.
3. Configure allowed origins/redirect URLs for the Agent Tick dashboard URL.
4. Configure mobile/native application settings and redirect schemes if using mobile OAuth/SSO.
5. Optionally configure SSO inside Clerk.
6. Start Agent Tick with:

```sh
AGENT_TICK_MODE=user
AGENT_TICK_AUTH_PROVIDER=clerk
AGENT_TICK_PUBLIC_URL=https://tick.example.com
AGENT_TICK_CLERK_PUBLISHABLE_KEY=pk_...
AGENT_TICK_CLERK_SECRET_KEY=sk_...
AGENT_TICK_CLERK_AUTHORIZED_PARTIES=https://tick.example.com
```

Operational warnings:

- Clerk is SaaS; identity data is processed by Clerk.
- Operators should review Clerk pricing, DPA, retention, and compliance terms.
- The default install path remains `single+local` with no third-party dependency.

Acceptance criteria:

- A self-hosted organization can run multi-user Agent Tick using its own Clerk tenant.
- Invalid or missing Clerk config fails with actionable startup errors.
- Default single-user install remains local-only.

## Phase 7: Legacy local user-mode cleanup

Only do this after Clerk mode is stable.

Options:

1. Keep local email/password user mode as an unsupported/development-only fallback.
2. Remove password login from production builds.
3. Preserve existing local user/session tables for migration compatibility but stop creating password hashes.

Migration considerations:

- Existing local users should be linkable to Clerk users through an explicit migration/link command, not automatic email linking.
- If importing users into Clerk, consider setting Clerk `external_id` to local `usr_...`.
- Do not delete historical audit/approval data.
- Keep `usr_...` IDs stable because many tables reference them.

Acceptance criteria:

- Existing local user-mode data can be migrated or linked without losing approvals/devices/agent tokens.
- Operators get clear release notes for changed auth behavior.

## Phase 8: Future generic OIDC/SSO option

Defer until there is real demand.

Potential config shape:

```sh
AGENT_TICK_AUTH_PROVIDER=oidc
AGENT_TICK_OIDC_ISSUER=https://login.example.com/...
AGENT_TICK_OIDC_CLIENT_ID=...
AGENT_TICK_OIDC_CLIENT_SECRET=...
```

This would avoid requiring Clerk for self-hosted enterprise multi-user, but it means Agent Tick owns more auth complexity: callbacks, cookies, refresh/session lifecycle, logout, provider quirks, and profile mapping.

Recommendation: use Clerk as the first multi-user auth provider and keep the server auth layer pluggable enough to add OIDC later.

## Test plan

### Go API tests

- `single+local` auth and pairing still pass.
- `user+local` session-cookie auth still passes during migration.
- Agent-token auth still passes in all modes.
- Clerk bearer token auth passes with test RSA/JWK.
- Invalid signature, expired token, not-before token, wrong authorized party, missing subject, and wrong issuer fail.
- Clerk identity maps to a stable local `usr_...`.
- Repeated Clerk login reuses the same local user.
- Clerk profile sync stores verified email/name.
- Email collision with unmapped local user fails safely.
- Tenant isolation uses `(provider, issuer, subject)`.
- Local organization header selection validates membership and prevents cross-org leaks.
- Device tokens are rejected for human API access in `user+clerk`.
- Clerk-mode device registration cannot register/unpair another user's device.
- Push token registration clears duplicate Expo push tokens from other devices.

### Admin tests

- Single-mode bearer UI still renders.
- Local user-mode login still renders when `authProvider=local`.
- Clerk-mode signed-out UI renders Clerk sign-in mount point.
- Clerk-mode API client awaits async `getToken()` and attaches bearer token.
- Clerk-mode 401 can refresh token once.
- Invite route/hash survives Clerk sign-in.
- Dashboard sends selected local organization header.

### Mobile tests

- Single-mode pairing UI remains available.
- Runtime auth config is fetched from server URL.
- ClerkProvider is initialized from runtime publishable key.
- Switching server/publishable key clears or namespaces token cache.
- Clerk-mode signed-out state blocks approval actions.
- Clerk-mode requests call `getToken()` and attach bearer token.
- Clerk-mode device registration uses authenticated local user.
- Push registration is not left attached to previous user after sign-out/server switch.

### Manual smoke tests

- Local single server + QR pair + approve request.
- Local user-mode legacy login + dashboard basic actions.
- Clerk dashboard login + create agent token.
- Agent token sends approval request.
- Clerk mobile login + respond to approval.
- Clerk-mode phone registration receives push for correct user.
- BYO Clerk env config starts and signs in.

## Key risks

- Clerk is a SaaS dependency and holds identity data.
- Clerk session token customization has a small cookie size budget; avoid stuffing Agent Tick data into Clerk tokens.
- Mobile BYO Clerk/SSO requires careful runtime publishable-key and redirect/native-app configuration.
- WebSocket auth must handle short-lived Clerk tokens.
- Existing local user IDs are local `usr_...`; never replace them with Clerk `user_...` IDs without a migration plan.
- Current local organization selection is implicit; explicit org selection is needed for robust multi-org use.
- Enterprise self-hosted customers may eventually prefer direct OIDC over Clerk.
