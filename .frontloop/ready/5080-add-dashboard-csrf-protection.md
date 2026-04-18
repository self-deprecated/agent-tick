---
title: Add CSRF protection for dashboard cookie-authenticated writes
priority: medium
---

## Goal

Protect dashboard POST endpoints that rely on the user-mode session cookie.

## Acceptance Criteria

- [ ] Cookie-authenticated dashboard writes require a CSRF token or equivalent same-origin protection.
- [ ] Bearer-token API clients continue to work without browser CSRF state.
- [ ] Tests cover missing/invalid CSRF tokens for cookie-authenticated POST requests.
- [ ] `SELFHOSTING.md` documents the expected HTTPS/reverse-proxy setup for secure cookies and CSRF behavior.

## Notes

Session cookies are HttpOnly and SameSite=Lax, and Secure is now set behind HTTPS. CSRF protection is still a separate design step and should be implemented deliberately.
