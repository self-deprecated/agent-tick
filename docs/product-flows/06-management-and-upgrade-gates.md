# Management and upgrade gate flows

## Goal

After setup is complete, management pages should retain the friendly/professional look while becoming more operational. Hosted solo users should see clear upgrade gates for team features.

## Agent management

Expected visible:

- agent name
- connection/heartbeat status
- copy setup command
- rotate token
- revoke token
- default approval rule assignment when rules are available

Database expectation:

- rename updates token metadata
- rotate invalidates old token and shows new plaintext once
- revoke prevents future agent authentication

## Mobile device management

Expected visible:

- registered devices
- push enabled/disabled status
- last seen
- send test notification
- remove device
- guidance when no device remains

Database expectation:

- device registration/update records status
- removed device can no longer act
- onboarding readiness changes if all devices are removed

## Upgrade gates

Expected visible in hosted solo mode:

- team/invite/rule collaboration previews
- “Upgrade for teams” or self-host alternative
- no active team admin controls before upgrade

Expected visible in self-hosted/unlocked mode:

- organization/team setup entry points
- invite and rule creation flows

## E2E coverage

Target: `tests/e2e/flows/management-and-upgrade-gates.spec.ts`

Assertions:

- agent rename/rotate/revoke affect DB and API authentication
- device add/test/remove affects DB and setup state
- hosted solo hides team controls and shows upgrade prompts
- unlocked/self-hosted mode shows team setup controls
