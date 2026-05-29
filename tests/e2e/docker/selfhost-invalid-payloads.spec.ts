import { expect, test } from '@playwright/test';
import {
  activityHistory,
  bearerHeaders,
  createAgentToken,
  createSanctionRequest,
  createSpoofedDevice,
  expectError,
  expectOk,
  getAuthConfig,
  getRequest
} from './support/selfhost';

function validRequestPayload(title: string) {
  return {
    requester: { name: 'Docker invalid payload E2E agent' },
    requestType: 'sanction',
    title,
    body: 'Valid baseline body',
    choices: [
      { id: 'approve', label: 'Approve', kind: 'approve' },
      { id: 'deny', label: 'Deny', kind: 'deny' }
    ]
  };
}

test.describe('Docker self-host invalid payloads', () => {
  test('rejects corrupted requests and auth without partial state', async ({ request, baseURL }) => {
    const config = await getAuthConfig(request, baseURL);
    expect(config).toMatchObject({ mode: 'single', authProvider: 'local' });

    const stamp = Date.now();
    const agent = await createAgentToken(request, baseURL, `Docker invalid payload agent ${stamp}`);
    const device = await createSpoofedDevice(request, baseURL, `Docker invalid payload phone ${stamp}`, 'ios');

    const initialHistory = await activityHistory(request, baseURL, 200);

    const missingRequester = await request.post(`${baseURL}/v1/requests`, {
      headers: bearerHeaders(agent.token),
      data: { requestType: 'sanction', title: `Docker invalid missing requester ${stamp}` }
    });
    await expectError(missingRequester, 400, 'missing requester request');

    const missingTitle = await request.post(`${baseURL}/v1/requests`, {
      headers: bearerHeaders(agent.token),
      data: { requester: { name: 'Docker invalid payload E2E agent' }, requestType: 'sanction' }
    });
    await expectError(missingTitle, 400, 'missing title request');

    const emptyRequestType = await request.post(`${baseURL}/v1/requests`, {
      headers: bearerHeaders(agent.token),
      data: { ...validRequestPayload(`Docker invalid empty request type ${stamp}`), requestType: '' }
    });
    await expectError(emptyRequestType, 400, 'empty requestType request');

    const choicesWithoutDeny = await request.post(`${baseURL}/v1/requests`, {
      headers: bearerHeaders(agent.token),
      data: {
        ...validRequestPayload(`Docker invalid no deny choice ${stamp}`),
        choices: [{ id: 'approve', label: 'Approve', kind: 'approve' }]
      }
    });
    await expectError(choicesWithoutDeny, 400, 'request choices without deny');

    const malformedChoice = await request.post(`${baseURL}/v1/requests`, {
      headers: bearerHeaders(agent.token),
      data: {
        ...validRequestPayload(`Docker invalid malformed choice ${stamp}`),
        choices: [{ id: 'approve', kind: 'approve' }, { id: 'deny', label: 'Deny', kind: 'deny' }]
      }
    });
    await expectError(malformedChoice, 400, 'request malformed choice');

    const malformedJson = await request.post(`${baseURL}/v1/requests`, {
      headers: { ...bearerHeaders(agent.token), 'content-type': 'application/json' },
      data: '{"requester":'
    });
    await expectError(malformedJson, 400, 'malformed JSON request');

    const wrongContentType = await request.post(`${baseURL}/v1/requests`, {
      headers: { ...bearerHeaders(agent.token), 'content-type': 'text/plain' },
      data: JSON.stringify(validRequestPayload(`Docker wrong content type ${stamp}`))
    });
    await expectError(wrongContentType, 400, 'wrong content-type request');

    const malformedBearer = await request.post(`${baseURL}/v1/requests`, {
      headers: { authorization: 'Bearer definitely-not-an-agent' },
      data: validRequestPayload(`Docker malformed bearer ${stamp}`)
    });
    await expectError(malformedBearer, 401, 'malformed bearer request');

    const fakeAgent = await request.post(`${baseURL}/v1/requests`, {
      headers: bearerHeaders('agent_fake_not_real'),
      data: validRequestPayload(`Docker fake agent ${stamp}`)
    });
    await expectError(fakeAgent, 401, 'fake Agent Token request');

    const tokenTypeMismatchAgentOnDevice = await request.post(`${baseURL}/v1/devices/register`, {
      headers: bearerHeaders(agent.token),
      data: { deviceName: `Docker invalid agent-as-device ${stamp}`, platform: 'ios' }
    });
    await expectError(tokenTypeMismatchAgentOnDevice, 403, 'Agent Token on human device endpoint');

    const tokenTypeMismatchDeviceOnAdmin = await request.post(`${baseURL}/v1/agent-tokens`, {
      headers: bearerHeaders(device.token),
      data: { label: `Docker invalid device-as-admin ${stamp}` }
    });
    await expectError(tokenTypeMismatchDeviceOnAdmin, 403, 'Device Token on admin endpoint');

    const created = await createSanctionRequest(request, baseURL, agent.token, `Docker valid request before invalid responses ${stamp}`);
    expect(created.request.status).toBe('pending');

    const fakeDevice = await request.post(`${baseURL}/v1/requests/${created.request.id}/responses`, {
      headers: bearerHeaders('device_fake_not_real'),
      data: { choiceId: 'approve' }
    });
    await expectError(fakeDevice, 401, 'fake Device Token response');

    const nonexistentRequest = await request.post(`${baseURL}/v1/requests/req_does_not_exist/responses`, {
      headers: bearerHeaders(device.token),
      data: { choiceId: 'approve' }
    });
    await expectError(nonexistentRequest, 404, 'nonexistent request response');

    const invalidChoice = await request.post(`${baseURL}/v1/requests/${created.request.id}/responses`, {
      headers: bearerHeaders(device.token),
      data: { choiceId: 'not-a-real-choice', message: 'This corrupted choice should fail' }
    });
    await expectError(invalidChoice, 400, 'invalid response choice');

    const afterInvalidResponses = await getRequest(request, baseURL, created.request.id);
    expect(afterInvalidResponses.status).toBe('pending');
    expect(afterInvalidResponses.response).toBeFalsy();

    const finalHistory = await activityHistory(request, baseURL, 200);
    const newInvalidRequestTitles = [
      `Docker invalid missing requester ${stamp}`,
      `Docker invalid empty request type ${stamp}`,
      `Docker invalid no deny choice ${stamp}`,
      `Docker invalid malformed choice ${stamp}`,
      `Docker wrong content type ${stamp}`,
      `Docker malformed bearer ${stamp}`,
      `Docker fake agent ${stamp}`
    ];
    for (const title of newInvalidRequestTitles) {
      expect(finalHistory.some((item) => item.kind === 'request' && item.request?.title === title), `${title} should not appear in activity`).toBeFalsy();
    }
    expect(finalHistory.length).toBeGreaterThanOrEqual(initialHistory.length);

    const health = await request.get(`${baseURL}/healthz`);
    await expectOk(health, 'GET /healthz after invalid payloads');
    const ready = await request.get(`${baseURL}/readyz`);
    await expectOk(ready, 'GET /readyz after invalid payloads');
  });
});
