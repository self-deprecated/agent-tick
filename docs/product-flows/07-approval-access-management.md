# Approval Access management polish

## Goal

Make it obvious who can approve Agent Tick requests, why they can approve them, and what an admin or member can do when access is wrong. “Approval Access” is the product label for a human’s ability to receive and answer bounded Agent Tick requests through organization membership, team membership, and approval rules.

This flow is a polish backlog, not a new permission model. It should clarify the existing Owner/Admin/Member roles, team membership, project/team scoped approval rules, and invite/request states before adding guest access or more advanced policy features.

## Current surfaces to unify

- Organization membership and role APIs in `apps/server/src/routes/organizations.ts` and the database stores.
- Organization invite preview/accept flows in `apps/server/src/routes/invites.ts` and `apps/admin/src/App.svelte`.
- Team membership management in `apps/server/src/routes/teams.ts` and the dashboard team sections.
- Approval rules/policies in `apps/server/src/routes/policies.ts` and the dashboard policy sections.
- Mobile copy that says team and organization access is managed on the dashboard.
- Audit events that record invite, membership, team, policy, and approval actions.

## Role language

Use simple role copy everywhere the dashboard discusses access:

| Role | Dashboard copy | Approval Access meaning |
| --- | --- | --- |
| Owner | Full workspace owner. Can manage billing, members, rules, tokens, and deletion. | Can approve when included by a rule, team, or direct recipient; ownership alone should not silently approve every request. |
| Admin | Workspace admin. Can manage invites, members, teams, rules, and agent setup. | Can approve when included by a rule, team, or direct recipient; admin role should be shown as management access, not blanket approval access. |
| Member | Workspace member. Can receive approvals assigned to them or their teams. | Can approve only when a rule, team, or direct recipient makes them eligible. |
| Pending request | Waiting for an admin to approve membership. | No Approval Access yet; explain what is blocked and how to contact an admin. |
| Removed/revoked | No active workspace access. | No Approval Access; hide request queues for that workspace and show a safe account-switch/rejoin path. |

## Admin UX improvements

### Access overview

Add an “Approval Access” card to the organization admin area after a workspace has at least one member, team, or approval rule.

Expected visible:

- Counts for active members, pending requests, teams, and enabled approval rules.
- A short explainer: “Members can approve only when a rule, team, or direct request makes them eligible.”
- Warnings for risky gaps:
  - no admins besides the current user
  - no enabled approval rules
  - a team-scoped rule with an empty team
  - quorum greater than eligible active members
  - pending requests consuming seats but not receiving approvals yet

Expected hidden:

- raw membership IDs, team IDs, policy IDs, and invite tokens unless copied for support.
- low-level database/audit terminology.

### Member table polish

For each active member, show:

- role: Owner/Admin/Member
- teams
- current Approval Access summary:
  - “Can approve: direct requests only”
  - “Can approve: Backend team · production deploy rule”
  - “No current approval rules include this member”
- management actions allowed by the current admin role.

For pending/rejected/removed requests, show a separate “Requests” list with state, requested role, requested teams, source invite label/domain, and next action.

### Invite polish

When creating or reviewing an invite, show:

- role being granted
- teams being assigned
- whether access is active on accept or requires admin approval
- domain/email restriction
- expiry and usage limit
- what Approval Access the recipient will have after accepting

Copy should avoid saying “this invite lets them approve everything.” Prefer: “They can approve requests only when a rule or direct request includes them.”

### Rule impact preview

On approval rule create/edit, show:

- eligible active approvers now
- pending members who would become eligible after approval
- quorum health: `required approvals <= eligible active approvers`
- project/team/agent scope in plain language
- what happens if the team is empty or all eligible members are off-call

## Member UX improvements

Members should have a read-only “My Approval Access” panel in the dashboard and a compact version in mobile Settings.

Expected visible:

- current workspace and role
- teams
- eligible rule summaries
- whether push/mobile is ready to receive requests
- pending/rejected membership requests with next step

Expected hidden:

- admin-only invite/member management actions
- other members’ emails beyond what the organization already exposes
- raw rule IDs and policy internals

## Empty and blocked states

- No organization selected: show personal setup state, not team access management.
- Solo hosted plan: explain that team Approval Access requires upgrade or self-hosting.
- No teams yet: suggest “Create a team” only after at least one teammate/invite exists or the admin explicitly chooses team setup.
- No rules yet: explain that direct requests still work, but team/project routing needs an approval rule.
- Pending member: show “You do not have Approval Access in this workspace yet.”
- Quorum impossible: block rule enablement or show a high-priority warning before saving.

## Privacy and audit expectations

- Access screens should not expose approval content to ineligible users.
- Admins can see membership/rule/audit metadata, not hidden request bodies by default.
- Every access-changing action should write an audit event with actor, target, state change, and safe metadata.
- Audit copy should say “access changed” or “rule changed,” not imply remote command execution.

## Implementation backlog

1. Add pure helpers that compute an Approval Access summary from members, teams, policies, and pending requests.
2. Add dashboard tests for the helper states: no rules, empty team, quorum impossible, member included by team rule, member direct-only.
3. Add the admin “Approval Access” overview card to the existing organization/admin section.
4. Add per-member Approval Access summaries to the members table.
5. Add invite impact preview copy before creating/copying an invite.
6. Add rule impact preview and quorum-health warnings to policy create/edit.
7. Add read-only “My Approval Access” panel for non-admin members.
8. Add mobile Settings summary after dashboard copy settles.
9. Add E2E coverage for admin and member views once the UI exists.

## E2E coverage

Target: `tests/e2e/flows/approval-access-management.spec.ts`

Assertions:

- owner/admin sees the Approval Access overview after team features are relevant.
- member sees read-only access summary and no admin actions.
- pending member sees blocked copy and cannot view workspace approval queues.
- invite preview states what role/team/access will be granted without leaking invite internals.
- rule impact preview catches empty-team and impossible-quorum cases before enablement.
- database/audit state matches member, team, invite, and policy changes.
