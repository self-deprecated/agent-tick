# @self-deprecated/agent-tick

Command-line status update, steering, and sanction interface for Agent Tick.

## Quickstart

Primary setup is the prompt-based skill at <https://agenttick.sh/skill.md>. For manual CLI setup, run the published npm installer:

```sh
npx @self-deprecated/agent-tick install
```

Or install globally first:

```sh
npm install -g @self-deprecated/agent-tick
agent-tick install
```

The installer opens Agent Tick in your browser, saves a local Agent Tick token, detects local coding agents, and installs supported integrations. Claude Code and Codex are supported via MCP Adapter, Claude Code native permission hooks are optional, and Pi is supported as a Native Extension.

## Use

Create a Sanction Request and wait for a Response:

```sh
agent-tick sanction \
  --title "Deploy production?" \
  --body "Deploy commit abc123" \
  --command "deploy production"
```

Create a Sanction Request that includes a command:

```sh
agent-tick sanction --title "Run migration?" -- ./migrate.sh
```

Ask a steering question with structured choices:

```sh
agent-tick steering \
  --title "Which rollout?" \
  --choice canary="Canary" \
  --choice cancel:deny="Cancel" \
  --choice-flag canary=favorite
```

Use `--choice-flag choiceId=favorite` for a mobile-visible recommendation star, or warning flags such as `production`, `destructive`, and `security_sensitive` on sanction approve choices.

Send a Status Update without creating a Request:

```sh
AGENT_TICK_SESSION_ID=codex_019e9c78-ab9c-73b0-b21c-ce18a32c8499 \
  agent-tick status-update --session-title "Test failure triage" --state working "Checking test failures"
```

Pass `--session` or `AGENT_TICK_SESSION_ID` to `status-update`, `steering`, and `sanction` only when the value is a real host chat/thread/session ID. Agent Tick can also detect known host IDs such as Codex `CODEX_THREAD_ID`. If no real host chat ID is available, omit explicit `sessionId`; Agent Tick groups best-effort by source metadata such as agent/client name, host, and working directory. Do not generate random Session IDs for generic CLI/MCP calls. Pass `--session-title` or `AGENT_TICK_SESSION_TITLE` for an optional chat/run label. Use only `working`, `waiting`, `blocked`, `done`, and `failed` as semantic Status Update states. Custom state strings remain accepted for compatibility, but Agent Tick treats them as display-only labels. Put custom reasons in the message or safe metadata, and do not send `waiting` merely because a Request was created.

Run the local stdio MCP adapter from an MCP-capable agent config:

```sh
agent-tick mcp
```

Codex can use the adapter as a stdio MCP server, and steering/sanction tools support local MCP form elicitation when Codex is configured to allow MCP elicitations.

For Codex, configure the MCP server and pre-authorize the Agent Tick tools so Agent Tick can ask the human without an extra local tool confirmation:

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

Codex local elicitation also requires Codex settings that allow MCP elicitations. `localElicitation: "auto"` is the default and recommended mode: it shows both the local Codex dialog and a remote Agent Tick mobile/web Request, with the first answer winning. Use `localElicitation: "only"` only when testing the local Codex dialog, and `localElicitation: "off"` only when testing remote Agent Tick mobile/web Requests.

For Claude Code, the installer configures MCP by default:

```sh
agent-tick install --target claude
claude mcp get agent-tick
```

Claude MCP tool calls should pass `sessionId: "claude_${CLAUDE_SESSION_ID}"` on every Agent Tick MCP call in a Claude chat when Claude's prompt substitution token is available. Add `sessionTitle` when Claude has a useful label; titles do not group Activity. `${CLAUDE_SESSION_ID}` is not a shell environment variable. Optional Claude hooks use hook stdin `session_id` automatically instead.

To also route Claude Code native permission prompts through Agent Tick, opt in explicitly:

```sh
agent-tick install --target claude --claude-permission-hook
```

Browser sign-in without installing integrations:

```sh
agent-tick login
```

Manual configuration for CI or self-hosted servers:

```sh
agent-tick config --server https://tick.example.com --token agent_...
```

Do not put tokens in logs or committed files.

More documentation: <https://docs.agenttick.sh>
