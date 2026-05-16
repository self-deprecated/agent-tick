# Hosted data inventory

This inventory maps Agent Tick hosted product data to implementation sources, processors, and launch privacy/store disclosures. It is a privacy and app-review support document, not a data-residency guarantee.

## Summary

Agent Tick hosted mode processes data needed to route bounded agent status updates, steering choices, and sanctions between local agents and authenticated humans. The product should disclose the following categories clearly:

- account identity and organization membership
- agent tokens, device records, and push tokens
- approval requests, responses, status updates, and Activity History
- audit events and operational metadata
- mobile diagnostics when enabled
- product and marketing analytics that exclude approval content
- billing entitlement state and app-store subscription state
- support/security correspondence handled outside the app database

Self-hosted deployments are separate: the self-hosted operator controls their own data, infrastructure, backups, subprocessors, analytics, and notification providers.

## Processor and surface inventory

| Processor/surface | Role | Data involved | Current evidence | Disclosure note |
| --- | --- | --- | --- | --- |
| Agent Tick hosted server/API | Primary application processor | Users, organizations, memberships, agent tokens, devices, approval requests, responses, status updates, audit events, diagnostics, billing entitlement state | `apps/server`, `packages/db`, `packages/shared` | Core hosted service data. Disclose as Agent Tick product data. |
| Agent Tick admin dashboard | Hosted web UI | Authenticated user/session state, approval/admin views, Plausible product analytics events | `apps/admin/src/App.svelte`, `apps/admin/src/analytics.ts` | Product analytics are minimal and exclude approval content. |
| Agent Tick native mobile app | Approval UI and push client | Local account/session state, mobile session tokens, device IDs, push tokens, approval/history views, optional diagnostics | `apps/mobile/App.tsx`, `apps/mobile/diagnostics.ts`, `apps/mobile/mobileAuth.ts` | App-store privacy should include identifiers, user content/approval content, diagnostics when enabled, and push token/device data. |
| Clerk | Hosted identity provider in Clerk mode | Identity/session data such as account identifiers, email/profile fields, OAuth callback state, session tokens | `apps/server/src/auth/clerk.ts`, `apps/admin/src/App.svelte`, `apps/mobile/App.tsx` | Clerk authenticates people; Agent Tick owns product authorization. Avoid claiming identity data is only stored in Agent Tick. |
| Expo push notification service | Push delivery provider | Expo push tokens, minimal notification payloads, device/platform metadata needed for push | `apps/server/src/services/notifications.ts`, `apps/mobile/App.tsx` | Push notifications should be minimal by default; request details open in the app. |
| Plausible / `analytics.selfdeprecated.ai` | Marketing and product analytics | Aggregate marketing page analytics; product events such as onboarding/paywall/setup state with small props | `agenttick.sh/src/app.html`, `apps/admin/src/analytics.ts` | No ad tracking pixels or retargeting; approval content is excluded. Honor opt-out flags. |
| App stores / in-app purchase platforms | Payment/subscription processor | Purchase/subscription entitlement status, refunds/cancellation records controlled by app stores | `apps/mobile/store-listing.md`, `apps/server/src/routes/billing.ts` | App stores remain responsible for payment processing, refunds, and subscription management. |
| Support email / GitHub issues/discussions | Support surfaces | User-provided support context, bug reports, self-hosting questions, sensitive reports by email | `agenttick.sh/src/routes/support/+page.svelte` | Tell users not to send secrets/tokens/full approval payloads; sensitive reports go private by email. |

## Hosted data category map

| Category | Examples | Implementation sources | Retention/deletion | Privacy/store disclosure |
| --- | --- | --- | --- | --- |
| Account identity | User ID, email/profile from Clerk or local auth, auth identity mapping | `apps/server/src/auth`, `packages/db/src/index.ts` identity tables, `apps/mobile/mobileAuth.ts` saved account metadata | Hosted personal deletion does not delete external identity-provider records. Account/session records may remain with Clerk or app stores. | “Hosted account data” and “Clerk authenticates people.” |
| Organizations and membership | Organization IDs/names, roles, teams, invites, membership approvals | `apps/server/src/routes/organizations.ts`, `apps/server/src/routes/invites.ts`, `packages/db/src/index.ts` | Organization owner deletion removes organization product data where supported; some operational records may remain outside product DB. | “Organization owners can delete organization data from Agent Tick-hosted organization storage where supported.” |
| Agent tokens | `agent_...` setup tokens, token hashes, agent IDs/names, owner/user/org linkage | `packages/db/src/index.ts`, `apps/server/src/routes/agentTokens.ts`, CLI config docs | Tokens are stored as hashes where possible; revoke/delete controls revoke agent access. | “Agent tokens are stored as hashes where possible.” |
| Devices and push tokens | Device ID/name/platform, installation ID, Expo push token, unregistered timestamp | `apps/server/src/routes/devices.ts`, `apps/mobile/App.tsx`, `packages/db/src/index.ts` | Unregistration clears push token and marks device unregistered; retention cleanup removes old unregistered rows. | “Revoked devices stop receiving push.” |
| Approval requests and responses | Request title/body/command, request type, bounded choices/questions, encrypted payload envelope, response/votes, status/timestamps | `packages/shared/src/index.ts`, `apps/server/src/routes/approvals.ts`, `packages/db/src/index.ts` | Retention cleanup removes eligible completed/expired requests; hosted personal/organization deletion removes relevant product data where safe. | App privacy should classify as user content; marketing copy must say approvals execute locally, not remotely. |
| Status updates and Activity History | Thread ID, message, state, next step, host/working directory/project metadata, recent history | `apps/server/src/routes/status.ts`, `apps/mobile/App.tsx`, `docs/activity-history-cleanup-deletion.md` | Status retention is configurable; Activity History availability follows lifecycle/retention. | “Activity History includes Requests, responses, and Status Updates.” |
| Audit events | Event type, target ID, user ID, created timestamp, small payload JSON | `packages/db/src/index.ts`, `apps/server/src/routes/audit.ts`, admin audit view | Audit retention cleanup can remove old events when configured; avoid claiming immediate audit erasure. | “Minimal operational metadata may remain.” |
| Mobile diagnostics | Opt-in diagnostic area/message/metadata, runtime context, error/setup/reliability events | `apps/mobile/diagnostics.ts`, `apps/server/src/routes/mobileDiagnostics.ts` | Diagnostics should exclude approval content and secrets; deletion/retention handling should be documented as operational data. | “Diagnostics are opt-in and intended for setup and reliability troubleshooting.” |
| Product analytics | `onboarding_started`, `onboarding_completed`, `paywall_viewed`, `setup_completed` with small props | `apps/admin/src/analytics.ts` | Opt-out via local flags; no approval content in events. | “Product analytics are minimal by default, can be opted out of, and exclude approval content.” |
| Marketing analytics | Page-view analytics for public site | `agenttick.sh/src/app.html`, `agenttick.sh/src/routes/privacy/+page.svelte` | Aggregate Plausible analytics; opt-out flag supported before script load. | “No ad tracking pixels or retargeting.” |
| Billing entitlement state | Trial start, app unlock, included hosted month, subscription end/cancel/deleted timestamps, plan/seat usage | `apps/server/src/routes/billing.ts`, `apps/server/src/services/personalEntitlements.ts`, `packages/db/src/index.ts` | Hosted personal deletion marks `hostedDataDeletedAt`; app-store records remain with app stores. | “App stores remain responsible for payment processing, refunds, and subscription management.” |
| Support/security correspondence | Account email, org name, issue description, security/abuse reports | `agenttick.sh/src/routes/support/+page.svelte` | Outside core app DB; handled by support/email/GitHub retention policies. | Support page says not to send secrets/tokens/full approval payloads. |

## Privacy disclosure alignment

The marketing privacy page should continue to state:

- Hosted Agent Tick processes account identity, organization membership, billing entitlement state, Agent Connections, device registrations, and settings needed to operate the service.
- Activity History includes Requests, responses, and Status Updates.
- Diagnostics are opt-in and should exclude approval content such as commands, bodies, choices, and secrets.
- Product and marketing analytics exclude approval content and are not ad tracking.
- Deletion controls remove hosted personal data and revoke hosted tokens/devices where safe; hosted data export is not a launch feature.
- Self-hosted deployments are the operator's responsibility.
- No public data residency guarantee exists unless a specific hosted deployment or enterprise agreement says so.

## App-store disclosure alignment

For app-store privacy questionnaires, treat this inventory as the source checklist. Current likely categories to review with counsel/store owner:

- Contact info / identifiers: account email and user identifiers when using hosted Clerk mode.
- User content: approval request titles/bodies/commands/choices/status updates and history that users or agents choose to send.
- Diagnostics: opt-in mobile diagnostic events and crash/setup troubleshooting context, if enabled.
- Usage data: minimal onboarding/paywall/setup analytics, excluding approval content.
- Purchases: app-store IAP/subscription status and hosted entitlement state.
- Device identifiers / push tokens: device records and Expo push tokens used for notifications.

Do not claim that the mobile app collects no user content if hosted approvals include request text or command context. Instead, explain that approval content is user-provided to operate the approval-routing service and is not used for marketing analytics.

## Open gaps

- Production infrastructure region/subprocessor confirmation is tracked separately in Fizzy #50.
- Hosted export controls are not a launch feature.
- A polished deletion preview/confirmation flow remains future work; see [Deletion controls verification](./deletion-controls-verification.md).
- The admin client has an `exportAuditEventsCSV` helper, but no matching launch server route was verified; do not disclose complete audit export as available.
- Actual app-store privacy answers should be reviewed against final store build, final hosted providers, and app-store policy wording.

## Validation evidence

Inspected sources include:

- `packages/shared/src/index.ts`
- `packages/db/src/index.ts`
- `apps/server/src/routes/*`
- `apps/server/src/services/personalEntitlements.ts`
- `apps/server/src/services/notifications.ts`
- `apps/admin/src/analytics.ts`
- `apps/mobile/App.tsx`
- `apps/mobile/diagnostics.ts`
- `apps/mobile/store-listing.md`
- `agenttick.sh/src/app.html`
- `agenttick.sh/src/routes/privacy/+page.svelte`
- `agenttick.sh/src/routes/support/+page.svelte`

## Status

This document satisfies Fizzy #49 as a repo-side hosted data inventory and disclosure map. Keep it updated whenever schemas, analytics events, notification processors, billing processors, or hosted infrastructure providers change.
