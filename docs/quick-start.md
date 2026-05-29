---
title: Quick Start
description: Connect one coding-agent machine to Agent Tick and send a safe test request.
---

# Quick Start

This guide connects one coding-agent machine, signs you in, and sends a safe test request.

## Before you start

Choose where requests should go:

- **Hosted Agent Tick** — easiest path. Use [app.agenttick.sh](https://app.agenttick.sh) and the mobile app.
- **Self-hosted Agent Tick** — run your own server first, then install with `--server https://tick.example.com`. See [Self-hosting](./self-hosting.md).

The phone and hosted app never run commands. Agent Tick only routes the request and returns your bounded response.

## 1. Ask your coding agent to set up Agent Tick

Paste this into the coding agent you want to connect:

```text
Fetch and follow the Agent Tick setup skill from:
https://agenttick.sh/skill

Use that skill to set up Agent Tick on this machine. Ask me which coding agent I am using and what kinds of updates or approval checks I want routed to my phone or browser. Explain status updates, steering choices, and sanctions in plain language, and let me opt out of any of them. Use the right integration for this agent, run a dry run first, explain what will change, then install after I confirm and verify it works.
```

You will sign in through the browser. The skill works even when this repository is not cloned.

Prefer doing it yourself? Run the manual installer on the agent machine:

```sh
npx @self-deprecated/agent-tick install
```

For self-hosting, point the installer at your server:

```sh
npx @self-deprecated/agent-tick install --server https://tick.example.com
```

## 2. Install the mobile app

Install Agent Tick on your phone and sign in with the same Agent Tick account.

- [Agent Tick for iOS](https://get.agenttick.sh/ios)
- [Agent Tick for Android](https://get.agenttick.sh/android)

If a store link is not live yet, use the web Request flow in [app.agenttick.sh](https://app.agenttick.sh) and retry the app later.

## 3. Send a safe test request

Ask your agent to prove the connection with a harmless bounded request. Good first tests are:

- a **status update**: “send a progress update that says setup is complete”
- a **steering request**: “ask me to choose between `Run docs check`, `Skip check`, or `Stop`”
- a **sanction** before a harmless local command such as `pwd`

You should see the request in the mobile app or web UI. After you respond, the local agent continues or stops based on that response.

## 4. Use the integration guide for your agent

- [Claude Code](./claude-code.md)
- [Codex](./codex.md)
- [Pi](./pi.md)
- [GitHub Actions release gate](./github-actions-release-sanction-tutorial.md)

Agent Tick groups related activity into Sessions when the host exposes a real chat/thread/session ID. You usually do not need to manage this yourself; see [Session identity](./session-identity.md) if you are writing an integration or debugging grouping.
