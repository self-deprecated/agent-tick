# Hosted subprocessors and infrastructure regions

This packet identifies the known hosted Agent Tick production providers and the region/disclosure gaps that must be confirmed before making public data-residency promises. Agent Tick currently makes no public data-residency guarantee. It is a launch privacy/legal support artifact, not a data processing agreement or legal advice.

## Current disclosure posture

- Agent Tick should **not** publish a data residency guarantee unless a specific hosted deployment or Enterprise agreement explicitly says so.
- Public privacy copy should say that hosted product data may be processed by the providers needed to operate authentication, routing, push, analytics, billing, support, and backups.
- Self-hosted deployments are separate: the self-hosted operator chooses their own infrastructure providers, regions, analytics, notifications, and backup targets.
- Provider and region details below should be reviewed by the owner/counsel against actual production accounts before they are published as a formal subprocessor page.

## Provider and region matrix

| Provider / surface | Status for launch | Role | Data involved | Region / location status | Evidence in repos | Disclosure note |
| --- | --- | --- | --- | --- | --- | --- |
| Agent Tick hosted server on `tay` | Planned / partially configured | Primary hosted application runtime | Hosted users, organizations, agent tokens, devices, approval requests/responses, status updates, audit events, diagnostics, billing entitlement state | **Unconfirmed.** `host-tay` uses placeholder “Hostinger-style VPS networking”; actual VPS/dedicated provider, datacenter country/region, and account owner must be confirmed. | `host-tay/docs/architecture.md`, `host-tay/modules/hosts/tay.nix`, `host-tay/IMPLEMENTATION_REPORT.md` | Do not state EU/US/other residency until the actual provider and datacenter are confirmed. |
| PostgreSQL on `tay` | Planned / configured as local service | Primary database for hosted product state | Same product data as hosted server, depending on table | Same as `tay` host; currently unconfirmed. | `host-tay/modules/aspects/agent-tick.nix`, `agent-tick/apps/server`, `agent-tick/packages/db` | PostgreSQL is local to the hosted server in the planned NixOS-first stack, not an external managed database in the current plan. |
| Redis on `tay` | Planned / configured as local service | Ephemeral coordination, rate limits, event wakeups, cleanup locks | Ephemeral IDs/events/rate-limit state; should not store durable approval content | Same as `tay` host; currently unconfirmed. | `host-tay/modules/aspects/agent-tick.nix`, `agent-tick/apps/server/src/services/eventBus.ts`, `rateLimit.ts`, `retentionLock.ts` | Redis should be described as ephemeral coordination, not a durable product-data store. |
| Restic backup target for `tay` | Planned / configured, target unknown | Off-machine backups | Backed-up hosted database/files depending on backup paths | **Unconfirmed.** Backup provider, bucket/server region, encryption ownership, and retention must be confirmed. | `host-tay/modules/aspects/backups.nix`, `host-tay/IMPLEMENTATION_REPORT.md` | Treat as a subprocessor/storage location once the target provider is known. |
| Tailscale | Planned / configured for private administration | Private admin network for rollout/ops surfaces | Device/network identity and admin connectivity metadata; should not carry approval content as a product surface | Tailscale account/control-plane region not confirmed in repo | `host-tay/docs/architecture.md`, `host-tay/modules/hosts/tay.nix` | Mention only if publishing infrastructure subprocessors; not a customer-facing approval channel. |
| Traefik / Let's Encrypt | Planned / configured on `tay` | HTTPS ingress and TLS certificates | Domain names, TLS challenge/certificate metadata, request routing metadata | Runs on `tay`; Let's Encrypt CA processing is external/global | `host-tay/modules/aspects/agent-tick.nix` | Certificate authority is infrastructure support, not product-data processing in the normal approval-content sense. |
| Clerk | In use for hosted identity mode | Hosted identity provider | Account identifiers, emails/profile fields, OAuth/session data, client/session tokens | **Unconfirmed in repo.** Confirm Clerk instance region/data-residency settings and subprocessors from the production Clerk account. | `agent-tick/apps/server/src/auth/clerk.ts`, `apps/admin/src/App.svelte`, `apps/mobile/App.tsx` | Clerk authenticates people; Agent Tick owns authorization/product data. Avoid saying account identity is only stored in Agent Tick. |
| Expo push service | In use for mobile push | Push notification delivery | Expo push tokens, minimal notification payloads, device/platform delivery metadata | **Unconfirmed in repo.** Expo/EAS processing locations and app project ownership must be confirmed. | `agent-tick/apps/server/src/services/notifications.ts`, `apps/mobile/App.tsx` | Push payloads should stay minimal; full request details open inside the app. |
| Plausible at `analytics.selfdeprecated.ai` | In use / configured | Marketing and product analytics | Aggregate marketing page analytics; limited product events such as onboarding/paywall/setup state | **Unconfirmed hosting region.** The Plausible service is self-hosted on `host-clippy`; `host-clippy` provider/region is not confirmed in this packet. | `agenttick.sh/src/app.html`, `agent-tick/apps/admin/src/analytics.ts`, `host-clippy/modules/aspects/plausible.nix` | No ad tracking or retargeting; approval content must not be sent to analytics. |
| Apple App Store / Google Play | Planned for native app purchases/subscriptions | App distribution, IAP/subscription processing | Purchase/subscription status, app-store account/payment/refund data controlled by stores | Global/app-store controlled; exact processing locations governed by Apple/Google terms | `agent-tick/apps/mobile/store-listing.md`, `apps/server/src/routes/billing.ts` | App stores remain responsible for payment processing, refunds, and subscription management. |
| GitHub | In use | Source hosting, public issues/discussions, release workflows | Public issues/discussions, user-provided support context, workflow metadata | GitHub-controlled/global | `agenttick.sh/src/routes/support/+page.svelte`, `.github/workflows/*` | Tell users not to post secrets, tokens, or full approval payloads in public issues/discussions. |
| Support email | In use / planned | Paid support, security/abuse intake | Account email, organization name, sanitized issue descriptions, sensitive reports | Mail provider/account not confirmed in repo | `agenttick.sh/src/routes/support/+page.svelte` | Confirm actual mail provider before publishing a formal subprocessor list. |

## Region confirmation checklist

Before publishing a formal subprocessor or data-residency page, the owner should record:

1. `tay` production provider name, legal entity, account owner, datacenter country/region, public IP allocation, and whether snapshots are enabled.
2. Backup target provider, bucket/server region, encryption model, retention period, and restore-test evidence.
3. Clerk production instance settings, region/residency options if any, and Clerk subprocessor/DPA links.
4. Expo/EAS project owner, push service terms, and whether notification payloads match the minimal-payload policy.
5. Plausible hosting provider/region for `analytics.selfdeprecated.ai`, plus the configured Plausible site domains.
6. App-store legal seller, payment processor responsibilities, subscription/refund data flow, and store privacy answers.
7. Support email provider and retention/access controls.
8. Whether any staging, preview, logging, error reporting, uptime monitoring, or CDN provider is added outside the repos inspected here.

## Public copy guidance

Safe launch wording:

> Agent Tick uses subprocessors needed to operate hosted authentication, routing, push notifications, analytics, billing, support, and backups. Agent Tick does not make a public data-residency guarantee unless a specific hosted deployment or Enterprise agreement says so.

Avoid:

- “All Agent Tick hosted data stays in the EU/US/[region]” unless the exact production stack, backups, identity provider, support, analytics, and app-store flows support that statement.
- “No third parties process account data” because Clerk, app stores, push delivery, analytics, support/GitHub, and backup providers may process relevant data.
- “Self-hosted deployments use Agent Tick subprocessors” because self-hosted operators choose and control their own providers.

## Implementation notes

- The planned `host-tay` production stack is NixOS-first on a VPS/dedicated host, with local PostgreSQL and Redis, Traefik ingress, Tailscale for private administration, and restic backups.
- The previous AWS-first approach remains only a portability path in `host-tay/IMPLEMENTATION_REPORT.md`; do not list AWS as a current hosted production subprocessor unless the deployment direction changes.
- `docs/hosted-data-inventory.md` remains the data-category source checklist; this packet adds provider/region status for Fizzy #50.

## Status

Repo-side provider and region inventory is prepared, but final production provider/region confirmation is still owner/counsel work. Keep this packet updated whenever infrastructure, identity, analytics, push, billing, support, monitoring, or backup providers change.
