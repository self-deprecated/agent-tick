---
title: CLI
description: Use the Agent Tick CLI to configure machines, smoke-test routing, run MCP, and let agents send Status Updates, Steering, and Sanctions.
---

# CLI

The `agent-tick` CLI runs where the agent or workflow runs. Humans mainly use it to configure and smoke-test Agent Tick; agents and integrations use it as a transport.

If `agent-tick` is not on your `PATH`, use `npx @self-deprecated/agent-tick <command>`.

## Configure this machine

Guided setup is normally done through the setup prompt from the Personal Console. Manual setup:

```sh
npx @self-deprecated/agent-tick install
```

Sign in and save a local token without installing integrations:

```sh
npx @self-deprecated/agent-tick login
```

For self-hosted servers or CI, save a server and Agent Token:

```sh
agent-tick config --server https://tick.example.com --token agent_...
agent-tick config show
```

Treat `agent_...` tokens as secrets.

## Smoke-test Status Updates

```sh
agent-tick status-update --state working --next "Run tests" "Finished edits; validating now"
```

Use `--notify` only for attention-worthy updates:

```sh
agent-tick status-update --state blocked --notify --importance high "Need staging access"
```

## Smoke-test Steering

```sh
agent-tick steering \
  --title "Which path?" \
  --choice small="Small targeted fix" \
  --choice refactor="Larger refactor" \
  --choice stop:deny="Stop"
```

Include a deny/escape option when continuing may be wrong.

## Smoke-test Sanctions

Use `--command` when the command is reviewer context only:

```sh
agent-tick sanction \
  --title "Run migration?" \
  --body "Touches staging billing tables." \
  --command "./migrate-staging.sh"
```

Put the command after `--` only when you want the CLI itself to run that local command after approval:

```sh
agent-tick sanction --title "Run migration?" -- ./migrate-staging.sh
```

Denial, timeout, or failure prevents the command from running.

## Run the MCP adapter

MCP-capable agents can launch:

```sh
agent-tick mcp
```

The adapter exposes `agent_tick_status_update`, `agent_tick_steering`, and `agent_tick_sanction` using the saved CLI config/token.

## Resolve a pending request

If a caller created a Request it no longer needs:

```sh
agent-tick abandon req_123
```

## Session IDs

Use a Session ID only when you have a real host chat/thread/run ID:

```sh
AGENT_TICK_SESSION_ID=ci_${GITHUB_RUN_ID} \
  agent-tick status-update --session-title "Release validation" --state working "Running checks"
```

Do not generate random Session IDs for one-off CLI calls. Omit the Session ID and let Agent Tick group best-effort.

## Safe content checklist

Do not put secrets, bearer tokens, private keys, raw logs, full prompts, `.env` files, or customer data in request titles, bodies, choices, commands, metadata, diagnostics, or notifications.
