# Security

Agent Tick is a least-permission request/response layer, not a remote shell.

## Bounded input

Agent Tick returns only responses defined by the original request:

- a status update is one-way progress
- steering chooses from bounded options
- a sanction approves or denies one specific action

Avoid freeform remote instructions when a bounded choice will do.

## Local execution

Approved actions execute in the user's local agent environment. The hosted service, dashboard, and iOS or Android app cannot invent or execute arbitrary commands.

For example, a sanction may include `./deploy.sh` as reviewer context, but Agent Tick only records and returns the human decision. The local agent or workflow decides whether to run the command after the Response.

## Push notifications

Hosted push notifications are minimal by default and should not include request title, body, command, secrets, raw prompts, or customer data. Full details open inside Agent Tick after the user is signed in. Push notification approve/deny actions are disabled at launch.

## Sensitive content

Do not send secrets in request titles, bodies, commands, choices, metadata, logs, diagnostics, analytics, or notification payloads.

Encrypted Request content exists for callers that intentionally use the SDK/shared helpers and manage keys out of band, but the launch default is still bounded plaintext summaries with no secrets.

## Retention and deletion

Hosted personal activity history follows the hosted personal lifecycle and grace period. Self-hosted deployments configure their own retention windows and backups.

Users should be able to delete hosted personal data from the product surface. Self-hosted operators are responsible for their own data deletion, backups, retention policy, and infrastructure access.

## Analytics and diagnostics

Diagnostics and analytics should exclude Request content. Hosted-product analytics use minimal setup/onboarding/paywall events. Marketing analytics are privacy-friendly aggregate Plausible page analytics without ad tracking pixels.
