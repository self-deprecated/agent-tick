---
title: Add agent registration wizard with project and team links
priority: high
---

## Goal

Make it easy to register an agent running on a shared device or machine, link it to a project, and decide which user/team is allowed to approve its requests.

## Acceptance Criteria

- [ ] Extend agent-token records with organization, project, owner user, optional team, and optional default approval policy fields.
- [ ] Add server-side validation so an agent token can only request routing/policies it is allowed to use.
- [ ] Add or update agent-token creation APIs to accept project/team/default-policy metadata and return the token exactly once.
- [ ] Build a Svelte registration wizard: name agent, choose/create project, choose owner, optionally choose team access, choose default approval behavior, then show setup command.
- [ ] Show clear setup instructions for both config-file setup and environment-variable setup.
- [ ] Display agent details in the dashboard: owner, project, linked team, default policy, last request time, scopes, active/revoked status.
- [ ] Add CLI flags and env vars for project/team/policy routing hints, including `AGENT_TICK_PROJECT`, `AGENT_TICK_PROJECT_ID`, `AGENT_TICK_TEAM`, and `AGENT_TICK_APPROVAL_POLICY`.
- [ ] Ensure project/team/policy hints are attached to approval-request metadata or first-class fields for later policy resolution.
- [ ] Add tests proving unauthorized agent tokens cannot route approvals to unrelated users or teams.

## UX Notes

- The wizard should answer: “Where is this agent running, what project is it for, and who can approve it?”
- Generated commands should be copyable and should avoid leaking the token after the first display.
