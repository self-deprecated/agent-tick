# Scoped guest approval links research

## Summary

Scoped guest approval links could help incident responders, customers, or one-off reviewers approve a single bounded Agent Tick request without joining an organization or installing the mobile app. They should remain a future optional capability, not a replacement for authenticated organization approvals.

Recommendation: design them as short-lived, one-request, least-permission reviewer tokens with explicit policy opt-in. Do not allow broad queue access, organization browsing, token management, or remote command execution from a guest link.

## Current product model

Agent Tick currently keeps approval authority tied to authenticated organization context:

- Humans respond through `POST /v1/approval-requests/:id/responses` after `requireHuman(...)` and organization eligibility checks.
- Agent-created approval requests can receive a short-lived waiter credential so the creating agent can wait for a terminal response.
- Waiter credentials are intentionally not response credentials. They can only call the wait path for the request they were minted for.
- Organization invites already support link-style entry, but they create or request organization membership rather than one-off approval authority.

That separation is important: waiting for a decision is safe for an agent token; making a decision must remain a human authority path.

## Candidate use cases

Good fits:

- External incident reviewer approves one production mitigation.
- Customer success asks a customer to approve a one-time refund/email draft.
- A contractor reviews one deployment while not needing long-term workspace membership.
- A legal/security stakeholder signs off on one request after seeing bounded context.

Poor fits / non-goals:

- Replacing Owner/Admin/Member organization roles.
- Sharing all pending approvals with a guest.
- Letting a guest create, edit, reroute, or abandon requests.
- Letting a guest execute commands from the phone or browser.
- Long-lived unauthenticated approval portals.
- Bypassing team/quorum policies unless the policy explicitly allows guest reviewer slots.

## Least-permission token shape

A guest approval token should be a new token class, separate from agent tokens, session tokens, invite tokens, and waiter tokens.

Minimum fields to store hashed server-side:

- token hash
- request id
- organization id
- allowed choice ids or allowed response type
- optional reviewer label/email for display and audit
- created by user id or policy id
- expires at
- used at
- revoked at
- max uses, default `1`
- safe metadata such as reason or originating workflow

The raw token should only appear in the link once. The database should store only a hash.

## Link scope

A guest link should allow only:

1. Viewing a minimal review page for one request.
2. Seeing request fields explicitly marked shareable.
3. Choosing one allowed bounded response.
4. Optionally adding a short reviewer note if the policy allows freeform notes.
5. Seeing a terminal confirmation after use or expiration.

A guest link should not allow:

- listing other requests
- reading audit logs
- seeing organization/team/member lists
- changing availability
- creating agent tokens, devices, teams, policies, or invites
- waiting on unrelated requests
- responding after expiration/revocation/use
- choosing a response that was not in the original bounded choices

## Request content sharing

Default should be conservative. Guest links may expose less content than authenticated approvals.

Suggested content levels:

| Level | Guest can see | Suitable for |
| --- | --- | --- |
| Minimal | title, requester, created time, allowed choices | low-risk operational acknowledge/deny |
| Review | title, body, safe metadata, allowed choices | customer approval or external review |
| Command | title, body, command string, risk flags, allowed choices | trusted incident reviewer |
| Encrypted handoff | opaque encrypted content plus out-of-band key flow | sensitive content where guest links are still needed |

Do not include secrets, bearer tokens, raw prompts, private customer data, or hidden approval content in guest-link titles, bodies, metadata, or analytics.

## Policy fit

Guest links should require explicit opt-in at one of these layers:

- per request: creator asks to create one guest link for this request
- per approval template: template allows guest reviewer links
- per policy: policy permits a specific number of guest reviewer slots
- per organization: admins enable guest links and set maximum expiration/content level

Guest links should not silently satisfy team-scoped quorum unless the rule says guest reviewers count. Safer launch posture:

- guest responses count as one bounded decision only when the request explicitly includes a guest-reviewer slot;
- authenticated eligible members still count normally;
- admin fallback remains separate and auditable.

## Abuse and security controls

Required controls before implementation:

- high-entropy unguessable tokens
- token hashes at rest
- one-use default
- short expiry defaults, such as 15 minutes to 24 hours depending on org policy
- revocation endpoint for admins/request creators
- rate limits on preview and respond endpoints
- generic error messages for invalid/expired links
- no organization enumeration from link errors
- CSRF protections suitable for unauthenticated form posts
- clickjacking protections on review pages
- optional email/domain confirmation for higher-risk links
- audit event on creation, preview, response, expiration, and revocation
- content-security review for any attachments/links shown on the page

## Audit model

Every guest-link action should produce safe audit metadata:

- `guest_approval_link.created`
- `guest_approval_link.previewed`
- `guest_approval_link.responded`
- `guest_approval_link.revoked`
- `guest_approval_link.expired` if expiration is materialized by cleanup

Audit payload should include request id, link id, creator/actor when known, reviewer label/email when configured, allowed choice id selected, expiration, and content level. It should not include raw token or sensitive approval body.

## UX direction

### Admin / request creator

Show guest link creation only behind explicit copy:

> Create a one-use guest review link for this request. The recipient can see only the selected review fields and can choose only the allowed response options.

Before showing the link, require confirmation of:

- expiration
- content level
- allowed choices
- whether response counts toward quorum
- reviewer label/email if known

### Guest reviewer

Guest page should show:

- request title and bounded context
- who requested review
- expiration
- allowed choices
- warning that approval lets the local agent continue in its own environment
- no navigation to dashboard or organization admin

After response:

- show final submitted choice
- explain that the link can no longer be used
- do not expose the broader request queue

### Authenticated member collision

If a signed-in organization member opens a guest link, prefer their authenticated identity for audit if they are eligible. If they are not eligible, keep the guest link path separate and label the audit event clearly as guest-link response.

## Implementation sketch

1. Add `guest_approval_links` table with hashed token, request/org scope, allowed choices, content level, expiry, and lifecycle timestamps.
2. Add store methods to create, verify, use, revoke, and clean up guest links.
3. Add `GET /v1/guest-approvals/:token` preview and `POST /v1/guest-approvals/:token/responses` response routes with strict rate limits.
4. Add minimal guest review page outside the authenticated dashboard shell.
5. Add admin/request creator UI for creating and revoking a link.
6. Update policy/template model only after the per-request path is safe.
7. Add E2E tests for valid use, one-use behavior, expiration, revocation, hidden fields, rate limiting, and audit events.

## Open questions

- Should guest links be available on hosted personal, organization plans only, or self-hosted only at first?
- Should guest responses be allowed to approve destructive/production choices, or only deny/request-changes until stronger identity proof exists?
- Should email/domain verification be mandatory for links that expose command text?
- Should guest links support attachments, or only text metadata at launch?
- Should passkey-backed receipt work be a prerequisite for high-risk guest approvals?
- How should guest responses interact with multi-step quorum and policy progress display?

## Decision

Scoped guest approval links fit Agent Tick only if they remain narrow, explicit, auditable, and revocable. They are worth a future design/implementation card, but should not be marketed as available until the one-use token model, content-sharing controls, response eligibility semantics, and audit trail are implemented and tested.
