# Organization and team workspace flow

## Goal

Let a solo user intentionally create or join a team workspace. Team setup should feel like guided onboarding, not a database admin panel.

## Preconditions

- User is signed in.
- User is active in a personal/solo workspace or has accepted an organization invite.

## Create organization UI

Expected visible:

- organization name form
- explanation of what changes when creating a team workspace
- simple starting mode choices:
  - keep it simple
  - set up teams now
- upgrade/self-host gate if hosted plan does not allow team features

Database expectation:

- organization created
- creator membership role is owner
- selected organization context can switch to the new organization

## Team setup UI

Expected visible:

- first team creation
- invite teammate card
- active/invited/pending teammate status
- simple role labels: owner, admin, approver, viewer

Expected hidden or de-emphasized:

- raw membership IDs
- internal invite IDs unless needed for support
- policy/rule controls until the team exists

Database expectation:

- team record created
- creator is team owner/lead as appropriate
- invited users create invite records or pending requests
- adding/removing team members updates team membership and protects last owner

## E2E coverage

Target: `tests/e2e/flows/organization-team-workspaces.spec.ts`

Assertions:

- solo user can create organization when allowed
- team feature gate appears when hosted solo is locked
- creating team creates expected DB records
- inviting teammate creates invite state
- approving membership request activates membership and team membership
- role and removal restrictions are enforced
