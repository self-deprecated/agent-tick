import { describe, expect, it } from 'vitest';
import { ApiErrorEnvelopeSchema, AuthConfigSchema, CreateApprovalRequestSchema, UpdateDevicePushTokenSchema } from '../src/index.js';

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

  it('rejects empty approval titles', () => {
    expect(() =>
      CreateApprovalRequestSchema.parse({ requester: { name: 'agent' }, title: '' })
    ).toThrow();
  });

  it('validates device push-token aliases', () => {
    expect(UpdateDevicePushTokenSchema.parse({ token: 'ExponentPushToken[1]' })).toEqual({ token: 'ExponentPushToken[1]' });
    expect(() => UpdateDevicePushTokenSchema.parse({})).toThrow();
  });

  it('validates structured API errors', () => {
    expect(
      ApiErrorEnvelopeSchema.parse({
        error: { code: 'not_authenticated', message: 'Authentication required', requestId: 'req-1' }
      }).error.code
    ).toBe('not_authenticated');
  });
});
