# Agent Tick product flow contracts

These documents are the source of truth for the dashboard redesign. Each flow describes the intended user experience, the product states that must exist, and the E2E coverage required before or alongside implementation.

The design direction is the friendly/professional onboarding system explored in:

- `scratch/agent-tick-onboarding-flow/index.html`
- `scratch/agent-tick-expanded-flows/index.html`

## Principles

1. **Do not show empty advanced product areas too early.** A new solo user should not see approval queues, policy editors, audit logs, team admin, or governance surfaces before they have configured an agent and mobile app.
2. **Mobile is primary for approvals.** The web app guides setup, shows status, and may later offer web approvals as an explicit secondary option.
3. **Use progressive disclosure.** Solo setup comes first. Team workspaces, invites, approval rules, activity history, and billing gates unlock only when relevant.
4. **Document and test every state transition.** Each flow must define preconditions, actions, UI expectations, and database expectations.
5. **Prefer deterministic E2E setup.** Full flow tests should use seeded users and local/test auth where possible. Real Clerk should remain a small smoke suite.

## Flow map

| Phase | Flow | Document | Primary E2E target |
| --- | --- | --- | --- |
| 1 | Account entry and solo onboarding | [`01-account-entry-and-solo-onboarding.md`](./01-account-entry-and-solo-onboarding.md) | `tests/e2e/flows/solo-onboarding.spec.ts` |
| 1 | Agent token, CLI, mobile, first approval lifecycle | [`02-agent-mobile-approval-lifecycle.md`](./02-agent-mobile-approval-lifecycle.md) | `tests/e2e/flows/agent-mobile-approval-lifecycle.spec.ts` |
| 2 | Join organization by invite | [`03-organization-invites.md`](./03-organization-invites.md) | `tests/e2e/flows/organization-invites.spec.ts` |
| 2 | Create organization and team workspace | [`04-organization-team-workspaces.md`](./04-organization-team-workspaces.md) | `tests/e2e/flows/organization-team-workspaces.spec.ts` |
| 2 | Approval rules | [`05-approval-rules.md`](./05-approval-rules.md) | `tests/e2e/flows/approval-rules.spec.ts` |
| 3 | Agent/device management and upgrade gates | [`06-management-and-upgrade-gates.md`](./06-management-and-upgrade-gates.md) | `tests/e2e/flows/management-and-upgrade-gates.spec.ts` |
| 3 | Approval Access management polish | [`07-approval-access-management.md`](./07-approval-access-management.md) | `tests/e2e/flows/approval-access-management.spec.ts` |

## E2E harness requirements

The redesigned flows need a stronger harness than the current smoke tests.

### Required support helpers

Create helpers under `tests/e2e/support/` for:

- starting each test with a clean or uniquely named test database
- creating a deterministic signed-in human user without relying on Clerk hosted UI for every test
- creating organizations, invites, teams, policies/rules, agent tokens, approval requests, and mobile devices
- reading database state at the end of a test
- common page-object selectors for onboarding screens

### Test auth approach

Use two layers:

1. **Deterministic local/test auth for full flow tests.** This should simulate the same server-side identity shape Clerk produces, but avoid hosted Clerk UI and real external accounts.
2. **Real Clerk smoke coverage.** Keep a small suite that verifies the real Clerk redirect/session integration still works.

### Database assertions

Each E2E flow should assert both:

- the UI elements shown/hidden for the user
- the database records produced by the flow

Examples:

- agent token plaintext is shown once, but only hashed token data is stored
- mobile device registration creates a device record and changes onboarding state
- accepting an invite creates either an active membership or a pending membership request
- approval rule creation creates a policy record with the expected organization/team/quorum

## Test implementation rule

Do not add non-skipped E2E tests for redesigned UI states until the corresponding UI exists. Flow docs can be added first; executable tests should land with or immediately before the feature implementation they verify.
