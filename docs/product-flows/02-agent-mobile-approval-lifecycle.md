# Agent token, CLI, mobile, and first approval lifecycle

## Goal

Move the user from “account exists” to “Agent Tick can receive a real request and notify the phone.” The web app remains setup/status oriented until the user completes the CLI and mobile steps.

## Preconditions

- User is signed in.
- User is in a personal or selected organization.
- User has not yet completed setup, or is managing an existing agent/device.

## UI states

### Token created

Expected visible:

- agent name
- plaintext token shown once
- copyable setup command
- warning that the token cannot be shown again

Expected hidden:

- approval queue unless a real request exists after setup
- advanced token assignment unless team/rule features are unlocked

### CLI connected

Expected visible:

- token saved/verified state
- server reached state
- recent heartbeat state
- next step: install mobile app

### Mobile connected

Expected visible:

- device name
- push status
- last seen
- send test notification action
- send first test request command

### First real approval

Expected visible:

- mobile-first status: “sent to phone”
- request title/body/command only after a real agent request exists
- optional web approval enablement if product chooses to support it

## Database expectations

- `agent_tokens` contains token metadata and hash only.
- token verification succeeds before revoke/rotation.
- device registration creates or updates a device record.
- first approval request is linked to the agent organization and optional agent metadata.
- response state changes only after a valid eligible human/device responds.

## E2E coverage

Target: `tests/e2e/flows/agent-mobile-approval-lifecycle.spec.ts`

Assertions:

- token is visible once in UI and never stored plaintext in DB
- CLI simulation using the token advances setup state
- mobile registration advances setup state
- first approval appears only after request creation
- mobile-primary messaging is visible
- final DB state includes agent token, device, approval request, and response when tested
