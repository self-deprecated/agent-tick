import { expect, test } from '@playwright/test';
import {
  bearerHeaders,
  createAgentToken,
  createSanctionRequest,
  createSpoofedDevice,
  getRequest,
  restartDockerService,
  waitForHealthAndReady,
  waitForReady,
  waitForRequest
} from './support/selfhost';

test.describe('Docker self-host Request expiration', () => {
  test('expires pending requests across read, respond, wait, and restart flows', async ({ request, baseURL }) => {
    const stamp = Date.now();
    const agent = await createAgentToken(request, baseURL, `Docker expiration agent ${stamp}`);
    const device = await createSpoofedDevice(request, baseURL, `Docker expiration phone ${stamp}`);
    const deadline = new Date(Date.now() + 800).toISOString();

    const created = await createSanctionRequest(request, baseURL, agent.token, `Docker expiration request ${stamp}`, { deadline });
    expect(created.request.status).toBe('pending');
    expect(created.waiter?.token).toMatch(/^wait_/);

    await expect.poll(async () => (await getRequest(request, baseURL, created.request.id)).status, { timeout: 10_000 }).toBe('expired');
    const expired = await getRequest(request, baseURL, created.request.id);
    expect(expired.response?.message).toBe('expired');

    const late = await request.post(`${baseURL}/v1/requests/${created.request.id}/responses`, {
      headers: bearerHeaders(device.token),
      data: { choiceId: 'approve', message: 'too late' }
    });
    expect(late.ok()).toBeTruthy();
    const lateBody = await late.json() as { status: string; response?: { choiceId?: string; message?: string } };
    expect(lateBody.status).toBe('expired');
    expect(lateBody.response?.choiceId).toBeFalsy();

    const waiter = await waitForRequest(request, baseURL, created.request.id, created.waiter!.token);
    expect(waiter.terminal).toBe(true);
    expect(waiter.request.status).toBe('expired');

    await restartDockerService();
    await waitForReady(baseURL);
    expect((await getRequest(request, baseURL, created.request.id)).status).toBe('expired');
    await waitForHealthAndReady(baseURL);
  });
});
