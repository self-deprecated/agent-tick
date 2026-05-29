---
title: Mobile app
description: Install the Agent Tick iOS or Android app, connect hosted or self-hosted servers, and respond to requests.
sidebar_label: Mobile app
---

# Mobile app

The iOS and Android app is the primary day-to-day response surface for Agent Tick.

## Install

- [Agent Tick for iOS](https://get.agenttick.sh/ios)
- [Agent Tick for Android](https://get.agenttick.sh/android)

If a store link is not live yet, continue with the web Request flow at [app.agenttick.sh](https://app.agenttick.sh) and retry after the store listing is published.

## Connect

For hosted Agent Tick, sign in to [app.agenttick.sh](https://app.agenttick.sh) with the same account used during CLI setup.

For a self-hosted server, choose the self-hosted server option in the app and enter your server URL, for example:

```text
https://tick.example.com
```

The app can also scan pairing QR codes where the product flow provides one.

External Approver invite links open the app directly when installed. If the user is not signed in yet, the app keeps the invite pending and completes it after sign-in.

## Sessions, Stack, and Lanes

Agent Tick groups status updates, steering questions, and sanctions into **Sessions**. A Session usually maps to one agent chat, thread, workspace task, or terminal workflow.

When more than one unarchived Session is active, the app shows a **Session Stack**: a dashboard of **Session Lanes**. Each lane is a clipped viewport into the same Session timeline you see in full detail.

### Stack Mode

In Stack Mode, lanes are for triage and navigation:

- tap a lane to open that Session in full detail
- answer Requests from the full Session view, not from the lane preview
- use the `⋯` Session Stack actions button for Stack actions such as archive, sizing, and mode changes
- if a Session with an actionable pending Request is offscreen, tap the directional nudge such as `↓ 1` or `↑ 1` to scroll toward it

### Overview Mode

Overview Mode turns lanes into interactive Session windows:

- each lane can scroll independently
- visible Request controls inside a lane are usable directly
- tapping lane content does not open full Session detail

Use the `⋯` Stack actions menu to switch between Stack Mode and Overview Mode.

### Lane sizing and ordering

Lanes keep a useful minimum height. If there are too many lanes to fit, the Stack scrolls vertically instead of shrinking every lane into tiny strips.

Each lane has three local sizes:

- **normal** — default lane height
- **large** — one lane can take about half the Stack
- **collapsed** — title bar only

Press the lane size control to collapse or restore a lane. Long-press it to toggle between normal and large. Long-press a lane title bar, drag, and release to reorder lanes. New Sessions append to the existing order.

## Respond to requests

The app shows bounded Agent Tick requests in chronological Session context:

- status updates for progress
- steering questions with fixed options
- sanctions with approve/deny decisions

Completed Requests are compact by default: title plus answer, expandable for original context and options.

The phone does not run commands. If a Sanction Request receives an approving Response, the local agent or workflow decides whether to continue on the machine where it was already running.

## Notifications

Enable notifications if you want Request alerts while the app is closed. Push notifications stay minimal; review the request details inside Agent Tick before responding. Push notification approve/deny actions are disabled at launch.

## Android permissions

The Android app intentionally requests only camera access, used for scanning Agent Tick pairing QR codes. Network access is required for sign-in, server communication, push routing, and purchases.

Agent Tick does not use microphone, media/storage, overlay, startup, wake-lock, or vibration permissions.

## Trial and purchases

- The 7-day Trial starts only when you choose the free `$0` app-store trial purchase. It does not start automatically on first app open.
- The trial includes hosted and self-hosted app responses while active.
- After the trial, the app remains read-only until an active Trial, Hosted subscription, or Self-hosted Lifetime unlock is available.
- Self-hosted Lifetime keeps app responses available for self-hosted servers; it does not include or activate hosted service.
- Hosted service is separate from permanent self-hosted app use; monthly/yearly hosted subscriptions can be purchased during Trial or after hosted access expires.
- The app shows the current hosted access expiry date and warns when non-renewing hosted access has one week or less remaining.
- iOS and Android purchases use App Store / Google Play in-app purchases through RevenueCat; the Agent Tick server projects hosted-account entitlements from verified purchase events.
- Sign in to an Agent Tick account before hosted purchases so purchases can be linked to routing, push, history, and billing.

See [Access and purchases](./entitlement-lifecycle.md) for the full Trial, Self-hosted Lifetime, Hosted subscription, and read-only grace states.
