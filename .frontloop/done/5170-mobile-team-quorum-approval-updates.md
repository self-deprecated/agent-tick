---
title: Update mobile app for team and quorum approvals
priority: high
---

## Goal

Update the phone app so approvers understand team-routed, quorum, and multi-step requests and can vote confidently from mobile notifications.

## Acceptance Criteria

- [ ] Update mobile API types for approval policy progress, votes, current step, team/project/agent metadata, and current-user vote state.
- [ ] Show project, agent, requesting user/token, target team, and approval-policy summary on request detail screens.
- [ ] Allow eligible users to approve/deny once per request or step.
- [ ] After voting, show pending progress such as “You approved. Waiting for 1 more approval.”
- [ ] Render final approval/denial history for completed requests.
- [ ] Handle ineligible users gracefully with read-only status and explanatory copy.
- [ ] Update push-notification handling so team/quorum/step notifications open the correct request.
- [ ] Add settings or account UI affordances for organization/team context where needed.
- [ ] Add or update interaction tests for single approver, team approval, quorum waiting, final quorum decision, denial, and ineligible user views.
- [ ] Run mobile tests and typecheck.

## UX Notes

- The mobile UI should make the current responsibility obvious: “Your approval is needed”, “Waiting for others”, or “You are not an eligible approver.”
- Keep fast approve/deny flows, but never hide quorum or risk context.
