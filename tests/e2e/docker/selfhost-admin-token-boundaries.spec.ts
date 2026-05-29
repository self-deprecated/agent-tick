import { expect, test } from '@playwright/test';
import {
  adminHeaders,
  adminToken,
  bearerHeaders,
  createAgentToken,
  createSanctionRequest,
  createSpoofedDevice,
  expectError,
  expectOk,
  listAgentTokens,
  sanctionRequestPayload,
  waitForHealthAndReady
} from './support/selfhost';

test.describe('Docker self-host admin token boundaries', () => {
  test('protects admin routes and keeps non-admin token classes out', async ({ request, baseURL }) => {
    const stamp = Date.now();
    const before = await listAgentTokens(request, baseURL);

    await expectError(await request.get(`${baseURL}/v1/agent-tokens`), 401, 'list Agent Tokens without admin token');
    await expectError(await request.post(`${baseURL}/v1/agent-tokens`, { headers: bearerHeaders('adm_wrong'), data: { label: `wrong ${stamp}` } }), 401, 'create Agent Token with wrong admin token');

    const agent = await createAgentToken(request, baseURL, `Docker admin-boundary agent ${stamp}`);
    const device = await createSpoofedDevice(request, baseURL, `Docker admin-boundary phone ${stamp}`);
    const created = await createSanctionRequest(request, baseURL, agent.token, `Docker admin-boundary request ${stamp}`);

    await expectError(await request.get(`${baseURL}/v1/agent-tokens`, { headers: bearerHeaders(agent.token) }), 403, 'Agent Token listing admin tokens');
    await expectError(await request.post(`${baseURL}/v1/agent-tokens`, { headers: bearerHeaders(device.token), data: { label: `device ${stamp}` } }), 403, 'Device Token creating Agent Token');
    await expectError(await request.post(`${baseURL}/v1/pairing-tokens`, { headers: bearerHeaders(device.token) }), 403, 'Device Token creating pairing token');

    const adminWait = await request.get(`${baseURL}/v1/requests/${created.request.id}/wait?timeoutMs=1`, { headers: adminHeaders() });
    await expectOk(adminWait, 'admin human wait is current single-mode policy');
    await expectError(await request.post(`${baseURL}/v1/requests/${created.request.id}/waiter/stop`, { headers: adminHeaders(), data: { reason: 'agent_cancelled' } }), 401, 'admin token on waiter stop endpoint');
    await expectError(await request.post(`${baseURL}/v1/requests/${created.request.id}/waiter/error`, { headers: adminHeaders(), data: { code: 'admin.not_waiter' } }), 401, 'admin token on waiter error endpoint');

    const adminCreatesRequest = await request.post(`${baseURL}/v1/requests`, {
      headers: bearerHeaders(adminToken()),
      data: sanctionRequestPayload(`Docker admin-human request ${stamp}`)
    });
    await expectOk(adminCreatesRequest, 'admin token creating human Request is current single-mode policy');

    const after = await listAgentTokens(request, baseURL);
    expect(after.length).toBe(before.length + 1);
    expect(after.some((token) => token.agentTokenId === agent.agentTokenId)).toBeTruthy();
    await waitForHealthAndReady(baseURL);
  });
});
