import { describe, expect, it } from 'vitest';
import type { ApprovalRequest } from '@agent-tick/shared';
import { createCompositeApprovalNotifier, createWebhookApprovalNotifier } from '../src/services/notifications.js';

const approval: ApprovalRequest = {
  id: 'req_123',
  organizationId: 'org_123',
  requester: { name: 'agent' },
  requestType: 'approval',
  title: 'Deploy?',
  choices: [{ id: 'approve', label: 'Approve' }],
  allowFreeformReply: false,
  metadata: { projectId: 'proj_123' },
  status: 'pending',
  createdAt: '2026-05-08T00:00:00.000Z'
};

describe('approval notifications', () => {
  it('posts approval-created notifications to an optional webhook', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response('{}', { status: 202 });
    }) as typeof fetch;

    await createWebhookApprovalNotifier({ url: 'https://hooks.example.com/approvals', publicURL: 'https://tick.example.com/', fetch: fetchImpl }).notifyApprovalCreated(approval);

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ url: 'https://hooks.example.com/approvals', init: { method: 'POST' } });
    expect(JSON.parse(calls[0]!.init.body as string)).toMatchObject({
      type: 'approval.created',
      organizationId: 'org_123',
      request: { id: 'req_123', title: 'Deploy?', metadata: { projectId: 'proj_123' } },
      url: 'https://tick.example.com/approvals/req_123'
    });
  });

  it('runs all configured approval notification sinks before surfacing failures', async () => {
    const delivered: string[] = [];
    const notifier = createCompositeApprovalNotifier([
      { notifyApprovalCreated: async () => { delivered.push('first'); } },
      { notifyApprovalCreated: async () => { throw new Error('webhook failed'); } },
      { notifyApprovalCreated: async () => { delivered.push('last'); } }
    ]);

    await expect(notifier.notifyApprovalCreated(approval)).rejects.toThrow(/webhook failed/);
    expect(delivered).toEqual(['first', 'last']);
  });
});
