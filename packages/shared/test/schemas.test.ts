import { describe, expect, it } from 'vitest';
import { ApiErrorEnvelopeSchema, ApprovalRequestSchema, AuthConfigSchema, BillingStatusSchema, CreateApprovalRequestSchema, CreateMobileDiagnosticsSchema, InviteEmailDeliverySchema, OrganizationInviteEmailResultSchema, UpdateDevicePushTokenSchema, createEncryptedApprovalPayload, decryptApprovalPayload, generateApprovalEncryptionKey } from '../src/index.js';

describe('shared schemas', () => {
  it('validates public auth config', () => {
    expect(
      AuthConfigSchema.parse({
        mode: 'clerk',
        authProvider: 'clerk',
        publicURL: 'https://tick.example.com',
        clerkPublishableKey: 'pk_test_123'
      })
    ).toEqual({
      mode: 'clerk',
      authProvider: 'clerk',
      publicURL: 'https://tick.example.com',
      clerkPublishableKey: 'pk_test_123'
    });
  });

  it('validates billing seat usage', () => {
    expect(
      BillingStatusSchema.parse({
        organizationId: 'org_123',
        plan: 'self-hosted',
        limits: { seats: 3 },
        usage: { activeMembers: 2, pendingMembers: 1 }
      })
    ).toEqual({ organizationId: 'org_123', plan: 'self-hosted', limits: { seats: 3 }, usage: { activeMembers: 2, pendingMembers: 1 } });
  });

  it('validates invite email delivery results without requiring raw invite tokens', () => {
    expect(InviteEmailDeliverySchema.parse({ status: 'skipped', recipient: 'bob@example.com', message: 'not configured' })).toMatchObject({ status: 'skipped' });
    expect(
      OrganizationInviteEmailResultSchema.parse({
        invite: {
          inviteId: 'inv_123',
          organizationId: 'org_123',
          role: 'member',
          approvalRequired: true,
          usedCount: 0,
          email: 'bob@example.com',
          emailLastStatus: 'sent',
          createdAt: '2026-05-08T00:00:00.000Z'
        },
        delivery: { status: 'sent', recipient: 'bob@example.com', sentAt: '2026-05-08T00:00:00.000Z' }
      }).invite
    ).not.toHaveProperty('token');
  });

  it('rejects empty approval titles', () => {
    expect(() =>
      CreateApprovalRequestSchema.parse({ requester: { name: 'agent' }, title: '' })
    ).toThrow();
  });

  it('encrypts and decrypts approval request contents', () => {
    const key = generateApprovalEncryptionKey();
    const payload = createEncryptedApprovalPayload({ title: 'Deploy?', body: 'Prod deploy', command: 'pnpm deploy' }, key, { nonce: new Uint8Array(12).fill(7) });

    expect(payload.algorithm).toBe('agent-tick-aes-256-gcm-v1');
    expect(payload.ciphertext).not.toContain('Deploy');
    expect(decryptApprovalPayload(payload, key)).toEqual({ title: 'Deploy?', body: 'Prod deploy', command: 'pnpm deploy' });
  });

  it('supports shorter passphrases for manual encrypted request testing', () => {
    const payload = createEncryptedApprovalPayload({ title: 'Manual test', command: 'echo ok' }, 'test-key', { nonce: new Uint8Array(12).fill(3) });
    expect(decryptApprovalPayload(payload, 'test-key')).toEqual({ title: 'Manual test', command: 'echo ok' });
    expect(() => decryptApprovalPayload(payload, 'wrong-key')).toThrow();
  });

  it('validates encrypted approval payload envelopes', () => {
    const encryptedPayload = {
      version: 1,
      algorithm: 'x25519-xsalsa20poly1305',
      keyId: 'org-key-1',
      nonce: 'base64-nonce',
      ciphertext: 'base64-ciphertext'
    };

    expect(
      CreateApprovalRequestSchema.parse({
        requester: { name: 'agent' },
        title: 'Encrypted approval request',
        encryptedPayload
      }).encryptedPayload
    ).toEqual(encryptedPayload);

    expect(
      ApprovalRequestSchema.parse({
        id: 'req_1',
        organizationId: 'org_1',
        requester: { name: 'agent', agentId: 'agt_1' },
        title: 'Encrypted approval request',
        encryptedPayload,
        choices: [
          { id: 'approve', label: 'Approve' },
          { id: 'reject', label: 'Reject', kind: 'deny' }
        ],
        status: 'pending',
        createdAt: '2026-05-08T00:00:00.000Z'
      }).encryptedPayload
    ).toEqual(encryptedPayload);
  });

  it('requires custom approval choices to include a deny kind', () => {
    expect(() =>
      CreateApprovalRequestSchema.parse({
        requester: { name: 'agent' },
        title: 'Which rollout?',
        choices: [{ id: 'canary', label: 'Canary' }]
      })
    ).toThrow(/deny/);

    expect(
      CreateApprovalRequestSchema.parse({
        requester: { name: 'agent' },
        title: 'Which rollout?',
        choices: [
          { id: 'canary', label: 'Canary' },
          { id: 'cancel', label: 'Cancel', kind: 'deny' }
        ]
      }).choices
    ).toEqual([
      { id: 'canary', label: 'Canary', kind: 'approve' },
      { id: 'cancel', label: 'Cancel', kind: 'deny' }
    ]);
  });

  it('validates device push-token aliases', () => {
    expect(UpdateDevicePushTokenSchema.parse({ token: 'ExponentPushToken[1]' })).toEqual({ token: 'ExponentPushToken[1]' });
    expect(UpdateDevicePushTokenSchema.parse({ token: '' })).toEqual({ token: '' });
    expect(() => UpdateDevicePushTokenSchema.parse({})).toThrow();
  });

  it('validates mobile diagnostics screen context', () => {
    expect(
      CreateMobileDiagnosticsSchema.parse({
        platform: 'ios',
        currentScreen: 'settings',
        events: [{ level: 'info', area: 'navigation', message: 'screen_changed', at: '2026-01-01T00:00:00.000Z' }]
      }).currentScreen
    ).toBe('settings');
  });

  it('validates structured API errors', () => {
    expect(
      ApiErrorEnvelopeSchema.parse({
        error: { code: 'not_authenticated', message: 'Authentication required', requestId: 'req-1' }
      }).error.code
    ).toBe('not_authenticated');
  });
});
