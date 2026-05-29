import { expect, test } from '@playwright/test';
import {
  activityHistory,
  createAgentToken,
  createSanctionRequest,
  createSpoofedDevice,
  createStatusUpdate,
  expectOk,
  getAuthConfig,
  pendingCount,
  respondToRequest,
  waitForRequest
} from './support/selfhost';

test.describe('Docker self-host single mode', () => {
  test('runs the agent, spoofed device, and request response lifecycle', async ({ request, baseURL }) => {
    const health = await request.get(`${baseURL}/healthz`);
    await expectOk(health, 'GET /healthz');
    const ready = await request.get(`${baseURL}/readyz`);
    await expectOk(ready, 'GET /readyz');

    const config = await getAuthConfig(request, baseURL);
    expect(config).toMatchObject({ mode: 'single', authProvider: 'local' });

    const stamp = Date.now();
    const sessionId = `docker-selfhost-${stamp}`;
    const initialPending = await pendingCount(request, baseURL);

    const agentToken = await createAgentToken(request, baseURL, `Docker self-host E2E ${stamp}`);
    expect(agentToken.token).toMatch(/^agent_/);
    expect(agentToken.workspaceId).toBeTruthy();

    const device = await createSpoofedDevice(request, baseURL, `Docker E2E Phone ${stamp}`, 'ios');
    expect(device.deviceId).toBeTruthy();
    expect(device.token).toMatch(/^device_/);

    const statusUpdate = await createStatusUpdate(request, baseURL, agentToken.token, `Docker E2E status ${stamp}`, { sessionId });
    expect(statusUpdate.statusId).toBeTruthy();
    expect(statusUpdate.message).toContain(String(stamp));

    const created = await createSanctionRequest(request, baseURL, agentToken.token, `Docker E2E sanction ${stamp}`, { sessionId });
    expect(created.request.status).toBe('pending');
    expect(created.waiter?.token).toMatch(/^wait_/);

    await expect.poll(async () => await pendingCount(request, baseURL)).toBeGreaterThanOrEqual(initialPending + 1);
    let history = await activityHistory(request, baseURL);
    expect(history.some((item) => item.kind === 'status_update' && item.statusUpdate?.message === statusUpdate.message)).toBeTruthy();
    expect(history.some((item) => item.kind === 'request' && item.request?.id === created.request.id && item.request.status === 'pending')).toBeTruthy();

    const responded = await respondToRequest(request, baseURL, device.token, created.request.id, 'approve');
    expect(responded.status).toBe('responded');
    expect(responded.response?.choiceId).toBe('approve');

    const terminal = await waitForRequest(request, baseURL, created.request.id, created.waiter!.token);
    expect(terminal.terminal).toBe(true);
    expect(terminal.request.status).toBe('responded');
    expect(terminal.request.response?.choiceId).toBe('approve');

    await expect.poll(async () => await pendingCount(request, baseURL)).toBe(initialPending);
    history = await activityHistory(request, baseURL);
    const finalRequest = history.find((item) => item.kind === 'request' && item.request?.id === created.request.id)?.request;
    expect(finalRequest?.status).toBe('responded');
  });
});
