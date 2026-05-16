# Security

Agent Tick is a least-permission approval layer, not a remote shell.

## Bounded Input

Agent Tick returns only responses defined by the original request: a Status Update is one-way, Steering chooses from bounded options, and a Sanction approves or denies one specific action.

## Local Execution

Approved actions execute in the user's local agent environment. The hosted service, dashboard, and Native App cannot invent or execute arbitrary commands.

## Push Notifications

Hosted push notifications are minimal by default and do not include request title/body/command by default. Full details open inside the Native App. Push notification approve/deny actions are disabled at launch.

## Encryption

Encrypted Approval Content is supported where available, but end-to-end encryption is not required for hosted launch. See [Optional encrypted approval content](./encrypted-approval-content.md) for the current scope, UX, threat model, and launch sequencing. Do not send secrets in request titles, bodies, commands, choices, metadata, logs, or notifications.

## Retention

Hosted personal activity history follows the hosted personal lifecycle and grace period. Self-hosted deployments configure their own retention windows. Cleanup and deletion UX requirements are tracked in [Activity History cleanup and deletion controls](./activity-history-cleanup-deletion.md).

## Scoped Guest Approval Links

Scoped guest approval links are a researched future option, not a launch feature. If implemented, they must be short-lived, one-request, explicitly enabled, audited, and separate from organization membership. See [Scoped guest approval links research](./scoped-guest-approval-links.md).

## Diagnostics and Analytics

Diagnostics should exclude approval content. Hosted-product analytics use Plausible for minimal onboarding/paywall/setup events and should exclude approval content, commands, request bodies, choices, secrets, tokens, and raw user-entered content. Marketing analytics are privacy-friendly aggregate Plausible page analytics without ad tracking pixels.
