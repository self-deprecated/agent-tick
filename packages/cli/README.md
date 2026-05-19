# @self-deprecated/agent-tick

Command-line status update, steering, and sanction interface for Agent Tick.

## Quickstart

Primary setup is the prompt-based skill at <https://agenttick.sh/skill>. For manual CLI setup, run the published npm installer:

```sh
npx @self-deprecated/agent-tick install
```

Or install globally first:

```sh
npm install -g @self-deprecated/agent-tick
agent-tick install
```

The installer opens Agent Tick in your browser, saves a local Agent Tick token, detects local coding agents, and installs supported integrations. Claude Code is supported as Verified Hook + MCP, Codex via MCP Adapter, and Pi as a Native Extension.

## Use

Ask for a sanction and wait for approval:

```sh
agent-tick sanction \
  --title "Deploy production?" \
  --body "Deploy commit abc123" \
  --command "deploy production"
```

Run a command only after sanction approval:

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

Send a status update without requesting approval:

```sh
agent-tick status-update --state working "Checking test failures"
```

Run the local stdio MCP adapter from an MCP-capable agent config:

```sh
agent-tick mcp
```

Codex can use the adapter as a stdio MCP server, and steering/sanction tools support local MCP form elicitation when Codex is configured to allow MCP elicitations.

For Codex, configure the MCP server and pre-approve the Agent Tick tools so Agent Tick can ask the human without an extra local tool approval:

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

Codex local elicitation also requires an approval policy that allows MCP elicitations. `localElicitation: "auto"` is the default and recommended mode: it shows both the local Codex dialog and a remote Agent Tick mobile/web request, with the first answer winning. Use `localElicitation: "only"` only when testing the local Codex dialog, and `localElicitation: "off"` only when testing remote Agent Tick mobile/web approval.

For Claude Code, the installer can route steering and permission prompts through Agent Tick. For unattended Claude Code runs, install with the headless profile:

```sh
agent-tick install --target claude --claude-profile headless --claude-steering always --claude-sanctions always
```

Browser sign-in without installing hooks:

```sh
agent-tick login
```

Manual setup for CI or self-hosted servers:

```sh
agent-tick setup --server https://tick.example.com --token agent_...
```

Do not put tokens in logs or committed files.

More documentation: <https://docs.agenttick.sh>
