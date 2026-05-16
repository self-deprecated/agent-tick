# Cursor, Gemini CLI, and OpenCode support options

## Summary

Cursor, Gemini CLI, and OpenCode should be treated as **MCP-capable integration targets**, not as verified hook/enforcement targets. Current public documentation for all three supports configuring local or remote MCP servers. None of the reviewed surfaces provides a Claude-Code-style pre-tool hook that Agent Tick can safely use today to intercept and block arbitrary tool calls or answer native question prompts outside MCP.

Recommendation: keep these targets out of the “enabled hook integration” bucket. Add them as planned MCP install/scaffold targets after the Agent Tick MCP adapter is production-ready and the installer can write tokenless project config with clear user confirmation.

## Current status

| Target | Verified config surface | Supports Agent Tick MCP adapter? | Verified blocking hook? | Recommended status |
| --- | --- | --- | --- | --- |
| Cursor | `mcp.json` in Cursor settings/project scope; Cursor CLI uses the same MCP config | Yes, via stdio MCP server entry | No verified pre-tool hook/blocking permission layer found | Planned MCP config target |
| Gemini CLI | `settings.json` with top-level `mcpServers` and global `mcp` settings | Yes, via stdio MCP server entry | No verified pre-tool hook/blocking permission layer found | Planned MCP config target |
| OpenCode | `opencode.json` / project config with `mcp` server entries | Yes, via local or remote MCP server entry | No verified pre-tool hook/blocking permission layer found | Planned MCP config target |

## What was verified

### Cursor

Cursor documentation describes MCP support through an `mcp.json` file and UI-managed Tools & MCP settings. MCP servers can be configured as command/args/env entries for local stdio-like servers or as remote HTTP/SSE servers. Cursor CLI documentation says MCP in the CLI uses the same configuration as the editor.

Implications for Agent Tick:

- A future installer can add an `agent_tick` MCP server entry that runs `agent-tick mcp`.
- Prefer project-local `.cursor/mcp.json` for repo-visible scaffold when the user asks for project scope.
- Prefer user/global Cursor MCP settings only with explicit confirmation.
- Do not claim Cursor can enforce Agent Tick approval before arbitrary built-in Cursor tool calls unless a supported blocking hook/permission API is verified later.

Example future shape:

```json
{
  "mcpServers": {
    "agent_tick": {
      "command": "agent-tick",
      "args": ["mcp"]
    }
  }
}
```

### Gemini CLI

Gemini CLI documentation describes persistent JSON settings and an `mcpServers` object in `settings.json` for MCP server definitions. It also describes a global `mcp` settings object for server discovery/execution behavior.

Implications for Agent Tick:

- A future installer can add `agent_tick` under `mcpServers` in the appropriate Gemini settings scope.
- Use the same stdio adapter command: `agent-tick mcp`.
- The installer should detect and preserve existing Gemini settings, avoid rewriting unrelated `mcp` options, and show a diff before writing.
- Do not claim Gemini CLI command approval or prompt interception until a blocking pre-tool hook or native permission integration is verified.

Example future shape:

```json
{
  "mcpServers": {
    "agent_tick": {
      "command": "agent-tick",
      "args": ["mcp"]
    }
  }
}
```

### OpenCode

OpenCode documentation describes a JSON configuration system with project and global config and an `mcp` object for local and remote MCP server entries. Each MCP server is keyed by name and can be enabled/disabled.

Implications for Agent Tick:

- A future installer can add an `agent_tick` entry under `mcp`.
- Prefer project `opencode.json` when the user wants repo-local setup; prefer user config only with explicit confirmation.
- Preserve existing agents, models, providers, and MCP entries.
- Do not claim OpenCode can route all native approvals through Agent Tick unless a blocking hook/permission API is verified later.

Example future shape:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "agent_tick": {
      "type": "local",
      "command": ["agent-tick", "mcp"],
      "enabled": true
    }
  }
}
```

The exact OpenCode command field shape should be confirmed against the schema at implementation time because docs show the `mcp` object conceptually and the schema may evolve.

## Installer guidance

When adding these targets, the installer should:

1. Detect existing config files and commands without modifying anything by default.
2. Offer a dry-run diff for project and user/global scopes.
3. Write tokenless MCP config by default; use the normal Agent Tick CLI config for tokens.
4. Never commit or write `agent_...` tokens into project config.
5. Preserve unrelated user settings and comments where possible; if comments cannot be preserved in JSON, warn before rewriting.
6. Add Agent Tick usage instructions that tell the agent to call MCP tools for status updates, steering, and sanctions.
7. Explain that this is model/tool-callable MCP support, not native permission-hook enforcement.

## Support language

Use:

- “Cursor, Gemini CLI, and OpenCode can connect to the Agent Tick MCP adapter.”
- “Agent Tick can provide model-callable status, steering, and sanction tools through MCP.”
- “The agent must choose to call those tools, or the user must configure workflows/instructions that require them.”
- “Native tool-blocking hooks are not verified for these targets.”

Avoid:

- “Agent Tick intercepts every Cursor/Gemini/OpenCode tool call.”
- “Agent Tick enforces all Cursor/Gemini/OpenCode command permissions.”
- “Agent Tick can answer arbitrary prompts from these clients.”
- “Agent Tick is a remote shell for these agents.”

## Recommended next implementation slices

1. Add read-only detection to `agent-tick install --target cursor|gemini|opencode` that reports found config paths and MCP support status.
2. Add dry-run scaffolds for tokenless MCP entries.
3. Add guarded writers with diff/confirmation and tests using temporary config files.
4. Add integration docs snippets once the writer behavior is tested.
5. Keep hook/enforcement support disabled until a first-party blocking API is verified for each target.

## Open questions

- Which Cursor MCP scope should be the default: project `.cursor/mcp.json` or user-level Tools & MCP config?
- Which Gemini CLI settings scope is safest for project setup versus user setup?
- What exact OpenCode `mcp` local-server schema should be generated for the installed version?
- Do these clients support any per-tool approval allowlist that should pre-approve Agent Tick MCP tools without weakening unrelated tools?
- Can any of these clients expose MCP elicitation support comparable to Codex for Mirrored Prompt?

## Decision

Cursor, Gemini CLI, and OpenCode are viable Agent Tick **MCP adapter targets**. They are not yet verified native hook/enforcement targets. Keep current docs honest, add MCP scaffold support only after the adapter and config writers are tested, and do not overclaim automatic interception.
