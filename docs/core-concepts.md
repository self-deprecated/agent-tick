---
title: Core Concepts
description: Understand Agent Tick Requests, Status Updates, Sessions, Agent Connections, Approval Devices, and Workspaces.
---

# Core Concepts

Agent Tick is built around one boundary: the agent can ask, but it cannot turn the phone or hosted app into a shell.

## Agent Activity

**Agent Activity** is anything human-visible that an agent sends through Agent Tick. There are two kinds:

- **Status Update** — progress that does not need a response.
- **Agent Tick Request** — a bounded request that waits for a human response.

## Status Updates

A Status Update is a one-way progress note. Use it for milestones, not chatty logs.

Good states are:

- `working`
- `waiting`
- `blocked`
- `done`
- `failed`

Do not send a `waiting` Status Update just because the agent created a Request. The Request itself is the waiting signal.

## Requests

An **Agent Tick Request** asks a human for a bounded answer. Agent Tick returns only the choices supplied by the caller.

### Steering

**Steering** asks the human to choose from known next steps.

Use Steering when several safe paths are possible and preference matters:

- “Run the docs check”
- “Skip the check”
- “Stop here”

Always include an escape/decline option when continuing may be wrong.

### Sanctions

A **Sanction** asks for approval before one specific risky action.

Use Sanctions for actions such as migrations, deployment, package publishing, broad file deletion, permission changes, or pushing to a remote.

Agent Tick can show the command as reviewer context, but the command still runs only in the local agent or workflow environment after approval.

## Bounded Input

Agent Tick is not a remote prompt box. A response is a selected option, not arbitrary new instructions.

This keeps the agent’s next step constrained to the request it made.

## Local Execution

The hosted app, Personal Console, and Native App do not execute commands. Approved actions remain the responsibility of the local agent, terminal, CI job, or workflow that asked.

## Agent Connections

An **Agent Connection** is a configured local agent or workflow identity linked to Agent Tick. It is backed by an `agent_...` token saved on the machine or CI environment.

Claude Code, Codex, Pi, and similar tools are **Coding-agent Integrations**. The configured identity they use inside Agent Tick is the Agent Connection.

## Approval Devices

An **Approval Device** is a Native App installation connected to a human account. It can receive and answer routed Requests.

Enable notifications if you want Agent Tick to get your attention while the app is closed.

## Sessions

A **Session** groups related Status Updates and Requests from one real agent chat, thread, terminal workflow, or CI run.

Most users do not set Session IDs manually. Integrations pass the right value when the host exposes one:

- Claude Code integration pages show the Claude-specific Session guidance.
- Codex uses `CODEX_THREAD_ID` where available.
- Pi Agent Tick uses Pi’s persisted chat/session ID where available.
- Generic CLI calls should omit Session IDs unless they already have a real run/thread ID.

Do not invent random Session IDs. Random IDs fragment one agent run across multiple Sessions.

## Workspaces

A **Workspace** contains members, Agent Connections, routing, and activity history.

- A **Personal Workspace** is for one developer’s own setup.
- A **Shared Workspace** is for multiple members, routing rules, and shared administration.

Shared Workspaces can be created and configured in hosted Agent Tick, but hosted shared routing and responses require an active Shared Workspace entitlement.
