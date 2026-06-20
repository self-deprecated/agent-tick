---
title: Security
description: How Agent Tick bounds responses, keeps execution local, handles tokens, notifications, sensitive content, retention, analytics, and diagnostics.
---

# Security

Agent Tick is a least-permission request/response layer, not a remote shell.

## Bounded responses

Agent Tick returns only responses defined by the original request:

- Status Updates require no response.
- Steering chooses from bounded options.
- Sanctions approve or deny one specific action.

Avoid freeform remote instructions when a bounded choice will do.

## Local execution

Approved actions execute in the local agent or workflow environment. The hosted service, Personal Console, and Native App cannot invent or execute arbitrary commands.

A Sanction may include `./deploy.sh` as reviewer context, but Agent Tick only records and returns the human decision.

## Tokens

Agents use Agent Tick `agent_...` tokens. Humans use hosted sign-in or self-hosted credentials depending on deployment.

Treat `agent_...` tokens, admin tokens, Clerk secrets, purchase provider secrets, and notification credentials as secrets. Do not put them in request content or committed config.

## Notifications

Hosted push notifications are minimal by default and should not include request title, body, command, secrets, raw prompts, or customer data. Full details open inside Agent Tick after sign-in.

## Sensitive content

Do not send secrets in titles, bodies, commands, choices, metadata, logs, diagnostics, analytics, or notification payloads.

Private Requests and private full-reply Status Updates can store sensitive display content as server-opaque encrypted payloads for Approval Devices. Each device key is generated and stored on that device; only the public key is registered with Agent Tick servers. See [Private encryption](./private-encryption.md) for the exact scope and trust model.

Plain Requests, clear operational fields, diagnostics, analytics, notifications, and integrations that do not enable private content should be treated as normal hosted/self-hosted application data.

## Retention and deletion

Hosted personal activity history follows hosted lifecycle and grace-period behavior. Self-hosted deployments configure their own retention windows and backups.

Deleting a hosted account deletes hosted personal Workspace content and access data according to the hosted deletion flow. Content in Shared Workspaces is Workspace/operator-owned and may remain under that Workspace’s retention policy after a member is removed or deleted.

Self-hosted operators are responsible for their own data deletion, backups, retention policy, and infrastructure access.

## Analytics and diagnostics

Diagnostics and analytics should exclude Request content. Hosted-product analytics use minimal setup/onboarding/paywall events. Marketing analytics use privacy-friendly aggregate page analytics without ad tracking pixels.
