import { expect, type APIRequestContext } from '@playwright/test';
import type { TestUserSession } from './auth';
import { authHeaders } from './auth';

export interface AgentTokenFixture {
  agentTokenId: string;
  token: string;
  label: string;
  workspaceId: string;
}

export interface RequestFixture {
  request: { id: string; title: string; status: string; workspaceId: string };
}

export interface SharedWorkspaceFixture {
  workspaceId: string;
  name: string;
  type: 'shared';
  userId: string;
  role: string;
}

export interface RoutingRuleFixture {
  routingRuleId: string;
  workspaceId: string;
  name: string;
  recipientUserIds: string[];
  requiredResponseMode: string;
  requiredResponseCount: number;
}

export async function createAgentToken(request: APIRequestContext, baseURL: string | undefined, session: TestUserSession, label: string, workspaceId = session.workspaceId): Promise<AgentTokenFixture> {
  const response = await request.post(`${baseURL}/v1/agent-tokens`, {
    headers: authHeaders(session, workspaceId),
    data: { label, workspaceId }
  });
  expect(response.ok()).toBeTruthy();
  return await response.json() as AgentTokenFixture;
}

export async function createRequest(request: APIRequestContext, baseURL: string | undefined, agentToken: string, title: string): Promise<RequestFixture> {
  const response = await request.post(`${baseURL}/v1/requests`, {
    headers: { authorization: `Bearer ${agentToken}` },
    data: {
      requester: { name: 'E2E local agent' },
      requestType: 'sanction',
      title,
      body: 'Created by a product-flow E2E fixture.',
      command: 'echo e2e',
      choices: [
        { id: 'approve', label: 'Approve', kind: 'approve' },
        { id: 'deny', label: 'Deny', kind: 'deny' }
      ]
    }
  });
  expect(response.ok()).toBeTruthy();
  return await response.json() as RequestFixture;
}

export async function registerMobileDevice(request: APIRequestContext, baseURL: string | undefined, session: TestUserSession, deviceName = 'E2E iPhone'): Promise<{ deviceId: string }> {
  const response = await request.post(`${baseURL}/v1/devices/register`, {
    headers: authHeaders(session),
    data: { deviceName, platform: 'ios', installationId: `${session.subject}-${deviceName}` }
  });
  expect(response.ok()).toBeTruthy();
  return await response.json() as { deviceId: string };
}

export async function createSharedWorkspace(request: APIRequestContext, baseURL: string | undefined, session: TestUserSession, name: string): Promise<SharedWorkspaceFixture> {
  const response = await request.post(`${baseURL}/v1/workspaces`, {
    headers: authHeaders(session),
    data: { name }
  });
  expect(response.ok()).toBeTruthy();
  return await response.json() as SharedWorkspaceFixture;
}

export async function addWorkspaceMember(request: APIRequestContext, baseURL: string | undefined, owner: TestUserSession, workspaceId: string, email: string, role: 'admin' | 'member' = 'member'): Promise<unknown> {
  const response = await request.post(`${baseURL}/v1/workspaces/${workspaceId}/members`, {
    headers: authHeaders(owner, workspaceId),
    data: { email, role }
  });
  expect(response.ok()).toBeTruthy();
  return await response.json();
}

export async function createRoutingRule(request: APIRequestContext, baseURL: string | undefined, session: TestUserSession, workspaceId: string, name: string, recipientUserIds: string[]): Promise<RoutingRuleFixture> {
  const response = await request.post(`${baseURL}/v1/routing-rules`, {
    headers: authHeaders(session, workspaceId),
    data: {
      workspaceId,
      name,
      recipientUserIds,
      requiredResponseMode: 'any_one',
      requiredResponseCount: 1
    }
  });
  expect(response.ok()).toBeTruthy();
  return await response.json() as RoutingRuleFixture;
}
