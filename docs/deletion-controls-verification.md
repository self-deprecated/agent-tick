# Deletion controls verification

This document verifies the deletion and retention controls that are currently implemented for Agent Tick launch surfaces. It is a product/privacy verification note, not a promise that every operational trace is erased immediately.

## Summary

Implemented controls exist for:

- **Hosted personal data deletion** through the billing lifecycle event `delete_account_data`.
- **Organization deletion** through owner-only organization deletion.
- **Retention cleanup** for old approval requests, status updates, audit events, unregistered devices, and expired/revoked invites.
- **Mobile device unregistration** that clears push tokens and stops future push delivery for the unregistered device.

Important limits:

- The current dashboard and mobile apps do not expose a polished self-service deletion confirmation flow for every control.
- Hosted data export is not a launch feature.
- Minimal operational metadata may remain for billing, abuse prevention, security, and system integrity.
- Self-hosted deployments are controlled by their operator; hosted deletion controls do not reach into a self-hosted server.

## Verified implementation map

| Control | Implementation | Who can invoke | What it does | Launch wording |
| --- | --- | --- | --- | --- |
| Hosted personal data deletion | `apps/server/src/routes/billing.ts` accepts `POST /v1/billing/personal` with event `delete_account_data`, then calls `store.deleteHostedPersonalData(userId, organizationId, now)` | Authenticated human for their hosted personal context | Revokes agent tokens owned by the user, unregisters the user's devices and clears Expo push tokens, deletes approval votes/recipients for the user, deletes organization status updates for that context, deletes approval requests in that organization created by the user, and marks the personal entitlement with `hostedDataDeletedAt` | “Deletion controls remove hosted personal data and revoke hosted tokens/devices where safe.” |
| Hosted personal deleted lifecycle | `apps/server/src/services/personalEntitlements.ts` returns lifecycle `deleted` when `hostedDataDeletedAt` is present | Server lifecycle logic | Disables responses, routing, and push; sets `historyRetentionDays: 0` for hosted personal status | “Hosted personal data deletion disables hosted routing and recent hosted history retention.” |
| Organization deletion | `apps/server/src/routes/organizations.ts` exposes `DELETE /v1/organizations/:id`; requires membership and owner role; calls `store.deleteOrganizationData(id)` | Organization owner | Revokes/deletes org agent tokens, unregisters member devices, deletes approval requests/votes/recipients, waiters, status updates, audit events, event tickets, pairing codes, availability, mobile diagnostics, invites/acceptances, teams, projects, policies, memberships, and organization row | “Organization owners can delete an organization and its Agent Tick organization data where supported.” |
| Retention cleanup | `apps/server/src/services/retention.ts` runs startup/scheduled cleanup when enabled; database cleanup lives in `packages/db/src/index.ts` and `packages/db/src/postgresStore.ts` | Server operator/config | Deletes old completed/expired approval requests, old status updates, old audit events, old unregistered devices, expired/revoked invites without acceptance history, and expired secrets/waiter tokens/pairing codes | “Activity History follows configured retention windows; cleanup is scheduled and best-effort.” |
| Mobile device unregistration | Mobile logout/unregister paths call SDK/client device unregistration; DB stores `unregistered_at` and clears push tokens | Device user / app flow | Stops future push notifications for that device; old unregistered device rows may remain until retention cleanup | “Revoked or unregistered devices stop receiving push.” |

## What remains or may remain

Deletion should not be described as total erasure. Depending on hosted/self-hosted mode, timing, and external providers, these may remain:

- payment processor / app-store subscription and refund records
- Clerk or identity-provider account/session records outside Agent Tick's database
- email delivery records or support tickets
- server logs, backups, metrics, abuse-prevention records, and security events
- minimal billing/account-integrity metadata
- data on self-hosted servers operated by the user or their organization

Do not claim that Agent Tick can delete app-store, identity-provider, infrastructure, or self-hosted operator records.

## Documentation copy alignment

Launch privacy copy should use these phrases:

- “Deletion controls remove hosted personal data and revoke hosted tokens/devices where safe.”
- “Organization owners can delete organization data from Agent Tick-hosted organization storage where supported.”
- “Minimal operational metadata may remain for billing, abuse prevention, security, and system integrity.”
- “Self-hosted deployments are controlled by their operator.”
- “Hosted data export is not a launch feature.”

Avoid these overclaims:

- “Delete your account and all data everywhere.”
- “Erase all audit logs immediately.”
- “Delete data from self-hosted servers.”
- “Export a complete audit log.”
- “Deletion removes payment, app-store, identity-provider, support, or infrastructure records.”

## Gaps and follow-ups

The implementation is sufficient for honest launch documentation, but the product should still add:

1. A typed deletion preview endpoint before destructive hosted personal deletion.
2. A visible dashboard/mobile confirmation flow that requires explicit acknowledgement of what remains.
3. A deletion receipt or status screen that avoids preserving deleted approval content.
4. Lifecycle-specific Activity History empty states in the mobile app and dashboard.
5. Tests that explicitly cover hosted personal deletion behavior in both SQLite and Postgres stores.
6. Public docs for organization deletion once the dashboard exposes it as a user-facing flow.

## Validation evidence

Verification sources inspected:

- `apps/server/src/routes/billing.ts`
- `apps/server/src/routes/organizations.ts`
- `apps/server/src/services/personalEntitlements.ts`
- `apps/server/src/services/retention.ts`
- `packages/db/src/index.ts`
- `packages/db/src/postgresStore.ts`
- `packages/db/test/store.test.ts`
- `docs/activity-history-cleanup-deletion.md`
- `agenttick.sh/src/routes/privacy/+page.svelte`

Relevant existing tests:

- `packages/db/test/store.test.ts` covers retention cleanup for approval requests, status updates, audit events, unregistered devices, and expired invites.
- `apps/server/test/app.test.ts` covers parsing retention cleanup configuration.
- `apps/server/test/coordination.test.ts` covers cleanup lock behavior.

## Status

Fizzy #51 is complete as a verification/documentation task when this file and the marketing privacy policy are updated together. It does not claim that deletion/export UX is fully polished; those improvements are captured as follow-up gaps.
