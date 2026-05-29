---
title: Security
description: How Agent Tick bounds input, keeps execution local, and handles sensitive content.
---

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

Agent Tick currently treats Request content as normal hosted/self-hosted application data. Do not claim hosted Request contents are unreadable to Agent Tick unless a future client-held-key Private Requests design is implemented and reviewed.

## Retention and deletion

Hosted personal activity history follows the hosted personal lifecycle and grace period. Self-hosted deployments configure their own retention windows and backups.

Deleting a hosted Agent Tick account deletes the hosted personal Workspace and its Request, Response, Status Update, routing, waiter/event/pairing, diagnostic, device, push-token, personal Agent Token, and audit content. The local user row is retained only as a revoked, PII-stripped tombstone so billing and audit references remain intact; app-store purchase attempts and transactions are retained as financial records. Content in Shared Workspaces is treated as Workspace/operator-owned: the deleted user is removed from memberships, routing recipients, recipient rows, responses, diagnostics, availability, devices, and user-created Agent Tokens are revoked, but Requests and Status Updates owned by the Shared Workspace may remain under that Workspace's retention policy.

The hosted deletion path deletes the upstream Clerk user before the irreversible local tombstone/content cleanup. If Clerk deletion fails, the API reports failure while local hosted personal content and access remain intact so the deletion can be retried. Self-hosted operators are responsible for their own data deletion, backups, retention policy, and infrastructure access.

## Analytics and diagnostics

Diagnostics and analytics should exclude Request content. Hosted-product analytics use minimal setup/onboarding/paywall events. Marketing analytics are privacy-friendly aggregate Plausible page analytics without ad tracking pixels.
