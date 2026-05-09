# E2E support harness plan

This directory contains shared helpers used by the product-flow E2E tests described in `docs/product-flows/`.

## Helpers

- `auth.ts` — deterministic test auth / mock-Clerk sign-in helpers.
- `db.ts` — test-state inspection helpers for Playwright assertions.
- `fixtures.ts` — user, organization, agent token, device, and approval fixtures.
- `pages.ts` — common page-object selectors for onboarding and management screens.

## Constraints

- Full product-flow E2E tests should not depend on real hosted Clerk for every run.
- Real Clerk should remain covered by a small smoke suite.
- Tests must assert both UI state and database state.
- Do not commit active non-skipped tests for UI that does not exist yet.
