# Activity History cleanup and deletion controls

## Summary

Activity History cleanup and deletion controls should make hosted privacy behavior understandable without implying that Agent Tick can erase every operational trace immediately. The product should distinguish request/activity history, audit metadata, diagnostics, devices, agent tokens, invites, and billing/account records.

Recommendation: add clear user-facing lifecycle states and admin/member copy before expanding export or deletion UI. Retention-off cleanup should be explicit, immediate where safe, and auditable with minimal metadata.

## Current model

Relevant implementation surfaces:

- Retention config in `apps/server/src/config.ts`:
  - `AGENT_TICK_APPROVAL_RETENTION_DAYS`
  - `AGENT_TICK_STATUS_UPDATE_RETENTION_DAYS`
  - `AGENT_TICK_AUDIT_RETENTION_DAYS`
  - device/invite cleanup windows
  - cleanup enable/interval/lock settings
- Cleanup service in `apps/server/src/services/retention.ts`.
- Database cleanup methods in `packages/db/src/index.ts` and `packages/db/src/postgresStore.ts`.
- Hosted personal entitlement lifecycle in `apps/server/src/services/personalEntitlements.ts`.
- `delete_account_data` event in `apps/server/src/routes/billing.ts`, currently routed to hosted personal data deletion.
- Mobile History screen and dashboard audit/history surfaces.

## Definitions

| Term | Meaning |
| --- | --- |
| Activity History | Human-visible request/response history, approval status, status updates, and related request timeline. |
| Audit Events | Minimal administrative/security evidence such as token creation, invite changes, policy changes, and response records. |
| Diagnostics | Optional troubleshooting events from mobile/admin surfaces; should exclude approval content. |
| Hosted personal data deletion | Hosted account lifecycle action that disables hosted routing and removes hosted personal approval/activity data where safe. |
| Retention-off cleanup | Configuration or account state where history retention is zero or disabled and existing eligible records should be cleaned promptly. |

## User-facing states

### Active retention

Visible copy:

- “Activity History is retained according to your workspace settings.”
- “Admins may keep minimal audit metadata for security and billing integrity.”

Expected behavior:

- History and audit surfaces show available records.
- Cleanup timer deletes records older than configured windows.
- Users can understand approximate retention periods.

### Retention disabled / zero days

Visible copy:

- “Activity History retention is off. New request and status history is cleaned as soon as the cleanup job runs.”
- “Minimal audit metadata may remain for security, abuse prevention, and billing integrity.”

Expected behavior:

- Approval request and status update retention policy should remove eligible records on startup and scheduled cleanup.
- UI should not show a stale history list as if retention were active.
- Admins should see the last cleanup result/time if available.

### Read-only grace

Visible copy:

- “Hosted personal service is in read-only grace. You can view recent history during the grace period, but responses are disabled.”

Expected behavior:

- Existing history remains visible for the grace period.
- Push/routing response behavior follows entitlement lifecycle.
- Copy explains when history will be removed or become unavailable.

### Expired hosted personal service

Visible copy:

- “Hosted personal service is inactive. Recent hosted Activity History may no longer be retained.”

Expected behavior:

- Routing and responses are disabled.
- Activity History should not imply continued hosted retention.
- Restore/resubscribe path should explain whether old history returns; default assumption should be no guarantee.

### Deleted hosted personal data

Visible copy:

- “Hosted personal data deletion requested. Hosted tokens/devices/history are removed or revoked where safe. Minimal operational metadata may remain.”

Expected behavior:

- Agent tokens revoked.
- Devices unregistered.
- Approval requests, status updates, diagnostics, event tickets, and personal hosted data removed where applicable.
- Billing/account integrity metadata may remain.
- UI should show a terminal deleted state rather than an empty-but-active dashboard.

## Cleanup UX requirements

### Dashboard/admin

Add a privacy/history panel that shows:

- Activity History retention setting or lifecycle-derived retention state.
- Last cleanup run status if available.
- Counts or coarse categories of records affected, avoiding sensitive content.
- Explanation of what audit metadata remains.
- Link to deletion controls when hosted personal deletion is available.

Do not show advanced cleanup controls to a new solo user before setup is complete. Link from Settings/Privacy or account management after the main setup flow.

### Mobile

Mobile Settings should show compact copy:

- current lifecycle: Trial, active, read-only grace, expired, deleted
- whether Activity History is expected to be available
- where deletion/export controls live

Mobile History should show empty states that explain retention/deletion, not just “No approval history yet,” when history was cleaned or account data was deleted.

### Deletion confirmation

Deletion UI should require an explicit confirmation step that lists:

- what will be removed/revoked
- what may remain
- whether this affects self-hosted servers
- whether the action is reversible
- current server/workspace/account context

Suggested confirmation copy:

> Delete hosted personal data for this Agent Tick account. This revokes hosted tokens/devices and removes hosted Activity History where safe. Minimal operational metadata may remain for billing, abuse prevention, and system integrity. Self-hosted servers are not affected.

## Backend backlog

1. Add a typed cleanup/deletion status endpoint for the current account/workspace.
2. Persist last cleanup run result/time separately from logs so UI can show current state.
3. Return lifecycle-aware history availability from hosted personal status.
4. Split destructive deletion into preview and execute endpoints if the current `delete_account_data` event remains internal/test-like.
5. Add audit-safe deletion events that do not preserve deleted approval content.
6. Ensure retention `0` has clear semantics and tests for immediate eligibility.
7. Add tests covering SQLite and Postgres cleanup parity for approval requests, status updates, audit events, diagnostics, invites, devices, and event tickets.

## Frontend backlog

1. Add dashboard privacy/history lifecycle panel.
2. Add deletion preview/confirmation copy.
3. Add lifecycle-specific Activity History empty states.
4. Add mobile Settings summary of hosted history availability.
5. Add mobile History empty states for cleaned/deleted/expired history.
6. Add copy to privacy docs that maps lifecycle states to data behavior.

## Audit and privacy expectations

- Do not log deleted request content in deletion audit events.
- Do not send deletion details to analytics.
- Diagnostics must exclude approval text, commands, bearer tokens, Clerk secrets, and raw user-entered content.
- Cleanup jobs should be idempotent and safe to run repeatedly.
- Deletion should revoke future hosted access before or while deleting historical data to prevent races.
- Self-hosted data remains the responsibility of the self-hosted operator.

## Validation plan

Unit/server tests:

- retention `0` removes eligible records on cleanup.
- retention disabled leaves records untouched only when cleanup is explicitly disabled.
- hosted personal deletion revokes tokens/devices and removes personal hosted history.
- audit events after deletion contain safe metadata only.
- SQLite and Postgres cleanup behavior match.

UI tests once implemented:

- active retention state copy.
- retention-off empty state.
- read-only grace history copy.
- deleted hosted personal data state.
- deletion confirmation prevents accidental execution.

## Open questions

- Should hosted personal deletion be available from mobile, dashboard, or both?
- Should audit retention ever be allowed to be zero for hosted accounts, or only self-hosted?
- What exact operational metadata is required for billing/refund/abuse integrity?
- Should deletion trigger an email receipt?
- Should cleanup status show exact counts or coarse categories only?
- Should expired hosted personal history be deleted immediately or after a fixed grace period?

## Decision

Activity History cleanup/deletion polish should land as lifecycle-aware UX and backend status before adding richer export controls. Retention-off and deletion states must be explicit, safe, auditable, and honest about what can remain.
