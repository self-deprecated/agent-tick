# Product-flow E2E tests

This directory contains Playwright tests for the flow contracts in `docs/product-flows/`.

Current specs:

- `solo-onboarding.spec.ts`
- `agent-mobile-approval-lifecycle.spec.ts`
- `organization-invites.spec.ts`
- `organization-team-workspaces.spec.ts`
- `approval-rules.spec.ts`
- `management-and-upgrade-gates.spec.ts`

Run these against a server started with `AGENT_TICK_MODE=clerk` and `AGENT_TICK_TEST_AUTH=1`. The tests skip when deterministic test auth is unavailable.
