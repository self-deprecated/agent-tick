# Zapier app/action opportunity brief

## Summary

Zapier is the second no-code/workflow connector target after n8n. Agent Tick should not try to replace Zapier Human in the Loop. The opportunity is narrower: give teams a least-permission Agent Tick approval checkpoint that can be dropped into existing Zaps, supports hosted or self-hosted Agent Tick servers, and returns a bounded decision for later Zap steps to branch on.

This brief is a product/design artifact, not a launched Zapier integration. It defines the first action surface, onboarding model, differentiation, safety boundaries, and validation plan for a future Zapier app.

## Why Zapier after n8n

Zapier has the strongest no-code distribution and a large app ecosystem. Teams already use it to connect support, billing, CRM, email, issue trackers, and internal tooling. Agent Tick can meet those teams where automation already happens, while preserving Agent Tick's product boundary: route and record an approval decision; do not execute the protected action.

n8n remains first because it is self-host-friendly and AI-workflow-native. Zapier should follow once the request/wait contract and approval templates are stable enough to reuse.

## Target users

- Solo developers and small teams who already use Zapier for business automation but want Agent Tick mobile approval surfaces.
- Self-hosted teams that want a Zap step pointing at their own Agent Tick API URL.
- Support/ops teams that need approval gates for refunds, outbound messages, release steps, or account changes.
- Coding-agent users who want a workflow step to pause before an external-effect action.

## First Zapier app shape

### Authentication

Use Zapier API key authentication first.

Fields:

- `serverUrl` — default `https://api.agenttick.sh`; allow custom self-hosted URL.
- `agentToken` — Zapier secret field for an Agent Tick `agent_...` token.

Rules:

- Send `Authorization: Bearer <agentToken>`.
- Never put tokens in URLs, request metadata, approval body text, or Zap outputs.
- Do not use human session tokens in Zapier credentials.
- OAuth can be revisited after hosted team/account flows need it.

### Action 1 — Create Approval Request

Purpose: create a bounded Agent Tick approval request and return the request id plus safe fields.

Input fields:

- `title` — required short reviewer-facing title.
- `body` — optional reviewer guidance; help text should warn against secrets/raw logs.
- `command` or `actionSummary` — optional safe action summary.
- `templateId` — optional preset: `production_deploy`, `refund_approval`, `outbound_email_approval`, `database_migration`, `release_approval`.
- `risk` — optional `low`, `medium`, `high`.
- `timeoutMinutes` — optional expiration/wait deadline.
- `choices` — advanced line items or preset choices; defaults to approve/deny.
- `metadata` — advanced key/value pairs from an allowlist.

Outputs:

- `requestId`
- `status`
- `terminal=false`
- `createdAt`
- `expiresAt`
- `decision=pending`
- `dashboardUrl` only if safe and supported by the configured server.

### Action 2 — Wait for Approval Decision

Purpose: wait/poll for a terminal decision and return normalized branch fields.

Input fields:

- `requestId` — required, usually from Create Approval Request.
- `timeoutSeconds` — bounded by Zapier platform limits.
- `pollIntervalSeconds` — if polling is used.

Outputs:

- `requestId`
- `terminal`
- `status`
- `decision` — `approved`, `denied`, `expired`, `abandoned`, `pending`, or `unknown`.
- `choiceId`
- `choiceKind`
- `message` only when explicitly safe.
- `answers` when questionnaire results are supported.
- `respondedAt`

Pending after timeout should be a successful non-terminal output where Zapier supports branching on `decision=pending`, not a fake denial.

### Action 3 — Create and Wait

Purpose: a convenience action for short approval gates in simple Zaps.

Input fields:

- All Create Approval Request fields.
- Wait timeout fields.

Outputs:

- Combined create and decision outputs.

This should be the first user-facing quickstart action if Zapier execution limits make the wait behavior reliable enough. Keep separate create/wait actions for longer workflows.

## Template presets

Reuse the docs-first [Approval templates](./approval-templates.md):

- `production_deploy`
- `refund_approval`
- `outbound_email_approval`
- `database_migration`
- `release_approval`

Zapier presets should prefill safe field labels, choices, and flags, but users must still review the generated approval text before sending it.

## Differentiation vs Zapier Human in the Loop

Zapier's own Human in the Loop features are workflow-native and have strong platform distribution. Agent Tick should not claim to be a generic replacement.

Agent Tick's complementary story:

- first-party Agent Tick mobile/web approval surfaces
- self-hosted Agent Tick server option
- agent-token-scoped approval requests
- reusable bounded templates aligned with CLI, SDK, MCP, GitHub Actions, and n8n plans
- consistent approval history and routing in Agent Tick
- source-available approval infrastructure for teams that do not want approval state only inside Zapier

Avoid saying:

- “Agent Tick replaces Zapier approval steps.”
- “Agent Tick runs the action for you.”
- “Approve arbitrary prompts from Zapier.”
- “Full audit log” unless retention and export scope are explicitly implemented for that plan.

## Privacy and safety boundaries

Zapier steps often receive data from many apps, so defaults must be conservative.

Do not send by default:

- secrets, bearer tokens, private keys, cookies, OAuth tokens, API keys, or `.env` contents
- raw AI prompts or full transcripts
- full logs, stack traces, or command output
- full customer records beyond what the reviewer needs
- payment card or bank details

Prefer:

- short summaries
- source-system links behind existing access controls
- bounded approve/deny/custom choices
- safe correlation ids
- `templateId`, `workflowId`, `zapId`, `runId`, or `correlationId` metadata

Warn on metadata keys matching `token`, `secret`, `password`, `authorization`, `cookie`, `privateKey`, `apiKey`, or `credential`.

## MVP non-goals

- Zapier Marketplace launch before private prototype validation.
- OAuth to Agent Tick.
- Guest approval links.
- Attachments or file upload handling.
- Editing outbound emails inside Agent Tick.
- Multi-step approval policy editing inside Zapier.
- Agent Tick executing refunds, emails, deploys, or migrations.
- Replacing Zapier permissions, Zap history, or app authorization scopes.

## Prototype validation plan

1. Build a private Zapier CLI app prototype with API key auth.
2. Test against hosted `https://api.agenttick.sh` and one self-hosted URL.
3. Create approval requests from all five template presets.
4. Approve, deny, and timeout requests; verify normalized outputs.
5. Confirm Zap branching on `decision=approved`, `decision=denied`, and `decision=pending`.
6. Verify no token or secret appears in output bundles, approval text, metadata, or logs.
7. Document Zapier execution-limit behavior for wait/poll actions.
8. Decide whether to ship private invite, public beta, or defer until webhook triggers exist.

## Launch checklist before public app submission

- README/setup page with hosted and self-hosted instructions.
- Privacy/security copy reviewed against Zapier data-flow expectations.
- All action help text warns against secrets and raw logs.
- Template presets use the same ids as `docs/approval-templates.md`.
- Tests or recorded fixtures cover create, wait approved, wait denied, timeout/pending, 401/403, 404, 429, and network errors.
- Clear support policy for self-hosted server URLs.
- Decision on whether a trigger such as “Approval Responded” is stable enough to include.

## Open questions

- Should Zapier use regular agent tokens, or should Agent Tick add workflow-scoped tokens first?
- Can Zapier's platform limits support a useful `Create and Wait` action, or should MVP favor create + delayed/poll steps?
- Should approval response webhooks be implemented before a public Zapier app?
- How should hosted account onboarding create the first Zapier-safe token without exposing broader admin permissions?
- Which template should be the public quickstart: production deploy, refund, or outbound email?
