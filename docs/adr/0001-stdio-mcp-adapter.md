# Stdio MCP adapter

Agent Tick's MCP Adapter uses a local stdio server launched by MCP-capable agents, for example through the `agent-tick mcp` command.

This keeps MCP use aligned with Agent Tick's Local Execution boundary: MCP clients can send Status Updates, Steering, and Sanctions through Agent Tick, but approved actions still run in the user's local agent or workflow environment. The adapter reuses the existing Agent Tick login/setup flow and saved `agent_...` token, then calls the configured Agent Tick server on the agent's behalf.

Authenticated HTTP MCP remains a possible future option if Agent Tick needs a remotely hosted MCP endpoint, but stdio is the smallest path that matches Claude Code/Codex local workflows and preserves the scoped Agent Connection token model.
