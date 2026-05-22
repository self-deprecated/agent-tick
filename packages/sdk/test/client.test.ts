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

  it('calls Request endpoints', async () => {
    const requests: Array<{ url: string; method?: string; body?: unknown }> = [];
    const requestRecord = { id: 'req_123', workspaceId: 'wsp_123', requester: { name: 'Pi' }, requestType: 'sanction', title: 'Deploy?', choices: [{ id: 'approve', label: 'Approve' }, { id: 'deny', label: 'Deny', kind: 'deny' }], status: 'pending', createdAt: '2026-01-01T00:00:00.000Z' };
    const client = new AgentTickClient({
      baseUrl: 'https://tick.example.com',
      fetch: async (input, init) => {
        requests.push({ url: String(input), method: init?.method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
        if (String(input).endsWith('/responses')) return jsonResponse({ ...requestRecord, status: 'responded', response: { choiceId: 'approve' } });
        if (String(input).includes('/wait')) return jsonResponse({ request: requestRecord, terminal: false });
        return jsonResponse(init?.method === 'POST' ? { request: requestRecord, waiter: { token: 'wait_123', expiresAt: '2026-01-01T01:00:00.000Z' } } : [requestRecord]);
      }
    });
    await expect(client.createRequest({ requester: { name: 'Pi' }, requestType: 'sanction', title: 'Deploy?' })).resolves.toMatchObject({ request: { id: 'req_123' } });
    await expect(client.listRequests()).resolves.toEqual([expect.objectContaining({ id: 'req_123' })]);
    await expect(client.respondToRequest('req_123', { choiceId: 'approve' })).resolves.toMatchObject({ status: 'responded' });
    await expect(client.waitForRequest('req_123', { timeoutMs: 0 })).resolves.toMatchObject({ terminal: false });
    expect(requests.map((entry) => entry.url)).toEqual([
      'https://tick.example.com/v1/requests',
      'https://tick.example.com/v1/requests',
      'https://tick.example.com/v1/requests/req_123/responses',
      'https://tick.example.com/v1/requests/req_123/wait?timeoutMs=0'
    ]);
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
