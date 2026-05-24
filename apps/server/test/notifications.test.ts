import { afterEach, describe, expect, it } from 'vitest';
import type { RequestRecord } from '@agent-tick/shared';
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
    expect(JSON.parse(String(calls[0]!.init.body))).toHaveLength(1);
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
