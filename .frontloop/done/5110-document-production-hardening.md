---
title: Document production hardening for self-hosting
priority: low
---

## Goal

Make `SELFHOSTING.md` explicit about the operational safeguards expected for a production deployment.

## Acceptance Criteria

- [x] Document HTTPS reverse-proxy requirements and forwarded headers.
- [x] Document SQLite volume backup and restore expectations.
- [x] Document admin token and agent token rotation.
- [x] Document the difference between local notifications and Expo remote push.
- [x] Mention that user-mode dashboard sessions rely on secure cookie behavior behind HTTPS.

## Notes

The current self-hosting guide is enough to get started, but production operators need a concise hardening checklist.

## Completion

Added a production hardening section covering HTTPS proxy headers, SQLite volume backups, dashboard and agent token rotation, device revocation, local vs Expo remote push notifications, and secure user-mode dashboard cookies.
