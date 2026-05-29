---
title: Agent Tick Docs
description: Learn how to connect coding agents to Agent Tick for status updates, bounded steering, and sanctions.
---

# Agent Tick Docs

Agent Tick lets local coding agents ask trusted humans for help without turning the web app or phone into a remote shell.

Use it for three things:

- **Status updates** — non-blocking progress from an agent.
- **Steering** — a human chooses from a fixed set of safe options.
- **Sanctions** — a human approves or denies one specific local action before the agent continues.

## Start with the path that matches you

| I want to… | Go here |
| --- | --- |
| Connect my first coding-agent machine | [Quick Start](./quick-start.md) |
| Respond from my phone | [Mobile app](./mobile-app.md) |
| Set up Claude Code, Codex, Pi, or GitHub Actions | [Integrations](./integrations.md) |
| Use the CLI directly | [CLI reference](./cli.md) |
| Run my own server | [Self-hosting](./self-hosting.md) |
| Build against the API | [API and SDK](./api-sdk.md) |

## What Agent Tick does not do

Agent Tick routes requests and returns bounded responses. It does **not** run commands on your phone, in the hosted app, or on Agent Tick servers. Approved actions still run only where the local agent or workflow was already running.

## Recommended first flow

1. Open the [Quick Start](./quick-start.md).
2. Paste the setup prompt into the coding agent you want to connect.
3. Install the mobile app or use the web request flow.
4. Send one safe test request before trusting it with real work.

Privacy Policy and Terms live on the product site:

- [Privacy Policy](https://agenttick.sh/privacy)
- [Terms](https://agenttick.sh/terms)
