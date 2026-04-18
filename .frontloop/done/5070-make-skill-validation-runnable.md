---
title: Make the bundled skill validation runnable from Devbox
priority: medium
---

## Goal

Make the `skills/agent-tick` validation command documented in `DEVELOPMENT.md` work in a fresh local development environment.

## Acceptance Criteria

- [x] `devbox run skill:validate` validates `skills/agent-tick`.
- [x] The required Python YAML dependency is installed or otherwise made available through Devbox.
- [x] `DEVELOPMENT.md` points contributors at the Devbox task instead of a host-specific Python command.
- [x] The validation command passes on a clean checkout after dependencies are installed.

## Notes

The current command failed locally with `ModuleNotFoundError: No module named 'yaml'` when running `/home/jmo/.codex/skills/.system/skill-creator/scripts/quick_validate.py`.

## Completion

Added Python 3.13 and PyYAML to Devbox, added `skill:validate`, and verified `devbox run skill:validate` returns `Skill is valid!`.
