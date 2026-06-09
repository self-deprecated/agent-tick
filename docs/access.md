---
title: Access and response availability
description: Understand when Agent Tick app responses, hosted routing, self-hosted responses, and read-only states are available.
---

# Access and response availability

Agent Tick has two related access tracks:

1. **Native App response access** — whether the first-party iOS/Android app can submit responses.
2. **Hosted service access** — whether hosted routing, push, updates, uptime, and hosted history are active.

Self-hosted servers remain under the operator’s control. Access state controls whether the first-party app and hosted service accept new routing/response activity; it does not turn the phone or hosted service into a remote shell.

## Personal access paths

| Access path | What it enables |
| --- | --- |
| **7-day Trial** | A free app-store trial transaction that enables hosted and self-hosted app responses while active. |
| **Hosted subscription** | Ongoing hosted routing, push, service, and app responses while active. |
| **Self-hosted Lifetime** | Ongoing first-party app responses for self-hosted Agent Tick servers. It does not include hosted service forever. |
| **Read-only** | Requests, history, Settings, restore, Terms/Privacy, and account deletion remain visible; response submission is disabled. |

The Trial starts when you choose the free `$0` app-store trial purchase. It does not start automatically on first app open.

## Shared Workspace access

Shared Workspaces can be created and configured in hosted Agent Tick. Hosted shared routing and responses require an active Shared Workspace entitlement. Without that entitlement, hosted shared routing and responses are blocked even if members, Routing Rules, and Agent Assignments are configured.

Self-hosted deployments are not billed by hosted Agent Tick, but operators are responsible for their own access controls, backups, notifications, and retention.

## Common reasons response buttons are disabled

- personal hosted Trial or subscription expired
- the app is connected to a self-hosted server without Self-hosted Lifetime or another active app entitlement
- hosted Shared Workspace entitlement is inactive
- you are not an eligible routed recipient for the Request
- the Request is already answered, resolved, expired, or abandoned

The app and Personal Console should show the active connection and access state near the relevant settings or response controls.
