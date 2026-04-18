---
title: Make the bundled skill validation runnable from Devbox
priority: medium
---

## Goal

Make the `skills/agent-tick` validation command documented in `DEVELOPMENT.md` work in a fresh local development environment.

## Acceptance Criteria

- [ ] `devbox run skill:validate` validates `skills/agent-tick`.
- [ ] The required Python YAML dependency is installed or otherwise made available through Devbox.
- [ ] `DEVELOPMENT.md` points contributors at the Devbox task instead of a host-specific Python command.
- [ ] The validation command passes on a clean checkout after dependencies are installed.

## Notes

The current command fails locally with `ModuleNotFoundError: No module named 'yaml'` when running `/home/jmo/.codex/skills/.system/skill-creator/scripts/quick_validate.py`.
