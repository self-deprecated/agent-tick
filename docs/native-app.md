---
title: Native App
description: Use the Agent Tick iOS or Android app for day-to-day approvals, Steering, Status Updates, Sessions, and notifications.
---

# Native App

The Native App is the primary day-to-day surface for Agent Tick. Use it to receive notifications, review agent context, answer bounded Requests, and follow Sessions while away from the terminal.

## Install and sign in

- [Agent Tick for iOS](https://get.agenttick.sh/ios)
- [Agent Tick for Android](https://get.agenttick.sh/android)

Sign in with the same account you use in [app.agenttick.sh](https://app.agenttick.sh).

For self-hosted servers, choose the self-hosted connection option and enter your server URL, for example:

```text
https://tick.example.com
```

Where the product provides a pairing QR code, the app can scan it.

## Turn on notifications

Enable notifications during setup. Agent Tick notifications are intentionally minimal: they tell you Agent Tick needs attention, then you review the full Request inside the app.

Push notification approve/deny actions are not the primary review path. Open Agent Tick and inspect the details before responding.

## Sessions and the Session Stack

Agent Tick groups related activity into **Sessions**. A Session usually maps to one agent chat, terminal workflow, or CI run.

When more than one unarchived Session is active, the app can show a **Session Stack**: multiple Session Lanes, each a clipped view into a Session timeline.

- **Stack Mode** is for triage and navigation. Tap a lane to open the full Session before answering.
- **Overview Mode** is for working directly inside multiple Session windows.
- Lanes can be normal, large, or collapsed.
- Offscreen pending indicators such as `↓ 1` point toward Sessions that need input.

A light annotated screenshot of the Session Stack belongs here once screenshots are captured.

## Answer Requests

Requests appear in chronological Session context.

- **Steering** shows bounded choices.
- **Sanctions** show the action or command context to approve or deny.
- Completed Requests collapse to the title and answer, with details available when expanded.

The app does not run commands. If a Sanction is approved, the local agent or workflow decides whether to continue on the machine where it was already running.

## History and Settings

Use History to inspect recent Agent Activity. Use Settings for account, connection, purchase/access, diagnostics, privacy, and support actions.

Developer diagnostics may include raw IDs and setup state. Do not paste diagnostics into public issues if they contain sensitive operational context.

## Access and response availability

If response buttons are disabled, read [Access and response availability](./access.md). Common causes are read-only access, expired hosted access, or Shared Workspace billing entitlement.
