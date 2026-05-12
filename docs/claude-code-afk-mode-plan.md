# Claude Code AFK mode integration plan

This document records the product and implementation decisions for the Agent Tick Claude Code setup flow.

## Framing

Agent Tick should present three independent Claude Code capabilities. Users may enable any combination of them.

1. **Status** — non-blocking progress updates from the agent to the human, such as meaningful milestones, blocked states, or task completion.
2. **Steering** — structured user choices that help the agent decide what to do next. In Claude Code this maps to `AskUserQuestion`.
3. **Sanctions** — human approval for actions Claude Code is already about to ask permission for. In Claude Code this maps to `PermissionRequest`.

## Agent Tick modes

Do not try to add a native Claude Code permission mode. Claude Code has its own built-in modes such as `default`, `acceptEdits`, `plan`, `auto`, `dontAsk`, and `bypassPermissions`; current plugin hooks do not appear to provide a supported way to add a new entry to that mode selector.

Instead, Agent Tick should provide its own local mode overlay:

- **AFK mode** — configured steering, sanction, and status flows are routed through Agent Tick.
- **Pass-through mode** — hooks are installed but inactive; Claude Code behaves normally and shows its native terminal/UI prompts.

The hook configuration should always be installed. Each hook checks the current Agent Tick mode before deciding whether to act.

In pass-through mode, hooks should exit cleanly without returning JSON decisions or modified input. In AFK mode, hooks may create Agent Tick requests and return Claude Code hook decisions.

## CLI mode surface

Add a CLI surface similar to:

```sh
agent-tick mode
agent-tick mode afk
agent-tick mode pass-through
```

The current mode should be stored in local Agent Tick state/config. Future aliases such as `passthrough` or `normal` may be useful, but the user-facing terms should be **AFK mode** and **pass-through mode**.

## Sanctions

Sanctions should not use an Agent Tick risky-command classifier for the initial Claude Code integration.

Instead, sanctions should route Claude Code's own permission requests. When Claude Code is about to ask the user for permission, Agent Tick can handle that request in AFK mode.

Use the Claude Code `PermissionRequest` hook with a broad matcher.

### Pass-through behavior

In pass-through mode, the hook exits without a decision. Claude Code then shows its normal permission UI.

### AFK behavior

In AFK mode, the hook creates an Agent Tick approval request from the Claude Code permission request, including relevant safe context such as:

- `tool_name`
- summarized `tool_input`
- working directory
- permission suggestions, if useful and safe to display

If approved, return a Claude Code permission decision equivalent to:

```json
{
  "hookSpecificOutput": {
    "hookEventName": "PermissionRequest",
    "decision": {
      "behavior": "allow"
    }
  }
}
```

If denied, timed out, or Agent Tick fails closed, return a denial:

```json
{
  "hookSpecificOutput": {
    "hookEventName": "PermissionRequest",
    "decision": {
      "behavior": "deny",
      "message": "Denied, timed out, or failed in Agent Tick"
    }
  }
}
```

Agent Tick may add command policy later, but it is explicitly out of scope for this first version.

## Steering

Steering maps to Claude Code's `AskUserQuestion` flow.

Claude Code's `AskUserQuestion` input supports:

- 1–4 questions
- 2–4 options per question
- option labels and descriptions
- optional multi-select
- optional previews in SDK contexts

Agent Tick should support the full schema rather than only a single question.

In AFK mode, the hook should create an Agent Tick steering request, wait for the selected choices, and return `updatedInput` containing the original questions plus an `answers` object keyed by exact question text:

```json
{
  "questions": [
    {
      "question": "Which framework?",
      "header": "Framework",
      "options": [
        { "label": "React", "description": "Use React" },
        { "label": "Svelte", "description": "Use Svelte" }
      ],
      "multiSelect": false
    }
  ],
  "answers": {
    "Which framework?": "Svelte"
  }
}
```

For multi-select answers, return selected labels in the format Claude Code accepts, such as an array of labels or a comma-joined string.

In pass-through mode, the hook should exit without a decision so Claude Code's native question UI appears.

## Status updates

Status is independent of steering and sanctions.

The setup flow should let the user choose whether status updates are enabled and when they are sent. Possible policies:

- no status updates
- task completion only
- blocked and completion updates
- major milestones
- turn-end updates

Default conservatively. Avoid noisy automatic updates. A good default is completion, blocked, and meaningful milestones when the user has opted into status.

Status can be instruction-driven and/or hook-assisted. Hook-assisted status may use events such as `Stop`, `UserPromptSubmit`, or `PostToolBatch`, but should avoid sending sensitive data and should not spam the user.

## Permissions

The installer should offer to configure Claude Code permissions so Agent Tick itself can run without recursive prompts.

The core allow rule is:

```text
Bash(agent-tick:*)
```

Depending on distribution/install path, future setup may also need to allow specific package runner/install commands. Do not add broad command permissions for user actions as part of the initial sanction setup.

If an existing deny rule blocks Agent Tick itself, the setup flow should report that conflict and explain what must change.

## Setup and onboarding flow

The preferred onboarding is skill-led and interactive.

The Agent Tick skill should:

1. inspect the current environment
2. ask how the user plans to use Agent Tick
3. ask which capabilities they want: status, steering, sanctions
4. inspect Claude Code settings, hooks, and permissions
5. recommend exact install commands
6. run a dry run
7. explain exactly what will change
8. ask for confirmation
9. run the install
10. verify the setup
11. instruct the user to restart Claude Code if required

The install command should also be interactive when required options are not passed explicitly, but the skill should provide the best first-time user experience because it can explain tradeoffs and inspect for conflicts.

## Setup questions

The skill or installer should ask about runtime style first.

### Runtime style

- **Interactive local sessions** — user is sometimes at the terminal and sometimes away. Recommend installing AFK/pass-through mode toggling.
- **Headless loops** — no terminal human is available. Recommend always-AFK behavior for enabled capabilities.
- **Mixed** — support both, with explicit defaults and toggles.

### Capabilities

Ask independently whether to enable:

- status
- steering
- sanctions

### Status policy

Ask when status should be sent, such as completion only, blocked/completion, milestones, or turn-end.

### Steering policy

Recommended defaults:

- interactive sessions: route steering only in AFK mode
- headless sessions: always route steering through Agent Tick

### Sanction policy

Recommended defaults:

- interactive sessions: route Claude `PermissionRequest` only in AFK mode
- headless sessions: always route Claude `PermissionRequest` through Agent Tick

Do not ask for dangerous command categories in the initial version, because Agent Tick will not manage command policy yet.

### Permission setup

Ask whether to add the Claude Code permission rule for Agent Tick itself. Explain that this only allows invoking Agent Tick and does not approve arbitrary user commands.

## Conflict checks

Before installing, inspect:

- `~/.claude/settings.json`
- `.claude/settings.json`
- `.claude/settings.local.json`
- existing hooks for `PermissionRequest`, `PreToolUse`, `PostToolUse`, `Stop`, and related events
- existing `permissions.allow`, `permissions.ask`, and `permissions.deny`
- whether `agent-tick` is on `PATH`
- whether Agent Tick client config exists
- current Claude Code version, when available

Report conflicts and notable findings, for example:

```text
Found existing PermissionRequest hooks. Agent Tick will add one additional hook and will pass through unless AFK mode is active.
```

or:

```text
Found a deny rule that may block Bash(agent-tick:*). Agent Tick hooks cannot function until this is changed.
```

## Dry-run output

The dry run should clearly show planned changes, for example:

```text
Planned changes:

1. Install Agent Tick Claude Code hook entries.
2. Add Claude permission allow rule:
   Bash(agent-tick:*)
3. Enable steering through Agent Tick in AFK mode.
4. Enable sanctions through Agent Tick in AFK mode.
5. Enable completion and blocked status updates.
6. Set initial Agent Tick mode to pass-through.

No Claude Code prompts will be routed to Agent Tick until AFK mode is enabled.
```

## Verification

After installation, verify:

- Agent Tick CLI exists
- Agent Tick config exists
- local Agent Tick mode state exists
- expected Claude Code hook entries are present
- `Bash(agent-tick:*)` permission is present if requested
- no obvious deny rule blocks Agent Tick

Then print a clear summary and restart instruction:

```text
Installed Agent Tick for Claude Code.

Current mode: pass-through
Enabled:
  - steering in AFK mode
  - sanctions in AFK mode
  - completion and blocked status updates

Use:
  agent-tick mode afk
  agent-tick mode pass-through

Restart Claude Code before relying on the new hooks.
```

## Claude Code plugin role

A Claude Code plugin can package the integration pieces where useful:

- hook configuration
- hook scripts or CLI hook entrypoints
- slash commands or skills for toggling AFK/pass-through mode
- setup/status commands
- user-facing instructions

The plugin is not expected to add a native Claude Code permission mode. It should implement Agent Tick's mode overlay using hooks and local Agent Tick state.
