---
title: Quick Start
description: Connect Agent Tick mobile/web routing, send a Test Request, then connect your first coding-agent machine.
---

# Quick Start

This guide connects one developer to hosted Agent Tick. You will prove that requests can reach you first, then connect a local coding agent.

Self-hosting instead? Start with [Self-hosting Quick Start](./self-hosting.md), then return here for app and agent setup.

## 1. Open the hosted app

Go to [app.agenttick.sh](https://app.agenttick.sh) and sign in.

Agent Tick will create your Personal Workspace. A Workspace contains your connected agents, Approval Devices, activity, and routing settings.

## 2. Install the Native App and enable notifications

Install Agent Tick on your phone and sign in with the same account:

- [Agent Tick for iOS](https://get.agenttick.sh/ios)
- [Agent Tick for Android](https://get.agenttick.sh/android)

When the app asks, enable notifications. Then open **Settings → General → Private encryption** in the Native App and enable private encryption. Do this before connecting rich agent mirroring; the setup skill will recommend encrypted Activity as the default.

In the Personal Console, the **Connections** page should show a push-ready Approval Device. Push notifications are intentionally minimal; review request details inside Agent Tick before responding.

## 3. Send a first-party Test Request

In the Personal Console, open **Connections** and send a **Steering Test Request**.

A Test Request proves that Agent Tick can route a bounded request to your app/web surfaces. It is labeled as a test and does not pretend to be real agent work.

Respond in the Native App or web fallback. If you can answer the Test Request, your human response path works.

## 4. Connect your coding agent

After the app path works, connect an Agent Connection from the **Connections** page.

Copy the setup prompt shown in the Personal Console. It tells your agent which Agent Tick server and Workspace to use, asks it to fetch the setup skill from:

```text
https://agenttick.sh/skill
```

The setup skill should inspect your coding-agent environment, confirm Native App private encryption is enabled for rich content, offer the Agent Tick feature selector, run a dry run, explain the changes, ask for confirmation, install the right integration, and verify it.

Manual setup is available when you do not want agent-assisted setup:

```sh
npx @self-deprecated/agent-tick setup
```

For a self-hosted server:

```sh
npx @self-deprecated/agent-tick setup --server https://tick.example.com
```

## 5. Send one real agent-originated request

Ask the connected agent for a harmless proof:

- send a **Status Update** that says setup is complete
- ask a **Steering** question with a safe stop option
- request a **Sanction** before a harmless local command such as `pwd`

You should see the activity in the Native App and Personal Console. After you respond to a Steering or Sanction request, the local agent continues or stops based on the bounded response.

## What to read next

- [Core Concepts](./core-concepts.md) for the product vocabulary.
- [Prompt agents to use Agent Tick](./prompting-agents.md) for reusable prompts.
- [Coding-agent integrations](./coding-agent-integrations.md) for Claude Code, Codex, Pi, and other tools.
