# Team Routing polish backlog

## Goal

Make team-based request routing understandable before, during, and after an Agent Tick request. A user should be able to answer: who was eligible, who was notified, why this request landed on my phone, and what happens when no ideal approver is available.

This backlog documents UX gaps around teams, availability, quorum, and unrouted interactions. It should refine the existing routing model rather than introduce a new remote-execution or arbitrary-command system.

## Current routing model

Existing implementation surfaces to preserve and clarify:

- Agent tokens can carry `projectId`, `teamId`, and `defaultApprovalPolicy` metadata.
- Policies can scope approvals by project/team and require a quorum through `requiredApprovals`.
- Team-scoped policy routing resolves active team members whose organization role and team role can respond.
- Availability is considered when team-scoped recipients are resolved.
- If no available team member can receive a team-scoped request, routing can fall back to unavailable eligible members and then organization admins.
- Responses are still bounded Agent Tick Requests: Status Updates, Steering, and Sanctions.

## Language

Use “routing” for deciding who receives a request. Use “eligibility” for who is allowed to respond. Use “availability” only for interruption preference.

Avoid copy that implies Agent Tick can run commands from the phone. Approval copy should say the local agent continues only after receiving a bounded response.

## Routing states to expose

| State | Meaning | User-facing copy direction |
| --- | --- | --- |
| Direct recipient | The request targeted one human/device/session directly. | “Sent directly to you.” |
| Organization default | No team policy applied; active organization responders are eligible. | “Any eligible workspace approver can respond.” |
| Team rule matched | A policy/team route matched the request. | “Routed to {team} by {rule}.” |
| Quorum pending | More approvals are required. | “Waiting for {n} more approval(s).” |
| Team empty | The matched team has no eligible active members. | “This rule has no eligible team approvers.” |
| Everyone unavailable | Eligible team members exist but are off-call/busy/do-not-disturb. | “Eligible approvers are unavailable; fallback routing may apply.” |
| Admin fallback | No available team recipient was found, so admins are included. | “Fallback sent to workspace admins because no available team approver was found.” |
| Unrouted | No policy/team/default route could choose a recipient. | “No route matched; review the agent token and approval rules.” |
| Impossible quorum | Required approvals exceed eligible active approvers. | “This rule cannot be satisfied until more eligible approvers are added or quorum is lowered.” |

## Admin UX gaps

### Routing preview on agent tokens

When creating or editing an agent token, preview:

- selected project/team/default approval rule
- who would receive a test sanction today
- whether fallback admins would be used
- unavailable/off-call members that are eligible but unlikely to be interrupted

Warn before saving if:

- the selected default policy is disabled or archived
- selected team has no eligible active members
- quorum is impossible
- no mobile-ready member exists for a route that depends on push/mobile

### Routing preview on approval rules

Approval rule create/edit should include an impact panel:

- matched scope: any request, project, team, or agent-token default
- eligible approvers now
- pending members who would become eligible after admin approval
- current availability breakdown: available, busy, do-not-disturb, off-call, unknown
- quorum health
- fallback behavior

The preview should update before save so admins do not learn routing is broken only when a production request arrives.

### Team member management

Team screens should show:

- which rules currently use the team
- whether removing a member breaks quorum
- whether the team has at least one owner/lead and at least one approval-eligible member
- availability state for members when relevant

Removing the last approval-eligible member from a routed team should require a confirmation explaining which rules become unhealthy.

### Unrouted interactions inbox

Admins need a safe review surface for requests that were not routed cleanly:

- request type and safe metadata
- agent token / project / team / policy metadata
- why routing failed or fell back
- suggested fixes, such as assign a default approval rule, add team members, lower quorum, enable the policy, or ask the agent to retry after setup

Do not expose approval content to users who were not eligible for the original request unless the admin role intentionally grants that visibility.

## Member UX gaps

### Why am I seeing this?

Mobile and dashboard request details should include compact routing context:

- “You are on {team}.”
- “{rule} requires {n} approval(s).”
- “You are receiving this as an admin fallback.”
- “You can respond because you are an eligible member of {team}.”

### Availability expectations

Availability should be framed as interruption preference, not permission:

- Available: normal routing target.
- Busy / Do Not Disturb / Off-call: avoid interruption where possible, but an admin fallback or explicit direct request may still appear depending on policy.
- Unknown: treat conservatively and show setup prompts for mobile/presence.

### Waiting states

After a member approves a quorum request, show:

- their vote was recorded
- how many approvals remain
- who can still respond, if visible under privacy rules
- whether the request has timed out or was resolved elsewhere

## Backend and API backlog

1. Add a pure routing preview helper that returns eligible members, availability breakdown, fallback reason, and quorum health without creating a request.
2. Reuse the helper in policy create/update validation, agent-token previews, and admin diagnostics.
3. Persist a safe routing explanation on each approval request, separate from sensitive request content.
4. Add structured recipient source labels beyond current internal strings such as `policy_team`, `unrouted_unavailable`, and `unrouted_admin`.
5. Add API fields for routing health so the dashboard/mobile apps do not duplicate backend logic.
6. Consider blocking policy enablement when quorum is impossible; allow saving disabled drafts.
7. Add audit events for routing fallback and policy health changes.

## Dashboard backlog

1. Add routing health to the policy list.
2. Add a live impact preview to policy create/edit.
3. Add a routing preview to agent token create/edit.
4. Add team rule-impact warnings to team member removal.
5. Add an admin unrouted/fallback review panel.
6. Add member-facing “why you received this” copy in request detail.

## Mobile backlog

1. Show one-line routing context on approval details.
2. Show quorum progress after vote submission.
3. Explain admin fallback when a request reaches an admin because a team was unavailable.
4. Link to dashboard for team/rule management rather than exposing admin controls on mobile.
5. Keep notification payloads minimal; routing context can load inside the app after auth.

## E2E coverage

Target: `tests/e2e/flows/team-routing-polish.spec.ts`

Assertions:

- policy preview catches empty-team and impossible-quorum routes.
- agent-token preview shows the selected default policy and expected recipients.
- request detail explains team-rule routing for an eligible member.
- admin fallback is clearly labeled when all eligible team members are unavailable.
- member removal warns when it would break a routed rule.
- unrouted request review shows safe metadata and suggested fixes without leaking approval content to ineligible users.

## Open product questions

- Should admin fallback be configurable per rule, or always enabled for launch safety?
- Should off-call members ever receive push notifications for high-importance sanctions?
- Should unknown availability count as available, unavailable, or “eligible but unverified” in quorum previews?
- When a route is impossible, should the agent request fail immediately or create an admin-visible setup issue?
