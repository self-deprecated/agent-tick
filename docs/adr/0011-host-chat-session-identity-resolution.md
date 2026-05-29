# Host chat identity for Agent Tick Sessions

Agent Tick Sessions represent one host agent chat, thread, or run. A Session ID is a real grouping boundary only when it comes from the host integration or an explicit caller override. Repository path, working directory, host name, client name, and agent label are source metadata; they can help fallback grouping, but they are not Session identity.

Session ID resolution order is:

1. Explicit caller identity: MCP `sessionId`, CLI `--session`, or `AGENT_TICK_SESSION_ID`.
2. Host-provided chat/thread/session identity exposed to the integration, sanitized and namespaced by host.
3. No explicit `sessionId`; Agent Tick groups best-effort by stable source metadata such as agent/client name, host, and working directory.

Integrations must not generate random default Session IDs for generic CLI or MCP calls. Random per-process IDs fragment one host chat across multiple commands and make the Session Stack unstable. If an integration cannot prove that an ID has the lifetime of one host chat, it should omit `sessionId` and provide source metadata instead.

Known host mappings:

- Pi Native Extension uses Pi's persisted chat/session ID when available, so resumed Pi chats continue in the same Agent Tick Session.
- Codex CLI/MCP uses the `CODEX_THREAD_ID` environment variable when no explicit Agent Tick Session ID is supplied.
- Claude Code hooks use the hook stdin JSON `session_id` field for hook-created Steering and Sanction Requests.
- Claude Code MCP cannot rely on `CLAUDE_SESSION_ID` as a shell environment variable. Claude-facing MCP instructions should use Claude's `${CLAUDE_SESSION_ID}` prompt substitution token and pass a namespaced value as the Agent Tick MCP `sessionId` argument.

Session titles are presentation metadata only. `AGENT_TICK_SESSION_TITLE`, CLI `--session-title`, and MCP `sessionTitle` may provide a useful label for one host chat, but they do not group Activity. Existing `threadId` fields are legacy/source metadata and should not be the canonical Session identity for new integrations.
