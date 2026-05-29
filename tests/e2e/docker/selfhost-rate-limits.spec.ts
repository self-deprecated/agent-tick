import { expect, test } from '@playwright/test';
import {
  activityHistory,
  bearerHeaders,
  createAgentToken,
  createSanctionRequest,
  expectError,
  expectOk,
  getAuthConfig
} from './support/selfhost';

function requestPayload(title: string) {
  return {
    requester: { name: 'Docker rate-limit E2E agent' },
    requestType: 'sanction',
    title,
    body: 'Created by Docker rate-limit E2E coverage.',
    command: 'echo docker-rate-limit-e2e',
    choices: [
      { id: 'approve', label: 'Approve', kind: 'approve' },
      { id: 'deny', label: 'Deny', kind: 'deny' }
    ]
  };
}

test.describe('Docker self-host rate limits', () => {
  test('limits request floods per bearer credential while preserving container health', async ({ request, baseURL }) => {
    const config = await getAuthConfig(request, baseURL);
    expect(config).toMatchObject({ mode: 'single', authProvider: 'local' });

    const stamp = Date.now();
    const agentA = await createAgentToken(request, baseURL, `Docker rate-limit agent A ${stamp}`);
    const agentB = await createAgentToken(request, baseURL, `Docker rate-limit agent B ${stamp}`);

    const firstA = await createSanctionRequest(request, baseURL, agentA.token, `Docker rate-limit A first ${stamp}`);
    const secondA = await createSanctionRequest(request, baseURL, agentA.token, `Docker rate-limit A second ${stamp}`);
    expect(firstA.request.status).toBe('pending');
    expect(secondA.request.status).toBe('pending');

    const rejectedTitle = `Docker rate-limit A rejected ${stamp}`;
    const limited = await request.post(`${baseURL}/v1/requests`, {
      headers: bearerHeaders(agentA.token),
      data: requestPayload(rejectedTitle)
    });
    const limitedBody = await expectError(limited, 429, 'Agent A request flood');
    expect(limitedBody.error?.code).toBe('rate_limited');
    const retryAfter = limited.headers()['retry-after'];
    expect(retryAfter).toBeTruthy();
    expect(Number(retryAfter)).toBeGreaterThanOrEqual(1);

    const bRequest = await createSanctionRequest(request, baseURL, agentB.token, `Docker rate-limit B unaffected ${stamp}`);
    expect(bRequest.request.status).toBe('pending');
    expect(bRequest.request.workspaceId).toBe(agentB.workspaceId);

    const history = await activityHistory(request, baseURL, 200);
    expect(history.some((item) => item.kind === 'request' && item.request?.id === firstA.request.id)).toBeTruthy();
    expect(history.some((item) => item.kind === 'request' && item.request?.id === secondA.request.id)).toBeTruthy();
    expect(history.some((item) => item.kind === 'request' && item.request?.id === bRequest.request.id)).toBeTruthy();
    expect(history.some((item) => item.kind === 'request' && item.request?.title === rejectedTitle)).toBeFalsy();

    const health = await request.get(`${baseURL}/healthz`);
    await expectOk(health, 'GET /healthz after rate limit');
    const ready = await request.get(`${baseURL}/readyz`);
    await expectOk(ready, 'GET /readyz after rate limit');
  });
});
