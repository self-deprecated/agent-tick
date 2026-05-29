import { expect, test } from '@playwright/test';
import { authHeaders, signInAsTestUser, testAuthEnabled } from '../support/auth';
import { createAgentToken, registerMobileDevice } from '../support/fixtures';
import { readTestState, rowsFor } from '../support/db';

test('Agent Token revoke and Approval Device registration update product state', async ({ page, request, baseURL }) => {
  test.skip(!(await testAuthEnabled(request, baseURL)), 'Set AGENT_TICK_TEST_AUTH=1 for deterministic product-flow E2E tests');
  const stamp = Date.now();
  const user = await signInAsTestUser(page, request, baseURL, { subject: `manage_${stamp}`, email: `manage_${stamp}@example.test`, name: 'Manage User' });
  const agent = await createAgentToken(request, baseURL, user, `Managed Agent ${stamp}`);
  const device = await registerMobileDevice(request, baseURL, user, `Managed iPhone ${stamp}`);

  let state = await readTestState(request, baseURL);
  expect(rowsFor(state.agentTokens, 'agent_token_id', agent.agentTokenId)).toHaveLength(1);
  expect(rowsFor(state.approvalDevices, 'device_id', device.deviceId)).toHaveLength(1);

  const revoke = await request.post(`${baseURL}/v1/agent-tokens/${agent.agentTokenId}/revoke`, { headers: authHeaders(user) });
  expect(revoke.ok()).toBeTruthy();
  const rejected = await request.post(`${baseURL}/v1/requests`, {
    headers: { authorization: `Bearer ${agent.token}` },
    data: { requester: { name: 'revoked' }, requestType: 'sanction', title: 'Should not create' }
  });
  expect(rejected.status()).toBe(401);

  const unregister = await request.post(`${baseURL}/v1/devices/${device.deviceId}/unregister`, { headers: authHeaders(user) });
  expect(unregister.ok()).toBeTruthy();
  state = await readTestState(request, baseURL);
  expect(rowsFor(state.agentTokens, 'agent_token_id', agent.agentTokenId)[0].revoked_at).toBeTruthy();
  expect(rowsFor(state.approvalDevices, 'device_id', device.deviceId)[0].unregistered_at).toBeTruthy();
});

test('hosted Personal Workspace shows Entitlement Status without web upgrade checkout', async ({ page, request, baseURL }) => {
  test.skip(!(await testAuthEnabled(request, baseURL)), 'Set AGENT_TICK_TEST_AUTH=1 for deterministic product-flow E2E tests');
  const stamp = Date.now();
  await signInAsTestUser(page, request, baseURL, { subject: `gate_${stamp}`, email: `gate_${stamp}@example.test`, name: 'Gate User' });

  await page.getByRole('button', { name: 'Settings' }).click();
  await expect(page.getByRole('heading', { name: 'Workspace operations' })).toBeVisible();
  await expect(page.getByText('Entitlement Status', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: /upgrade/i })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /upgrade/i })).toHaveCount(0);
});
