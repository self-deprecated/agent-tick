---
title: CLI reference
description: Configure Agent Tick and use status-update, steering, sanction, and MCP commands.
sidebar_label: CLI
---

# CLI reference

The `agent-tick` CLI runs on the machine where your coding agent or workflow runs.

Use it to:

- configure a server URL and local `agent_...` token
- send **status updates**
- ask bounded **steering** questions
- create **sanction** requests before sensitive local actions
- run the local stdio **MCP adapter** for MCP-capable agents

If `agent-tick` is not on your `PATH`, use `npx @self-deprecated/agent-tick <command>` for one-off commands.

## Configure the CLI

Recommended first-time setup is the prompt-based flow in [Quick Start](./quick-start.md). Manual setup:

```sh
npx @self-deprecated/agent-tick install
```

Sign in and save a local token without installing integrations:

```sh
npx @self-deprecated/agent-tick login
```

For self-hosted servers or CI, create an Agent Token in the dashboard and save it locally:

```sh
agent-tick config --server https://tick.example.com --token agent_...
agent-tick config show
```

Treat `agent_...` tokens as secrets.

## Send a status update

Status updates are one-way progress. They do not require a human response.

```sh
agent-tick status-update --state working --next "Run tests" "Finished edits; validating now"
```

Use Session IDs only when you have a real host chat/thread/session ID:

```sh
AGENT_TICK_SESSION_ID=codex_019e9c78-ab9c-73b0-b21c-ce18a32c8499 \
  agent-tick status-update --session-title "Billing migration" --state working "Running checks"
```

See [Session identity](./session-identity.md) for the full rules.

## Ask for steering

Use steering when the agent needs a human to choose between known options.

```sh
agent-tick steering \
  --title "Which rollout?" \
  --choice canary="Canary" \
  --choice blue_green="Blue/green" \
  --choice cancel:deny="Cancel"
```

Include a deny or escape option when a bad state is possible.

Choice flags add mobile-visible cues:

```sh
agent-tick steering \
  --title "Which fix?" \
  --choice small="Small targeted fix" \
  --choice rewrite="Rewrite subsystem" \
  --choice stop:deny="Stop" \
  --choice-flag small=favorite
```

## Ask for a sanction

Use a sanction before one specific sensitive local action. Agent Tick records the request and returns the human decision; it does not run the command remotely.

```sh
agent-tick sanction \
  --title "Run migration?" \
  --body "Run the migration against the staging database." \
  --command "./migrate-staging.sh"
```

Use `--command` when you only want to show the command as reviewer context.

Put the command after `--` only when you want the CLI itself to run that local command after approval:

```sh
agent-tick sanction --title "Run migration?" -- ./migrate-staging.sh
```

The command runs locally on this machine after approval. Denial, timeout, or failure prevents it from running.

## Run the MCP adapter

MCP-capable agents can launch the local stdio adapter:

```sh
agent-tick mcp
```

The adapter uses the same saved CLI config/token and exposes Agent Tick tools for status updates, steering, and sanctions.

## Resolve a pending request

If a local caller created a request it no longer needs, resolve it by ID:

```sh
agent-tick abandon req_123
```

## Safe content checklist

Do not put secrets, bearer tokens, private keys, raw logs, full prompts, `.env` files, or customer data in request titles, bodies, choices, commands, metadata, or diagnostics.
