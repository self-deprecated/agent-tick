import { expect, test } from '@playwright/test';
import {
  bearerHeaders,
  createAgentToken,
  createSanctionRequest,
  createSpoofedDevice,
  getRequest,
  waitForHealthAndReady
} from './support/selfhost';

test.describe('Docker self-host concurrent response idempotency', () => {
  test('deduplicates racing responses from the same responder', async ({ request, baseURL }) => {
    const stamp = Date.now();
    const agent = await createAgentToken(request, baseURL, `Docker concurrency agent ${stamp}`);
    const device = await createSpoofedDevice(request, baseURL, `Docker concurrency phone ${stamp}`);
    const created = await createSanctionRequest(request, baseURL, agent.token, `Docker concurrency request ${stamp}`);

    const attempts = await Promise.all(Array.from({ length: 6 }, async (_value, index) => {
      return request.post(`${baseURL}/v1/requests/${created.request.id}/responses`, {
        headers: bearerHeaders(device.token),
        data: { choiceId: 'approve', message: `concurrent approve ${index}` }
      });
    }));
    for (const response of attempts) expect(response.ok(), `response status ${response.status()}: ${await response.text().catch(() => '')}`).toBeTruthy();

    const final = await getRequest(request, baseURL, created.request.id);
    expect(final.status).toBe('responded');
    expect(final.response?.choiceId).toBe('approve');
    expect(final.responses ?? []).toHaveLength(1);
    expect((final.responses ?? []).filter((response) => response.final)).toHaveLength(1);

    const late = await request.post(`${baseURL}/v1/requests/${created.request.id}/responses`, {
      headers: bearerHeaders(device.token),
      data: { choiceId: 'deny', message: 'late mutation should not win' }
    });
    expect(late.ok()).toBeTruthy();
    const afterLate = await getRequest(request, baseURL, created.request.id);
    expect(afterLate.response?.choiceId).toBe('approve');
    expect(afterLate.responses ?? []).toHaveLength(1);
    await waitForHealthAndReady(baseURL);
  });
});
