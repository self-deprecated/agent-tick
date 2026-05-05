---
title: Add billing and hosted-service hardening
priority: medium
---

## Goal

Prepare Agent Tick to be offered as a paid hosted service with tenant isolation, billing controls, auditability, and production-grade security defaults.

## Acceptance Criteria

- [ ] Add organization plan fields, seat limits, agent limits, request limits, and retention settings.
- [ ] Add usage counters for active users, active agents, approval requests, push notifications, and retained audit events.
- [ ] Add a billing-provider abstraction and webhook-ready flow without coupling core logic to one provider too early.
- [ ] Enforce plan limits in organization/team/user/agent creation paths with clear API errors.
- [ ] Add Svelte Billing/Settings screens showing plan, usage, limits, invoices or billing portal link placeholder, and upgrade/contact actions.
- [ ] Add organization audit-log views and export endpoints for security-sensitive events.
- [ ] Add tenant-isolation tests proving users cannot access other organizations' teams, policies, agents, devices, approvals, or audit logs.
- [ ] Harden hosted defaults: stricter CORS, secure cookies behind HTTPS, rate limiting, request-size limits, token rotation UX, and safer error messages.
- [ ] Add retention/deletion jobs or documented operational hooks for expired sessions, old approval data, revoked tokens, and audit retention.
- [ ] Update self-hosting and hosted-service documentation with plan behavior, security posture, and operational requirements.

## UX Notes

- Billing should not block self-hosted local use.
- Paid-service limits should be explained before users hit them, especially seats, active agents, and audit retention.
