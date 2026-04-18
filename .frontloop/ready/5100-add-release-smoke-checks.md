---
title: Add release smoke checks for CLI artifacts
priority: medium
---

## Goal

Catch broken release artifacts before publishing or attaching them to a GitHub Release.

## Acceptance Criteria

- [ ] Release CI verifies `agent-tick --version` for built artifacts.
- [ ] Release CI verifies `agent-tick request --help` runs from an unpacked archive.
- [ ] Release CI verifies expected archive contents include the binary, `README.md`, and `LICENSE`.
- [ ] The smoke check runs on pull requests that touch release config or server build paths.

## Notes

The release workflows build archives today, but there is no artifact-level smoke test that proves a downloaded archive is usable.
