---
title: Claude Code
description: Configure Claude Code to use Agent Tick through the MCP adapter and optional permission hooks.
---

# Claude Code

Agent Tick configures Claude Code through the local MCP Adapter by default. Claude can call Agent Tick tools for Status Updates, bounded Steering, and model/tool-driven Sanctions while all actions still execute locally in Claude Code.

Supported launch behavior:

- `agent_tick_status_update` sends progress to Agent Tick.
- `agent_tick_steering` asks a bounded question with explicit choices.
- `agent_tick_sanction` asks for human approval before a specific action Claude chooses to gate.
- Optional Claude Code hooks can route Claude Code native permission prompts through Agent Tick.

MCP does **not** automatically intercept Claude Code's own Bash/Edit permission prompts. Install the optional permission hook only if you want those native Claude Code prompts routed through Agent Tick Sanctions.

## Session identity

Agent Tick Sessions should map to Claude Code chats. Claude Code exposes its chat ID differently by integration path:

- **Claude hooks** receive `session_id` in hook stdin JSON. Agent Tick hooks should pass that value as a sanitized, namespaced Session ID such as `claude_df39e0b0-7701-4352-9ef8-1549adfc32f2`.
- **Claude MCP** should use Claude's `${CLAUDE_SESSION_ID}` prompt substitution token in Claude-facing instructions and pass `sessionId: "claude_${CLAUDE_SESSION_ID}"` on every Agent Tick MCP tool call in that chat. Pass `sessionTitle` too when Claude has a useful human-readable chat label, but do not depend on title for grouping.

`${CLAUDE_SESSION_ID}` is not a shell environment variable, so do not expect `echo $CLAUDE_SESSION_ID` or the `agent-tick mcp` process environment to contain it. Hooks are different: Claude hook-created Requests read `session_id` from hook stdin JSON automatically. If no real Claude chat ID is available, omit explicit `sessionId`; Agent Tick will group best-effort by source metadata.

## Install

For first-time setup, the [Quick Start](./quick-start.md) prompt-based skill can detect Claude Code, run a dry run, explain the change, and install after you confirm.

Manual install starts with a dry run:

```sh
npx @self-deprecated/agent-tick install --target claude --dry-run
```

The default install configures the Agent Tick MCP server for Claude Code and verifies the entry where practical:

```sh
npx @self-deprecated/agent-tick install --target claude
```

Local project MCP config:

```sh
npx @self-deprecated/agent-tick install --target claude --claude-scope local
```

Global/user MCP config:

```sh
npx @self-deprecated/agent-tick install --target claude --claude-scope global
```

Verify with Claude Code:

```sh
claude mcp list
claude mcp get agent-tick
```

## Optional native permission hook

If you want Agent Tick to handle Claude Code native permission prompts for tools such as Bash/Edit, opt in explicitly:

```sh
npx @self-deprecated/agent-tick install --target claude --claude-permission-hook
```

This installs only the `PermissionRequest` hook by default. Agent Tick returns allow/deny for Claude Code's prompt; it does not run the command remotely.

## Optional question hook

MCP Steering is the preferred bounded-question path. If you still need Claude Code `AskUserQuestion` hook routing, opt in explicitly:

```sh
npx @self-deprecated/agent-tick install --target claude --claude-question-hook
```

## Removing old Agent Tick hooks

If older Agent Tick Claude hooks are detected, the installer can remove only Agent Tick hook entries while preserving unrelated Claude settings and hooks:

```sh
npx @self-deprecated/agent-tick install --target claude --remove-claude-hooks
```

## Verify Steering

Ask Claude Code to use Agent Tick MCP Steering with bounded choices, for example:

```text
Use agent_tick_steering to ask which safe documentation-only path to take next. Pass sessionId "claude_${CLAUDE_SESSION_ID}". Offer exactly these options: Review setup wording, Review troubleshooting wording, Stop the demo. Treat Stop the demo as the decline option and do not edit files yet.
```

Expected result: Agent Tick creates a Steering Request and returns only the selected bounded choice.

## Verify Sanctions

Ask Claude Code to use Agent Tick MCP Sanctions before a harmless command, for example:

```text
Before running pwd, use agent_tick_sanction with sessionId "claude_${CLAUDE_SESSION_ID}" and the exact command as context.
```

Expected result: Agent Tick creates a Sanction Request. If approved, Claude Code may run the command locally.

## Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| Claude cannot see Agent Tick tools | MCP entry was not added or Claude Code needs a restart/reload. | Run `claude mcp get agent-tick`, rerun `npx @self-deprecated/agent-tick install --target claude --dry-run`, then reinstall. |
| Claude Code still shows native permission prompts | MCP does not intercept native Claude permissions. | Install `--claude-permission-hook` if you want those prompts routed through Agent Tick. |
| Hook fails closed | Agent Tick CLI config/token is missing or the server is unreachable. | Run `npx @self-deprecated/agent-tick install`, `agent-tick login`, or `agent-tick config --server ... --token ...`. |
| Agent Tick hook triggers a permission loop | Missing `Bash(agent-tick:*)` allow rule. | Re-run installer with the optional hook flag and restart Claude Code. |
