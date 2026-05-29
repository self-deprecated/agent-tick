import { expect, test } from '@playwright/test';
import {
  activityHistory,
  createAgentToken,
  createSanctionRequest,
  createSpoofedDevice,
  createStatusUpdate,
  getRequest,
  listAgentTokens,
  listDevices,
  listStatusUpdates,
  respondToRequest,
  restartDockerService,
  waitForReady
} from './support/selfhost';

test.describe('Docker self-host SQLite persistence', () => {
  test('persists API data across a Docker service restart', async ({ request, baseURL }) => {
    const stamp = Date.now();
    const tokenLabel = `Docker persistence token ${stamp}`;
    const deviceName = `Docker persistence phone ${stamp}`;
    const statusMessage = `Docker persistence status ${stamp}`;
    const requestTitle = `Docker persistence request ${stamp}`;
    const sessionId = `docker-persistence-${stamp}`;

    const agentToken = await createAgentToken(request, baseURL, tokenLabel);
    const device = await createSpoofedDevice(request, baseURL, deviceName, 'android');
    const status = await createStatusUpdate(request, baseURL, agentToken.token, statusMessage, { sessionId });
    const created = await createSanctionRequest(request, baseURL, agentToken.token, requestTitle, { sessionId });
    const responded = await respondToRequest(request, baseURL, device.token, created.request.id, 'approve');
    expect(responded.status).toBe('responded');

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
  });
});
