# Organization Invite and Membership Approval Flow

## Summary

Agent Tick should support organization invite links that work well for both existing and new users. An organization admin or owner can create an invite link, share it with one person or many people, and invited users can accept the invite after signing in or creating an account.

Accepting an invite should not immediately grant full organization access by default. Instead, the accepting user enters a **pending approval** state. An organization admin or owner must approve the pending member before they become an active organization member and receive team access.

This supports safer long-lived and reusable invite links while keeping onboarding smooth.

## Goals

- Let organization admins/owners create invite links from the dashboard.
- Support both one-time invites and reusable onboarding links.
- Support long-lived invites with optional expiration.
- Let existing users accept an invite after signing in.
- Let new users create an account from an invite and continue the invite flow.
- Put accepted invite users into a pending approval state by default.
- Give admins/owners a clear pending member approval queue.
- Only active approved members should access organization resources.

## Non-goals for the first version

- Email delivery of invites.
- SSO or SCIM provisioning.
- Complex per-team approval workflows.
- Public directory/user search.

These can be added later once the link-based invite and approval flow is solid.

## User flows

### Admin creates an invite

From the Organization page, an admin or owner opens an **Invite people** panel and configures:

- Invite label, for example `Backend onboarding link`.
- Organization role to grant after approval: `viewer`, `approver`, `admin`.
- Optional teams to add the user to after approval.
- Whether approval is required. Default: `true`.
- Maximum uses:
  - `1` for a single-use invite.
  - a positive number for a capped reusable invite.
  - empty/null for unlimited usage.
- Expiration:
  - short-lived invites, for example 7 or 30 days.
  - long-lived onboarding links, for example 90/365 days or no expiry.
- Optional email or domain restriction.

After creation, the dashboard shows a copyable invite URL:

```text
/invite/{token}
```

The raw token should be shown only once. The server stores only a token hash.

### Existing user accepts an invite

1. User opens `/invite/{token}`.
2. If already signed in, they see an invite preview:
   - organization name
   - requested role
   - requested teams
   - whether admin approval is required
3. User clicks **Accept invite**.
4. Server validates the invite and records a pending membership request.
5. User sees:

```text
Request sent. An organization admin needs to approve your access before you can use this organization.
```

### New user accepts an invite

1. User opens `/invite/{token}`.
2. User sees a preview before account creation.
3. User signs in or creates an account.
4. After successful account creation, the dashboard automatically continues the invite acceptance.
5. User lands on a pending state page:

```text
Account created. Your request to join Acme is pending admin approval.
```

Pending users should not see organization approvals, agents, projects, teams, billing, or audit data until approved.

### Admin approves or rejects a pending member

The Organization page includes a **Pending members** section.

Each pending row shows:

- user name and email
- invite label/source
- requested role
- requested teams
- accepted time
- approve action
- reject action

Approving:

- changes the membership status to `active`
- applies the requested organization role
- adds requested team memberships
- records audit events

Rejecting:

- marks the request as `rejected`
- does not grant organization/team access
- records an audit event

## Membership states

Organization membership should distinguish pending and active users.

Recommended statuses:

```text
pending_approval
active
rejected
removed
```

Only `active` memberships should be accepted by authorization checks.

Pending members:

- can see their own pending state
- cannot list organization resources
- cannot approve requests
- cannot receive team approval push notifications
- should not count as eligible approvers

Seat billing can either count pending members separately or exclude them from active seats. The first implementation should avoid treating rejected/removed users as active seats.

## Invite behavior

### Default safe invite

Default invite settings should be conservative:

- approval required: `true`
- expiration: 30 days
- max uses: 1
- role: `viewer` or `approver`, depending on product preference

### Reusable invite

Reusable invites are useful for onboarding groups, contractors, or team-specific setup docs.

Reusable invite settings:

- `maxUses` greater than 1, or null for unlimited
- optional long expiration
- approval required strongly recommended
- label required or encouraged

Admin UI should make reusable links visibly different from one-time links.

### Long-lived invite

Long-lived invites should be allowed, but safe because users remain pending until approved.

Recommended UI copy:

```text
Long-lived links can be used later by anyone with the URL. Users will still require admin approval before getting access.
```

### Invite restrictions

Optional restrictions:

- exact email, for single-person invites
- email domain, for organization onboarding links

If a signed-in user's email does not match the invite restriction, acceptance should fail with a clear message and offer account switching.

## Proposed backend model

### organization_invites

```sql
CREATE TABLE organization_invites (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  created_by_user_id TEXT NOT NULL,

  label TEXT,
  role TEXT NOT NULL,
  team_ids_json TEXT NOT NULL DEFAULT '[]',

  approval_required INTEGER NOT NULL DEFAULT 1,

  email TEXT,
  domain TEXT,

  expires_at TEXT,
  max_uses INTEGER,
  used_count INTEGER NOT NULL DEFAULT 0,

  revoked_at TEXT,
  created_at TEXT NOT NULL
);
```

`max_uses` semantics:

- `NULL`: unlimited uses
- `1`: single-use invite
- `N`: accept up to `N` users

### organization_invite_acceptances

For reusable invites, acceptance history should be tracked separately.

```sql
CREATE TABLE organization_invite_acceptances (
  id TEXT PRIMARY KEY,
  invite_id TEXT NOT NULL,
  organization_id TEXT NOT NULL,
  user_id TEXT NOT NULL,

  requested_role TEXT NOT NULL,
  requested_team_ids_json TEXT NOT NULL DEFAULT '[]',

  status TEXT NOT NULL,
  accepted_at TEXT NOT NULL,

  decided_by_user_id TEXT,
  decided_at TEXT
);
```

Suggested statuses:

```text
pending_approval
approved
rejected
```

A unique constraint on `(invite_id, user_id)` prevents duplicate pending requests for the same invite/user pair. A separate uniqueness rule may also prevent multiple active/pending requests for the same organization/user.

### organization_memberships changes

Add status and decision metadata:

```sql
ALTER TABLE organization_memberships ADD COLUMN status TEXT NOT NULL DEFAULT 'active';
ALTER TABLE organization_memberships ADD COLUMN approved_by_user_id TEXT;
ALTER TABLE organization_memberships ADD COLUMN approved_at TEXT;
ALTER TABLE organization_memberships ADD COLUMN rejected_by_user_id TEXT;
ALTER TABLE organization_memberships ADD COLUMN rejected_at TEXT;
ALTER TABLE organization_memberships ADD COLUMN invite_id TEXT;
```

Existing rows should migrate to `active`.

## Proposed API

### Public/authenticated invite endpoints

```text
GET  /v1/invites/{token}
POST /v1/invites/{token}/accept
```

`GET /v1/invites/{token}` returns a safe preview. It may be available while signed out, but should avoid exposing unnecessary internal details.

`POST /v1/invites/{token}/accept` requires an authenticated user session.

### Admin invite management endpoints

```text
GET  /v1/organization-invites
POST /v1/organization-invites
POST /v1/organization-invites/{id}/revoke
```

Requires organization admin or owner.

### Pending membership endpoints

```text
GET  /v1/organization-membership-requests
POST /v1/organization-membership-requests/{id}/approve
POST /v1/organization-membership-requests/{id}/reject
```

Requires organization admin or owner.

## Authorization rules

- Invite preview can be public, but minimal.
- Invite acceptance requires a signed-in user.
- Invite creation/list/revoke requires `admin` or `owner`.
- Approval/rejection requires `admin` or `owner`.
- Only `active` organization memberships satisfy normal organization authorization.
- Pending users can only access their own session and pending invite/membership status.

## Audit events

Record audit events for:

```text
organization_invite.created
organization_invite.revoked
organization_invite.accepted
organization_membership.pending
organization_membership.approved
organization_membership.rejected
organization_membership.upserted
team_member.upserted
```

Each event should include enough context to answer:

- who created the invite
- who accepted it
- who approved or rejected it
- which role and teams were requested
- which invite was used

## Admin UI changes

### Invite people card

Add to the Organization page:

- label input
- role select
- team multi-select
- expiration select/custom date
- max uses input
- approval required toggle, default on
- optional email/domain restriction
- create invite button
- copy invite link result

### Active/reusable invite list

Show:

- label
- role
- teams
- created by
- created date
- expiration
- used count/max uses
- pending count
- approved count
- revoked/active state
- revoke action

### Pending members section

Show pending users with approve/reject buttons and clear copy explaining that pending users do not have access yet.

## Invite acceptance UI

Add a route like:

```text
#/invite/{token}
```

States:

- loading preview
- invalid or expired invite
- signed out preview with sign-in/create-account CTA
- signed in preview with accept CTA
- pending approval success
- already active member
- email/domain mismatch

For a new account created from the invite page, the app should automatically accept the invite after login succeeds.

## Implementation slices

### Slice 1: Core backend

- DB migrations for invites, acceptances, membership status.
- Store methods for create/preview/accept/list/revoke invites.
- Store methods for list/approve/reject pending requests.
- Active-only membership authorization.
- Backend tests.

### Slice 2: Admin and invite UI

- API client methods.
- Invite creation card.
- Invite preview/accept route.
- Pending member approval UI.
- Basic UI tests.

### Slice 3: Reusable invite polish

- Invite list counts.
- Revoke flows.
- Better expired/max-use messaging.
- Long-lived invite warnings.

### Slice 4: Restrictions and billing

- Email/domain restrictions.
- Seat-limit checks at approval time.
- Billing usage separation for active vs pending users.

### Slice 5: Email delivery

- SMTP/provider configuration.
- Send invite email.
- Resend invite.

## Open questions

- Should non-owner admins be allowed to create invites that grant `admin` role?
- Should approval be required for all invite types, or can owners create auto-approved links?
- Should seat limits be enforced at invite acceptance time or approval time? Approval time is probably better.
- Should pending users be visible in global user/member lists, or only in a pending section?
- Should reusable invite URLs be visible after creation? If the raw token is only shown once, admins may need to create a new link if they lose it.
