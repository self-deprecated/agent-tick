# MCP + Agent Tick

Agent Tick exposes a local stdio MCP adapter through `agent-tick mcp`. MCP-capable agents can use it to send status updates, ask bounded steering questions, and request sanctions before sensitive local work proceeds.

The adapter reuses the normal CLI setup and saved `agent_...` token. Do not commit Agent Tick tokens into MCP host configuration files.

## Relevant CLI commands

```sh
agent-tick install
agent-tick login
agent-tick setup --server https://tick.example.com --token agent_...
agent-tick mcp
agent-tick status-update "MCP preflight"
agent-tick steering --title "Which path?" --choice safe="Safe path" --choice stop:deny="Stop"
agent-tick sanction --title "Run production SQL?" --command "psql -f migrate.sql"
agent-tick abandon apr_123
```

## Minimal stdio server entry

```toml
[mcp_servers.agent_tick]
command = "agent-tick"
args = ["mcp"]
startup_timeout_sec = 10
tool_timeout_sec = 1800
```

Pre-approve only the Agent Tick MCP tools in hosts that require local tool approval. Do not broadly pre-approve shell or unrelated tools.

## Local execution boundary

Agent Tick does not run commands from MCP. A sanction returns an approve/deny decision; the MCP host or local workflow decides whether to continue.

For Codex-specific configuration and verification prompts, see [`docs/codex.md`](../../docs/codex.md).
