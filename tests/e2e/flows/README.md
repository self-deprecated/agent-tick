# Product-flow E2E tests

This directory contains Playwright tests for the current Workspace, Request, Activity, and Routing Rule flow contracts.

Current specs:

- `solo-onboarding.spec.ts`
- `agent-mobile-request-lifecycle.spec.ts`
- `workspace-members.spec.ts`
- `shared-workspace-routing.spec.ts`
- `routing-rules.spec.ts`
- `management-and-upgrade-gates.spec.ts`

Run these against a server started with `AGENT_TICK_MODE=clerk` and `AGENT_TICK_TEST_AUTH=1`. The tests skip when deterministic test auth is unavailable.
