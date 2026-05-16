# Claude Code Verified Hook verification and demo

## Summary

Claude Code support uses local Verified Hooks installed by `agent-tick install --target claude`. The hooks run on the same machine as Claude Code and either pass through to Claude Code's native prompts or route Claude Code steering and permission prompts to Agent Tick, depending on the local Agent Tick mode and Claude routing policy.

This page is a launch-safe verification note and demo script. It is not a claim that Agent Tick replaces Claude Code's permission model or classifies every command itself. Agent Tick handles Claude Code prompts that Claude Code already exposes through supported hook events.

## Verified launch scope

Supported current behavior:

- `agent-tick install --target claude` writes Claude Code hook entries to `~/.claude/settings.json` or `.claude/settings.local.json`.
- The installer adds a `PreToolUse` hook for `AskUserQuestion` steering.
- The installer adds a `PermissionRequest` hook with matcher `*` for Claude Code permission prompts.
- The installer adds `Bash(agent-tick:*)` so Agent Tick can run without recursive Claude permission prompts.
- Interactive profile defaults to `pass-through` mode with steering and sanctions routed only when `agent-tick mode afk` is enabled.
- Headless profile defaults to `afk` mode with steering and sanctions routed with policy `always`.
- The hook state is stored locally in Agent Tick state, separate from Claude Code's own permission mode selector.
- Agent Tick redacts hook input keys containing `token`, `secret`, `password`, `credential`, or `key` before displaying permission request context.

Not verified or not implemented for launch:

- A new native Claude Code permission mode named Agent Tick.
- Agent Tick command-risk classification for arbitrary Claude Code tools.
- Remote shell or remote command execution by Agent Tick.
- Approval of broad Claude Code permissions beyond the prompt Claude Code is already asking about.
- Automatic routing while in `pass-through` mode, unless the relevant routing policy is set to `always`.

## Install and verification checklist

Run the installer from the machine where Claude Code runs:

```sh
agent-tick install --target claude --dry-run
```

Review the planned settings file, hook entries, `Bash(agent-tick:*)` permission, sandbox allowances, and initial mode. Then install either the interactive or headless profile.

Interactive/local demo profile:

```sh
agent-tick install --target claude \
  --claude-profile interactive \
  --claude-scope local \
  --claude-steering afk \
  --claude-sanctions afk \
  --claude-initial-mode pass-through
```

Headless demo profile:

```sh
agent-tick install --target claude \
  --claude-profile headless \
  --claude-scope local \
  --claude-steering always \
  --claude-sanctions always \
  --claude-initial-mode afk
```

After install:

1. Restart Claude Code so it reloads hook settings.
2. Run `agent-tick mode` and confirm the expected local mode.
3. Inspect the selected Claude settings file and confirm it contains:
   - `PreToolUse` matcher `AskUserQuestion` with `agent-tick hook claude-pre-tool-use`
   - `PermissionRequest` matcher `*` with `agent-tick hook claude-permission-request`
   - `permissions.allow` entry `Bash(agent-tick:*)`
4. Keep the demo repository disposable and exclude secrets from prompts, commands, and file names.

## Demo 1 — pass-through safety

Use this with the interactive profile while `agent-tick mode` prints `pass-through`.

Ask Claude Code:

```text
Ask me a structured question with two safe options about which local README wording to review next. Do not edit files yet.
```

Expected result: Claude Code should use its native local question behavior. Agent Tick should not create a remote steering request because the default interactive profile routes steering only in AFK mode.

If a remote Agent Tick request appears in this step, inspect the local Agent Tick state and routing policies; a policy may be set to `always`.

## Demo 2 — AFK steering

Switch to AFK mode:

```sh
agent-tick mode afk
```

Ask Claude Code:

```text
Use AskUserQuestion to ask which safe documentation-only demo path to run next. Offer exactly these options: Review setup wording, Review troubleshooting wording, Stop the demo. Treat Stop the demo as the escape option and do not edit files.
```

Expected result: Agent Tick creates a steering request with the Claude-provided options plus a cancel/deny path. The selected answer is returned to Claude Code through `updatedInput.answers`.

For public recordings, choose the stop/escape option once to demonstrate that the remote human can safely halt the flow.

## Demo 3 — Claude permission sanction

Keep AFK mode enabled, then ask Claude Code for a harmless action that triggers Claude Code's own permission prompt, such as reading a non-sensitive local file or running a no-op command in a disposable checkout:

```text
Before changing anything, ask to run a harmless local command such as `pwd` so we can demonstrate the Agent Tick sanction path. Do not run destructive commands and do not include secrets.
```

Expected result: Claude Code requests permission, the `PermissionRequest` hook creates an Agent Tick sanction, and Agent Tick returns either:

- allow: Claude Code may continue with the specific permission prompt, or
- deny/timeout/failure: Claude Code receives a denial and should stop or pick a safe alternate path.

Agent Tick does not execute the command itself from the hook. It only returns Claude Code's permission decision for the prompt Claude Code supplied.

## Demo 4 — restore native Claude prompts

Return to pass-through mode after the demo:

```sh
agent-tick mode pass-through
```

Repeat the steering or permission prompt. Claude Code should show its native prompt instead of routing through Agent Tick, unless the installed routing policy is `always`.

## Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| Claude Code keeps showing native prompts in the AFK demo | Claude Code was not restarted, hooks were installed in a different scope, or local mode is still `pass-through` | Restart Claude Code, inspect the selected settings file, and run `agent-tick mode afk`. |
| Agent Tick requests appear during pass-through demo | Routing policy is `always`, or `AGENT_TICK_MODE=afk` is set in the hook environment | Check local Agent Tick state and environment variables. |
| Agent Tick hook itself triggers a permission loop | Missing or overridden `Bash(agent-tick:*)` allow rule | Re-run installer dry-run and add the specific allow rule; do not add broad command permissions. |
| Hook fails closed with denial | Agent Tick config/token is missing, server is unreachable, or hook input is malformed | Run `agent-tick login` or `agent-tick setup --server ... --token ...`, then retry with a safe prompt. |
| Sandbox blocks the hook | Claude Code sandbox cannot reach Agent Tick or write local Agent Tick state | Use `--claude-sandbox auto` or `--claude-sandbox allow` and inspect the generated sandbox allowances. |
| Prompt contains secrets | Demo prompt or tool input is unsafe | Stop the demo, rewrite with sanitized data, and rotate any exposed credential if needed. |

## Disclosure boundaries

Use these phrases in public launch materials:

- "Claude Code Verified Hooks can route `AskUserQuestion` steering and Claude Code `PermissionRequest` prompts through Agent Tick."
- "Pass-through mode keeps Claude Code's native prompts; AFK mode routes configured prompts to Agent Tick."
- "Agent Tick sanctions approve or deny the specific action Claude Code is already asking about."

Avoid these overclaims:

- "Agent Tick replaces Claude Code permissions."
- "Agent Tick remotely runs shell commands."
- "Agent Tick blocks every arbitrary tool call in every Claude Code mode."
- "Agent Tick can safely approve broad command categories for Claude Code."
