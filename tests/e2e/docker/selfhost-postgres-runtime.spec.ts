import { expect, test } from '@playwright/test';
import {
  activityHistory,
  createAgentToken,
  createSanctionRequest,
  createSpoofedDevice,
  createStatusUpdate,
  expectOk,
  getAuthConfig,
  getRequest,
  listAgentTokens,
  listDevices,
  listStatusUpdates,
  pendingCount,
  respondToRequest,
  restartDockerService,
  waitForReady,
  waitForRequest
} from './support/selfhost';

test.describe('Docker self-host PostgreSQL runtime mode', () => {
  test('runs the single-mode lifecycle against PostgreSQL and persists across a server restart', async ({ request, baseURL }) => {
    const health = await request.get(`${baseURL}/healthz`);
    await expectOk(health, 'GET /healthz');

    const ready = await request.get(`${baseURL}/readyz`);
    await expectOk(ready, 'GET /readyz');
    expect(await ready.json()).toMatchObject({ dependencies: { database: 'ok' } });

    const config = await getAuthConfig(request, baseURL);
    expect(config).toMatchObject({ mode: 'single', authProvider: 'local' });

    const stamp = Date.now();
    const sessionId = `docker-postgres-${stamp}`;
    const tokenLabel = `Docker PostgreSQL token ${stamp}`;
    const deviceName = `Docker PostgreSQL phone ${stamp}`;
    const statusMessage = `Docker PostgreSQL status ${stamp}`;
    const requestTitle = `Docker PostgreSQL request ${stamp}`;
    const initialPending = await pendingCount(request, baseURL);

    const agentToken = await createAgentToken(request, baseURL, tokenLabel);
    expect(agentToken.token).toMatch(/^agent_/);

    const device = await createSpoofedDevice(request, baseURL, deviceName, 'android');
    expect(device.token).toMatch(/^device_/);

    const status = await createStatusUpdate(request, baseURL, agentToken.token, statusMessage, { sessionId });
    expect(status.statusId).toBeTruthy();

    const created = await createSanctionRequest(request, baseURL, agentToken.token, requestTitle, { sessionId });
    expect(created.request.status).toBe('pending');
    expect(created.waiter?.token).toMatch(/^wait_/);

    await expect.poll(async () => await pendingCount(request, baseURL)).toBeGreaterThanOrEqual(initialPending + 1);

    const responded = await respondToRequest(request, baseURL, device.token, created.request.id, 'approve');
    expect(responded.status).toBe('responded');
    expect(responded.response?.choiceId).toBe('approve');

    const terminal = await waitForRequest(request, baseURL, created.request.id, created.waiter!.token);
    expect(terminal.terminal).toBe(true);
    expect(terminal.request.status).toBe('responded');
    expect(terminal.request.response?.choiceId).toBe('approve');

    await restartDockerService();
    await waitForReady(baseURL);

    const tokens = await listAgentTokens(request, baseURL);
    expect(tokens.some((token) => token.agentTokenId === agentToken.agentTokenId && token.label === tokenLabel && !token.revokedAt)).toBeTruthy();

    const devices = await listDevices(request, baseURL);
    expect(devices.some((item) => item.deviceId === device.deviceId && item.name === deviceName)).toBeTruthy();

    const statuses = await listStatusUpdates(request, baseURL, 100);
    expect(statuses.some((item) => item.statusId === status.statusId && item.message === statusMessage)).toBeTruthy();

    const persistedRequest = await getRequest(request, baseURL, created.request.id);
    expect(persistedRequest.title).toBe(requestTitle);
    expect(persistedRequest.status).toBe('responded');
    expect(persistedRequest.response?.choiceId).toBe('approve');

    const history = await activityHistory(request, baseURL, 100);
    expect(history.some((item) => item.kind === 'status_update' && item.statusUpdate?.statusId === status.statusId)).toBeTruthy();
    expect(history.some((item) => item.kind === 'request' && item.request?.id === created.request.id && item.request.status === 'responded')).toBeTruthy();
    await expect.poll(async () => await pendingCount(request, baseURL)).toBe(initialPending);
  });
});
