import { expect, test } from '@playwright/test';
import { authHeaders } from '../support/auth';
import { createAgentToken, createRequest } from '../support/fixtures';
import {
  bearerHeaders,
  createMobileSession,
  createTestUser,
  expectOk,
  registerMobileDevice,
  subscribePersonalBilling,
  waitForHealthAndReady
} from './support/selfhost';

test.describe('Docker self-host retention cleanup', () => {
  test('removes backdated retained data while keeping fresh data', async ({ request, baseURL }) => {
    const stamp = Date.now();
    const user = await createTestUser(request, baseURL, { subject: `docker_retention_${stamp}` });
    await subscribePersonalBilling(request, baseURL, user);
    const mobile = await createMobileSession(request, baseURL, user);
    const oldDevice = await registerMobileDevice(request, baseURL, mobile.token, `Docker retention old phone ${stamp}`);
    const freshDevice = await registerMobileDevice(request, baseURL, mobile.token, `Docker retention fresh phone ${stamp}`);
    const agent = await createAgentToken(request, baseURL, user, `Docker retention agent ${stamp}`);

    const oldStatusResponse = await request.post(`${baseURL}/v1/status-updates`, {
      headers: bearerHeaders(agent.token),
      data: { message: `Docker retention old status ${stamp}`, state: 'working', clientName: 'docker-retention-e2e' }
    });
    await expectOk(oldStatusResponse, 'old status update');
    const oldStatus = await oldStatusResponse.json() as { statusId: string };
    const oldRequest = await createRequest(request, baseURL, agent.token, `Docker retention old request ${stamp}`);

    const freshStatusResponse = await request.post(`${baseURL}/v1/status-updates`, {
      headers: bearerHeaders(agent.token),
      data: { message: `Docker retention fresh status ${stamp}`, state: 'working', clientName: 'docker-retention-e2e' }
    });
    await expectOk(freshStatusResponse, 'fresh status update');
    const freshStatus = await freshStatusResponse.json() as { statusId: string };
    const freshRequest = await createRequest(request, baseURL, agent.token, `Docker retention fresh request ${stamp}`);

    const backdate = await request.post(`${baseURL}/__test/backdate-state`, {
      data: {
        iso: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
        requestIds: [oldRequest.request.id],
        statusIds: [oldStatus.statusId],
        deviceIds: [oldDevice.deviceId]
      }
    });
    await expectOk(backdate, 'backdate old state');

    const cleanup = await request.post(`${baseURL}/__test/retention-cleanup`);
    await expectOk(cleanup, 'manual retention cleanup');
    const cleanupBody = await cleanup.json() as { retention: { requests: number; statusUpdates: number; devices: number; auditEvents: number } };
    expect(cleanupBody.retention.requests).toBeGreaterThanOrEqual(1);
    expect(cleanupBody.retention.statusUpdates).toBeGreaterThanOrEqual(1);
    expect(cleanupBody.retention.devices).toBeGreaterThanOrEqual(1);

    const requestsResponse = await request.get(`${baseURL}/v1/requests`, { headers: authHeaders(user) });
    await expectOk(requestsResponse, 'list requests after retention cleanup');
    const visibleRequests = await requestsResponse.json() as Array<{ id: string; title: string }>;
    expect(visibleRequests.some((item) => item.id === oldRequest.request.id)).toBeFalsy();
    expect(visibleRequests.some((item) => item.id === freshRequest.request.id)).toBeTruthy();

    const statusResponse = await request.get(`${baseURL}/v1/status-updates?limit=100`, { headers: authHeaders(user) });
    await expectOk(statusResponse, 'list status after retention cleanup');
    const statuses = await statusResponse.json() as Array<{ statusId: string; message: string }>;
    expect(statuses.some((item) => item.statusId === oldStatus.statusId)).toBeFalsy();
    expect(statuses.some((item) => item.statusId === freshStatus.statusId)).toBeTruthy();

    const state = await (await request.get(`${baseURL}/__test/state`)).json() as { approvalDevices: Array<{ device_id: string }>; requests: Array<{ id: string }>; statusUpdates: Array<{ status_id: string }> };
    expect(state.approvalDevices.some((device) => device.device_id === oldDevice.deviceId)).toBeFalsy();
    expect(state.approvalDevices.some((device) => device.device_id === freshDevice.deviceId)).toBeTruthy();
    expect(state.requests.some((item) => item.id === oldRequest.request.id)).toBeFalsy();
    expect(state.statusUpdates.some((item) => item.status_id === oldStatus.statusId)).toBeFalsy();

    await waitForHealthAndReady(baseURL);
  });
});
