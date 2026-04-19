---
title: Add release smoke checks for CLI artifacts
priority: medium
---

## Goal

Catch broken release artifacts before publishing or attaching them to a GitHub Release.

## Acceptance Criteria

- [x] Release CI verifies `agent-tick --version` for built artifacts.
- [x] Release CI verifies `agent-tick request --help` runs from an unpacked archive.
- [x] Release CI verifies expected archive contents include the binary, `README.md`, and `LICENSE`.
- [x] The smoke check runs on pull requests that touch release config or server build paths.

## Notes

The release workflows build archives today, but there was no artifact-level smoke test that proves a downloaded archive is usable.

## Completion

Added `scripts/smoke-server-release.sh`, included README and LICENSE in built archives, wired smoke checks into the CLI release workflow, and verified locally with `AGENT_TICK_VERSION=smoke devbox run build:server && sh scripts/smoke-server-release.sh`.
