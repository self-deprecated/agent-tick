# Organization invite flow

## Goal

Let a user join an organization from an invite link without exposing raw admin UI. The invite page should explain who invited them, what role they requested, and whether admin approval is required.

## Preconditions

- An organization invite exists.
- User may be signed out, signed into a matching account, or signed into a non-matching account.

## UI states

### Invite preview before sign-in

Expected visible:

- organization name
- requested role
- whether the invite is a legacy approval-required invite or a launch active-on-accept invite
- expiration if relevant
- Clerk sign-in/create-account surface

Expected hidden:

- organization internal IDs
- team IDs
- invite token internals
- admin invite table

### Accepted immediately

Expected visible:

- “Welcome to {organization}”
- selected organization/workspace context
- next setup action for that workspace

Database expectation:

- active organization membership exists
- team membership exists if invite assigned teams
- invite usage count updated

### Legacy pending admin approval

Expected visible:

- pending approval explanation
- “we’ll notify you” style message
- personal workspace fallback

Database expectation:

- no active membership yet
- membership request exists with requested role/team IDs
- pending seat usage increments

### Error states

Expected states:

- expired invite
- revoked invite
- wrong email/domain
- already accepted
- seat limit reached

## E2E coverage

Target: `tests/e2e/flows/organization-invites.spec.ts`

Assertions:

- invite preview is safe and does not leak private fields
- signed-out invite flow routes through auth
- launch Owner/Admin invites create active Admin or Member membership immediately; legacy approval-required invites may create a pending request
- pending requests are visible to admins and not active for the requester
- revoked/expired/domain-restricted invites show the correct UI and DB state
