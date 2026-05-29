import { expect, test } from '@playwright/test';
import {
  adminHeaders,
  bearerHeaders,
  createAgentToken,
  createSanctionRequest,
  expectError,
  expectOk,
  restartDockerService,
  sanctionRequestPayload,
  waitForReady
} from './support/selfhost';

test.describe('Docker self-host Redis runtime mode', () => {
  test('reports Redis readiness, publishes events, and retains rate limits across server restart', async ({ request, baseURL }) => {
    const ready = await request.get(`${baseURL}/readyz`);
    await expectOk(ready, 'GET /readyz');
    expect(await ready.json()).toMatchObject({ dependencies: { database: 'ok', redis: 'ok' } });

    const stamp = Date.now();
    const agentA = await createAgentToken(request, baseURL, `Docker redis agent A ${stamp}`);
    const agentB = await createAgentToken(request, baseURL, `Docker redis agent B ${stamp}`);

    const pollPromise = request.get(`${baseURL}/v1/events/poll?timeoutMs=5000`, { headers: adminHeaders() });
    const first = await createSanctionRequest(request, baseURL, agentA.token, `Docker redis event first ${stamp}`);
    const polled = await pollPromise;
    await expectOk(polled, 'Redis-backed event poll');
    const pollBody = await polled.json() as { events: Array<{ type: string; targetId: string }> };
    expect(pollBody.events.some((event) => event.targetId === first.request.id)).toBeTruthy();

    await createSanctionRequest(request, baseURL, agentA.token, `Docker redis rate second ${stamp}`);
    await restartDockerService();
    await waitForReady(baseURL);
    const limited = await request.post(`${baseURL}/v1/requests`, {
      headers: bearerHeaders(agentA.token),
      data: sanctionRequestPayload(`Docker redis rate limited ${stamp}`)
    });
    await expectError(limited, 429, 'Redis-backed rate limit after restart');

    const unaffected = await createSanctionRequest(request, baseURL, agentB.token, `Docker redis agent B unaffected ${stamp}`);
    expect(unaffected.request.status).toBe('pending');
  });
});
