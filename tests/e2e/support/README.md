# E2E support harness plan

This directory is reserved for shared helpers used by the product-flow E2E tests described in `docs/product-flows/`.

The redesign should add helpers here before large UI implementation lands.

## Planned helpers

- `auth.ts` — deterministic test auth / mock-Clerk sign-in helpers.
- `db.ts` — database inspection helpers for Playwright assertions.
- `fixtures.ts` — user, organization, invite, team, rule, agent token, device, and approval fixtures.
- `pages.ts` — common page-object selectors for onboarding and management screens.

## Constraints

- Full product-flow E2E tests should not depend on real hosted Clerk for every run.
- Real Clerk should remain covered by a small smoke suite.
- Tests must assert both UI state and database state.
- Do not commit active non-skipped tests for UI that does not exist yet.
