import { describe, expect, it } from 'vitest';
import { ApiErrorEnvelopeSchema, AuthConfigSchema, BillingStatusSchema, CreateApprovalRequestSchema, CreateMobileDiagnosticsSchema, InviteEmailDeliverySchema, OrganizationInviteEmailResultSchema, UpdateDevicePushTokenSchema } from '../src/index.js';

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

  it('validates device push-token aliases', () => {
    expect(UpdateDevicePushTokenSchema.parse({ token: 'ExponentPushToken[1]' })).toEqual({ token: 'ExponentPushToken[1]' });
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
