import { describe, expect, it } from 'vitest';
import { AgentTickApiError, AgentTickClient, type EventSourceConstructor } from '../src/index.js';

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
    const status = { statusId: 'stat_123', workspaceId: 'wsp_123', agentTokenId: 'agt_123', message: 'Running tests', state: 'working', createdAt: '2026-01-01T00:00:00.000Z' };
    const client = new AgentTickClient({
      baseUrl: 'https://tick.example.com',
      fetch: async (input, init) => {
        requests.push({ url: String(input), method: init?.method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
        return jsonResponse(init?.method === 'POST' ? status : [status]);
      }
    });
    await expect(client.createStatusUpdate({ message: 'Running tests' })).resolves.toMatchObject({ statusId: 'stat_123' });
    await expect(client.listStatusUpdates({ limit: 5 })).resolves.toEqual([expect.objectContaining({ message: 'Running tests' })]);
    expect(requests).toEqual([
      { method: 'POST', url: 'https://tick.example.com/v1/status-updates', body: { message: 'Running tests', state: 'working' } },
      { method: 'GET', url: 'https://tick.example.com/v1/status-updates?limit=5', body: undefined }
    ]);
  });

  it('calls Request endpoints and can wait with the returned waiter token', async () => {
    const requests: Array<{ url: string; method?: string; body?: unknown; authorization?: string | null }> = [];
    const requestRecord = { id: 'req_123', workspaceId: 'wsp_123', requester: { name: 'Pi' }, requestType: 'sanction', title: 'Deploy?', choices: [{ id: 'approve', label: 'Approve' }, { id: 'deny', label: 'Deny', kind: 'deny' }], status: 'pending', createdAt: '2026-01-01T00:00:00.000Z' };
    const client = new AgentTickClient({
      baseUrl: 'https://tick.example.com',
      tokenProvider: () => 'agent_123',
      fetch: async (input, init) => {
        const headers = new Headers(init?.headers);
        requests.push({ url: String(input), method: init?.method, body: init?.body ? JSON.parse(String(init.body)) : undefined, authorization: headers.get('Authorization') });
        if (String(input).endsWith('/responses')) return jsonResponse({ ...requestRecord, status: 'responded', response: { choiceId: 'approve' } });
        if (String(input).includes('/wait')) return jsonResponse({ request: requestRecord, terminal: false });
        return jsonResponse(init?.method === 'POST' ? { request: requestRecord, waiter: { token: 'wait_123', expiresAt: '2026-01-01T01:00:00.000Z' } } : [requestRecord]);
      }
    });
    const created = await client.createRequest({ requester: { name: 'Pi' }, requestType: 'sanction', title: 'Deploy?' });
    expect(created).toMatchObject({ request: { id: 'req_123' }, waiter: { token: 'wait_123' } });
    await expect(client.listRequests()).resolves.toEqual([expect.objectContaining({ id: 'req_123' })]);
    await expect(client.respondToRequest('req_123', { choiceId: 'approve' })).resolves.toMatchObject({ status: 'responded' });
    await expect(client.waitForCreatedRequest(created, { timeoutMs: 0 })).resolves.toMatchObject({ terminal: false });
    expect(requests.map((entry) => entry.url)).toEqual([
      'https://tick.example.com/v1/requests',
      'https://tick.example.com/v1/requests',
      'https://tick.example.com/v1/requests/req_123/responses',
      'https://tick.example.com/v1/requests/req_123/wait?timeoutMs=0'
    ]);
    expect(requests.at(-1)?.authorization).toBe('Bearer wait_123');
  });

  it('calls Workspace, Agent Token, Routing Rule, Activity, and test endpoints', async () => {
    const calls: string[] = [];
    const client = new AgentTickClient({
      baseUrl: 'https://tick.example.com',
      fetch: async (input, init) => {
        calls.push(`${init?.method ?? 'GET'} ${new URL(String(input)).pathname}`);
        const url = String(input);
        if (url.endsWith('/v1/workspaces')) return jsonResponse([{ workspaceId: 'wsp_123', type: 'personal', name: 'Personal', userId: 'usr_123', role: 'owner', status: 'active', createdAt: '2026-01-01T00:00:00.000Z' }]);
        if (url.endsWith('/v1/agent-tokens')) return jsonResponse([{ agentTokenId: 'agt_123', label: 'Pi', scopes: [], workspaceId: 'wsp_123', createdAt: '2026-01-01T00:00:00.000Z' }]);
        if (url.endsWith('/v1/routing-rules')) return jsonResponse([{ routingRuleId: 'rul_123', workspaceId: 'wsp_123', name: 'Release', requiredResponseMode: 'any_one', requiredResponseCount: 1, recipientUserIds: ['usr_123'], createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }]);
        if (url.endsWith('/v1/activity/pending-count')) return jsonResponse({ pendingRequests: 1 });
        if (url.endsWith('/v1/tests')) return jsonResponse({ status: 'sent', kind: 'steering', id: 'req_123' });
        return jsonResponse([]);
      }
    });
    await client.listWorkspaces();
    await client.listAgentTokens();
    await client.listRoutingRules();
    await expect(client.getPendingRequestCount()).resolves.toEqual({ pendingRequests: 1 });
    await expect(client.sendTestActivity({ kind: 'steering' })).resolves.toEqual({ status: 'sent', kind: 'steering', id: 'req_123' });
    expect(calls).toContain('GET /v1/workspaces');
    expect(calls).toContain('GET /v1/agent-tokens');
    expect(calls).toContain('GET /v1/routing-rules');
  });

  it('calls readiness, history, membership, billing, routing delete, and device unpair endpoints', async () => {
    const calls: Array<{ method?: string; path: string; body?: unknown }> = [];
    const member = { workspaceId: 'wsp_123', type: 'shared', name: 'Team', userId: 'usr_456', role: 'member', status: 'active', email: 'ada@example.com', createdAt: '2026-01-01T00:00:00.000Z' };
    const personalBillingStatus = {
      entitlement: { userId: 'usr_123', trialStartedAt: '2026-01-01T00:00:00.000Z', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
      hostedPersonal: { lifecycle: 'active', trialEndsAt: '2026-02-01T00:00:00.000Z', responsesEnabled: true, routingEnabled: true, pushEnabled: true, historyRetentionDays: 30 },
      products: [],
      activeEntitlements: { lifetimeUnlock: { active: false }, hostedPersonal: { active: false } },
      purchaseAvailability: { lifetime_unlock: { allowed: true }, hosted_personal_monthly: { allowed: true }, hosted_personal_yearly: { allowed: true } }
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
        if (url.pathname === '/v1/devices/dev_123/unpair') return jsonResponse(device);
        return jsonResponse({});
      }
    });

    await expect(client.ready()).resolves.toMatchObject({ status: 'ready', dependencies: { database: 'ok' } });
    await expect(client.listActivityHistory({ workspaceId: 'wsp_123', limit: 100 })).resolves.toEqual([]);
    await expect(client.addWorkspaceMember('wsp_123', { email: 'ada@example.com', role: 'member' })).resolves.toMatchObject({ email: 'ada@example.com' });
    await expect(client.updatePersonalBilling({ event: 'cancel_subscription' })).resolves.toMatchObject({ entitlement: { userId: 'usr_123' } });
    await expect(client.deleteRoutingRule('rul_123')).resolves.toEqual({ status: 'deleted', routingRuleId: 'rul_123' });
    await expect(client.unpairDevice('dev_123')).resolves.toMatchObject({ deviceId: 'dev_123' });
    expect(calls.map((call) => `${call.method ?? 'GET'} ${call.path}`)).toEqual([
      'GET /readyz',
      'GET /v1/activity/history?workspaceId=wsp_123&limit=100',
      'POST /v1/workspaces/wsp_123/members',
      'POST /v1/billing/personal',
      'DELETE /v1/routing-rules/rul_123',
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
