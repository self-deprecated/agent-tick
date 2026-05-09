# Approval rules flow

## Goal

Make policy setup understandable by presenting policies as “approval rules.” Users should configure who approves which agent actions without needing to understand implementation details.

## Preconditions

- User is signed in.
- User has at least one agent token, or is creating a rule as part of team setup.
- Team/project choices may or may not exist.

## First rule wizard

Expected steps:

1. Choose scope: agent, project, or any request.
2. Choose approvers: only me, anyone in a team, or specific role/group.
3. Choose quorum: one approval or multiple approvals.
4. Choose trigger/context: default, production, command pattern, project/team route.
5. Review and enable.

Expected visible:

- friendly “Who should approve this?” copy
- preview of affected agents/requests
- safe defaults for solo users

Expected hidden/deferred:

- raw policy IDs
- implementation-specific metadata
- advanced matching until needed

## Edit rule flow

Expected visible:

- editable rule name
- approver group
- required approvals
- affected agents preview
- confirm/archive actions

Database expectation:

- policy/rule row created or updated
- agent default policy references update when configured
- team/project constraints are stored correctly
- responder eligibility follows team/quorum settings

## E2E coverage

Target: `tests/e2e/flows/approval-rules.spec.ts`

Assertions:

- user can create a first rule from wizard UI
- database policy matches selected scope/team/quorum
- editing a rule shows impact preview and persists changes
- agent requests route through the configured rule
- ineligible responders cannot approve team-scoped requests
