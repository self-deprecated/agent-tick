import { expect, test } from '@playwright/test';
import {
  adminHeaders,
  bearerHeaders,
  createAgentToken,
  createSanctionRequest,
  createSpoofedDevice,
  expectError,
  expectOk,
  getRequest,
  respondToRequest,
  waitForHealthAndReady,
  waitForRequest
} from './support/selfhost';

test.describe('Docker self-host waiter token lifecycle', () => {
  test('scopes waiter tokens to their request and protects waiter-only endpoints', async ({ request, baseURL }) => {
    const stamp = Date.now();
    const agent = await createAgentToken(request, baseURL, `Docker waiter agent ${stamp}`);
    const device = await createSpoofedDevice(request, baseURL, `Docker waiter phone ${stamp}`);

    const first = await createSanctionRequest(request, baseURL, agent.token, `Docker waiter first ${stamp}`);
    const second = await createSanctionRequest(request, baseURL, agent.token, `Docker waiter second ${stamp}`);
    expect(first.waiter?.token).toMatch(/^wait_/);
    expect(second.waiter?.token).toMatch(/^wait_/);

    await expectError(await request.get(`${baseURL}/v1/requests/${first.request.id}/wait?timeoutMs=1`), 401, 'missing waiter token');
    await expectError(await request.get(`${baseURL}/v1/requests/${first.request.id}/wait?timeoutMs=1`, { headers: bearerHeaders('wait_fake') }), 401, 'fake waiter token');
    await expectError(await request.get(`${baseURL}/v1/requests/${second.request.id}/wait?timeoutMs=1`, { headers: bearerHeaders(first.waiter!.token) }), 401, 'wrong waiter token for request');
    await expectError(await request.post(`${baseURL}/v1/requests/${first.request.id}/waiter/stop`, { headers: adminHeaders(), data: { reason: 'agent_cancelled' } }), 401, 'admin on waiter stop');
    await expectError(await request.post(`${baseURL}/v1/requests/${first.request.id}/waiter/stop`, { headers: bearerHeaders(agent.token), data: { reason: 'agent_cancelled' } }), 401, 'agent on waiter stop');
    await expectError(await request.post(`${baseURL}/v1/requests/${second.request.id}/waiter/error`, { headers: bearerHeaders(first.waiter!.token), data: { code: 'wrong_request' } }), 401, 'wrong waiter token for error');

    const stop = await request.post(`${baseURL}/v1/requests/${first.request.id}/waiter/stop`, {
      headers: bearerHeaders(first.waiter!.token),
      data: { reason: 'agent_cancelled' }
    });
    await expectOk(stop, 'valid waiter stop');
    expect((await stop.json() as { id: string; status: string }).status).toBe('pending');

    const error = await request.post(`${baseURL}/v1/requests/${second.request.id}/waiter/error`, {
      headers: bearerHeaders(second.waiter!.token),
      data: { code: 'agent.crashed', message: 'simulated waiter error' }
    });
    await expectOk(error, 'valid waiter error');
    expect((await error.json() as { id: string; status: string }).status).toBe('pending');

    const beforeResponse = await getRequest(request, baseURL, first.request.id);
    expect(beforeResponse.status).toBe('pending');
    expect(beforeResponse.response).toBeFalsy();

    await respondToRequest(request, baseURL, device.token, first.request.id, 'approve');
    const terminal = await waitForRequest(request, baseURL, first.request.id, first.waiter!.token);
    expect(terminal).toMatchObject({ terminal: true, request: { status: 'responded' } });

    await waitForHealthAndReady(baseURL);
  });
});
