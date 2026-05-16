# Codex MCP Adapter verification and demo

## Summary

Codex support uses the local Agent Tick stdio MCP Adapter launched with `agent-tick mcp`. Codex calls Agent Tick MCP tools for status updates, steering, and sanctions; Agent Tick then creates normal approval requests/status updates against the configured Agent Tick server.

This is an integration verification note and demo script. It is not a claim that `agent-tick install --target codex` automatically edits Codex config today. Current installer discovery can identify Codex, but automatic Codex config writing is still disabled; users should configure Codex manually with the TOML below until the installer slice is implemented and tested.

## Verified launch scope

Supported current behavior:

- `agent-tick mcp` starts the local stdio MCP adapter.
- The adapter uses the same saved Agent Tick setup/token as the CLI.
- Codex can be configured with a local `mcp_servers.agent_tick` stdio entry.
- Agent Tick MCP tools expose:
  - `agent_tick_status_update`
  - `agent_tick_steering`
  - `agent_tick_sanction`
- Mirrored Prompt is available when the MCP client supports elicitation and `localElicitation` is `auto`.
- With Mirrored Prompt, the local Codex MCP elicitation and remote Agent Tick phone/web request race; the first valid answer wins.
- MCP sanctions never execute commands. They return an approval result that Codex/the local workflow must act on.

Not verified or not implemented for launch:

- Automatic Codex config writing by `agent-tick install --target codex`.
- Native Codex hook interception for all internal prompts or tool approvals.
- Remote HTTP MCP transport.
- Agent Tick approving broad Codex permissions beyond the Agent Tick MCP tools themselves.
- Agent Tick running commands from MCP sanctions.

## Manual Codex config

Add a tokenless project or user Codex config entry. The MCP adapter should read credentials from the normal Agent Tick CLI config; do not commit `agent_...` tokens into `.codex/config.toml`.

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

If Codex uses granular approval policy, allow MCP elicitations so Mirrored Prompt can show the local Codex dialog:

```toml
[tools]
mcp_elicitations = true
```

Use `localElicitation: "off"` only when intentionally testing remote Agent Tick phone/web routing without the local Codex dialog.

## Preflight checklist

1. Run `agent-tick login` or `agent-tick setup --server ... --token ...`.
2. Verify `agent-tick status-update "Codex MCP preflight"` can reach the intended server.
3. Verify `agent-tick mcp --help` prints adapter options.
4. Add the Codex MCP config above without embedding tokens.
5. Start Codex in a test repository with no secrets in prompts or command examples.
6. Ask Codex to list/use the `agent_tick_status_update`, `agent_tick_steering`, and `agent_tick_sanction` tools.
7. Confirm the Agent Tick tools are approved/pre-approved in Codex so Agent Tick itself does not require another local approval before it can ask the human.

## Demo 1 — status update

Ask Codex:

```text
Use the Agent Tick MCP status tool to send: "Codex MCP demo started; no secrets included." Then continue.
```

Expected result:

- Codex calls `agent_tick_status_update`.
- Agent Tick records a lightweight status update.
- No approval is required and no sensitive content is included.

## Demo 2 — mirrored steering

Ask Codex:

```text
Use Agent Tick steering to ask which safe demo path to run next.
Options:
- Run docs build (recommended)
- Run CLI help smoke test
- Stop the demo
Include Stop the demo as the deny/escape option.
```

Expected result:

1. Codex calls `agent_tick_steering`.
2. Agent Tick creates a remote steering request.
3. If `mcp_elicitations = true` and `localElicitation = "auto"`, Codex also shows the local MCP elicitation dialog.
4. The local Codex answer and remote Agent Tick phone/web answer race.
5. The first valid answer is returned as structured MCP output.
6. The losing pending Agent Tick request is resolved/abandoned by the adapter according to current implementation behavior.

Demo boundary:

- Use bounded options only.
- Do not ask Codex to accept arbitrary freeform remote instructions.
- Keep the deny/stop option visible.

## Demo 3 — sanction result without command execution

Ask Codex:

```text
Use Agent Tick sanction to ask whether this dry-run release action is allowed:
command summary: pnpm --filter @self-deprecated/agent-tick publish --dry-run
The action must not be executed by Agent Tick. If denied, stop.
```

Expected result:

- Codex calls `agent_tick_sanction`.
- Agent Tick asks for approve/deny.
- The MCP tool returns a structured approval/denial result.
- Codex/local workflow decides whether to proceed.
- Agent Tick does not run `pnpm publish`, `npm publish`, shell commands, or release actions.

For a public recording, deny first to demonstrate safe blocking. If showing approval, use only a dry-run or local no-op command in a disposable checkout.

## Failure modes and expected copy

| Failure | Expected handling |
| --- | --- |
| No Agent Tick config | `agent-tick mcp` should fail with setup guidance; run `agent-tick login` or `agent-tick setup`. |
| Codex blocks MCP elicitation | Use remote-only `localElicitation: "off"` for the demo, or enable `mcp_elicitations = true`. |
| Agent Tick tools require Codex approval | Approve only the Agent Tick MCP tools, not broad shell or unrelated tools. |
| Remote request times out | Treat as a negative/blocked outcome for steering/sanction demos. |
| User denies sanction | Codex should stop or choose a safe alternative; the protected action should not run. |
| Prompt includes secrets | Stop and rewrite the demo prompt with sanitized data. |

## Disclosure boundaries

Do not send:

- API keys, bearer tokens, cookies, private keys, `.env` contents, or credentials.
- Full command output or logs.
- Full prompts/transcripts.
- Production customer data.
- Real deploy/publish commands unless the workflow is intentionally approved and safe.

Do show:

- Safe command summaries.
- Bounded choices and explicit deny/stop options.
- The phone/web Agent Tick request.
- The local Codex elicitation when enabled.
- The returned structured decision.

## Validation notes for this repo

Useful checks after docs changes:

```sh
corepack pnpm --filter agent-tick-docs build
```

Useful checks before claiming adapter behavior changed:

```sh
corepack pnpm --filter @self-deprecated/agent-tick test
corepack pnpm --filter @self-deprecated/agent-tick build
agent-tick mcp --help
```

Only update this doc from “manual config” to “installer config” after `agent-tick install --target codex` writes/preserves Codex config and has tests for existing config, tokenless project config, and `mcp_elicitations` policy handling.
