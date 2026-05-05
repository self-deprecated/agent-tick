---
title: Implement multi-approval backend policy engine
priority: high
---

## Goal

Change approvals from a single-response model to a policy-driven decision model that can collect votes, enforce quorum, and support multi-step approval flows.

## Acceptance Criteria

- [ ] Add approval vote/decision storage that records approver user, device/source, choice, message/answers, step, and timestamp.
- [ ] Preserve compatibility for simple one-person approval requests and existing CLI/mobile polling behavior.
- [ ] Update response handling so an approver vote may leave the request pending until the policy is satisfied.
- [ ] Implement policy evaluation for owner-only, any-team-member, quorum, and sequence policies.
- [ ] Implement configurable deny behavior, including immediate deny-veto where applicable.
- [ ] Track aggregate request state: pending, approved/responded, denied/responded, expired, abandoned, and step-specific pending state.
- [ ] Return policy progress in approval-request API responses, including required approvals, received approvals, current step, and whether the current user has already voted.
- [ ] Publish events for vote recorded, step advanced, final decision reached, expired, and abandoned.
- [ ] Ensure push delivery targets only eligible approvers for the current policy step.
- [ ] Add concurrency tests for simultaneous votes and quorum races.
- [ ] Add CLI/API tests proving the CLI only unblocks after the final policy decision.

## UX Notes

- A user who already voted should see “Waiting for 1 more approval” rather than another approve button.
- Auditability matters: final request history should show who approved/denied and why.
