---
title: Add mobile tests for pairing and notification actions
priority: medium
---

## Goal

Cover the mobile flows that currently carry the most behavior risk outside the settings layout.

## Acceptance Criteria

- [ ] Tests cover parsing Agent Tick pairing QR payloads.
- [ ] Tests cover notification approve/deny action handling.
- [ ] Tests cover the fallback path when a notification action response fails and the app opens the approval.
- [ ] Existing `npm test -- --runInBand` continues to pass.

## Notes

The current mobile test suite focuses on `SettingsScreen` rendering and does not exercise the app-level pairing or notification action logic.
