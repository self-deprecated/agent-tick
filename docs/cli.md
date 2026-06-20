---
title: CLI
description: Use the Agent Tick CLI to configure machines, smoke-test routing, run MCP, and let agents send Status Updates, Steering, and Sanctions.
---

# CLI

The `agent-tick` CLI runs where the agent or workflow runs. Humans mainly use it to configure and smoke-test Agent Tick; agents and integrations use it as a transport.

If `agent-tick` is not on your `PATH`, use `npx @self-deprecated/agent-tick <command>`.

## Configure this machine

Guided setup is normally done through the setup prompt from the Personal Console. Before enabling rich agent mirroring, open the Native App and enable **Settings → General → Private encryption**. Agent Tick setup should recommend encrypted Activity as the default.

Manual setup:

```sh
npx @self-deprecated/agent-tick setup
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

## Send Agent Activity

Activity-creating commands are grouped under `agent-tick send`:

```sh
agent-tick send status --state working --next "Run tests" "Finished edits; validating now"
agent-tick send steering --title "Which path?" --choice small="Small targeted fix" --choice stop:deny="Stop"
agent-tick send sanction --title "Run migration?" --command "./migrate-staging.sh"
```

Use `--notify` only for attention-worthy updates:

```sh
agent-tick send status --state blocked --notify --importance high "Need staging access"
```

For Steering, include a deny/escape option when continuing may be wrong.

For Sanctions, use `--command` when the command is reviewer context only. Put the command after `--` only when you want the CLI itself to run that local command after approval:

```sh
agent-tick send sanction --title "Run migration?" -- ./migrate-staging.sh
```

Denial, timeout, or failure prevents the command from running.

## Configure Agent Tick features

Agent Tick lifecycle updates and optional message mirroring can be toggled without hand-editing JSON:

```sh
agent-tick features show
agent-tick features tui
agent-tick features enable message-mirroring
agent-tick features disable heartbeat
agent-tick features set status.heartbeat.intervalMs 15000
```

`agent-tick features` and `agent-tick features tui` open an interactive selector: move with ↑/↓ or j/k, Space/Enter toggles the focused row (and cycles Tool Activity visibility through `off → names → summaries → details`), `p` switches privacy mode, `e` edits a draft JSON config, `s` saves and quits, and `q` quits without saving. If there are unsaved changes, `q` asks you to confirm discard.

By default, supported agent integrations send start, finish, and long-running heartbeat Status Updates for human-meaningful progress. Turn-end, shutdown, full message mirroring, structured Tool Activity visibility, and Sanction approval gates are off until enabled. Tool Activity is grouped Session metadata (`off`, `names`, `summaries`, or `details`), not start/finish Status Update rows. The selector shows what each focused feature sends now: disabled, generic/plain, or encrypted private content.

For useful message mirroring, thinking, and detailed Tool Activity, enable **Private encryption** in the Native App at **Settings → General** first, then set encrypted Activity as the default:

```sh
agent-tick features set privacy.defaultContentMode private
```

Precedence for CLI/MCP Activity is: explicit `--private`/`--plain` or MCP `contentMode`, then legacy `AGENT_TICK_PRIVATE_REQUESTS=always`, then saved `privacy.defaultContentMode`, then plaintext. Private Activity still uses generic notification-safe labels outside the encrypted payload.

## Run the MCP adapter

MCP-capable agents can launch:

```sh
agent-tick mcp
```

The adapter exposes `agent_tick_status_update`, `agent_tick_steering`, and `agent_tick_sanction` using the saved CLI config/token. Each tool accepts `contentMode: "default" | "private" | "plain"`; omit it or use `default` to follow the saved privacy default.

## Resolve a pending request

If a caller created a Request it no longer needs:

```sh
agent-tick abandon req_123
```

## Session IDs

Use a Session ID only when you have a real host chat/thread/run ID:

```sh
AGENT_TICK_SESSION_ID=ci_${GITHUB_RUN_ID} \
  agent-tick send status --session-title "Release validation" --state working "Running checks"
```

Do not generate random Session IDs for one-off CLI calls. Omit the Session ID and let Agent Tick group best-effort.

## Safe content checklist

Do not put secrets, bearer tokens, private keys, raw logs, full prompts, `.env` files, or customer data in plaintext request titles, bodies, choices, commands, metadata, diagnostics, or notifications. Use private mode for sensitive Activity, and still keep public labels generic.
