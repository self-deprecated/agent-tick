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
- **Resolved request** — a request that has reached a terminal non-response outcome, such as local prompt winning a mirrored race, wait deadline reached, or explicit user cancellation. `resolved` replaces the older `abandoned` terminology throughout the product; no compatibility migration is needed.

For the first implementation, the MCP server is a local stdio process started by the agent:

```sh
agent-tick mcp
```

The stdio adapter reads the same Agent Tick config as the rest of the CLI. A human signs in through the existing Agent Tick setup/login flow, which provisions a scoped `agent_...` token; the MCP adapter uses that token when calling the Agent Tick product server. Streamable HTTP MCP is out of the MVP and can be revisited later if Agent Tick needs a remotely hosted MCP endpoint.

## High-level architecture

```text
Claude Code / Codex / other MCP-capable agent
  │
  │ MCP stdio, later streamable HTTP
  ▼
agent-tick mcp
(local stdio adapter using saved agent token)
  │
  │ Agent Tick SDK / HTTP API
  ▼
Agent Tick product server
  │
  ├─ mobile push
  ├─ web dashboard
  └─ approval/status persistence
```

The MCP server is an agent-facing adapter, not a new source of truth. Agent Tick requests, status updates, audit records, and routing still live in the existing Agent Tick product server.

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
- string enum for approve/deny sanctions.

Do not use form-mode elicitation for secrets or human-written comments. Agentic decisions return structured choices only; do not return freeform text from MCP steering or sanctions.

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

Codex also has MCP tool approval settings on configured MCP servers. The Agent Tick MCP tools themselves should normally be configured as approved so Codex does not require a separate local approval before Agent Tick can ask the human. Pre-approve Agent Tick MCP tools only where the client supports it; document Claude behavior separately rather than inventing unsupported Claude approval config.

## Product behavior

### CLI/MCP parity principle

MCP tools should stay in sync with existing CLI behavior where practical. Reuse CLI config resolution, status metadata semantics, redaction, timeout/deadline handling, request creation, result mapping, and validation unless there is an explicit security or protocol reason to differ. One deliberate difference: MCP sanctions never execute commands; they only return structured approval results for the agent/client to act on.

The desired behavior is the same across clients:

1. The agent calls an Agent Tick MCP tool.
2. The tool creates an Agent Tick request or status update against the product server.
3. For steering/sanctions, the tool can also show a local MCP elicitation dialog.
4. The tool races local MCP response vs remote Agent Tick mobile/web response.
5. The first terminal response wins, including explicit local decline/cancel/timeout. If local elicitation is unsupported or rejected before a user sees/answers it, continue remote-only.
6. If local wins, resolve the pending Agent Tick request with non-secret reason/source and structured local outcome metadata when available.
7. If remote wins, best-effort cancel the local elicitation and return the remote structured decision to the agent.
8. If remote creation fails but local elicitation succeeds, return the local result with `source: "local_elicitation"`, no `requestId`, and a concise non-secret warning such as `remote_mirror_failed`.
9. If denied, cancelled, or timed out, the tool returns a structured negative result and the agent must stop or ask for further instruction. MCP/CLI timeouts are request deadlines: set `expiresAt` and resolve the pending request when the timeout is reached.

## Request resolution

Rename the current abandon concept to resolve throughout the product: API routes, SDK methods, CLI commands, store methods, audit events, request status values, admin/mobile labels, and documentation. Use request status `resolved` for terminal non-response outcomes. A resolution reason explains whether it was abandoned, cancelled, timed out, or answered elsewhere.

Resolution endpoint shape:

```ts
type ResolveRequestInput = {
  reason: "local_answered" | "local_denied" | "local_cancelled" | "local_timed_out" | "wait_timed_out" | "manual";
  source: "local_elicitation" | "agent_tick_mcp" | "cli" | "manual";
  terminalStatus?: "answered" | "approved" | "denied" | "cancelled" | "timed_out" | "resolved";
  localChoiceIds?: string[];
};
```

Do not accept freeform resolution messages or arbitrary resolution metadata. Store the constrained resolution metadata in the request response/audit payload while keeping it distinct from a remote Agent Tick human response.

## MCP tools

### `agent_tick_status_update`

Non-blocking progress update.

Input schema:

```ts
type AgentTickStatusUpdateInput = {
  message: string;
  state?: "working" | "waiting" | "blocked" | "done" | "failed";
  nextStep?: string;
  project?: string;
  importance?: "low" | "normal" | "high" | "urgent";
  notify?: boolean;
  metadata?: Record<string, string>;
};
```

Output schema:

```ts
type AgentTickStatusUpdateOutput = {
  statusId: string;
  threadId: string;
  state: string;
};
```

Behavior:

- Define an MCP `outputSchema` and return both `structuredContent` and concise text content.
- Keep metadata behavior in sync with `agent-tick status-update --metadata`: arbitrary string key/value pairs with validation, best-effort redaction, and length limits.
- Preserve `importance` and `notify` as explicit hooks for future push behavior.
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
    kind?: "option" | "deny";
    flags?: string[];
    tags?: string[];
  }>;
  allowMultiple?: boolean;
  timeoutMs?: number;
  localElicitation?: "auto" | "off";
};
```

Output schema:

```ts
type AgentTickSteeringOutput = {
  status: "answered" | "denied" | "cancelled" | "timed_out" | "failed";
  selectedChoiceIds?: string[];
  selectedLabels?: string[];
  source?: "agent_tick" | "local_elicitation";
  warning?: string;
  requestId?: string;
};
```

Behavior:

1. Define an MCP `outputSchema` and return both `structuredContent` and concise text content.
2. Validate choice ids are unique and short enough for Agent Tick.
3. Validate the non-empty choice set has at least one caller-provided choice with `kind: "deny"`.
4. Create Agent Tick request with `requestType: "steer"` semantics using the existing approval request API.
5. If local elicitation is enabled and the MCP client supports it, send a form elicitation:
   - single-select: string enum / `oneOf`;
   - multi-select: array enum / `items.anyOf`.
6. Race local elicitation and Agent Tick wait using one shared deadline.
7. Map result to `AgentTickSteeringOutput`; silently ignore any remote response messages.
8. If a multi-select response includes both deny and normal choices, deny wins.
9. Resolve the pending remote request when local wins or when the MCP tool reaches its timeout.
10. Do not support `timeoutMs: 0`; MCP steering must wait for a terminal result.

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
  localElicitation?: "auto" | "off";
};
```

Output schema:

```ts
type AgentTickSanctionOutput = {
  approved: boolean;
  status: "approved" | "denied" | "cancelled" | "timed_out" | "failed";
  choiceId?: "approve" | "deny" | string;
  source?: "agent_tick" | "local_elicitation";
  warning?: string;
  requestId?: string;
};
```

Behavior:

1. Define an MCP `outputSchema` and return both `structuredContent` and concise text content.
2. Create Agent Tick request with `requestType: "sanction"` and fixed approve/deny choices. Sanction choices use canonical kinds `approve` and `deny`; steering choices use `option` and `deny`.
3. If local elicitation is enabled, ask for approve/deny locally.
4. Race local and remote responses using one shared deadline.
5. Silently ignore any remote response messages.
6. Return `approved: true` only for explicit approve.
7. Resolve pending remote request when local wins or when the MCP tool reaches its timeout.
8. Do not support `timeoutMs: 0`; MCP sanctions must wait for a terminal result.
9. Agents must treat all non-approved outputs as stop conditions.

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
  --server https://agenttick.sh \
  --token agent_... \
  --local-elicitation auto \
  --timeout 30m
```

All options are optional when normal Agent Tick config is present. `--server`/`--token` mirror existing CLI overrides and are not written by default installers. `stdio` is the only supported MVP transport; do not implement or document HTTP MCP mode in the first slice.

Do not add MCP tool annotations in MVP. Rely on clear tool descriptions and Agent Tick choice flags such as `favorite`, `safest`, `production`, and `destructive`, keeping those flags aligned with the CLI.

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

Use the official MCP TypeScript SDK if it can be pinned and packaged cleanly. If adding the dependency, follow `docs/dependency-policy.md`, update the lockfile, and validate/update any affected Nix `fetchPnpmDeps` hashes.

## Configuration resolution

`agent-tick mcp` should use the same Agent Tick config resolution as the CLI:

1. `AGENT_TICK_SERVER` + `AGENT_TICK_TOKEN`.
2. `AGENT_TICK_CONFIG`.
3. `~/.config/agent-tick/config.json`.

If config is missing or invalid, `agent-tick mcp` should fail at startup with setup guidance. Do not start a partially configured MCP server. Add a side-effect-free agent self endpoint (for example `GET /v1/agent/me`) so startup can verify the configured `agent_...` token without creating status updates or approval requests.

## Claude Code installation

Add a Claude MCP install path alongside the existing hook install. Hooks remain the default Claude integration; MCP is an explicit offered choice with clear explanation of hooks vs model-callable MCP tools.

Default Claude MCP install should create a tokenless project `.mcp.json` so the repository records that Agent Tick MCP is available without committing credentials. Local/user MCP configuration can also be created with Claude’s CLI:

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

- Use `agent_tick_status_update` for progress updates.
- Use `agent_tick_steering` when a decision blocks progress.
- Use `agent_tick_sanction` before risky/destructive/production actions when native permission routing is not already handling the prompt.
- If a sanction is denied, cancelled, or times out, stop.

## Codex installation

Add a Codex MCP install path. Codex MCP is the default recommended Codex integration path.

Default Codex MCP install should create a tokenless project `.codex/config.toml` so the repository records that Agent Tick MCP is available without committing credentials. Recommended project `.codex/config.toml` snippet:

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

The installer should not silently weaken unrelated approval categories. For the default mirrored MCP profile, require `mcp_elicitations = true`; if it is false, refuse/default-block mirrored setup unless the user chooses a remote-only profile or explicitly changes the setting.

Agent instructions should tell Codex to use Agent Tick MCP tools for status updates, steering, and sanctions. Codex is supported via MCP Adapter; CLI fallback is less capable because it cannot use Mirrored Prompt. Codex does not currently provide a general hook that intercepts and answers all internal ask-user prompts in the same way Claude Code can for `AskUserQuestion`, so MCP steering is model/tool initiated.

## Implementation slices

### Slice 0 — agent self endpoint

- Add a side-effect-free agent-token endpoint such as `GET /v1/agent/me`.
- Return non-secret agent/org/project/team metadata: agent id/name, organization id, scopes, project id, team id, default approval policy, auth source, and server time.
- Use it for `agent-tick mcp` startup verification.

### Slice 1 — MCP server skeleton

- Add dependency and command entrypoint.
- Start a stdio MCP server using the official MCP TypeScript SDK.
- Resolve config, verify startup through the agent self endpoint, and expose a simple `agent_tick_status_update` tool.
- Add unit tests for CLI command registration and schema validation.
- Manually smoke-test with one MCP client if practical.

### Slice 2 — status update tool

- Implement config resolution.
- Call existing Agent Tick status update API.
- Return structured status update result.
- Add tests for success, missing config, and redaction.

### Slice 3 — remote-only steering and sanction tools

- Before implementing MCP steering/sanction tools, rename abandon to resolve everywhere, change the terminal status to `resolved`, add the constrained resolve input schema, update store/audit/SDK/CLI methods, and align admin/mobile labels.
- Implement `agent_tick_steering` and `agent_tick_sanction` using the Agent Tick HTTP API.
- Use `requestType: "steer"` for all steering, including multi-select/questionnaire-style collection.
- Use `requestType: "sanction"` for sanctions, update the existing CLI sanction path to do the same, and update admin/mobile to show sanction requests with approval-gate behavior and Sanction labeling.
- No local MCP elicitation yet.
- Wait for Agent Tick response with a reusable long-wait loop, set request deadlines from timeouts, resolve on timeout, and return structured outputs.
- Add tests for response mapping, timeout, deny, cancel, and API failures.

### Slice 4 — local MCP elicitation

- Add helper to build MCP form schemas from Agent Tick choices.
- Add `localElicitation` modes: `auto`, `off`, `only`.
- Use the server-level `--local-elicitation` value as the default only; per-call values may override it.
- Race local elicitation vs Agent Tick wait concurrently.
- Resolve remote request if local wins, including decline/cancel/timeout; if local wins before remote creation completes, create-then-resolve when possible.
- Best-effort cancel local elicitation if remote wins.
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
- Add or update tokenless project `.mcp.json` by default; support other scopes only when explicitly selected.
- Add dry-run output explaining hooks vs MCP tools.

### Slice 7 — documentation

- Update `docs/integrations.md` with MCP support.
- Add usage examples for Claude and Codex.
- Document that MCP form elicitation must not carry secrets or human-written comments/freeform instructions.
- Document how to disable local elicitation and rely only on Agent Tick mobile/web.

## Security and disclosure rules

- Include only constrained non-secret MCP source metadata on MCP-created requests, such as `source=agent-tick-mcp`, `tool`, `cliVersion`, and `localElicitationMode`; never include raw prompts, environment, transcripts, or full tool inputs as metadata.
- Never include tokens, secrets, private keys, credentials, or full environment files in titles, bodies, commands, metadata, or form fields.
- Redact command/tool inputs before sending to Agent Tick.
- Keep MCP tool output concise; do not return huge Agent Tick request payloads.
- Treat MCP form elicitation as visible to the MCP client and potentially transcript/logged.
- Use URL-mode or Agent Tick web/mobile for any future sensitive data collection.
- Avoid recursive prompts by approving only the Agent Tick MCP tools themselves, not broad user actions.

## Resolved decisions

- MCP MVP uses local stdio only. HTTP MCP is not part of the first implementation.
- The MCP adapter lives in the existing CLI package and is started with `agent-tick mcp`.
- Use the official MCP TypeScript SDK.
- Tool names keep the `agent_tick_` prefix.
- Claude hooks remain native/default; Claude MCP is an explicit install option.
- Codex MCP is the default recommended Codex integration.
- Agent Tick MCP tools should be pre-approved/allowed by installers where the client supports it, without broadening other client permissions. Document Claude behavior separately if no verified per-tool approval config exists.
- MCP outputs use MCP `outputSchema`, `structuredContent`, and concise text summaries.
- Expected domain/API failures return structured failed outputs; reserve MCP tool errors for malformed inputs, protocol failures, or unexpected crashes.
- Agentic decisions return structured choices only; no comments/freeform text are returned to agents.
- Steering requires a non-empty structured choice set. Choices expose the existing `kind` field and must include a caller-provided deny choice. In multi-select steering, deny choices are mutually exclusive with normal choices, and deny wins if mixed selections are received.
- Sanctions are fixed approve/deny gates in MVP, and MCP sanctions never execute commands.
- `agent_tick_sanction` remains model-callable MCP surface only; provider-native hooks keep their existing implementation paths.
- `agent-tick mcp` fails at startup when config is missing or invalid.
- `agent-tick mcp --timeout` is a default that per-call `timeoutMs` may override.
- CLI and MCP should stay in sync where practical, including status metadata behavior, config resolution, redaction, and timeout/deadline semantics.
- MCP and CLI sanction/steering timeouts are request deadlines: set `expiresAt` and resolve on timeout. MCP steering/sanction do not support no-wait `timeoutMs: 0`.
- Installers should install MCP usage instructions.
- Claude and Codex MCP installs default to tokenless project config (`.mcp.json` and `.codex/config.toml` respectively); users may explicitly use `--server`/`--token` at their own risk.
