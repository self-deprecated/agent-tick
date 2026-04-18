---
title: the readme should be geared towards users that will install the agent-tick cli, not to those that will selfhost it. The selfhosting setup is in its own document
priority: medium
depends_on: 5050-set-up-cli-distribution-goreleaser-brew-scoop.md
---

## Goal

Rewrite `README.md` so it targets CLI users (install, pair, first approval request), not self-hosters. Move the current self-hosting content into a new `SELFHOSTING.md`. Absorb any operationally-flavoured content from `DEVELOPMENT.md` into `SELFHOSTING.md` so `DEVELOPMENT.md` stays focused on contributors.

## Acceptance Criteria

### `README.md`

- [ ] Opens with "What is Agent Tick" — one paragraph, user-perspective (agents ask for approval; your phone answers).
- [ ] "Install" section with brew, scoop, install.sh, and `go install` (matches what task `5050-set-up-cli-distribution-...` ships). Example:
  ```
  brew install self-deprecated/tap/agent-tick
  scoop install agent-tick
  curl -sSL https://get.agent-tick.dev/install.sh | sh   # placeholder URL if not yet set
  go install agent-tick/apps/server/cmd/agent-tick@latest
  ```
  (Exact commands to match what the distribution task actually produces.)
- [ ] "Quick start" section: pair with a server (QR scan), send first approval request via `agent-tick request`, approve on phone.
- [ ] A short note: "You currently need to run your own Agent Tick server. A hosted option is planned." — links to `SELFHOSTING.md`.
- [ ] A short "How it works" paragraph (agent → server → phone → agent).
- [ ] Links at the bottom to `SELFHOSTING.md` and `DEVELOPMENT.md`.
- [ ] No `docker-compose`, env var tables, or `.env` examples in README. Those live in `SELFHOSTING.md`.
- [ ] License section (added by the license task, `5000-...`).

### `SELFHOSTING.md` (new)

- [ ] Contains the current README's server-setup content (`.env`, `docker-compose.yml`, ports, reverse proxy, `AGENT_TICK_*` env vars, mode/public URL guidance).
- [ ] Absorbs any operationally-flavoured content from `DEVELOPMENT.md` (e.g. deployment, image publishing, production env tuning) that doesn't belong in a contributor doc.
- [ ] Linked from the README.

### `DEVELOPMENT.md`

- [ ] Retains only contributor-facing content: building from source, running tests, local dev loop, code layout, release process (tagging — but not operating a deployed instance).
- [ ] Any ops content that was there is moved to `SELFHOSTING.md` or deleted if duplicated.

### General

- [ ] Markdown renders cleanly on GitHub.
- [ ] All internal links work.

## Design Decisions

- **Audience split**: README = CLI user; SELFHOSTING.md = operator; DEVELOPMENT.md = contributor.
- **Self-hosting file name and location**: `SELFHOSTING.md` at repo root (discoverable, one click from README). Not `docs/selfhosting.md` — the repo has no other `docs/` content yet; avoid creating a directory for one file.
- **Hosted service status**: note in README that self-hosting is currently required; hosted option is planned.
- **Install section**: uses brew/scoop/install.sh as primary paths; `go install` as a fallback for Go users. Assumes the distribution task (`5050`) has landed.

## Implementation Notes

- This task depends on `5050-set-up-cli-distribution-goreleaser-brew-scoop.md`. Do not start until `5050` is merged and the install commands actually work — otherwise README ships broken instructions.
- Example juggler README lives at `~/Development/active/tools/juggler/README.md` — use it as a structural reference for the quick-start style.
- Keep the README under ~150 lines. If it grows, split further rather than padding.
- The "Quick start" should be runnable: real commands, real flag names. No placeholders in code blocks that a user could copy-paste and get confused by. If a value is user-specific (server URL), show it as `<your-server-url>` with inline explanation.
