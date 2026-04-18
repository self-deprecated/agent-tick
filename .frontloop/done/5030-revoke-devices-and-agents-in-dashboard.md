---
title: Remove connected devices and agent in dashboard
priority: medium
---

## Goal

Add the ability to revoke devices and agent tokens from the admin dashboard. Currently the dashboard lists both but provides no way to revoke access.

## Acceptance Criteria

### Backend

- [ ] `store.go` gains a new method `UnpairDevice(deviceID string) error` on the `Store` interface, and `SQLiteStore` implements it by invalidating the device token (the device record stays; it is marked unpaired so its push tokens are no longer used and its token no longer verifies).
- [ ] `ListDevices` returns a field indicating paired/unpaired status so the dashboard can render it.
- [ ] New HTTP endpoint `POST /v1/devices/{deviceId}/unpair` (or `DELETE /v1/devices/{deviceId}/pairing`) in `api.go`, gated by the same admin authentication as `GET /v1/devices`.
- [ ] New HTTP endpoint `POST /v1/agent-tokens/{agentId}/revoke` (or `DELETE /v1/agent-tokens/{agentId}`) that calls the existing `store.RevokeAgentToken`.
- [ ] `ListAgentTokens` returns a field indicating active/revoked status.
- [ ] New unit tests cover the unpair-device and revoke-agent-token endpoints (success + unauthorized).

### Dashboard UI (`admin.go`)

- [ ] Each device row in the Devices section shows a "Revoke" button.
- [ ] Each agent row in the Agents section shows a "Revoke" button.
- [ ] Already-revoked/unpaired rows show their status (e.g. greyed out, "Unpaired" / "Revoked" label) with no Revoke button.
- [ ] Clicking Revoke triggers a native `confirm()` dialog: "Revoke this device?" / "Revoke this agent token? This cannot be undone."
- [ ] On confirm, the dashboard POSTs to the new endpoint and then calls `loadDevices()` / `loadAgents()` to refresh.
- [ ] Errors render via existing `renderError` helper.

### General

- [ ] `go build ./...` and `go test ./...` pass.
- [ ] Mobile app and CLI continue to work; existing endpoints are unchanged.

## Design Decisions

- **"Remove" means revoke, not hard-delete**. Agent tokens and device pairings are soft-revoked so approval history referencing them stays meaningful. No entries are deleted from the database.
- **Agents**: use the existing `RevokeAgentToken` store method; add HTTP endpoint and UI button.
- **Devices**: add a new `UnpairDevice` store method (invalidates the device token, keeps the row). Add HTTP endpoint and UI button.
- **Confirmation UX**: native browser `confirm()` dialog. Matches the dashboard's minimal styling and prevents accidental clicks.

## Implementation Notes

- Title of the original task was ambiguous ("remove" as verb). Clarified: the user wants the *ability* to revoke devices and agents from the dashboard, not removal of the dashboard sections.
- Check the Store interface and SQLiteStore carefully — `UnpairDevice` is new; design it to match the existing revoke/verify patterns (e.g. an `unpaired_at` column or clearing the token hash column).
- The admin dashboard JS in `admin.go` uses vanilla JS + innerHTML. Keep the same style — no framework.
- Reuse existing auth middleware on the new endpoints; do not invent new auth.
