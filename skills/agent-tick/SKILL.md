---
name: agent-tick
description: Set up Agent Tick or use its CLI/MCP surface for status updates, steering, and sanctions. Use when a user asks to install/configure Agent Tick; when an agent should send mobile-visible progress updates; when bounded user steering is needed; or before risky, destructive, expensive, production, dependency, data-accessing, or infrastructure actions.
---

# Agent Tick

Agent Tick is a least-permission approval layer for coding agents: status updates, steering, and sanctions. It routes bounded decisions and progress updates; it does not run remote shell commands.

## Public Setup Flow

Default to the hosted quick start unless the user explicitly asks for self-hosting or provides a self-hosted URL/token. The primary setup path is this prompt-based skill. The browser-readable setup page is:

```text
https://agenttick.sh/skill
```

For raw Markdown that can be pasted into a coding agent, use:

```text
https://agenttick.sh/skill.md
```

Use the published npm CLI. If `agent-tick` is missing, prefer `npx` for first run:

```sh
npx @self-deprecated/agent-tick install
```

Global npm install is secondary:

```sh
npm install -g @self-deprecated/agent-tick
agent-tick install
```

Do not use or recommend pipe-to-shell installers.

## Setup Checklist

When setting up Agent Tick, do all of this in order:

1. Detect intent: hosted quick start by default; self-hosted only if the user asks for it or provides a self-hosted server/token.
2. Inspect current agent configs before changing them. For Claude Code, inspect `claude mcp list` / `claude mcp get agent-tick` when available plus `~/.claude/settings.json`, project `.claude/settings.json`, and `.claude/settings.local.json` when present. Look for existing Agent Tick hooks, unrelated hooks, permission rules, sandbox settings, and any rule that could block `agent-tick` itself.
3. Enable status updates, steering, and sanctions by default through MCP where the agent supports MCP. Mention each capability and allow explicit opt-out.
4. For Claude Code, MCP is the primary setup path. Ask whether to install MCP locally or globally. Recommend local when working in one repository or when project-specific settings already exist; recommend global for a personal machine with many projects; if unsure, recommend local first for safer blast radius.
5. For Claude Code native permission prompts, offer `--claude-permission-hook` only as an optional add-on. Explain that MCP Sanctions are model/tool-driven and do not automatically intercept Claude Code Bash/Edit permission prompts.
6. Run a dry run first.
7. Explain exactly which files/settings will change and why.
8. Ask for confirmation before writing files.
9. Run the same install command without `--dry-run` after confirmation.
10. Verify the result with `agent-tick --help`, `claude mcp list`, `claude mcp get agent-tick` for Claude Code, and a safe first proof request.

Suggested hosted Claude Code dry run:

```sh
npx @self-deprecated/agent-tick install --target claude --claude-scope local --dry-run
```

If the user chose global scope, use `--claude-scope global` instead. For direct CLI setup without installing agent integrations:

```sh
npx @self-deprecated/agent-tick login --server https://app.agenttick.sh
```

For self-hosted/manual setup, use the user's server URL and token exactly once:

```sh
npx @self-deprecated/agent-tick config --server https://tick.example.com --token agent_...
```

Do not print, log, summarize, or expose token values after setup.

## First Proof Request

After Claude Code installation, make the first proof request use the MCP tool path: ask Claude Code to call `agent_tick_steering` with bounded choices and an explicit decline option. Optionally ask it to call `agent_tick_sanction` before a harmless command such as `pwd`.

For non-MCP or manual CLI verification, use a safe Steering test:

```sh
agent-tick steering \
  --title "Agent Tick setup test" \
  --body "Choose whether setup is working." \
  --choice works="It works" \
  --choice stop:deny="Stop testing"
```

Optional follow-up demos:

```sh
agent-tick status-update --state working "Agent Tick setup test status update"
agent-tick sanction --title "Agent Tick setup test sanction" --body "No command will be run; this only tests approval routing."
```

## Session Identity

Agent Tick Sessions should map to one real host agent chat, thread, or run. Use a Session ID only when the host exposes a stable chat/thread/session ID or the user/integration explicitly supplies one:

- CLI: pass `--session` or set `AGENT_TICK_SESSION_ID`.
- MCP: pass the `sessionId` tool argument.
- Codex: Agent Tick can auto-detect `CODEX_THREAD_ID`; still pass an explicit MCP `sessionId` if you have a stronger host chat ID.
- Claude Code MCP: pass `sessionId: "claude_${CLAUDE_SESSION_ID}"` when Claude's `${CLAUDE_SESSION_ID}` prompt substitution token is available. Do not expect it to exist as a shell environment variable.
- Claude Code hooks and Pi native integration should use their host-provided session IDs directly.

If no real host chat ID is available, do **not** invent a random or cwd-derived explicit Session ID. Omit `sessionId`; Agent Tick will group best-effort by source metadata such as agent/client name, host, and working directory. `AGENT_TICK_SESSION_TITLE`, `--session-title`, and MCP `sessionTitle` are labels only; they do not group Activity.

## Status Updates

Use `agent-tick status-update` for non-blocking progress updates. Recommended states are `working`, `waiting`, `blocked`, `done`, and `failed`. Use `--notify` and `--importance` only when the update deserves future push-notification treatment.

```sh
agent-tick status-update --state working --next "Run typecheck" "Finished edits; validating now"
agent-tick status-update --state waiting "Waiting for CI"
agent-tick status-update --state blocked --notify --importance high --next "Wait for user decision" "Need clarification before changing the API shape"
agent-tick status-update --state done "Implementation complete; tests passed"
```

Do not include secrets or sensitive logs.

## Steering

Use `agent-tick steering` for bounded choices that steer the work. Repeat `--choice`. Use `id=Label` or `id:kind=Label`; include a `deny` choice when the user should be able to stop or decline.

```sh
agent-tick steering \
  --title "Which rollout should I use?" \
  --body "Choose the deployment strategy." \
  --choice canary="Canary rollout" \
  --choice blue_green="Blue/green rollout" \
  --choice cancel:deny="Do not deploy" \
  --choice-flag canary=favorite
```

Treat denial or any selected `deny` choice as a hard stop unless the user gives a new instruction.

## Sanctions

Use `agent-tick sanction` before one risky or sensitive action. Sanctions should describe the exact action and risk.

```sh
agent-tick sanction \
  --title "Proceed with deployment?" \
  --body "Deploy commit abc123 to production." \
  --command "deploy production"
```

To run a command only after approval:

```sh
agent-tick sanction -- npm install
```

For flags, pipes, redirection, shell expansion, or multiple steps, wrap the command in a shell:

```sh
agent-tick sanction -- sh -c 'npm install && npm test'
```

If denied, timed out, or the CLI exits non-zero, stop the gated action and report the outcome.

## MCP

Use `agent-tick mcp` as the local stdio MCP adapter. When your host exposes a real chat/session/thread ID, pass the same value as `sessionId` to every Agent Tick MCP tool call in that conversation. For Claude Code MCP, use `claude_${CLAUDE_SESSION_ID}` in Claude-facing instructions. For Codex, Agent Tick auto-detects `CODEX_THREAD_ID` when the adapter process inherits it.

The launch tool names are:

- `agent_tick_status_update`
- `agent_tick_steering`
- `agent_tick_sanction`

For Codex, pre-approve Agent Tick MCP tools so Agent Tick can ask the human without an extra local tool approval:

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

Codex local elicitation prompts require Codex policy to allow MCP elicitations. If granular approval policy is configured, `mcp_elicitations` must be `true`.

## JSON Output

Use `--json` when another script needs machine-readable events from `sanction`, `steering`, `abandon`, or `status-update`:

```sh
agent-tick status-update --json --state working "Running server tests"
```

## Safety Rules

- Do not use Agent Tick to approve its own installation or configuration command.
- Do not include secrets, bearer tokens, private keys, session cookies, or full `.env` contents in sanction titles, steering bodies, status update messages, commands, or metadata.
- Do not continue a gated action after denial, timeout, CLI failure, or a non-zero `agent-tick` exit.
- Do not replace Agent Tick with a normal prompt when the user asked for Agent Tick approval.
- Use one sanction for one meaningful action. Batch only when the full batch is clearly described.
