import { expect, type APIRequestContext } from '@playwright/test';
import type { TestUserSession } from './auth';
import { authHeaders } from './auth';

export async function createAgentToken(request: APIRequestContext, baseURL: string | undefined, session: TestUserSession, name: string, organizationId = session.organizationId): Promise<{ agentId: string; token: string }> {
  const response = await request.post(`${baseURL}/v1/agent-tokens`, {
    headers: authHeaders(session, organizationId),
    data: { name }
  });
  expect(response.ok()).toBeTruthy();
  return await response.json() as { agentId: string; token: string };
}

export async function createApprovalRequest(request: APIRequestContext, baseURL: string | undefined, agentToken: string, title: string): Promise<{ request: { id: string; title: string } }> {
  const response = await request.post(`${baseURL}/v1/approval-requests`, {
    headers: { authorization: `Bearer ${agentToken}` },
    data: {
      requester: { name: 'E2E local agent' },
      title,
      body: 'Created by a product-flow E2E fixture.',
      command: 'echo e2e',
      choices: [
        { id: 'approve', label: 'Approve', kind: 'approve' },
        { id: 'reject', label: 'Reject', kind: 'reject' }
      ]
    }
  });
  expect(response.ok()).toBeTruthy();
  return await response.json() as { request: { id: string; title: string } };
}

export async function registerMobileDevice(request: APIRequestContext, baseURL: string | undefined, session: TestUserSession, deviceName = 'E2E iPhone'): Promise<{ deviceId: string }> {
  const response = await request.post(`${baseURL}/v1/devices/register`, {
    headers: authHeaders(session),
    data: { deviceName, platform: 'ios', installationId: `${session.subject}-${deviceName}` }
  });
  expect(response.ok()).toBeTruthy();
  return await response.json() as { deviceId: string };
}

export async function createOrganization(request: APIRequestContext, baseURL: string | undefined, session: TestUserSession, name: string): Promise<{ organizationId: string; name: string }> {
  const response = await request.post(`${baseURL}/v1/organizations`, {
    headers: authHeaders(session),
    data: { name }
  });
  expect(response.ok()).toBeTruthy();
  return await response.json() as { organizationId: string; name: string };
}
