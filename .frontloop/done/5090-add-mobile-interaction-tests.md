---
title: Add mobile tests for pairing and notification actions
priority: medium
---

## Goal

Cover the mobile flows that currently carry the most behavior risk outside the settings layout.

## Acceptance Criteria

- [x] Tests cover parsing Agent Tick pairing QR payloads.
- [x] Tests cover notification approve/deny action handling.
- [x] Tests cover the fallback path when a notification action response fails and the app opens the approval.
- [x] Existing `npm test -- --runInBand` continues to pass.

## Notes

The current mobile test suite focused on `SettingsScreen` rendering and did not exercise the app-level pairing or notification action logic.

## Completion

Extracted pure app interaction helpers into `AppLogic.ts` and added Jest coverage for pairing payload parsing, notification approve/deny decisions, notification open decisions, and fallback state.
