---
title: Codex
description: Configure Codex to use Agent Tick through the local MCP adapter.
---

# Codex

Codex can use Agent Tick through the local stdio MCP adapter launched with `agent-tick mcp`.

Supported launch behavior:

- Codex calls Agent Tick MCP tools for status updates, steering, and sanctions.
- The adapter uses the same saved Agent Tick config/token as the CLI.
- Agent Tick uses Codex `CODEX_THREAD_ID` as the Session ID when no explicit `sessionId` or `AGENT_TICK_SESSION_ID` is supplied.
- Sanctions return a Response result; Agent Tick does not run commands from MCP.
- When Codex supports MCP elicitation, local Codex prompts and remote Agent Tick requests can race so the first valid answer wins.

Automatic Codex config writing is not implemented for launch. Configure Codex manually.

## Prerequisites

For first-time setup, start with the [Quick Start](./quick-start.md) prompt-based skill and tell your agent you use Codex.

Manual setup:

```sh
npx @self-deprecated/agent-tick install
```

Or configure a server/token manually:

```sh
agent-tick config --server https://tick.example.com --token agent_...
```

Verify the CLI can reach your Agent Tick server:

```sh
agent-tick status-update "Codex MCP preflight"
agent-tick mcp --help
```

When Codex launches the MCP adapter or shell commands with `CODEX_THREAD_ID` in the environment, Agent Tick maps it to a sanitized namespaced Session ID such as `codex_019e9c78-ab9c-73b0-b21c-ce18a32c8499`. That keeps Status Updates, Steering, and Sanctions from one Codex chat in one Agent Tick Session. Explicit MCP `sessionId`, CLI `--session`, or `AGENT_TICK_SESSION_ID` still override Codex autodetection. If Codex ever runs without `CODEX_THREAD_ID`, do not invent a random Session ID; Agent Tick will group best-effort by source metadata.

## Codex MCP config

Add an MCP server entry to your Codex config. The MCP adapter reads credentials from the normal Agent Tick CLI config; do not commit `agent_...` tokens into Codex config files.

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

If your Codex config uses granular approval settings, allow MCP elicitations so Codex can show the local prompt:

```toml
[tools]
mcp_elicitations = true
```

## Verify status updates

Ask Codex:

```text
Use the Agent Tick MCP status tool to send: "Codex MCP preflight; no secrets included." Then continue.
```

Expected result: Codex calls `agent_tick_status_update`; no Response is required.

## Verify steering

Ask Codex:

```text
Use Agent Tick steering to ask which safe path to run next.
Options:
- Run docs build
- Run CLI help smoke test
- Stop the demo
Include Stop the demo as the deny/escape option.
```

Expected result: Codex calls `agent_tick_steering`, Agent Tick creates a bounded request, and Codex receives one selected option.

## Verify sanctions

Ask Codex:

```text
Use Agent Tick sanction to ask whether this dry-run release action is allowed:
command summary: pnpm --filter @self-deprecated/agent-tick publish --dry-run
The action must not be executed by Agent Tick. If denied, stop.
```

Expected result: Codex calls `agent_tick_sanction`; Agent Tick asks approve/deny; Codex decides whether to proceed based on the returned result. Agent Tick does not run `pnpm publish` or any other shell command.

## Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| `agent-tick mcp` fails with config guidance | CLI config/token is missing. | Run `npx @self-deprecated/agent-tick install`, `agent-tick login`, or `agent-tick config --server ... --token ...`. |
| Codex asks for approval before every Agent Tick tool call | Agent Tick MCP tools are not pre-approved in Codex. | Approve only the Agent Tick MCP tools, not broad shell or unrelated tools. |
| Local Codex prompt does not appear | MCP elicitations are disabled or unsupported. | Enable `mcp_elicitations` if available, or use the remote Agent Tick app/web request. |
| Request times out or is denied | The human did not approve the action. | Stop or choose a safe alternative; do not run the protected action. |
