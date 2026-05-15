# Agent Tick MCP integration implementation plan

## Goal

Add an Agent Tick MCP adapter that gives agent clients a shared tool surface for the three Agent Tick primitives:

1. **Status** — non-blocking progress updates.
2. **Steering** — structured human choices that guide the agent.
3. **Sanctions** — explicit approval before risky or irreversible work.

The MCP adapter should work across Claude Code and Codex first, then become the preferred cross-agent integration path for other agents that support MCP.

## Terminology

There are two different servers in this design:

- **Agent Tick product server** — the existing Agent Tick HTTP API and dashboard/mobile backend, for example `https://agenttick.sh` or a self-hosted server.
- **Agent Tick MCP server** — a local or remote MCP adapter that the agent connects to. It exposes MCP tools and calls the Agent Tick product server internally.

For the first implementation, the MCP server should be a local stdio process started by the agent:

```sh
agent-tick mcp
```

Later, Agent Tick can add a streamable HTTP MCP mode, but stdio is simpler, safer, and works with both Claude Code and Codex local workflows.

## High-level architecture

```text
Claude Code / Codex / other MCP-capable agent
  │
  │ MCP stdio, later streamable HTTP
  ▼
agent-tick mcp
  │
  │ Agent Tick SDK / HTTP API
  ▼
Agent Tick product server
  │
  ├─ mobile push
  ├─ web dashboard
  └─ approval/status persistence
```

The MCP server is an agent-facing adapter, not a new source of truth. Agent Tick approval requests, status updates, audit records, and routing still live in the existing Agent Tick product server.

## Relevant MCP and agent-client behavior

### MCP elicitation

MCP supports server-initiated `elicitation/create` requests during a tool call. This allows an MCP server to pause a tool call and ask the MCP client to collect user input.

The useful form-mode shape is:

```json
{
  "method": "elicitation/create",
  "params": {
    "mode": "form",
    "message": "Which rollout should I use?",
    "requestedSchema": {
      "type": "object",
      "properties": {
        "choice": {
          "type": "string",
          "title": "Choice",
          "oneOf": [
            { "const": "canary", "title": "Canary rollout" },
            { "const": "blue_green", "title": "Blue/green rollout" },
            { "const": "cancel", "title": "Cancel" }
          ]
        }
      },
      "required": ["choice"]
    }
  }
}
```

Expected response:

```json
{
  "action": "accept",
  "content": {
    "choice": "canary"
  }
}
```

or:

```json
{ "action": "decline" }
```

or:

```json
{ "action": "cancel" }
```

MCP form schemas are intentionally restricted to flat objects with primitive properties. That is sufficient for Agent Tick steering and sanctions:

- string enum for single-select steering;
- array enum for multi-select steering;
- string enum for approve/deny sanctions;
- optional string fields for non-secret comments.

Do not use form-mode elicitation for secrets. If future Agent Tick flows need sensitive data, use Agent Tick web/mobile or MCP URL-mode elicitation, not form fields.

### Claude Code behavior

Claude Code supports MCP elicitation in the CLI. Its docs describe form-mode and URL-mode elicitation and say elicitation dialogs appear automatically when an MCP server requests them.

Claude Code also exposes hook events around MCP elicitations:

- `Elicitation` — before the dialog/response is resolved.
- `ElicitationResult` — after the user responds, before the response is sent to the MCP server.

This means Claude can either:

1. let `agent-tick mcp` own the local/remote race; or
2. use Claude-specific hooks to route or auto-answer MCP elicitations through Agent Tick.

The first path is more portable and should be the MVP. The second path can be a later Claude-specific optimization.

### Codex behavior

Codex supports MCP elicitations and declares MCP client elicitation capability. Codex policy matters:

- `approval_policy = "on-request"` allows MCP elicitation prompts.
- `approval_policy = "never"` rejects MCP elicitations.
- granular policies must allow MCP elicitations:

```toml
approval_policy = { granular = {
  sandbox_approval = true,
  rules = true,
  mcp_elicitations = true,
  request_permissions = true,
  skill_approval = true
}}
```

Codex also has MCP tool approval settings on configured MCP servers. The Agent Tick MCP tools themselves should normally be configured as approved so Codex does not require a separate local approval before Agent Tick can ask the human.

## Product behavior

The desired behavior is the same across clients:

1. The agent calls an Agent Tick MCP tool.
2. The tool creates an Agent Tick request or status update against the product server.
3. For steering/sanctions, the tool can also show a local MCP elicitation dialog.
4. The tool races local MCP response vs remote Agent Tick mobile/web response.
5. The first terminal response wins.
6. If local wins, abandon the pending Agent Tick request.
7. If remote wins, return the remote decision to the agent.
8. If denied, cancelled, or timed out, the tool returns a structured negative result and the agent must stop or ask for further instruction.

## MCP tools

### `agent_tick_status`

Non-blocking progress update.

Input schema:

```ts
type AgentTickStatusInput = {
  message: string;
  state?: "working" | "blocked" | "done";
  nextStep?: string;
  project?: string;
  metadata?: Record<string, string>;
};
```

Behavior:

- Resolve Agent Tick config using the same order as the CLI.
- Call `createStatusUpdate`.
- Use `AGENT_TICK_THREAD_ID` if set, otherwise derive a stable thread id from host + working directory.
- Include host, working directory, and project name.
- Return a small structured result containing status id, state, and thread id.

No MCP elicitation is needed.

### `agent_tick_steering`

Structured choice prompt.

Input schema:

```ts
type AgentTickSteeringInput = {
  title: string;
  body?: string;
  choices: Array<{
    id: string;
    label: string;
    description?: string;
    flags?: string[];
    tags?: string[];
  }>;
  allowMultiple?: boolean;
  allowFreeform?: boolean;
  timeoutMs?: number;
  localElicitation?: "auto" | "off" | "only";
};
```

Output schema:

```ts
type AgentTickSteeringOutput = {
  status: "answered" | "denied" | "cancelled" | "timed_out" | "failed";
  selectedChoiceIds?: string[];
  selectedLabels?: string[];
  message?: string;
  source?: "agent_tick" | "local_elicitation";
  requestId?: string;
};
```

Behavior:

1. Validate choice ids are unique and short enough for Agent Tick.
2. Create Agent Tick request with `requestType: "steer"` semantics using the existing approval request API.
3. If local elicitation is enabled and the MCP client supports it, send a form elicitation:
   - single-select: string enum / `oneOf`;
   - multi-select: array enum / `items.anyOf`;
   - freeform: optional `message` string field.
4. Race local elicitation and Agent Tick wait.
5. Map result to `AgentTickSteeringOutput`.
6. Abandon pending remote request when local wins.

Single-select local schema:

```json
{
  "type": "object",
  "properties": {
    "choice": {
      "type": "string",
      "title": "Choice",
      "description": "Choose one option.",
      "oneOf": [
        { "const": "option_a", "title": "Option A" },
        { "const": "option_b", "title": "Option B" }
      ]
    },
    "message": {
      "type": "string",
      "title": "Optional comment"
    }
  },
  "required": ["choice"]
}
```

Multi-select local schema:

```json
{
  "type": "object",
  "properties": {
    "choices": {
      "type": "array",
      "title": "Choices",
      "minItems": 1,
      "items": {
        "anyOf": [
          { "const": "option_a", "title": "Option A" },
          { "const": "option_b", "title": "Option B" }
        ]
      }
    },
    "message": {
      "type": "string",
      "title": "Optional comment"
    }
  },
  "required": ["choices"]
}
```

### `agent_tick_sanction`

Explicit approval gate.

Input schema:

```ts
type AgentTickSanctionInput = {
  title: string;
  body?: string;
  command?: string;
  risk?: "low" | "medium" | "high";
  choiceFlags?: Record<string, string[]>;
  timeoutMs?: number;
  localElicitation?: "auto" | "off" | "only";
};
```

Output schema:

```ts
type AgentTickSanctionOutput = {
  approved: boolean;
  status: "approved" | "denied" | "cancelled" | "timed_out" | "failed";
  choiceId?: "approve" | "deny" | string;
  message?: string;
  source?: "agent_tick" | "local_elicitation";
  requestId?: string;
};
```

Behavior:

1. Create Agent Tick approval request.
2. If local elicitation is enabled, ask for approve/deny locally.
3. Race local and remote responses.
4. Return `approved: true` only for explicit approve.
5. Abandon pending remote request when local wins.
6. Agents must treat all non-approved outputs as stop conditions.

Local sanction schema:

```json
{
  "type": "object",
  "properties": {
    "decision": {
      "type": "string",
      "title": "Decision",
      "oneOf": [
        { "const": "approve", "title": "Approve" },
        { "const": "deny", "title": "Deny" }
      ]
    },
    "comment": {
      "type": "string",
      "title": "Optional comment"
    }
  },
  "required": ["decision"]
}
```

## CLI changes

Add a new public command:

```sh
agent-tick mcp
```

Initial options:

```sh
agent-tick mcp \
  --transport stdio \
  --local-elicitation auto \
  --timeout 30m
```

`stdio` should be the only supported transport in the first slice. Reserve but do not document HTTP mode until implemented.

Suggested files:

```text
packages/cli/src/mcp/server.ts
packages/cli/src/mcp/tools/status.ts
packages/cli/src/mcp/tools/steering.ts
packages/cli/src/mcp/tools/sanction.ts
packages/cli/src/mcp/elicitation.ts
packages/cli/src/mcp/schemas.ts
packages/cli/src/mcp/resultMapping.ts
packages/cli/src/mcp/redaction.ts
```

Use `@modelcontextprotocol/sdk` if it can be pinned and packaged cleanly. If adding the dependency, follow `docs/dependency-policy.md`, update the lockfile, and validate/update any affected Nix `fetchPnpmDeps` hashes.

## Configuration resolution

`agent-tick mcp` should use the same Agent Tick config resolution as the CLI:

1. `AGENT_TICK_SERVER` + `AGENT_TICK_TOKEN`.
2. `AGENT_TICK_CONFIG`.
3. `~/.config/agent-tick/config.json`.

If config is missing:

- `agent_tick_status` should return an error telling the user to run `agent-tick install` or `agent-tick setup`.
- `agent_tick_steering` and `agent_tick_sanction` may still use `localElicitation: "only"` if requested, but default behavior should fail with setup guidance because Agent Tick remote routing is the product promise.

## Claude Code installation

Add a Claude MCP install path alongside the existing hook install.

Local/user MCP configuration can be created with Claude’s CLI:

```sh
claude mcp add --transport stdio agent_tick -- agent-tick mcp
```

Or project `.mcp.json`:

```json
{
  "mcpServers": {
    "agent_tick": {
      "command": "agent-tick",
      "args": ["mcp"],
      "env": {}
    }
  }
}
```

Claude-specific integration choices:

- Keep existing Claude hooks for `PermissionRequest` and `AskUserQuestion` initially.
- Add MCP as an additional tool surface for explicit status/steering/sanction calls.
- Later, consider using Claude `Elicitation` / `ElicitationResult` hooks for richer Agent Tick routing or audit of all MCP elicitations.

Agent instructions should tell Claude:

- Use `agent_tick_status` for progress updates.
- Use `agent_tick_steering` when a decision blocks progress.
- Use `agent_tick_sanction` before risky/destructive/production actions when native permission routing is not already handling the prompt.
- If a sanction is denied, cancelled, or times out, stop.

## Codex installation

Add a Codex MCP install path.

Recommended `~/.codex/config.toml` or project `.codex/config.toml` snippet:

```toml
[mcp_servers.agent_tick]
command = "agent-tick"
args = ["mcp"]
startup_timeout_sec = 10
tool_timeout_sec = 1800
default_tools_approval_mode = "approve"

[mcp_servers.agent_tick.tools.agent_tick_status]
approval_mode = "approve"

[mcp_servers.agent_tick.tools.agent_tick_steering]
approval_mode = "approve"

[mcp_servers.agent_tick.tools.agent_tick_sanction]
approval_mode = "approve"
```

If Codex uses granular approvals, install should verify or recommend:

```toml
approval_policy = { granular = {
  sandbox_approval = true,
  rules = true,
  mcp_elicitations = true,
  request_permissions = true,
  skill_approval = true
}}
```

The installer should not silently weaken unrelated approval categories. If `mcp_elicitations = false`, warn and ask before changing it.

Agent instructions should tell Codex to use Agent Tick MCP tools for status, steering, and sanctions. Codex does not currently provide a general hook that intercepts and answers all internal ask-user prompts in the same way Claude Code can for `AskUserQuestion`, so MCP steering is model/tool initiated.

## Implementation slices

### Slice 1 — MCP server skeleton

- Add dependency and command entrypoint.
- Start a stdio MCP server.
- Expose a simple `agent_tick_status` tool.
- Add unit tests for CLI command registration and schema validation.
- Manually smoke-test with one MCP client if practical.

### Slice 2 — status tool

- Implement config resolution.
- Call existing Agent Tick status API.
- Return structured status result.
- Add tests for success, missing config, and redaction.

### Slice 3 — remote-only steering and sanction tools

- Implement `agent_tick_steering` and `agent_tick_sanction` using existing Agent Tick HTTP API.
- No local MCP elicitation yet.
- Wait for Agent Tick response and return structured outputs.
- Add tests for response mapping, timeout, deny, cancel, and API failures.

### Slice 4 — local MCP elicitation

- Add helper to build MCP form schemas from Agent Tick choices.
- Add `localElicitation` modes: `auto`, `off`, `only`.
- Race local elicitation vs Agent Tick wait.
- Abandon remote request if local wins.
- Add tests for schema building and result mapping.

### Slice 5 — Codex installer

- Make `agent-tick install --target codex` install MCP config instead of reporting scaffold-only.
- Detect existing Codex config and preserve unrelated settings.
- Add `default_tools_approval_mode = "approve"` and per-tool approve entries for Agent Tick MCP tools.
- Detect granular approval policy and warn/offer to set `mcp_elicitations = true`.
- Add dry-run output.

### Slice 6 — Claude installer

- Add an MCP option to Claude install.
- Keep existing Claude hook installation as-is initially.
- Add or update `.mcp.json` / user MCP config depending on chosen scope.
- Add dry-run output explaining hooks vs MCP tools.

### Slice 7 — documentation

- Update `docs/integrations.md` with MCP support.
- Add usage examples for Claude and Codex.
- Document that MCP form elicitation must not carry secrets.
- Document how to disable local elicitation and rely only on Agent Tick mobile/web.

## Security and disclosure rules

- Never include tokens, secrets, private keys, credentials, or full environment files in titles, bodies, commands, metadata, or form fields.
- Redact command/tool inputs before sending to Agent Tick.
- Keep MCP tool output concise; do not return huge Agent Tick request payloads.
- Treat MCP form elicitation as visible to the MCP client and potentially transcript/logged.
- Use URL-mode or Agent Tick web/mobile for any future sensitive data collection.
- Avoid recursive prompts by approving only the Agent Tick MCP tools themselves, not broad user actions.

## Open questions

1. Should local MCP elicitation default to `auto` or `off` for AFK/headless profiles?
   - Recommended: interactive profiles use `auto`; headless profiles use `off`.
2. Should `agent_tick_sanction` be model-callable only, or should hooks call it too?
   - Recommended: keep provider-native hooks for automatic permission prompts; use MCP sanctions for explicit model-requested gates.
3. Should MCP tools be named with or without `agent_tick_` prefix?
   - Recommended: use prefix to avoid collisions and make instructions clear.
4. Should the first implementation support HTTP MCP transport?
   - Recommended: no. Start with stdio; add HTTP only after the stdio path is stable.
5. Should the MCP server be split into a separate package?
   - Recommended: keep it in the CLI package first so it shares config, versioning, and distribution.
