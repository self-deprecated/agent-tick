---
title: Add presence, availability, and on-call routing
priority: medium
---

## Goal

Support approval routing based on who is currently available, who was most recently active on mobile, and who is on call for a team.

## Acceptance Criteria

- [ ] Add device/user heartbeat endpoints and store `last_seen_at` for mobile/web clients.
- [ ] Add user availability state such as available, busy, do-not-disturb, off-call, and manual override expiration.
- [ ] Add team on-call schedule storage with current primary/secondary approver support.
- [ ] Add APIs and Svelte admin screens to view and edit team availability and on-call schedules.
- [ ] Implement policy resolution for on-call-person and recently-active templates.
- [ ] Add escalation behavior when the selected approver does not respond within the configured timeout.
- [ ] Show team coverage status in the dashboard, including “who would receive a request right now.”
- [ ] Update mobile app to send heartbeat/availability updates at safe intervals and expose manual availability controls.
- [ ] Add privacy-conscious copy/settings explaining what last-seen and availability mean.
- [ ] Add tests for heartbeat, availability transitions, on-call resolution, recently-active routing, and escalation.

## UX Notes

- The policy preview should say things like: “If a request arrived now, Alice would be notified first; Bob is fallback after 5 minutes.”
- Avoid making users feel tracked: show coarse availability and give clear controls for do-not-disturb/off-call.
