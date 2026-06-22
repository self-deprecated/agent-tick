# Private full-reply Status Updates

Agent Tick will support opt-in full-reply Status Updates for chat-like agent integrations. A full-reply Status Update is still one-way Agent Activity, not an Approval Interaction: it records an agent or user conversation message in a Session timeline without requiring or accepting a human response. The first integration target is `pi-agent-tick`, where Pi can mirror finalized assistant replies, and optionally user messages, at the end of a message or turn so the same reply that appears in the terminal is viewable on Approval Devices.

Full-reply Status Updates must use private, server-opaque content by default. The server may keep non-sensitive routing and timeline fields in cleartext, but agent/user message text, long markdown bodies, and sensitive presentation copy should live in an encrypted status payload. Cleartext `message` remains a short operational fallback and notification-safe label such as “Assistant replied” or “User message”, not the full reply preview, when private content is enabled. Approval Devices decrypt the private status payload and render the decrypted preview/body in the Session timeline. This extends the Private Request encryption model to Status Updates rather than treating status history as a plaintext chat archive, with the same trust boundary: stored display content is opaque to routine server storage and tooling, but server-supplied recipient public keys are not yet protected by key pinning or transparency.

This feature is opt-in at the integration/config level. Existing milestone Status Updates remain supported and should stay concise by default. Enabling full-reply mirroring changes Status Updates from progress pings into conversation mirroring, so integrations must make the disclosure mode explicit, keep user-message mirroring disabled unless configured, and continue to exclude model thinking, raw tool results, shell logs, secrets, and oversized payloads by default.

A full-reply Status Update should carry two layers of content:

- **Clear operational envelope**: Workspace, Routing Rule, Session identity, state, timestamps, sender role, model/provider names when useful, and compact generic labels needed for routing, grouping, push notification targeting, retention, and debugging.
- **Private display payload**: decrypted-on-device content such as the human-visible preview, full markdown/text body, optional next-step copy, role-specific display labels, and presentation hints such as collapsed-by-default.

Status Updates will also gain a typed `contextUsage` object for chat context health:

```ts
contextUsage?: {
  tokens: number | null;
  contextWindow: number;
  percent: number | null;
}
```

`contextUsage` may be stored in cleartext as operational metadata. It does not contain prompt text, file content, or model output; it helps Approval Devices show whether a Session is nearing compaction pressure, for example `42k / 200k · 21%`. If a future customer requires even token counts to be private, the same values can be duplicated or moved into the encrypted display payload while preserving the typed API field for normal deployments.

`pi-agent-tick` should obtain `contextUsage` from Pi's `ctx.getContextUsage()` when sending lifecycle or full-reply Status Updates. `tokens` and `percent` may be `null` immediately after compaction or before a fresh post-compaction assistant response. Clients should render unknown values gracefully and use thresholds such as high-at-75% and urgent-at-90% only when `percent` is known.

Session timelines should render full-reply Status Updates compactly by default. The visible row or card shows the decrypted preview, role, time, semantic state, and optional context-usage pill. Long bodies are expandable on demand. Session Stack lane previews may show the same component clipped by lane height, without introducing a separate summary mode. Push notifications for private full-reply Status Updates must remain generic unless an explicit future notification design supports private local notification content after device-side decryption.

The API should preserve backward compatibility. Older clients can continue reading `message`, `state`, `nextStep`, and `metadata`; newer clients can use `contentMode`, `encryptedPayload`, private payload decryption state, and `contextUsage`. Plain Status Updates remain allowed for non-sensitive milestone updates, tests, and integrations that deliberately choose plaintext. Private full-reply Status Updates should fail closed when private status content is required but no eligible device key is available.

Retention follows Activity History policy. Full-reply Status Updates are not an Audit Log and are not intended as immutable compliance records. Because private payloads can contain substantial conversation content, retention controls and deletion flows must apply to encrypted status payloads and key envelopes in the same way they apply to the rest of Status Update history.
