import { describe, expect, it } from 'vitest';
import type { RequestRecord } from '@agent-tick/shared';
import { createCompositeRequestNotifier, createWebhookRequestNotifier } from '../src/services/notifications.js';

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
