---
title: Add approval policy templates and management UI
priority: high
---

## Goal

Let users configure who can approve agent actions using approachable policy templates instead of hand-written workflow configuration.

## Acceptance Criteria

- [ ] Add approval-policy and approval-policy-step storage for owner-only, any-team-member, on-call, recently-active, quorum, sequence, and risk-based templates.
- [ ] Add typed policy models in Go and TypeScript.
- [ ] Add CRUD APIs for policies scoped to organization/project/team with role-based authorization.
- [ ] Add validation for policy settings such as team membership, quorum size, timeout, escalation target, and deny-veto behavior.
- [ ] Add a Svelte policy builder that starts from templates: Just me, Anyone on a team, On-call person, Most recently active, Require multiple approvals, Multi-step flow.
- [ ] Add a policy preview explaining who would be notified if a request arrived now, using best-effort data available before presence/on-call is fully implemented.
- [ ] Allow projects and agents to select a default policy.
- [ ] Update approval-request creation to resolve the effective policy from request hint, agent default, project default, or organization default.
- [ ] Reject request policy hints that the agent token is not permitted to use.
- [ ] Add tests for policy CRUD, validation, default resolution, and unauthorized policy use.

## UX Notes

- Keep templates human-readable. Avoid exposing raw JSON unless behind an advanced/debug panel.
- Each policy should have plain-language summary text like “Requires 2 approvals from Backend Team; any denial blocks the command.”
