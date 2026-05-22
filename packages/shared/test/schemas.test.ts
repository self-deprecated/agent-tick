import { describe, expect, it } from 'vitest';
import {
  ApiErrorEnvelopeSchema,
  AuthConfigSchema,
  BillingStatusSchema,
  ChoiceListSchema,
  CreateRequestSchema,
  CreateRoutingRuleSchema,
  RequestRecordSchema,
  UpdateDevicePushTokenSchema,
  WorkspaceMemberRecordSchema,
  createEncryptedRequestPayload,
  decryptRequestPayload,
  generateRequestEncryptionKey
} from '../src/index.js';

describe('shared Workspace and Request schemas', () => {
  it('validates public auth config', () => {
    expect(AuthConfigSchema.parse({ mode: 'clerk', authProvider: 'clerk', publicURL: 'https://tick.example.com', clerkPublishableKey: 'pk_test_123' })).toMatchObject({ mode: 'clerk' });
  });

  it('validates Workspace membership records', () => {
    expect(WorkspaceMemberRecordSchema.parse({ workspaceId: 'wsp_1', type: 'personal', name: 'Personal', userId: 'usr_1', role: 'owner', status: 'active', createdAt: '2026-05-08T00:00:00.000Z' })).toMatchObject({ workspaceId: 'wsp_1', name: 'Personal' });
  });

  it('validates routing rules without teams/projects/policies', () => {
    expect(CreateRoutingRuleSchema.parse({ workspaceId: 'wsp_1', name: 'Backend', recipientUserIds: ['usr_1'], requiredResponseMode: 'exact', requiredResponseCount: 2 })).toMatchObject({ name: 'Backend', requiredResponseMode: 'exact' });
  });

  it('validates billing status with Workspace language', () => {
    expect(BillingStatusSchema.parse({ workspaceId: 'wsp_1', plan: 'self-hosted', limits: { seats: 3 }, usage: { activeMembers: 2, pendingMembers: 0 } })).toMatchObject({ workspaceId: 'wsp_1' });
  });

  it('rejects empty Request titles', () => {
    expect(() => CreateRequestSchema.parse({ requester: { name: 'agent' }, title: '' })).toThrow();
  });

  it('requires custom Request choices to include a deny kind', () => {
    expect(() => CreateRequestSchema.parse({ requester: { name: 'agent' }, title: 'Pick?', choices: [{ id: 'a', label: 'A' }] })).toThrow(/deny/);
    expect(CreateRequestSchema.parse({ requester: { name: 'agent' }, requestType: 'steering', title: 'Pick?', choices: [{ id: 'a', label: 'A' }, { id: 'cancel', label: 'Cancel', kind: 'deny' }] }).choices).toEqual([{ id: 'a', label: 'A', kind: 'approve' }, { id: 'cancel', label: 'Cancel', kind: 'deny' }]);
  });

  it('deduplicates duplicate choice ids for display and response safety', () => {
    expect(ChoiceListSchema.parse([{ id: 'id', label: 'First' }, { id: 'id', label: 'Second' }, { id: 'id', label: 'Cancel', kind: 'deny' }])).toEqual([{ id: 'id', label: 'First', kind: 'approve' }, { id: 'id_2', label: 'Second', kind: 'approve' }, { id: 'id_3', label: 'Cancel', kind: 'deny' }]);
  });

  it('validates encrypted Request payload envelopes', () => {
    const encryptedPayload = { version: 1, algorithm: 'x25519-xsalsa20poly1305', keyId: 'wsp-key-1', nonce: 'base64-nonce', ciphertext: 'base64-ciphertext' };
    expect(CreateRequestSchema.parse({ requester: { name: 'agent' }, title: 'Encrypted request', encryptedPayload }).encryptedPayload).toEqual(encryptedPayload);
    expect(RequestRecordSchema.parse({ id: 'req_1', workspaceId: 'wsp_1', requester: { name: 'agent', agentTokenId: 'agt_1' }, requestType: 'sanction', title: 'Encrypted request', encryptedPayload, choices: [{ id: 'approve', label: 'Approve' }, { id: 'deny', label: 'Deny', kind: 'deny' }], status: 'pending', createdAt: '2026-05-08T00:00:00.000Z' }).encryptedPayload).toEqual(encryptedPayload);
  });

  it('encrypts and decrypts Request contents', () => {
    const key = generateRequestEncryptionKey();
    const payload = createEncryptedRequestPayload({ title: 'Deploy?', body: 'Prod deploy', command: 'pnpm deploy' }, key, { nonce: new Uint8Array(12).fill(7) });
    expect(payload.algorithm).toBe('agent-tick-aes-256-gcm-v1');
    expect(payload.ciphertext).not.toContain('Deploy');
    expect(decryptRequestPayload(payload, key)).toEqual({ title: 'Deploy?', body: 'Prod deploy', command: 'pnpm deploy' });
  });

  it('validates device push-token aliases and structured API errors', () => {
    expect(UpdateDevicePushTokenSchema.parse({ token: 'ExponentPushToken[1]' })).toEqual({ token: 'ExponentPushToken[1]' });
    expect(() => UpdateDevicePushTokenSchema.parse({})).toThrow();
    expect(ApiErrorEnvelopeSchema.parse({ error: { code: 'not_authenticated', message: 'Authentication required', requestId: 'req-1' } }).error.code).toBe('not_authenticated');
  });
});
