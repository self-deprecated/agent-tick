# Agent install and hook research

This document records what is known versus scaffolded for `agent-tick install`.

## Preloop pattern

Preloop's public docs and site describe a one-command installer. This research note intentionally does not repeat pipe-to-shell install snippets in launch docs.

The documented behavior is not just adding instructions. Preloop discovers local agent/client configs for Claude Code, Codex CLI, Gemini CLI, Hermes, OpenClaw, OpenCode, and other MCP-compatible runtimes. On supported managed paths, discovery can import configured tools/model metadata and reconfigure the local runtime to use the Preloop model gateway and MCP tool firewall.

For Claude Code specifically, Preloop documents MCP configuration, not a Claude hook:

```sh
claude mcp add \
  --transport http \
  --header "Authorization: Bearer YOUR_API_KEY_HERE" \
  preloop \
  https://preloop.ai/mcp/v1
```

It also documents the equivalent config file shape in `~/.claude/mcp-servers.json` with a `preloop` HTTP streaming MCP server. The approval behavior then happens because tools are exposed through Preloop's MCP server/firewall, including a `request_approval` tool.

## Agent Tick installer stance

Agent Tick should install real hooks/config where verified, and show disabled scaffolds where not verified. A plain `AGENTS.md`/`CLAUDE.md` note is not considered an enforcement integration.

The installer must also make Agent Tick commands always safe to run from the agent's permission layer. Those commands are the mechanism for asking the human, so they should not themselves require a separate agent permission prompt.

## Current enabled integrations

### Claude Code — enabled

Verified source: Claude Code hook docs. Claude Code supports hooks in `~/.claude/settings.json`, `.claude/settings.json`, and `.claude/settings.local.json`. `PreToolUse` can allow/deny/ask/defer by returning `hookSpecificOutput.permissionDecision`. `AskUserQuestion` can be answered with `updatedInput.answers`. `PermissionRequest` can handle Claude Code permission prompts.

Installed by Agent Tick:

- Adds `PreToolUse` hook for `AskUserQuestion`:
  - command: `agent-tick hook claude-pre-tool-use`
  - in pass-through mode, exits without a decision so Claude Code behaves normally
  - in AFK mode, routes steering choices to Agent Tick and returns answers through `updatedInput.answers`
- Adds `PermissionRequest` hook with matcher `*`:
  - command: `agent-tick hook claude-permission-request`
  - in pass-through mode, exits without a decision so Claude Code shows its native permission prompt
  - in AFK mode, routes Claude Code's own permission prompt through Agent Tick as a sanction
- Adds permission allow rule:
  - `Bash(agent-tick:*)`
- Initializes Agent Tick local mode and Claude routing policy:
  - interactive profile default: mode `pass-through`, steering `afk`, sanctions `afk`
  - headless profile default: mode `afk`, steering `always`, sanctions `always`

Agent Tick does not install a Claude Code risky-command policy in this version. Users continue to manage Claude Code permissions themselves; Agent Tick only handles permission prompts Claude Code was already going to show.

### Pi — enabled

Verified source: Pi extension docs and examples. Pi auto-discovers TypeScript extensions from `~/.pi/agent/extensions/*.ts` and project `.pi/extensions/*.ts`. Extensions can subscribe to `tool_call` and return `{ block: true, reason }` to stop a tool call.

Installed by Agent Tick:

- Copies the versioned repo-maintained extension from `packages/cli/assets/pi/agent-tick-approval.ts` to `~/.pi/agent/extensions/agent-tick-approval.ts`
- The extension watches `bash` tool calls
- Agent Tick commands are allowed
- Risky bash commands call `agent-tick sanction` and block if approval is denied, times out, or fails

## Scaffolded / disabled until verified

- Codex CLI: detected via `codex` command or `~/.codex/config.toml`; native hook/config enforcement path not verified in this pass. MCP support is planned separately and documented in the MCP implementation plan.
- Gemini CLI: detected via `gemini` command or `~/.gemini`; verified as an MCP-capable target through `settings.json` `mcpServers`, but native hook/config enforcement remains unverified. See [Cursor, Gemini CLI, and OpenCode support options](./cursor-gemini-opencode-support.md).
- Cursor: detected via `cursor` command or project `.cursor`; verified as an MCP-capable target through `mcp.json`, but native hook/config enforcement remains unverified. See [Cursor, Gemini CLI, and OpenCode support options](./cursor-gemini-opencode-support.md).
- OpenCode: detected via `opencode` command or `~/.config/opencode`; verified as an MCP-capable target through OpenCode `mcp` config, but native hook/config enforcement remains unverified. See [Cursor, Gemini CLI, and OpenCode support options](./cursor-gemini-opencode-support.md).
- Generic `AGENTS.md`: detected but disabled because instructions alone are advisory, not enforcement.

## Next confirmations

For each disabled target, confirm all of the following before enabling it:

1. Exact config file(s) and precedence.
2. Whether pre-tool hooks exist.
3. Whether the hook can block execution.
4. Whether it can mutate/answer question-style prompts.
5. How to add allow rules for Agent Tick commands.
6. How to install idempotently without overwriting user config.
