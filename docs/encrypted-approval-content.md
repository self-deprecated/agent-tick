# Optional encrypted approval content

## Summary

Agent Tick can carry encrypted approval details for requests where the title, body, command summary, or selected metadata is too sensitive to store or display in plaintext on every surface. The current implementation is a shared-client encryption helper plus mobile decrypt UX; it is not a full enterprise key-management system.

Encrypted approval content should stay optional. The launch default remains bounded plaintext summaries with no secrets. Use encrypted content only when the requester and reviewer already share an out-of-band key or passphrase and the reviewer can safely decrypt inside the app.

## Current implementation evidence

Current code supports these building blocks:

- `packages/shared/src/index.ts`
  - `EncryptedApprovalPlaintextSchema` with `title`, optional `body`, optional `command`, and optional string metadata.
  - `EncryptedApprovalPayloadSchema` with `version`, `algorithm`, optional `keyId`, `nonce`, `ciphertext`, and optional `aad`.
  - `generateApprovalEncryptionKey()` returns a 32-byte base64url key.
  - `createEncryptedApprovalPayload(...)` encrypts with `agent-tick-aes-256-gcm-v1`.
  - `decryptApprovalPayload(...)` decrypts locally using the same key/passphrase behavior.
- `apps/mobile/App.tsx` and `SettingsScreen.tsx`
  - Store a user-entered E2EE key/passphrase locally.
  - Hide encrypted request title/body/command until local decrypt succeeds.
  - Require an encrypted-payload acknowledgement on response.
  - Offer a safe “Dismiss encrypted request” path when the user cannot decrypt.
- `apps/server/src/services/notifications.ts`
  - Push notification payloads carry IDs and encrypted hints, not decrypted content.
- `apps/mobile/ApprovalsScreen.test.tsx`
  - Covers locked encrypted requests and local decryption behavior.

## Threat model

Encrypted approval content helps when:

- Hosted Agent Tick infrastructure should not see the sensitive title/body/command.
- Push notifications, dashboard previews, logs, and intermediate connector surfaces should avoid sensitive content.
- A reviewer can receive only a placeholder until they decrypt locally.

It does not solve:

- A compromised requester environment before encryption.
- A compromised reviewer device after decryption.
- Weak or shared passphrases.
- Malicious requesters sending misleading plaintext metadata around encrypted content.
- Legal/e-signature proof or non-repudiation.
- Access-control mistakes outside Agent Tick, such as broadly shared source-system links.

## Data model

### Plaintext before encryption

Only these fields belong in the encrypted plaintext envelope:

```json
{
  "title": "Restart production API?",
  "body": "Sensitive incident summary and reviewer-only details.",
  "command": "kubectl rollout restart deploy/api",
  "metadata": {
    "incidentId": "INC-1234"
  }
}
```

Keep metadata small and safe even when encrypted. Do not put bearer tokens, private keys, cookies, raw environment files, or full logs in encrypted metadata.

### Stored payload

Stored encrypted payloads use:

```json
{
  "version": 1,
  "algorithm": "agent-tick-aes-256-gcm-v1",
  "keyId": "optional-human-readable-key-id",
  "nonce": "base64url",
  "ciphertext": "base64url",
  "aad": "optional-associated-data"
}
```

Recommended associated data, when used, should bind non-secret context such as request id, organization id, or template id. Do not place secrets in `aad`; it is authenticated but not encrypted.

## Key model

Current launch posture:

- The requester and reviewer share a key or passphrase out of band.
- Agent Tick stores the reviewer-entered key/passphrase locally on the device where supported.
- The server should not receive or store the decryption key.
- `keyId` is optional and should be treated as a hint only, not an authorization mechanism.

Key handling rules:

- Prefer generated 32-byte keys from `generateApprovalEncryptionKey()` for automation demos or controlled teams.
- Passphrases are convenient but weaker; use only when users can manage them safely.
- Rotating keys should be modeled as sending new requests with a new `keyId`, not re-encrypting historical requests in place.
- Losing the key means encrypted request content may be unrecoverable; the user should deny/dismiss and ask the requester to resend with decryptable context.

## UX requirements

### Request list and notifications

- Show minimal placeholders for encrypted requests.
- Push notifications should include request id, organization id, and `encrypted=true` only.
- Do not show encrypted title/body/command in notification payloads.
- Do not show decrypted content on surfaces that have not explicitly decrypted locally.

### Approval detail

When no key is configured:

- Show “Encrypted request. Add your E2EE key in Settings to decrypt.”
- Disable approve/deny choices that require reading the encrypted content.
- Offer a dismiss/deny-safe path.

When a key is configured but decryption fails:

- Show “Encrypted request. The configured E2EE key could not decrypt this request.”
- Keep protected actions disabled.
- Let the reviewer update the key or dismiss.

When decryption succeeds:

- Show decrypted title/body/command locally.
- Make it clear that the response is still bounded by the original choices/questions.
- Send only the normal response payload plus `encryptedPayloadAcknowledged=true`; do not send decrypted content back as response metadata.

## Disclosure boundaries

Encrypted content does not make all request data private. These fields may still be visible to server-side systems and admins unless separately minimized:

- request id
- organization id
- requester/agent id
- request type/status
- created/responded timestamps
- non-encrypted metadata
- choice ids/kinds and response status
- audit event type and target ids
- notification delivery metadata

Therefore:

- Keep outer plaintext title/body/command as placeholders when `encryptedPayload` is present.
- Use safe metadata only.
- Do not claim that Agent Tick stores no metadata.
- Do not claim legal-grade secrecy or e-signature proof.

## API and connector guidance

SDK/API callers that create encrypted requests should:

1. Generate or obtain a shared key out of band.
2. Build the sensitive plaintext envelope.
3. Encrypt using the shared helper.
4. Send a normal approval request with a neutral placeholder title/body plus `encryptedPayload`.
5. Include only safe metadata such as `encrypted=true`, `keyId`, `templateId`, and `correlationId`.

Example placeholder shape:

```json
{
  "title": "Encrypted approval request",
  "body": "Open in Agent Tick with your E2EE key to review details.",
  "requestType": "approval",
  "encryptedPayload": {
    "version": 1,
    "algorithm": "agent-tick-aes-256-gcm-v1",
    "keyId": "prod-ops-2026-05",
    "nonce": "...",
    "ciphertext": "..."
  },
  "metadata": {
    "encrypted": "true",
    "keyId": "prod-ops-2026-05",
    "correlationId": "safe-run-id"
  }
}
```

Connectors such as n8n/Zapier/Make should not collect encryption keys in shared workflow credentials until a stronger key-management design exists. If they support encrypted content later, they should encrypt in the runner and never map keys to approval text, metadata, or logs.

## Launch sequencing

### Slice 1 — document current support

- Keep launch docs honest: encrypted content is supported where the caller uses the helper and the reviewer has the key.
- Do not market E2EE as required for hosted launch.
- Preserve minimal notification behavior.

### Slice 2 — helper examples

- Add SDK examples for generating a key and creating an encrypted request.
- Add tests for encrypted request creation/decryption with deterministic nonce.
- Add a CLI helper only if key input can avoid shell history and process-list leakage.

### Slice 3 — admin and recovery UX

- Add admin copy explaining encrypted placeholders, key loss, and resend behavior.
- Add key rotation guidance.
- Add safe audit events for encrypted request dismissal/acknowledgement without logging decrypted content.

### Slice 4 — managed key options, if needed

Only after real customer demand:

- Evaluate per-organization public-key encryption.
- Evaluate device-bound keys.
- Evaluate hardware-backed/passkey-assisted unwrap for high-risk approvals.
- Keep managed-key designs separate from legal receipt/passkey-signature work.

## Validation checklist for future implementation

- Server never logs decrypted plaintext.
- Push notifications contain only ids and encrypted hints.
- Mobile refuses approval while encrypted content is locked.
- Wrong keys fail closed.
- Response payloads do not include decrypted title/body/command.
- Audit events record safe metadata only.
- Tests cover successful decrypt, missing key, wrong key, missing ciphertext, encrypted acknowledgement, and notification minimization.
- Docs distinguish encrypted content from full audit deletion, legal proof, and remote execution.

## Non-goals

- Requiring E2EE for every hosted approval.
- Server-side decryption.
- Storing decryption keys on the Agent Tick server.
- Using passkeys as encryption keys in the current launch slice.
- Legal/e-signature proof or non-repudiation receipts.
- Attachments or file encryption.
- Allowing encrypted content to justify sending secrets that reviewers do not need.
- Remote command execution or arbitrary remote prompting.

## Open questions

- Should encrypted request placeholders be enforced by schema when `encryptedPayload` is present?
- Should the API reject unsafe plaintext metadata keys on encrypted requests?
- Should `aad` be populated automatically with request id after creation, or should callers provide stable pre-creation context?
- Should mobile store E2EE keys per server, per organization, or per account rather than the current simple local setting?
- Should future encrypted requests support multiple recipient keys for team routing?
- What exact product copy should distinguish “encrypted approval content” from “end-to-end encrypted service”?
