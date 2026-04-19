---
title: Add CSRF protection for dashboard cookie-authenticated writes
priority: medium
---

## Goal

Protect dashboard POST endpoints that rely on the user-mode session cookie.

## Acceptance Criteria

- [x] Cookie-authenticated dashboard writes require a CSRF token or equivalent same-origin protection.
- [x] Bearer-token API clients continue to work without browser CSRF state.
- [x] Tests cover missing/invalid CSRF tokens for cookie-authenticated POST requests.
- [x] `SELFHOSTING.md` documents the expected HTTPS/reverse-proxy setup for secure cookies and CSRF behavior.

## Notes

Session cookies are HttpOnly and SameSite=Lax, and Secure is now set behind HTTPS. CSRF protection uses a readable double-submit CSRF cookie plus `X-Agent-Tick-CSRF` for browser writes authenticated by the session cookie.
