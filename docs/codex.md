---
title: Codex
description: Configure Codex to use Agent Tick through the local MCP adapter.
---

# Codex

Codex can use Agent Tick through the local stdio MCP adapter launched with `agent-tick mcp`.

Codex calls Agent Tick MCP tools for Status Updates, Steering, and Sanctions. Agent Tick returns bounded responses; Codex or the local shell still decides what to run.

## Setup

First configure the Agent Tick CLI:

```sh
npx @self-deprecated/agent-tick install
```

Or configure a server/token manually:

```sh
agent-tick config --server https://app.agenttick.sh --token agent_...
```

Verify the CLI can reach Agent Tick:

```sh
agent-tick status-update "Codex MCP preflight"
agent-tick mcp --help
```

## Codex MCP config

Add an MCP server entry to your Codex config. The adapter reads credentials from normal Agent Tick CLI config; do not commit `agent_...` tokens into Codex config files.

```toml
[mcp_servers.agent_tick]
command = "agent-tick"
args = ["mcp"]
startup_timeout_sec = 10
tool_timeout_sec = 1800
default_tools_approval_mode = "approve"

[mcp_servers.agent_tick.tools.agent_tick_status_update]
approval_mode = "approve"

[mcp_servers.agent_tick.tools.agent_tick_steering]
approval_mode = "approve"

[mcp_servers.agent_tick.tools.agent_tick_sanction]
approval_mode = "approve"
```

If your Codex build supports MCP elicitations and you want local prompts to race with remote Agent Tick Requests, enable them:

```toml
[tools]
mcp_elicitations = true
```

## Session guidance

When Codex launches the MCP adapter or shell commands with `CODEX_THREAD_ID`, Agent Tick maps it to a namespaced Session ID such as `codex_019e9c78-ab9c-73b0-b21c-ce18a32c8499`.

If Codex runs without a real thread ID, do not invent a random Session ID. Agent Tick will group best-effort by safe source metadata.

## Verify status updates

Ask Codex:

```text
Use the Agent Tick MCP status tool to send: "Codex MCP preflight; no secrets included." Then continue.
```

## Verify Steering

Ask Codex:

```text
Use Agent Tick Steering to ask which safe path to run next.
Options:
- Run docs build
- Run CLI help smoke test
- Stop the demo
Include Stop the demo as the deny/escape option.
```

## Verify Sanctions

Ask Codex:

```text
Use Agent Tick Sanction to ask whether this dry-run release action is allowed:
command summary: pnpm --filter @self-deprecated/agent-tick publish --dry-run
The action must not be executed by Agent Tick. If denied, stop.
```

## Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| `agent-tick mcp` fails with config guidance | CLI config/token missing | Run `agent-tick install`, `agent-tick login`, or `agent-tick config --server ... --token ...`. |
| Codex asks for approval before every Agent Tick tool call | Agent Tick MCP tools are not pre-approved in Codex | Approve only Agent Tick MCP tools, not broad shell access. |
| Local prompt does not appear | MCP elicitations disabled or unsupported | Enable `mcp_elicitations` if available, or use the remote Agent Tick app/web request. |
| Request times out or is denied | Human did not approve | Stop or choose a safe alternative. |
