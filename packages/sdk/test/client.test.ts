import { describe, expect, it } from 'vitest';
import { AgentTickApiError, AgentTickClient } from '../src/index.js';

describe('AgentTickClient', () => {
  it('attaches bearer and organization headers', async () => {
    const seen: { headers?: Headers; url?: string } = {};
    const client = new AgentTickClient({
      baseUrl: 'https://tick.example.com/base/',
      tokenProvider: async () => 'token-123',
      organizationIdProvider: () => 'org_123',
      fetch: async (input, init) => {
        seen.url = String(input);
        seen.headers = new Headers(init?.headers);
        return jsonResponse({ status: 'ok' });
      }
    });

    await client.health();

    expect(seen.url).toBe('https://tick.example.com/healthz');
    expect(seen.headers?.get('Authorization')).toBe('Bearer token-123');
    expect(seen.headers?.get('X-Agent-Tick-Organization-ID')).toBe('org_123');
  });

  it('parses structured API errors', async () => {
    const client = new AgentTickClient({
      baseUrl: 'https://tick.example.com',
      fetch: async () =>
        jsonResponse(
          { error: { code: 'not_authenticated', message: 'Authentication required', requestId: 'req-1' } },
          { status: 401 }
        )
    });

    await expect(client.getMe()).rejects.toMatchObject<Partial<AgentTickApiError>>({
      name: 'AgentTickApiError',
      status: 401,
      code: 'not_authenticated',
      requestId: 'req-1'
    });
  });

  it('calls audit event endpoint with limit', async () => {
    const seen: { url?: string; method?: string } = {};
    const client = new AgentTickClient({
      baseUrl: 'https://tick.example.com',
      fetch: async (input, init) => {
        seen.url = String(input);
        seen.method = init?.method;
        return jsonResponse([
          {
            eventId: 1,
            organizationId: 'org_123',
            userId: 'usr_123',
            eventType: 'agent_token.created',
            targetId: 'agt_123',
            payload: { name: 'agent' },
            createdAt: '2026-01-01T00:00:00.000Z'
          }
        ]);
      }
    });

    await expect(client.listAuditEvents({ limit: 10 })).resolves.toEqual([
      expect.objectContaining({ eventType: 'agent_token.created', targetId: 'agt_123' })
    ]);
    expect(seen).toEqual({ method: 'GET', url: 'https://tick.example.com/v1/audit-events?limit=10' });
  });

  it('calls presence endpoints with validated payloads', async () => {
    const requests: Array<{ url: string; method?: string; body?: unknown }> = [];
    const client = new AgentTickClient({
      baseUrl: 'https://tick.example.com',
      fetch: async (input, init) => {
        requests.push({ url: String(input), method: init?.method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
        if (String(input).endsWith('/v1/heartbeat')) return jsonResponse({ status: 'ok', state: 'available' });
        return jsonResponse({ userId: 'usr_123', organizationId: 'org_123', state: 'busy', updatedAt: '2026-01-01T00:00:00.000Z' });
      }
    });

    await expect(client.sendHeartbeat({ client: 'mobile' })).resolves.toMatchObject({ status: 'ok', state: 'available' });
    await expect(client.setAvailability({ state: 'busy' })).resolves.toMatchObject({ state: 'busy' });
    expect(requests).toEqual([
      { method: 'POST', url: 'https://tick.example.com/v1/heartbeat', body: { client: 'mobile' } },
      { method: 'POST', url: 'https://tick.example.com/v1/availability', body: { state: 'busy' } }
    ]);
  });

  it('calls project endpoints with validated payloads', async () => {
    const requests: Array<{ url: string; method?: string; body?: unknown }> = [];
    const client = new AgentTickClient({
      baseUrl: 'https://tick.example.com',
      fetch: async (input, init) => {
        requests.push({ url: String(input), method: init?.method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
        const project = {
          projectId: 'prj_123',
          organizationId: 'org_123',
          name: 'Mobile App',
          slug: 'mobile-app',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z'
        };
        return String(input).endsWith('/v1/projects') && init?.method === 'POST' ? jsonResponse(project) : jsonResponse([project]);
      }
    });

    await expect(client.createProject({ name: 'Mobile App' })).resolves.toMatchObject({ projectId: 'prj_123', slug: 'mobile-app' });
    await expect(client.listProjects()).resolves.toEqual([expect.objectContaining({ projectId: 'prj_123' })]);
    expect(requests).toEqual([
      { method: 'POST', url: 'https://tick.example.com/v1/projects', body: { name: 'Mobile App' } },
      { method: 'GET', url: 'https://tick.example.com/v1/projects', body: undefined }
    ]);
  });

  it('calls team endpoints with validated payloads', async () => {
    const requests: Array<{ url: string; method?: string; body?: unknown }> = [];
    const client = new AgentTickClient({
      baseUrl: 'https://tick.example.com',
      fetch: async (input, init) => {
        requests.push({ url: String(input), method: init?.method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
        const team = {
          teamId: 'team_123',
          organizationId: 'org_123',
          name: 'Platform',
          slug: 'platform',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z'
        };
        if (String(input).endsWith('/v1/teams') && init?.method === 'POST') return jsonResponse({ ...team, userId: 'usr_123', role: 'owner' });
        if (String(input).endsWith('/members') && init?.method === 'POST') return jsonResponse({ ...team, userId: 'usr_123', role: 'lead' });
        if (String(input).endsWith('/members/usr_456') && init?.method === 'DELETE') return jsonResponse({ ...team, userId: 'usr_456', role: 'lead' });
        if (String(input).endsWith('/members')) return jsonResponse([{ ...team, userId: 'usr_123', role: 'owner' }]);
        return jsonResponse([team]);
      }
    });

    await expect(client.createTeam({ name: 'Platform' })).resolves.toMatchObject({ teamId: 'team_123', role: 'owner' });
    await expect(client.listTeams()).resolves.toEqual([expect.objectContaining({ teamId: 'team_123' })]);
    await expect(client.listTeamMembers('team_123')).resolves.toEqual([expect.objectContaining({ userId: 'usr_123' })]);
    await expect(client.upsertTeamMember('team_123', { userId: 'usr_456', role: 'lead' })).resolves.toMatchObject({ userId: 'usr_123' });
    await expect(client.removeTeamMember('team_123', 'usr_456')).resolves.toMatchObject({ userId: 'usr_456' });
    expect(requests).toEqual([
      { method: 'POST', url: 'https://tick.example.com/v1/teams', body: { name: 'Platform' } },
      { method: 'GET', url: 'https://tick.example.com/v1/teams', body: undefined },
      { method: 'GET', url: 'https://tick.example.com/v1/teams/team_123/members', body: undefined },
      { method: 'POST', url: 'https://tick.example.com/v1/teams/team_123/members', body: { userId: 'usr_456', role: 'lead' } },
      { method: 'DELETE', url: 'https://tick.example.com/v1/teams/team_123/members/usr_456', body: undefined }
    ]);
  });

  it('calls policy endpoints with validated payloads', async () => {
    const requests: Array<{ url: string; method?: string; body?: unknown }> = [];
    const client = new AgentTickClient({
      baseUrl: 'https://tick.example.com',
      fetch: async (input, init) => {
        requests.push({ url: String(input), method: init?.method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
        const policy = {
          policyId: 'pol_123',
          organizationId: 'org_123',
          name: 'Production quorum',
          requiredApprovals: 2,
          enabled: true,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z'
        };
        return String(input).endsWith('/v1/policies') && init?.method === 'POST' ? jsonResponse(policy) : jsonResponse([policy]);
      }
    });

    await expect(client.createPolicy({ name: 'Production quorum', requiredApprovals: 2 })).resolves.toMatchObject({ policyId: 'pol_123' });
    await expect(client.listPolicies()).resolves.toEqual([expect.objectContaining({ policyId: 'pol_123' })]);
    expect(requests).toEqual([
      { method: 'POST', url: 'https://tick.example.com/v1/policies', body: { name: 'Production quorum', requiredApprovals: 2, enabled: true } },
      { method: 'GET', url: 'https://tick.example.com/v1/policies', body: undefined }
    ]);
  });

  it('calls organization invite endpoints and omits org selection for token acceptance', async () => {
    const requests: Array<{ url: string; method?: string; body?: unknown; organizationId: string | null }> = [];
    const client = new AgentTickClient({
      baseUrl: 'https://tick.example.com',
      organizationIdProvider: () => 'org_selected',
      fetch: async (input, init) => {
        const headers = new Headers(init?.headers);
        requests.push({
          url: String(input),
          method: init?.method,
          body: init?.body ? JSON.parse(String(init.body)) : undefined,
          organizationId: headers.get('X-Agent-Tick-Organization-ID')
        });
        const invite = {
          inviteId: 'inv_123',
          organizationId: 'org_123',
          label: 'Teammate',
          role: 'admin',
          teamIds: ['team_123'],
          domain: 'example.com',
          usedCount: 0,
          createdAt: '2026-01-01T00:00:00.000Z',
          token: 'invite_secret'
        };
        const url = String(input);
        if (url.includes('/v1/invites/invite_secret/accept')) {
          return jsonResponse({
            status: 'pending_approval',
            membership: { organizationId: 'org_123', name: 'Production', userId: 'usr_123', role: 'admin', status: 'pending_approval', createdAt: '2026-01-01T00:00:00.000Z' }
          });
        }
        if (url.includes('/v1/invites/invite_secret')) return jsonResponse({ organizationName: 'Production', role: 'admin', approvalRequired: true });
        if (url.includes('/v1/organization-membership-requests/mreq_123/approve')) return jsonResponse({ requestId: 'mreq_123', inviteId: 'inv_123', organizationId: 'org_123', userId: 'usr_123', requestedRole: 'admin', requestedTeamIds: ['team_123'], status: 'approved', acceptedAt: '2026-01-01T00:00:00.000Z' });
        if (url.includes('/v1/organization-membership-requests/mreq_123/reject')) return jsonResponse({ requestId: 'mreq_123', inviteId: 'inv_123', organizationId: 'org_123', userId: 'usr_123', requestedRole: 'admin', requestedTeamIds: ['team_123'], status: 'rejected', acceptedAt: '2026-01-01T00:00:00.000Z' });
        if (url.endsWith('/v1/organization-membership-requests')) return jsonResponse([{ requestId: 'mreq_123', inviteId: 'inv_123', organizationId: 'org_123', userId: 'usr_123', requestedRole: 'admin', requestedTeamIds: ['team_123'], status: 'pending_approval', acceptedAt: '2026-01-01T00:00:00.000Z' }]);
        if (url.includes('/revoke')) return jsonResponse({ ...invite, revokedAt: '2026-01-01T00:00:00.000Z' });
        return url.endsWith('/v1/organization-invites') && init?.method === 'POST' ? jsonResponse(invite) : jsonResponse([invite]);
      }
    });

    await expect(client.createOrganizationInvite({ label: 'Teammate', role: 'admin', teamIds: ['team_123'], domain: 'example.com' })).resolves.toMatchObject({ inviteId: 'inv_123', teamIds: ['team_123'], domain: 'example.com' });
    await expect(client.listOrganizationInvites()).resolves.toEqual([expect.objectContaining({ inviteId: 'inv_123', domain: 'example.com' })]);
    await expect(client.previewInvite('invite_secret')).resolves.toEqual({ organizationName: 'Production', role: 'admin', approvalRequired: true });
    await expect(client.acceptInvite('invite_secret')).resolves.toMatchObject({ status: 'pending_approval', membership: { role: 'admin' } });
    await expect(client.listMembershipRequests()).resolves.toEqual([expect.objectContaining({ requestId: 'mreq_123' })]);
    await expect(client.approveMembershipRequest('mreq_123')).resolves.toMatchObject({ status: 'approved' });
    await expect(client.rejectMembershipRequest('mreq_123')).resolves.toMatchObject({ status: 'rejected' });
    await expect(client.revokeOrganizationInvite('inv_123')).resolves.toMatchObject({ revokedAt: expect.any(String) });
    expect(requests.map((request) => [request.method, request.url, request.organizationId, request.body])).toEqual([
      ['POST', 'https://tick.example.com/v1/organization-invites', 'org_selected', { label: 'Teammate', role: 'admin', approvalRequired: true, teamIds: ['team_123'], domain: 'example.com', maxUses: 1 }],
      ['GET', 'https://tick.example.com/v1/organization-invites', 'org_selected', undefined],
      ['GET', 'https://tick.example.com/v1/invites/invite_secret', null, undefined],
      ['POST', 'https://tick.example.com/v1/invites/invite_secret/accept', null, {}],
      ['GET', 'https://tick.example.com/v1/organization-membership-requests', 'org_selected', undefined],
      ['POST', 'https://tick.example.com/v1/organization-membership-requests/mreq_123/approve', 'org_selected', {}],
      ['POST', 'https://tick.example.com/v1/organization-membership-requests/mreq_123/reject', 'org_selected', {}],
      ['POST', 'https://tick.example.com/v1/organization-invites/inv_123/revoke', 'org_selected', {}]
    ]);
  });

  it('calls organization member endpoint', async () => {
    const seen: { url?: string; method?: string } = {};
    const client = new AgentTickClient({
      baseUrl: 'https://tick.example.com',
      fetch: async (input, init) => {
        seen.url = String(input);
        seen.method = init?.method;
        return jsonResponse([
          {
            organizationId: 'org_123',
            name: 'Production',
            userId: 'usr_123',
            role: 'owner',
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z'
          }
        ]);
      }
    });

    await expect(client.listOrganizationMembers('org_123')).resolves.toEqual([
      expect.objectContaining({ organizationId: 'org_123', userId: 'usr_123' })
    ]);
    expect(seen).toEqual({ method: 'GET', url: 'https://tick.example.com/v1/organizations/org_123/members' });
  });

  it('calls agent token revoke endpoint', async () => {
    const seen: { url?: string; method?: string; body?: unknown } = {};
    const client = new AgentTickClient({
      baseUrl: 'https://tick.example.com',
      fetch: async (input, init) => {
        seen.url = String(input);
        seen.method = init?.method;
        seen.body = init?.body ? JSON.parse(String(init.body)) : undefined;
        return jsonResponse({
          agentId: 'agt_123',
          name: 'agent',
          scopes: ['approval:create'],
          organizationId: 'org_123',
          createdAt: '2026-01-01T00:00:00.000Z',
          revokedAt: '2026-01-01T00:00:00.000Z'
        });
      }
    });

    await expect(client.revokeAgentToken('agt_123')).resolves.toMatchObject({ agentId: 'agt_123' });
    expect(seen).toEqual({
      url: 'https://tick.example.com/v1/agent-tokens/agt_123/revoke',
      method: 'POST',
      body: {}
    });
  });

  it('calls device endpoints with validated payloads', async () => {
    const requests: Array<{ url: string; method?: string; body?: unknown }> = [];
    const client = new AgentTickClient({
      baseUrl: 'https://tick.example.com',
      fetch: async (input, init) => {
        requests.push({
          url: String(input),
          method: init?.method,
          body: init?.body ? JSON.parse(String(init.body)) : undefined
        });
        const url = String(input);
        if (url.endsWith('/v1/devices/register')) return jsonResponse({ deviceId: 'dev_123' });
        if (url.endsWith('/v1/devices/pair')) return jsonResponse({ deviceId: 'dev_123', token: 'dtok_123' });
        return jsonResponse({
          deviceId: 'dev_123',
          userId: 'usr_123',
          organizationId: 'org_123',
          name: 'Phone',
          platform: 'ios',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z'
        });
      }
    });

    await expect(client.registerDevice({ deviceName: 'Phone', platform: 'ios', expoPushToken: 'ExponentPushToken[1]' })).resolves.toEqual({
      deviceId: 'dev_123'
    });
    await expect(client.pairDevice({ token: 'pair_123', deviceName: 'Phone' })).resolves.toEqual({ deviceId: 'dev_123', token: 'dtok_123' });
    await expect(client.updateDevicePushToken('dev_123', { token: 'ExponentPushToken[2]' })).resolves.toMatchObject({ deviceId: 'dev_123' });
    await expect(client.unregisterDevice('dev_123')).resolves.toMatchObject({ deviceId: 'dev_123' });

    expect(requests.map((request) => [request.method, request.url, request.body])).toEqual([
      ['POST', 'https://tick.example.com/v1/devices/register', { deviceName: 'Phone', platform: 'ios', expoPushToken: 'ExponentPushToken[1]' }],
      ['POST', 'https://tick.example.com/v1/devices/pair', { token: 'pair_123', deviceName: 'Phone' }],
      ['POST', 'https://tick.example.com/v1/devices/dev_123/push-token', { token: 'ExponentPushToken[2]' }],
      ['POST', 'https://tick.example.com/v1/devices/dev_123/unregister', {}]
    ]);
  });

  it('validates response schemas', async () => {
    const client = new AgentTickClient({
      baseUrl: 'https://tick.example.com',
      fetch: async () => jsonResponse({ status: 'wrong' })
    });

    await expect(client.health()).rejects.toThrow();
  });
});

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { 'content-type': 'application/json', ...init.headers }
  });
}
