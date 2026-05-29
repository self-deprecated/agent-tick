import { expect, test } from '@playwright/test';
import { authHeaders, signInAsTestUser, testAuthEnabled } from '../support/auth';
import { createAgentToken, createRequest, registerMobileDevice } from '../support/fixtures';

test('Activity count tracks pending actionable Requests and ignores Status Updates', async ({ page, request, baseURL }) => {
  test.skip(!(await testAuthEnabled(request, baseURL)), 'Set AGENT_TICK_TEST_AUTH=1 for deterministic product-flow E2E tests');
  const stamp = Date.now();
  const user = await signInAsTestUser(page, request, baseURL, { subject: `life_${stamp}`, email: `life_${stamp}@example.test`, name: 'Lifecycle User' });
  const agent = await createAgentToken(request, baseURL, user, `Lifecycle Agent ${stamp}`);
  await registerMobileDevice(request, baseURL, user, `Lifecycle iPhone ${stamp}`);

  const statusUpdate = await request.post(`${baseURL}/v1/status-updates`, {
    headers: { authorization: `Bearer ${agent.token}` },
    data: { message: `Lifecycle status ${stamp}`, state: 'working', clientName: 'product-flow-e2e' }
  });
  expect(statusUpdate.ok()).toBeTruthy();

  let pending = await (await request.get(`${baseURL}/v1/activity/pending-count`, { headers: authHeaders(user) })).json() as { pendingRequests: number };
  expect(pending).toEqual({ pendingRequests: 0 });

  const created = await createRequest(request, baseURL, agent.token, `Lifecycle Request ${stamp}`);
  pending = await (await request.get(`${baseURL}/v1/activity/pending-count`, { headers: authHeaders(user) })).json() as { pendingRequests: number };
  expect(pending).toEqual({ pendingRequests: 1 });

  const activity = await (await request.get(`${baseURL}/v1/activity`, { headers: authHeaders(user) })).json() as Array<{ kind: string; request?: { id: string }; statusUpdate?: { message: string } }>;
  expect(activity.some((item) => item.kind === 'request' && item.request?.id === created.request.id)).toBeTruthy();
  expect(activity.some((item) => item.kind === 'status_update' && item.statusUpdate?.message === `Lifecycle status ${stamp}`)).toBeTruthy();

  const response = await request.post(`${baseURL}/v1/requests/${created.request.id}/responses`, {
    headers: authHeaders(user),
    data: { choiceId: 'approve' }
  });
  expect(response.ok()).toBeTruthy();
  pending = await (await request.get(`${baseURL}/v1/activity/pending-count`, { headers: authHeaders(user) })).json() as { pendingRequests: number };
  expect(pending).toEqual({ pendingRequests: 0 });
});
