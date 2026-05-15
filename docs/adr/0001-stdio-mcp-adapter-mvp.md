# Stdio MCP adapter for the MVP

Agent Tick's MCP MVP will use a local stdio adapter launched by MCP-capable agents, for example through the `agent-tick mcp` command. The adapter reuses the existing Agent Tick login/setup flow and saved `agent_...` token, then calls the Agent Tick product server on the agent's behalf. Authenticated HTTP MCP remains a later option if Agent Tick needs a remotely hosted MCP endpoint, but stdio is the smallest path that matches Claude/Codex local workflows and preserves the scoped agent-token model.
