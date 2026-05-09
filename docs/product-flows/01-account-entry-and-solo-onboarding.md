# Account entry and solo onboarding

## Goal

A new user should first see a polished Clerk-powered sign-in/create-account surface. After sign-in, the dashboard should focus only on the solo setup path: create an agent token, run CLI setup, install/sign into the mobile app, then send a first test request.

## Preconditions

- Hosted/Clerk mode: user is not signed in.
- Self-hosted single mode: local/admin authentication may replace Clerk, but the same onboarding state model applies after authentication.
- The user has no connected agent and no registered mobile device.

## Signed-out UI

Expected visible:

- Agent Tick brand and concise value proposition.
- Clerk `SignIn`/`SignUp`-style account surface.
- Provider options: GitHub, Google, Apple.
- Email account creation/sign-in option.
- Copy explaining that mobile is the primary approval surface.

Expected hidden:

- approval queue
- agent token list
- team/org admin
- approval rules/policies
- audit/activity history

## First signed-in UI

Expected visible:

- “Welcome. Let’s connect one agent.”
- setup checklist with:
  1. create an agent token
  2. run the CLI setup command
  3. install/sign into the mobile app
- explicit explanation that approvals will appear only after setup creates a real request

Expected hidden:

- approval queue/action buttons
- approval rule editor
- invites/team settings unless the user explicitly enters team setup
- audit/history

## State transitions

| State | Trigger | Next state |
| --- | --- | --- |
| signed_out | user signs in or creates account | needs_agent_token |
| needs_agent_token | user creates first token | needs_cli_setup |
| needs_cli_setup | CLI validates token and records heartbeat | needs_mobile_app |
| needs_mobile_app | mobile device signs in/registers | ready_for_first_request |

## Database expectations

After first sign-in:

- user exists
- personal/default organization membership exists
- no agent token is required yet
- no device is required yet

After onboarding advances:

- token creation produces an `agent_tokens` row with no plaintext token stored
- CLI heartbeat/presence is recorded or derivable
- mobile sign-in produces a device row

## E2E coverage

Target: `tests/e2e/flows/solo-onboarding.spec.ts`

Assertions:

- signed-out page shows provider/email account entry
- signed-out page hides dashboard-only surfaces
- signed-in first-run page shows setup checklist
- approval/team/rule/audit surfaces are hidden before setup
- creating a token advances the UI to CLI setup
- database contains expected user/org/token state
