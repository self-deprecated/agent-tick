---
title: Rebuild admin dashboard as Svelte and TypeScript
priority: high
---

## Goal

Replace the inline vanilla JavaScript admin page with a Svelte 5 + TypeScript dashboard while preserving the current single-user and user-mode workflows.

## Acceptance Criteria

- [ ] Add an `apps/admin` Svelte 5 + TypeScript app built with Vite.
- [ ] Add typed API models and a small typed fetch client for sessions, CSRF, bearer-token auth, approvals, devices, pairing tokens, and agent tokens.
- [ ] Implement current auth flows: single-mode bearer-token connect and user-mode email/password sign-in with session resume.
- [ ] Recreate current dashboard features: approval list, approve/deny actions, QR phone pairing, device listing/revocation, agent-token listing/creation/revocation, loading states, empty states, and errors.
- [ ] Serve the built admin app from the Go server using embedded/static assets instead of the current `adminHTML` string.
- [ ] Keep existing REST endpoints and mobile/CLI behavior compatible.
- [ ] Add development/build tasks so `devbox run check` or an equivalent local check validates the admin app.
- [ ] Run Svelte validation/typecheck and Go tests.

## UX Notes

- Use a clean responsive shell with clear primary actions: Approvals, Devices, Agents.
- Prefer progressive disclosure for setup commands and QR pairing.
- Avoid introducing teams/policies in this task; this is a safe feature-parity rewrite first.
