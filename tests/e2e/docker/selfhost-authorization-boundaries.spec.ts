import { expect, test } from '@playwright/test';
import { authHeaders } from '../support/auth';
import { createAgentToken, createRequest } from '../support/fixtures';
import {
  bearerHeaders,
  createMobileSession,
  createTestUser,
  expectError,
  expectOk,
  getAuthConfig,
  registerMobileDevice,
  subscribePersonalBilling
} from './support/selfhost';

test.describe('Docker self-host authorization boundaries', () => {
  test('does not leak or mutate another user workspace through human, mobile, or agent credentials', async ({ request, baseURL }) => {
    const config = await getAuthConfig(request, baseURL);
    expect(config).toMatchObject({ mode: 'clerk', authProvider: 'clerk', testAuth: true });

    const stamp = Date.now();
    const userA = await createTestUser(request, baseURL, {
      subject: `docker_authz_a_${stamp}`,
      name: 'Docker AuthZ User A'
    });
    const userB = await createTestUser(request, baseURL, {
      subject: `docker_authz_b_${stamp}`,
      name: 'Docker AuthZ User B'
    });
    expect(userA.userId).not.toBe(userB.userId);
    expect(userA.workspaceId).not.toBe(userB.workspaceId);

    await subscribePersonalBilling(request, baseURL, userA);
    await subscribePersonalBilling(request, baseURL, userB);

    const mobileA = await createMobileSession(request, baseURL, userA);
    const mobileB = await createMobileSession(request, baseURL, userB);
    await registerMobileDevice(request, baseURL, mobileA.token, `Docker AuthZ Phone A ${stamp}`, 'ios');
    await registerMobileDevice(request, baseURL, mobileB.token, `Docker AuthZ Phone B ${stamp}`, 'android');

    const agentA = await createAgentToken(request, baseURL, userA, `Docker AuthZ Agent A ${stamp}`);
    const agentB = await createAgentToken(request, baseURL, userB, `Docker AuthZ Agent B ${stamp}`);
    expect(agentA.workspaceId).toBe(userA.workspaceId);
    expect(agentB.workspaceId).toBe(userB.workspaceId);

    const createdA = await createRequest(request, baseURL, agentA.token, `Docker AuthZ Request A ${stamp}`);
    const createdB = await createRequest(request, baseURL, agentB.token, `Docker AuthZ Request B ${stamp}`);
    expect(createdA.request.workspaceId).toBe(userA.workspaceId);
    expect(createdB.request.workspaceId).toBe(userB.workspaceId);

    const userBReadsA = await request.get(`${baseURL}/v1/requests/${createdA.request.id}`, { headers: authHeaders(userB) });
    const userBReadsABody = await expectError(userBReadsA, 404, 'User B GET User A request');
    expect(userBReadsABody.error?.message).not.toContain(createdA.request.title);

    const userBRequestsResponse = await request.get(`${baseURL}/v1/requests`, { headers: authHeaders(userB) });
    await expectOk(userBRequestsResponse, 'User B GET /v1/requests');
    const userBRequests = await userBRequestsResponse.json() as Array<{ id: string; title: string; workspaceId: string }>;
    expect(userBRequests.some((item) => item.id === createdA.request.id || item.title === createdA.request.title)).toBeFalsy();
    expect(userBRequests.some((item) => item.id === createdB.request.id)).toBeTruthy();

    const userBActivityResponse = await request.get(`${baseURL}/v1/activity/history?limit=100`, { headers: authHeaders(userB) });
    await expectOk(userBActivityResponse, 'User B GET /v1/activity/history');
    const userBActivity = await userBActivityResponse.json() as Array<{ request?: { id: string; title: string }; statusUpdate?: { statusId: string } }>;
    expect(userBActivity.some((item) => item.request?.id === createdA.request.id || item.request?.title === createdA.request.title)).toBeFalsy();

    const userBSelectsAWorkspace = await request.get(`${baseURL}/v1/activity/history?workspaceId=${encodeURIComponent(userA.workspaceId)}`, { headers: authHeaders(userB, userA.workspaceId) });
    await expectError(userBSelectsAWorkspace, 403, 'User B selecting User A workspace');

    const mobileBRespondsToA = await request.post(`${baseURL}/v1/requests/${createdA.request.id}/responses`, {
      headers: bearerHeaders(mobileB.token),
      data: { choiceId: 'approve', message: 'cross-account response should fail' }
    });
    await expectError(mobileBRespondsToA, 404, 'User B mobile responding to User A request');

    const mobileARespondsToB = await request.post(`${baseURL}/v1/requests/${createdB.request.id}/responses`, {
      headers: bearerHeaders(mobileA.token),
      data: { choiceId: 'approve', message: 'cross-account response should fail' }
    });
    await expectError(mobileARespondsToB, 404, 'User A mobile responding to User B request');

    const userBCreatesTokenInAWorkspace = await request.post(`${baseURL}/v1/agent-tokens`, {
      headers: authHeaders(userB, userA.workspaceId),
      data: { label: `Docker AuthZ forbidden token ${stamp}`, workspaceId: userA.workspaceId }
    });
    await expectError(userBCreatesTokenInAWorkspace, 403, 'User B creating Agent Token in User A workspace');

    const userBCreatesTokenForAWorkspaceWithoutSelecting = await request.post(`${baseURL}/v1/agent-tokens`, {
      headers: authHeaders(userB),
      data: { label: `Docker AuthZ mismatched token ${stamp}`, workspaceId: userA.workspaceId }
    });
    await expectError(userBCreatesTokenForAWorkspaceWithoutSelecting, 403, 'User B creating Agent Token with mismatched workspace');

    const finalAResponse = await request.get(`${baseURL}/v1/requests/${createdA.request.id}`, { headers: authHeaders(userA) });
    await expectOk(finalAResponse, 'User A GET own request after denied attempts');
    const finalA = await finalAResponse.json() as { status: string; responses?: unknown[]; response?: unknown };
    expect(finalA.status).toBe('pending');
    expect(finalA.response).toBeFalsy();
    expect(finalA.responses ?? []).toHaveLength(0);

    const finalBResponse = await request.get(`${baseURL}/v1/requests/${createdB.request.id}`, { headers: authHeaders(userB) });
    await expectOk(finalBResponse, 'User B GET own request after denied attempts');
    const finalB = await finalBResponse.json() as { status: string; responses?: unknown[]; response?: unknown };
    expect(finalB.status).toBe('pending');
    expect(finalB.response).toBeFalsy();
    expect(finalB.responses ?? []).toHaveLength(0);
  });
});
