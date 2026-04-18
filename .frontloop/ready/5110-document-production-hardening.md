---
title: Document production hardening for self-hosting
priority: low
---

## Goal

Make `SELFHOSTING.md` explicit about the operational safeguards expected for a production deployment.

## Acceptance Criteria

- [ ] Document HTTPS reverse-proxy requirements and forwarded headers.
- [ ] Document SQLite volume backup and restore expectations.
- [ ] Document admin token and agent token rotation.
- [ ] Document the difference between local notifications and Expo remote push.
- [ ] Mention that user-mode dashboard sessions rely on secure cookie behavior behind HTTPS.

## Notes

The current self-hosting guide is enough to get started, but production operators need a concise hardening checklist.
