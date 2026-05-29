import { afterEach, describe, expect, it } from 'vitest';
import type { RequestRecord } from '@self-deprecated/agent-tick-shared';
import { AgentTickStore, DEFAULT_USER_ID, DEFAULT_WORKSPACE_ID } from '@agent-tick/db';
import { createCompositeRequestNotifier, createExpoPushNotifier, createWebhookRequestNotifier } from '../src/services/notifications.js';

let store: AgentTickStore | undefined;

afterEach(() => {
  store?.close();
  store = undefined;
});

function freshStore(): AgentTickStore {
  const next = AgentTickStore.open({ databaseURL: ':memory:' });
  next.migrate();
  next.ensureSingleTenantDefaults('2026-05-08T00:00:00.000Z');
  store = next;
  return next;
}

const requestRecord: RequestRecord = {
  id: 'req_123',
  workspaceId: 'wsp_123',
  requester: { name: 'Pi', agentTokenId: 'agt_123' },
  requestType: 'sanction',
  title: 'Deploy?',
  choices: [{ id: 'approve', label: 'Approve', kind: 'approve' }, { id: 'deny', label: 'Deny', kind: 'deny' }],
  metadata: { route: 'release' },
  status: 'pending',
  createdAt: '2026-05-08T00:00:00.000Z'
};

describe('Request notifications', () => {
  it('posts request-created notifications to an optional webhook', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response('{}', { status: 200 });
    };

    await createWebhookRequestNotifier({ url: 'https://hooks.example.com/requests', publicURL: 'https://tick.example.com/', fetch: fetchImpl }).notifyRequestCreated(requestRecord);

    expect(calls[0]).toMatchObject({ url: 'https://hooks.example.com/requests', init: { method: 'POST' } });
    expect(JSON.parse(String(calls[0]!.init.body))).toMatchObject({
      type: 'request.created',
      workspaceId: 'wsp_123',
      request: { id: 'req_123', title: 'Deploy?', metadata: { route: 'release' } },
      url: 'https://tick.example.com/activity?request=req_123'
    });
  });

  it('deduplicates Expo push targets and surfaces ticket errors', async () => {
    const local = freshStore();
    local.registerDevice({ userId: DEFAULT_USER_ID, deviceName: 'phone one', expoPushToken: 'ExponentPushToken[same]' });
    local.registerDevice({ userId: DEFAULT_USER_ID, deviceName: 'phone two', expoPushToken: 'ExponentPushToken[same]' });
    const credential = local.createAgentToken({ label: 'Pi' });
    const created = local.createRequest({ workspaceId: DEFAULT_WORKSPACE_ID, agentTokenId: credential.agentTokenId, requester: { name: 'Pi' }, requestType: 'sanction', title: 'Deploy?' });
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return Response.json({ data: [{ status: 'error', message: 'Invalid credentials', details: { error: 'InvalidCredentials' } }] });
    };

    await expect(createExpoPushNotifier({ store: local, fetch: fetchImpl }).notifyRequestCreated(created)).rejects.toThrow(/InvalidCredentials/);
    const payload = JSON.parse(String(calls[0]!.init.body));
    expect(payload).toHaveLength(1);
    expect(payload[0]).toMatchObject({
      title: 'Agent Tick',
      body: 'Agent Tick needs your attention.',
      sound: 'default',
      priority: 'high',
      channelId: 'agent-tick-requests',
      data: { requestId: created.id, workspaceId: DEFAULT_WORKSPACE_ID, type: 'request' }
    });
  });

  it('pushes Audience Requests to active channel subscribers', async () => {
    const local = freshStore();
    const shared = local.createSharedWorkspaceForUser(DEFAULT_USER_ID, 'Public dev');
    const channel = local.createAudienceChannel({ workspaceId: shared.workspaceId, name: 'Roadmap', visibility: 'public' }, DEFAULT_USER_ID);
    const active = local.loginOrCreateClerkIdentity({ issuer: 'agent-tick-test', subject: 'aud_active', email: 'active@example.test', emailVerified: true, name: 'Active' });
    const muted = local.loginOrCreateClerkIdentity({ issuer: 'agent-tick-test', subject: 'aud_muted', email: 'muted@example.test', emailVerified: true, name: 'Muted' });
    local.registerDevice({ userId: active.userId, deviceName: 'active phone', expoPushToken: 'ExponentPushToken[active]' });
    local.registerDevice({ userId: muted.userId, deviceName: 'muted phone', expoPushToken: 'ExponentPushToken[muted]' });
    local.setAudienceSubscription(channel.channelId, active.userId, 'active');
    local.setAudienceSubscription(channel.channelId, muted.userId, 'muted');
    const credential = local.createAgentToken({ workspaceId: shared.workspaceId, label: 'Roadmap bot' });
    const created = local.createRequest({ workspaceId: shared.workspaceId, agentTokenId: credential.agentTokenId, requester: { name: 'Roadmap bot' }, requestType: 'steering', deliveryKind: 'audience_channel', responsePolicy: 'deadline_plurality', audienceChannelId: channel.channelId, closesAt: '2099-01-01T00:00:00.000Z', title: 'What next?' });
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return Response.json({ data: [{ status: 'ok', id: 'ticket_1' }] });
    };

    await createExpoPushNotifier({ store: local, fetch: fetchImpl }).notifyRequestCreated(created);

    const payload = JSON.parse(String(calls[0]!.init.body));
    expect(payload).toHaveLength(1);
    expect(payload[0]).toMatchObject({ to: 'ExponentPushToken[active]', data: { requestId: created.id, workspaceId: shared.workspaceId, type: 'request' } });
  });

  it('runs all configured Request notification sinks before surfacing failures', async () => {
    const calls: string[] = [];
    const notifier = createCompositeRequestNotifier([
      { notifyRequestCreated: async () => { calls.push('first'); } },
      { notifyRequestCreated: async () => { calls.push('second'); throw new Error('webhook failed'); } }
    ]);

    await expect(notifier.notifyRequestCreated(requestRecord)).rejects.toThrow(/webhook failed/);
    expect(calls).toEqual(['first', 'second']);
  });
});
