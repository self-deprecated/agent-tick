import { expect, test } from '@playwright/test';
import { authHeaders, type TestUserSession } from '../support/auth';
import { createAgentToken, createRequest } from '../support/fixtures';
import { bearerHeaders, expectOk, getAuthConfig } from './support/selfhost';

test.describe('Docker self-host Clerk test-auth mode', () => {
  test('runs deterministic user, mobile session, agent token, request, and mobile response flow', async ({ request, baseURL }) => {
    const config = await getAuthConfig(request, baseURL);
    expect(config).toMatchObject({ mode: 'clerk', authProvider: 'clerk', testAuth: true });

    const stamp = Date.now();
    const subject = `docker_clerk_${stamp}`;
    const email = `${subject}@example.test`;
    const userResponse = await request.post(`${baseURL}/__test/users`, {
      data: { subject, email, name: 'Docker Clerk User' }
    });
    await expectOk(userResponse, 'POST /__test/users');
    const session = await userResponse.json() as Omit<TestUserSession, 'subject' | 'email' | 'name'>;
    const user: TestUserSession = { ...session, subject, email, name: 'Docker Clerk User' };
    expect(user.token).toMatch(/^test_/);
    expect(user.role).toBe('owner');

    const mobileSessionResponse = await request.post(`${baseURL}/v1/auth/mobile-session`, {
      data: { clerkToken: user.token }
    });
    await expectOk(mobileSessionResponse, 'POST /v1/auth/mobile-session');
    const mobileSession = await mobileSessionResponse.json() as { token: string; userId: string; workspaceId: string; role: string };
    expect(mobileSession.token.split('.')).toHaveLength(3);
    expect(mobileSession.userId).toBe(user.userId);
    expect(mobileSession.workspaceId).toBe(user.workspaceId);

    const billingResponse = await request.post(`${baseURL}/v1/billing/personal`, {
      headers: authHeaders(user),
      data: { event: 'subscribe_monthly' }
    });
    await expectOk(billingResponse, 'POST /v1/billing/personal');

    const deviceResponse = await request.post(`${baseURL}/v1/devices/register`, {
      headers: bearerHeaders(mobileSession.token),
      data: { deviceName: `Docker Clerk Phone ${stamp}`, platform: 'ios', installationId: `docker-clerk-${stamp}` }
    });
    await expectOk(deviceResponse, 'POST /v1/devices/register');
    const device = await deviceResponse.json() as { deviceId: string };
    expect(device.deviceId).toBeTruthy();

    const agent = await createAgentToken(request, baseURL, user, `Docker Clerk Agent ${stamp}`);
    expect(agent.token).toMatch(/^agent_/);

    const statusResponse = await request.post(`${baseURL}/v1/status-updates`, {
      headers: { authorization: `Bearer ${agent.token}` },
      data: { message: `Docker Clerk status ${stamp}`, state: 'working', clientName: 'docker-selfhost-e2e' }
    });
    await expectOk(statusResponse, 'POST /v1/status-updates');

    const created = await createRequest(request, baseURL, agent.token, `Docker Clerk Request ${stamp}`);
    expect(created.request.status).toBe('pending');

    let pending = await (await request.get(`${baseURL}/v1/activity/pending-count`, { headers: authHeaders(user) })).json() as { pendingRequests: number };
    expect(pending.pendingRequests).toBeGreaterThanOrEqual(1);

    const response = await request.post(`${baseURL}/v1/requests/${created.request.id}/responses`, {
      headers: bearerHeaders(mobileSession.token),
      data: { choiceId: 'approve', message: 'Approved from Docker Clerk mobile session' }
    });
    await expectOk(response, `POST /v1/requests/${created.request.id}/responses`);
    const responded = await response.json() as { status: string; response?: { choiceId?: string } };
    expect(responded.status).toBe('responded');
    expect(responded.response?.choiceId).toBe('approve');

    pending = await (await request.get(`${baseURL}/v1/activity/pending-count`, { headers: authHeaders(user) })).json() as { pendingRequests: number };
    expect(pending.pendingRequests).toBe(0);
  });
});
