---
title: Add organization, team, and project foundations
priority: high
---

## Goal

Introduce the SaaS/team data model that lets Agent Tick group users, agents, projects, and devices under organizations and teams without breaking the existing single-user flow.

## Acceptance Criteria

- [ ] Add SQLite migrations for organizations, organization memberships, teams, team members, projects, and invites or invite-ready records.
- [ ] Backfill existing single-user installs into a default organization, default project, and default owner membership.
- [ ] Add role concepts for at least owner, admin, approver, and viewer.
- [ ] Extend auth/context helpers so API handlers know the current user, organization, and role.
- [ ] Add store interfaces and implementations for creating/listing/updating teams, team members, and projects.
- [ ] Add REST endpoints for team and project management, protected by role checks.
- [ ] Add audit events for organization/team/project creation and membership changes.
- [ ] Update the Svelte admin navigation to include Teams and Projects sections with basic list/create/detail screens.
- [ ] Existing approval, device, and agent-token endpoints continue to work in single mode and user mode.
- [ ] Add backend tests for migrations, default backfill, membership checks, and endpoint authorization.

## UX Notes

- Make the first-run experience simple: create an organization name, then optionally create a team.
- Do not require small/self-hosted users to understand organizations before they can pair a phone or create an agent token.
