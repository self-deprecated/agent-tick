---
title: Philosophy
description: Why Agent Tick exists and why it chooses bounded approvals, local execution, and source-available self-hosting.
---

# Philosophy

Coding agents are useful when they can keep working. They are dangerous when the easiest way to keep them working is broad unattended permission or remote execution.

Agent Tick exists for the middle path: the agent can ask for bounded human input without gaining a remote shell.

## Least-permission approvals

Agent Tick should return only what the agent asked for:

- a Status Update returns nothing
- Steering returns one of the offered choices
- a Sanction returns approve or deny

That is less powerful than a remote chat box, and that is the point.

## Local execution stays local

The agent, terminal, CI job, or workflow that asked remains responsible for execution. Agent Tick does not run commands from your phone or hosted app.

This keeps the review surface separate from the execution surface.

## Ask at decision boundaries

Agent Tick is not meant for every thought an agent has. Use it when a human decision changes the path:

- high-stakes architecture or API direction
- risky local commands
- publishing, deployment, or production-impacting work
- ambiguous requirements with multiple valid options
- long-running work where milestone updates matter

## Human attention is scarce

Good Agent Tick usage is quiet by default and explicit when it needs attention. Status Updates should be milestones. Steering should be one focused question. Sanctions should show exactly what is being approved.

## Source-available and self-hostable

Agent Tick is source-available and self-hostable so developers and operators can inspect the approval layer that sits between their agents and their decisions.

Self-hosting is not a second-class product mode. It is the right choice when you want to operate the routing and history yourself.

## Not a governance theater product

Agent Tick is not an audit-log costume for unchecked automation. It works best when the local agent is still constrained, the human sees concise context, and denial or timeout actually stops the protected action.
