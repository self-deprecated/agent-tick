---
title: Prompt agents to use Agent Tick
description: Prompt coding agents to call Agent Tick tools for Status Updates, Steering, and Sanctions instead of only replying in chat.
---

# Prompt agents to use Agent Tick

Agents often answer in chat unless you explicitly tell them to use a tool. Agent Tick works best when your prompt names the Agent Tick primitive and the expected boundary.

## Basic rule

Tell the agent to **use Agent Tick**, not merely to ask you.

Good:

```text
Use Agent Tick Steering to ask which implementation path to take. Offer exactly these choices: Small targeted fix, Larger refactor, Stop. Treat Stop as the decline option. Do not edit files until I answer.
```

Weak:

```text
Ask me what to do next.
```

## MCP tool names

MCP-capable integrations expose these tools:

- `agent_tick_status_update`
- `agent_tick_steering`
- `agent_tick_sanction`

When the tool names are visible to the agent, use them directly:

```text
Use `agent_tick_steering`, not a normal chat reply, to ask which docs section to rewrite first.
```

## Ask one bounded question

A Steering request should have one decision boundary and finite choices.

```text
Use Agent Tick Steering to ask which safe docs task to do next.
Choices:
- Rewrite Quick Start first (recommended)
- Rewrite CLI first
- Stop and summarize findings
Mark Rewrite Quick Start first as the recommended option if the tool supports flags.
```

Avoid combining unrelated decisions such as “Which section should I edit, should I run tests, and should I commit?” Ask those separately.

## Require Sanctions for risky local work

Use Sanctions when the agent is about to do one specific sensitive action.

```text
Before running any command that changes dependencies, publishes packages, pushes commits, deletes files recursively, or touches production, use Agent Tick Sanction with the exact command as context. If denied or timed out, stop.
```

Agent Tick does not run the command. The local agent decides whether to continue after receiving the bounded response.

## Ask for useful Status Updates

Status Updates should be milestones, not logs.

```text
Send Agent Tick Status Updates when you start validation, when you are blocked, and when the task is done. Do not send raw logs or secrets.
```

## Decision-gate pattern

For planning or architecture work, tell the agent to keep using Agent Tick at each real decision boundary:

```text
Before making each consequential design decision, gather evidence from the repo, summarize the trade-off, then use Agent Tick Steering to ask one focused question. Provide 2-4 options, mark your recommended option, and wait. Continue with the next decision only after I answer.
```

This is especially useful when you want to step away while the agent keeps surfacing bounded decisions on your phone. Use it for plans, migrations, public API changes, deployment decisions, and security-sensitive work.

## Safe content

Never put secrets, bearer tokens, private keys, cookies, `.env` contents, raw logs, full prompts, or customer data in Agent Tick titles, bodies, choices, commands, metadata, diagnostics, or notifications.
