import { describe, expect, it, vi } from 'vitest';
import { AgentTickApiError, AgentTickClient, initialSessionClientState, loadSessionSummaries, loadSessionTimeline, type EventSourceConstructor, type SessionSummary } from '../src/index.js';

describe('AgentTickClient', () => {
  it('attaches bearer and Workspace headers', async () => {
    const seen: { headers?: Headers; url?: string } = {};
    const client = new AgentTickClient({
      baseUrl: 'https://tick.example.com/base/',
      tokenProvider: async () => 'token-123',
      workspaceIdProvider: () => 'wsp_123',
      fetch: async (input, init) => {
        seen.url = String(input);
        seen.headers = new Headers(init?.headers);
        return jsonResponse({ status: 'ok' });
      }
    });
    await client.health();
    expect(seen.url).toBe('https://tick.example.com/healthz');
    expect(seen.headers?.get('Authorization')).toBe('Bearer token-123');
    expect(seen.headers?.get('X-Agent-Tick-Workspace-ID')).toBe('wsp_123');
  });

  it('parses structured API errors', async () => {
    const client = new AgentTickClient({ baseUrl: 'https://tick.example.com', fetch: async () => jsonResponse({ error: { code: 'not_authenticated', message: 'Authentication required', requestId: 'req-1' } }, { status: 401 }) });
    await expect(client.getMe()).rejects.toMatchObject<Partial<AgentTickApiError>>({ name: 'AgentTickApiError', status: 401, code: 'not_authenticated', requestId: 'req-1' });
  });

  it('creates and lists routed Status Updates', async () => {
    const requests: Array<{ url: string; method?: string; body?: unknown }> = [];
    const status = { statusId: 'stat_123', workspaceId: 'wsp_123', agentTokenId: 'agt_123', message: 'Running tests', state: 'working', sessionId: 'run_123', session: { title: 'Billing migration' }, createdAt: '2026-01-01T00:00:00.000Z' };
    const client = new AgentTickClient({
      baseUrl: 'https://tick.example.com',
      fetch: async (input, init) => {
        requests.push({ url: String(input), method: init?.method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
        return jsonResponse(init?.method === 'POST' ? status : [status]);
      }
    });
    await expect(client.createStatusUpdate({ message: 'Running tests', sessionId: 'run_123', session: { title: 'Billing migration' } })).resolves.toMatchObject({ statusId: 'stat_123', session: { title: 'Billing migration' } });
    await expect(client.listStatusUpdates({ limit: 5 })).resolves.toEqual([expect.objectContaining({ message: 'Running tests' })]);
    expect(requests).toEqual([
      { method: 'POST', url: 'https://tick.example.com/v1/status-updates', body: { message: 'Running tests', sessionId: 'run_123', session: { title: 'Billing migration' }, state: 'working' } },
      { method: 'GET', url: 'https://tick.example.com/v1/status-updates?limit=5', body: undefined }
    ]);
  });

  it('calls Request endpoints and can wait with the returned waiter token', async () => {
    const requests: Array<{ url: string; method?: string; body?: unknown; authorization?: string | null; responseSurface?: string | null }> = [];
    const requestRecord = { id: 'req_123', workspaceId: 'wsp_123', sessionId: 'run_123', session: { title: 'Billing migration' }, requester: { name: 'Pi' }, requestType: 'sanction', title: 'Deploy?', choices: [{ id: 'approve', label: 'Approve' }, { id: 'deny', label: 'Deny', kind: 'deny' }], status: 'pending', createdAt: '2026-01-01T00:00:00.000Z' };
    const client = new AgentTickClient({
      baseUrl: 'https://tick.example.com',
      tokenProvider: () => 'agent_123',
      fetch: async (input, init) => {
        const headers = new Headers(init?.headers);
        requests.push({ url: String(input), method: init?.method, body: init?.body ? JSON.parse(String(init.body)) : undefined, authorization: headers.get('Authorization'), responseSurface: headers.get('X-Agent-Tick-Response-Surface') });
        if (String(input).endsWith('/waiter/stop')) return jsonResponse({ ...requestRecord, agentWaiter: { waiterId: 'waiter_123', state: 'stopped', stopReason: 'local_answer' } });
        if (String(input).endsWith('/waiter/error')) return jsonResponse({ ...requestRecord, agentWaiter: { waiterId: 'waiter_123', state: 'errored', errorCode: 'wait_failed' } });
        if (String(input).endsWith('/responses')) return jsonResponse({ ...requestRecord, status: 'responded', response: { choiceId: 'approve' } });
        if (String(input).endsWith('/audience-requests')) return jsonResponse([{ ...requestRecord, deliveryKind: 'audience_channel', responsePolicy: 'deadline_plurality' }]);
        if (String(input).includes('/wait')) return jsonResponse({ request: requestRecord, terminal: false });
        return jsonResponse(init?.method === 'POST' ? { request: requestRecord, waiter: { token: 'wait_123', waiterId: 'waiter_123', expiresAt: '2026-01-01T01:00:00.000Z', leaseExpiresAt: '2026-01-01T00:01:00.000Z' } } : [requestRecord]);
      }
    });
    const created = await client.createRequest({ requester: { name: 'Pi' }, requestType: 'sanction', title: 'Deploy?', sessionId: 'run_123', session: { title: 'Billing migration' } });
    expect(created).toMatchObject({ request: { id: 'req_123' }, waiter: { token: 'wait_123' } });
    await expect(client.listRequests()).resolves.toEqual([expect.objectContaining({ id: 'req_123' })]);
    await expect(client.respondToRequest('req_123', { choiceId: 'approve' }, { responseSurface: 'web-fallback' })).resolves.toMatchObject({ status: 'responded' });
    await expect(client.waitForCreatedRequest(created, { timeoutMs: 0 })).resolves.toMatchObject({ terminal: false });
    await expect(client.stopRequestWaiter('req_123', { reason: 'local_answer' }, { waiterToken: 'wait_123' })).resolves.toMatchObject({ agentWaiter: { state: 'stopped', stopReason: 'local_answer' } });
    await expect(client.reportRequestWaiterError('req_123', { code: 'wait_failed' }, { waiterToken: 'wait_123' })).resolves.toMatchObject({ agentWaiter: { state: 'errored', errorCode: 'wait_failed' } });
    await expect(client.listAudienceRequests()).resolves.toEqual([expect.objectContaining({ deliveryKind: 'audience_channel' })]);
    await expect(client.respondToAudienceRequest('req_123', { choiceId: 'approve' })).resolves.toMatchObject({ status: 'responded' });
    expect(requests.map((entry) => entry.url)).toEqual([
      'https://tick.example.com/v1/requests',
      'https://tick.example.com/v1/requests',
      'https://tick.example.com/v1/requests/req_123/responses',
      'https://tick.example.com/v1/requests/req_123/wait?timeoutMs=0',
      'https://tick.example.com/v1/requests/req_123/waiter/stop',
      'https://tick.example.com/v1/requests/req_123/waiter/error',
      'https://tick.example.com/v1/audience-requests',
      'https://tick.example.com/v1/audience-requests/req_123/responses'
    ]);
    expect(requests[0]?.body).toMatchObject({ sessionId: 'run_123', session: { title: 'Billing migration' } });
    expect(requests[2]?.responseSurface).toBe('web-fallback');
    expect(requests[3]?.authorization).toBe('Bearer wait_123');
    expect(requests[4]?.body).toEqual({ reason: 'local_answer' });
    expect(requests[4]?.authorization).toBe('Bearer wait_123');
    expect(requests[5]?.body).toEqual({ code: 'wait_failed' });
  });

  it('caps long Request waits and re-polls until the caller timeout or terminal response', async () => {
    const waitURLs: string[] = [];
    const pendingRequest = { id: 'req_long', workspaceId: 'wsp_123', requester: { name: 'Pi' }, requestType: 'sanction', title: 'Deploy?', choices: [{ id: 'approve', label: 'Approve' }, { id: 'deny', label: 'Deny', kind: 'deny' }], status: 'pending', createdAt: '2026-01-01T00:00:00.000Z' };
    const respondedRequest = { ...pendingRequest, status: 'responded', response: { choiceId: 'approve' } };
    const client = new AgentTickClient({
      baseUrl: 'https://tick.example.com',
      fetch: async (input) => {
        waitURLs.push(String(input));
        return jsonResponse({ request: waitURLs.length < 3 ? pendingRequest : respondedRequest, terminal: waitURLs.length >= 3 });
      }
    });

    await expect(client.waitForCreatedRequest({ request: pendingRequest, waiter: { token: 'wait_long', waiterId: 'waiter_long', expiresAt: '2026-01-01T01:00:00.000Z', leaseExpiresAt: '2026-01-01T00:01:00.000Z' } }, { timeoutMs: 120_000 }))
      .resolves.toMatchObject({ terminal: true, request: { status: 'responded' } });
    expect(waitURLs).toEqual([
      'https://tick.example.com/v1/requests/req_long/wait?timeoutMs=55000',
      'https://tick.example.com/v1/requests/req_long/wait?timeoutMs=55000',
      'https://tick.example.com/v1/requests/req_long/wait?timeoutMs=55000'
    ]);
  });

  it('retries transient Request wait errors with bounded short long-polls', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
    const waitURLs: string[] = [];
    const pendingRequest = { id: 'req_retry', workspaceId: 'wsp_123', requester: { name: 'Pi' }, requestType: 'sanction', title: 'Deploy?', choices: [{ id: 'approve', label: 'Approve' }, { id: 'deny', label: 'Deny', kind: 'deny' }], status: 'pending', createdAt: '2026-01-01T00:00:00.000Z' };
    const respondedRequest = { ...pendingRequest, status: 'responded', response: { choiceId: 'approve' } };
    try {
      const client = new AgentTickClient({
        baseUrl: 'https://tick.example.com',
        fetch: async (input) => {
          waitURLs.push(String(input));
          if (waitURLs.length === 1) throw new TypeError('fetch failed');
          return jsonResponse({ request: respondedRequest, terminal: true });
        }
      });

      const wait = client.waitForCreatedRequest({ request: pendingRequest, waiter: { token: 'wait_retry', waiterId: 'waiter_retry', expiresAt: '2026-01-01T01:00:00.000Z', leaseExpiresAt: '2026-01-01T00:01:00.000Z' } }, { timeoutMs: 120_000 });
      await vi.advanceTimersByTimeAsync(2_000);
      await expect(wait).resolves.toMatchObject({ terminal: true, request: { status: 'responded' } });
      expect(waitURLs).toEqual([
        'https://tick.example.com/v1/requests/req_retry/wait?timeoutMs=55000',
        'https://tick.example.com/v1/requests/req_retry/wait?timeoutMs=55000'
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('calls Session summary and detail endpoints', async () => {
    const calls: string[] = [];
    const summary = { sessionId: 'session_123', title: 'Release validation', state: 'needs-input', latestActivity: { kind: 'request', id: 'req_123', createdAt: '2026-01-01T00:00:00.000Z', preview: 'Approve deploy?', requestStatus: 'pending' }, pendingRequestCount: 1, sourceLabels: ['Pi'], startedAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' };
    const requestRecord = { id: 'req_123', workspaceId: 'wsp_123', requester: { name: 'Pi' }, requestType: 'sanction', title: 'Approve deploy?', choices: [{ id: 'approve', label: 'Approve' }, { id: 'deny', label: 'Deny', kind: 'deny' }], status: 'pending', createdAt: '2026-01-01T00:00:00.000Z' };
    const client = new AgentTickClient({
      baseUrl: 'https://tick.example.com',
      fetch: async (input, init) => {
        calls.push(`${init?.method ?? 'GET'} ${String(input)}`);
        if (String(input).includes('/v1/sessions/session_123')) return jsonResponse({ summary, timeline: [{ kind: 'request', id: 'req_123', workspaceId: 'wsp_123', createdAt: '2026-01-01T00:00:00.000Z', request: requestRecord }] });
        return jsonResponse([summary]);
      }
    });

    await expect(client.listSessions({ workspaceId: 'wsp_123', limit: 10 })).resolves.toEqual([expect.objectContaining({ title: 'Release validation', state: 'needs-input' })]);
    await expect(client.getSession('session_123', { workspaceId: 'wsp_123' })).resolves.toMatchObject({ summary: { sessionId: 'session_123' }, timeline: [{ kind: 'request', id: 'req_123' }] });
    expect(calls).toEqual([
      'GET https://tick.example.com/v1/sessions?workspaceId=wsp_123&limit=10',
      'GET https://tick.example.com/v1/sessions/session_123?workspaceId=wsp_123'
    ]);
  });

  it('represents shared Session client data loading states', async () => {
    const baseSummary: SessionSummary = { sessionId: 'session_1', title: 'Release validation', state: 'needs-input', latestActivity: { kind: 'request', id: 'req_1', createdAt: '2026-01-01T00:00:00.000Z', preview: 'Approve?', requestStatus: 'pending' }, pendingRequestCount: 1, sourceLabels: ['Pi'], startedAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' };
    const nextSummary: SessionSummary = { ...baseSummary, sessionId: 'session_2', title: 'New activity', pendingRequestCount: 0 };
    const previous = { ...initialSessionClientState('session_1'), summaries: [baseSummary], status: 'ready' as const };

    await expect(loadSessionSummaries({ listSessions: async () => [nextSummary, baseSummary] }, previous)).resolves.toMatchObject({ status: 'ready', selectedSessionId: 'session_1', summaries: [nextSummary, baseSummary] });
    await expect(loadSessionSummaries({ listSessions: async () => [] })).resolves.toMatchObject({ status: 'empty', summaries: [] });
    await expect(loadSessionSummaries({ listSessions: async () => { throw new Error('offline'); } }, previous)).resolves.toMatchObject({ status: 'stale', selectedSessionId: 'session_1', summaries: [baseSummary], error: 'offline' });
    await expect(loadSessionSummaries({ listSessions: async () => { throw new Error('server failed'); } })).resolves.toMatchObject({ status: 'error', summaries: [], error: 'server failed' });
    await expect(loadSessionTimeline({ getSession: async () => ({ summary: baseSummary, timeline: [] }) }, 'session_1', previous)).resolves.toMatchObject({ status: 'ready', selectedSessionId: 'session_1', detail: { summary: { sessionId: 'session_1' } } });
  });

  it('calls Workspace, External Approver, Agent Token, Routing Rule, Audience, Activity, and test endpoints', async () => {
    const calls: string[] = [];
    const client = new AgentTickClient({
      baseUrl: 'https://tick.example.com',
      fetch: async (input, init) => {
        calls.push(`${init?.method ?? 'GET'} ${new URL(String(input)).pathname}`);
        const url = String(input);
        if (url.endsWith('/v1/workspaces')) return jsonResponse([{ workspaceId: 'wsp_123', type: 'personal', name: 'Personal', userId: 'usr_123', role: 'owner', status: 'active', createdAt: '2026-01-01T00:00:00.000Z' }]);
        if (url.endsWith('/v1/agent-tokens')) return jsonResponse([{ agentTokenId: 'agt_123', label: 'Pi', scopes: [], workspaceId: 'wsp_123', createdAt: '2026-01-01T00:00:00.000Z' }]);
        if (url.endsWith('/v1/routing-rules')) return jsonResponse([{ routingRuleId: 'rul_123', workspaceId: 'wsp_123', name: 'Release', requiredResponseMode: 'any_one', requiredResponseCount: 1, recipientUserIds: ['usr_123'], createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }]);
        if (url.endsWith('/v1/external-approvers')) return jsonResponse({ externalApproverId: 'xapp_123', workspaceId: 'wsp_123', displayName: 'Ada', createdByUserId: 'usr_123', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' });
        if (url.endsWith('/v1/external-approvers/xapp_123/status')) return jsonResponse({ externalApproverId: 'xapp_123', workspaceId: 'wsp_123', displayName: 'Ada', userId: 'usr_456', createdByUserId: 'usr_123', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', invitePending: false, connected: true, routeReady: false });
        if (url.endsWith('/v1/external-approvers/xapp_123/invite')) return jsonResponse({ inviteId: 'xinv_123', externalApproverId: 'xapp_123', workspaceId: 'wsp_123', token: 'xinv_token', deepLink: 'agenttick://join-external-approver?token=xinv_token', qrPayload: 'agenttick://join-external-approver?token=xinv_token', expiresAt: '2026-01-01T01:00:00.000Z', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' });
        if (url.endsWith('/v1/external-approvers/xapp_123/agent-token')) return jsonResponse({ agentTokenId: 'agt_bound', token: 'agent_bound', label: 'Ada agent', scopes: [], workspaceId: 'wsp_123', routingRuleId: 'rul_123', boundRecipientUserId: 'usr_456', createdAt: '2026-01-01T00:00:00.000Z' });
        if (url.endsWith('/v1/workspaces/wsp_123/external-approver-invites')) return jsonResponse({ inviteId: 'xinv_123', workspaceId: 'wsp_123', token: 'xinv_token', deepLink: 'agenttick://join-external-approver?token=xinv_token', qrPayload: 'agenttick://join-external-approver?token=xinv_token', expiresAt: '2026-01-01T01:00:00.000Z', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' });
        if (url.includes('/v1/external-approver-invites/xinv_token/accept')) return jsonResponse({ workspaceId: 'wsp_123', type: 'shared', name: 'Team', userId: 'usr_456', role: 'member', memberKind: 'external_approver', status: 'active', createdAt: '2026-01-01T00:00:00.000Z' });
        if (url.includes('/v1/external-approver-invites/xinv_token')) return jsonResponse({ inviteId: 'xinv_123', workspaceId: 'wsp_123', expiresAt: '2026-01-01T01:00:00.000Z', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' });
        if (url.endsWith('/v1/audience-channels')) return jsonResponse([{ channelId: 'aud_123', workspaceId: 'wsp_123', name: 'Roadmap', visibility: 'public', status: 'active', createdByUserId: 'usr_123', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }]);
        if (url.endsWith('/v1/audience-channels/aud_123/subscribe')) return jsonResponse({ channelId: 'aud_123', userId: 'usr_123', status: 'active', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' });
        if (url.endsWith('/v1/activity/pending-count')) return jsonResponse({ pendingRequests: 1 });
        if (url.endsWith('/v1/tests')) return jsonResponse({ status: 'sent', kind: 'steering', id: 'req_123' });
        return jsonResponse([]);
      }
    });
    await client.listWorkspaces();
    await client.listAgentTokens();
    await client.listRoutingRules();
    await expect(client.createExternalApprover({ displayName: 'Ada' })).resolves.toMatchObject({ externalApproverId: 'xapp_123' });
    await expect(client.getExternalApproverStatus('xapp_123')).resolves.toMatchObject({ connected: true });
    await expect(client.createExternalApproverInviteForApprover('xapp_123')).resolves.toMatchObject({ externalApproverId: 'xapp_123', token: 'xinv_token' });
    await expect(client.createExternalApproverBoundAgentToken('xapp_123')).resolves.toMatchObject({ boundRecipientUserId: 'usr_456' });
    await expect(client.createExternalApproverInvite('wsp_123', { displayName: 'Ada' })).resolves.toMatchObject({ inviteId: 'xinv_123', token: 'xinv_token' });
    await expect(client.getExternalApproverInvite('xinv_token')).resolves.toMatchObject({ inviteId: 'xinv_123' });
    await expect(client.acceptExternalApproverInvite('xinv_token')).resolves.toMatchObject({ memberKind: 'external_approver' });
    await expect(client.listAudienceChannels()).resolves.toEqual([expect.objectContaining({ channelId: 'aud_123' })]);
    await expect(client.subscribeToAudienceChannel('aud_123')).resolves.toMatchObject({ status: 'active' });
    await expect(client.getPendingRequestCount()).resolves.toEqual({ pendingRequests: 1 });
    await expect(client.sendTestActivity({ kind: 'steering' })).resolves.toEqual({ status: 'sent', kind: 'steering', id: 'req_123' });
    expect(calls).toContain('GET /v1/workspaces');
    expect(calls).toContain('GET /v1/agent-tokens');
    expect(calls).toContain('GET /v1/routing-rules');
    expect(calls).toContain('POST /v1/external-approvers');
    expect(calls).toContain('POST /v1/external-approvers/xapp_123/invite');
    expect(calls).toContain('POST /v1/external-approvers/xapp_123/agent-token');
    expect(calls).toContain('POST /v1/workspaces/wsp_123/external-approver-invites');
    expect(calls).toContain('GET /v1/audience-channels');
    expect(calls).toContain('POST /v1/audience-channels/aud_123/subscribe');
  });

  it('calls readiness, history, membership, billing, routing delete, and device unpair endpoints', async () => {
    const calls: Array<{ method?: string; path: string; body?: unknown }> = [];
    const member = { workspaceId: 'wsp_123', type: 'shared', name: 'Team', userId: 'usr_456', role: 'member', status: 'active', email: 'ada@example.com', createdAt: '2026-01-01T00:00:00.000Z' };
    const personalBillingStatus = {
      entitlement: { userId: 'usr_123', trialStartedAt: '2026-01-01T00:00:00.000Z', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
      hostedPersonal: { lifecycle: 'active', trialEndsAt: '2026-02-01T00:00:00.000Z', responsesEnabled: true, routingEnabled: true, pushEnabled: true, historyRetentionDays: 30 },
      products: [],
      activeEntitlements: { trial7Day: { active: false }, lifetimeUnlock: { active: false }, hostedPersonal: { active: false } },
      purchaseAvailability: { trial_7_day: { allowed: true }, lifetime_unlock: { allowed: true }, hosted_personal_monthly: { allowed: true }, hosted_personal_yearly: { allowed: true } }
    };
    const device = { deviceId: 'dev_123', userId: 'usr_123', name: 'Phone', platform: 'ios', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', unregisteredAt: '2026-01-01T01:00:00.000Z' };
    const client = new AgentTickClient({
      baseUrl: 'https://tick.example.com',
      fetch: async (input, init) => {
        const url = new URL(String(input));
        calls.push({ method: init?.method, path: `${url.pathname}${url.search}`, body: init?.body ? JSON.parse(String(init.body)) : undefined });
        if (url.pathname === '/readyz') return jsonResponse({ status: 'ready', time: '2026-01-01T00:00:00.000Z', dependencies: { database: 'ok' } });
        if (url.pathname === '/v1/activity/history') return jsonResponse([]);
        if (url.pathname === '/v1/workspaces/wsp_123/members') return jsonResponse(member);
        if (url.pathname === '/v1/billing/personal') return jsonResponse(personalBillingStatus);
        if (url.pathname === '/v1/routing-rules/rul_123') return jsonResponse({ status: 'deleted', routingRuleId: 'rul_123' });
        if (url.pathname === '/v1/workspaces/wsp_123/external-approver-invites/xinv_123/revoke') return jsonResponse({ inviteId: 'xinv_123', workspaceId: 'wsp_123', expiresAt: '2026-01-01T01:00:00.000Z', revokedAt: '2026-01-01T00:30:00.000Z', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:30:00.000Z' });
        if (url.pathname === '/v1/audience-channels/aud_123') return jsonResponse({ channelId: 'aud_123', workspaceId: 'wsp_123', name: 'Roadmap', visibility: 'public', status: 'active', createdByUserId: 'usr_123', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' });
        if (url.pathname === '/v1/audience-channels/aud_123/mute' || url.pathname === '/v1/audience-channels/aud_123/unsubscribe') return jsonResponse({ channelId: 'aud_123', userId: 'usr_123', status: url.pathname.endsWith('/mute') ? 'muted' : 'removed', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:30:00.000Z' });
        if (url.pathname === '/v1/devices/dev_123/unpair') return jsonResponse(device);
        return jsonResponse({});
      }
    });

    await expect(client.ready()).resolves.toMatchObject({ status: 'ready', dependencies: { database: 'ok' } });
    await expect(client.listActivityHistory({ workspaceId: 'wsp_123', limit: 100 })).resolves.toEqual([]);
    await expect(client.addWorkspaceMember('wsp_123', { email: 'ada@example.com', role: 'member' })).resolves.toMatchObject({ email: 'ada@example.com' });
    await expect(client.updatePersonalBilling({ event: 'cancel_subscription' })).resolves.toMatchObject({ entitlement: { userId: 'usr_123' } });
    await expect(client.deleteRoutingRule('rul_123')).resolves.toEqual({ status: 'deleted', routingRuleId: 'rul_123' });
    await expect(client.revokeExternalApproverInvite('wsp_123', 'xinv_123')).resolves.toMatchObject({ revokedAt: '2026-01-01T00:30:00.000Z' });
    await expect(client.getAudienceChannel('aud_123')).resolves.toMatchObject({ channelId: 'aud_123' });
    await expect(client.muteAudienceChannel('aud_123')).resolves.toMatchObject({ status: 'muted' });
    await expect(client.unsubscribeFromAudienceChannel('aud_123')).resolves.toMatchObject({ status: 'removed' });
    await expect(client.unpairDevice('dev_123')).resolves.toMatchObject({ deviceId: 'dev_123' });
    expect(calls.map((call) => `${call.method ?? 'GET'} ${call.path}`)).toEqual([
      'GET /readyz',
      'GET /v1/activity/history?workspaceId=wsp_123&limit=100',
      'POST /v1/workspaces/wsp_123/members',
      'POST /v1/billing/personal',
      'DELETE /v1/routing-rules/rul_123',
      'POST /v1/workspaces/wsp_123/external-approver-invites/xinv_123/revoke',
      'GET /v1/audience-channels/aud_123',
      'POST /v1/audience-channels/aud_123/mute',
      'POST /v1/audience-channels/aud_123/unsubscribe',
      'POST /v1/devices/dev_123/unpair'
    ]);
    expect(calls[3]?.body).toEqual({ event: 'cancel_subscription' });
  });

  it('builds event stream URLs from short-lived tickets', async () => {
    const client = new AgentTickClient({ baseUrl: 'https://tick.example.com/base/', fetch: async () => jsonResponse({ ticket: 'evt_123', expiresAt: '2026-01-01T00:01:00.000Z' }) });
    await expect(client.createEventStreamURL({ lastEventId: 42 })).resolves.toBe('https://tick.example.com/base/v1/events?ticket=evt_123&lastEventId=42');
  });

  it('opens event streams with an injectable EventSource constructor', async () => {
    const opened: string[] = [];
    class FakeEventSource {
      constructor(url: string | URL) { opened.push(String(url)); }
      close() {}
      addEventListener() {}
      removeEventListener() {}
      dispatchEvent() { return true; }
      onerror = null;
      onmessage = null;
      onopen = null;
      readyState = 0;
      url = '';
      withCredentials = false;
      CONNECTING = 0;
      OPEN = 1;
      CLOSED = 2;
    }
    const client = new AgentTickClient({ baseUrl: 'https://tick.example.com', fetch: async () => jsonResponse({ ticket: 'evt_stream', expiresAt: '2026-01-01T00:01:00.000Z' }) });
    await client.openEventStream({ EventSource: FakeEventSource as unknown as EventSourceConstructor, lastEventId: 7 });
    expect(opened).toEqual(['https://tick.example.com/v1/events?ticket=evt_stream&lastEventId=7']);
  });
});

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' }, ...init });
}
