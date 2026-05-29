---
title: Session identity
description: How Agent Tick groups status updates, steering requests, and sanctions into Sessions.
sidebar_label: Sessions
---

# Session identity

Agent Tick groups related status updates, steering requests, and sanctions into a **Session**. A Session should represent one real agent chat, thread, terminal workflow, or CI run.

Most users do not need to set Session IDs manually. Supported integrations pass the right value when the host exposes one.

## Use a Session ID only when it is real

Good Session IDs come from the host:

| Host | Preferred ID source |
| --- | --- |
| Claude Code hooks | hook stdin `session_id`, namespaced as `claude_...` |
| Claude MCP prompts | `"claude_${CLAUDE_SESSION_ID}"` using Claude's prompt substitution token |
| Codex | `CODEX_THREAD_ID`, auto-detected by Agent Tick where available |
| Pi | Pi's persisted chat/session ID |
| GitHub Actions or CI | the workflow/run ID when it represents one reviewable run |

If no real host chat/thread/session ID exists, omit `sessionId` and let Agent Tick group best-effort from safe source metadata such as client name, host, working directory, and Agent Connection label.

## Do and don't

Do:

- pass the same Session ID to status updates, steering, and sanctions from the same host chat/run
- add `sessionTitle` or `AGENT_TICK_SESSION_TITLE` when the host has a useful human-readable label
- treat source metadata as helpful context, not as identity

Do not:

- generate random Session IDs for generic one-shot CLI calls
- derive Session IDs from the current working directory
- treat a title as the stable Session identity
- send secrets, prompts, raw logs, or customer data in Session metadata

## Status update states

Use these semantic states for status updates:

- `working`
- `waiting`
- `blocked`
- `done`
- `failed`

Unknown custom states are accepted for compatibility, but they are display-only labels. Put custom reasons in the message or safe metadata.

Do not send a `waiting` status update merely because you created an Agent Tick Request. The Request itself is the waiting signal.
