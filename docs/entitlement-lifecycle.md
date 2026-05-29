---
title: Access and purchases
description: Understand Agent Tick trial, hosted subscription, self-hosted lifetime, and read-only states.
sidebar_label: Access
---

# Access and purchases

Agent Tick has two related access tracks:

1. **Mobile app response access** — whether the first-party iOS/Android app can submit responses.
2. **Hosted service access** — whether `app.agenttick.sh` hosted routing, push, updates, uptime, and recent hosted history are active.

Self-hosted servers remain under the operator's control. Agent Tick access state decides whether the first-party app and hosted service accept new routing/response activity; it does not turn the phone or hosted service into a remote shell.

## Purchase paths

| Product | What it unlocks |
| --- | --- |
| `$0` **7-day Trial** | Starts an explicit seven-day app-store trial transaction. Unlocks hosted and self-hosted responses while active. It is not a subscription and does not start automatically on first app open. |
| **Hosted monthly/yearly subscription** | Unlocks hosted routing, push, service, and app responses while active. Also unlocks self-hosted responses while active. |
| **Self-hosted Lifetime** | Unlocks first-party app responses with self-hosted Agent Tick servers forever. It does not grant hosted service forever. |

No active purchase is a valid read-only state: notifications, Requests, history, Settings, restore, Terms/Privacy, and account deletion remain available, but response submission is disabled.

## States at a glance

| State | Self-hosted responses | Hosted responses | Hosted routing/push | How to leave the state |
| --- | --- | --- | --- | --- |
| Read-only | Disabled | Disabled | Disabled | Start trial, subscribe hosted, or buy Self-hosted Lifetime |
| Trial active | Enabled | Enabled | Enabled | Trial expires or paid entitlement starts |
| Self-hosted Lifetime active | Enabled forever | Disabled unless hosted subscription is also active | Disabled unless hosted subscription is also active | Subscribe hosted if hosted service is wanted |
| Hosted subscription active | Enabled while active | Enabled | Enabled | Subscription lapses/cancels |
| Lifetime + hosted active | Enabled forever | Enabled while subscription is active | Enabled while subscription is active | Subscription lapse returns to Lifetime-only hosted inactive state |
| Read-only routing grace | Depends on lifetime/trial; otherwise disabled | Disabled | Recovery/history only; push disabled | Renew, delete hosted data, or grace expires |
| Hosted data deleted | Depends on app entitlement and self-hosted server | Disabled | Disabled | New hosted setup if supported later |

## Important rules

- The **7-day Trial** starts only from the `$0` App Store / Google Play / RevenueCat non-consumable IAP transaction.
- Trial timing is derived from the purchase date plus seven days.
- Hosted subscriptions do **not** require Self-hosted Lifetime first.
- Hosted subscriptions unlock hosted service and self-hosted responses while active.
- Self-hosted Lifetime unlocks first-party app responses with self-hosted servers forever.
- Self-hosted Lifetime does **not** grant hosted service forever.
- The app shows current hosted/trial expiry dates and warns when non-renewing hosted access has one week or less remaining.
- Read-only routing grace is a hosted recovery state after a canceled/lapsed subscription: routing and recent history remain visible, but responses and push are disabled.
- Self-hosted deployments are responsible for their own uptime, backups, notifications, and data retention.

## Common misunderstandings

- The trial does not start automatically. You start it with the free `$0` app-store trial purchase.
- Self-hosted Lifetime does not include hosted service forever.
- You do not need Self-hosted Lifetime before subscribing to Hosted.
- The mobile app does not run commands remotely.
- Read-only grace is temporary recovery access, not indefinite hosted retention.
