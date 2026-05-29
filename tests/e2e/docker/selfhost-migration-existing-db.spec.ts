import { expect, test } from '@playwright/test';
import {
  activityHistory,
  createAgentToken,
  createSanctionRequest,
  createSpoofedDevice,
  getRequest,
  restartDockerService,
  waitForHealthAndReady,
  waitForReady
} from './support/selfhost';

test.describe('Docker self-host existing SQLite migration', () => {
  test('starts with migrate-on-start against retained SQLite data and reads/writes after restart', async ({ request, baseURL }) => {
    const stamp = Date.now();
    const agent = await createAgentToken(request, baseURL, `Docker migration agent ${stamp}`);
    const device = await createSpoofedDevice(request, baseURL, `Docker migration phone ${stamp}`);
    const created = await createSanctionRequest(request, baseURL, agent.token, `Docker migration retained request ${stamp}`);
    expect(created.request.status).toBe('pending');
    expect(device.deviceId).toBeTruthy();

    await restartDockerService();
    await waitForReady(baseURL);

    const afterRestart = await getRequest(request, baseURL, created.request.id);
    expect(afterRestart.title).toBe(created.request.title);
    expect(afterRestart.status).toBe('pending');

    const second = await createSanctionRequest(request, baseURL, agent.token, `Docker migration post-restart request ${stamp}`);
    expect(second.request.status).toBe('pending');
    const history = await activityHistory(request, baseURL, 200);
    expect(history.some((item) => item.kind === 'request' && item.request?.id === created.request.id)).toBeTruthy();
    expect(history.some((item) => item.kind === 'request' && item.request?.id === second.request.id)).toBeTruthy();
    await waitForHealthAndReady(baseURL);
  });
});
