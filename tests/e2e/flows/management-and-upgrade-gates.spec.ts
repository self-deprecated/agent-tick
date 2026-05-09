import { expect, test } from '@playwright/test';
import { authHeaders, signInAsTestUser, testAuthEnabled } from '../support/auth';
import { createAgentToken, registerMobileDevice } from '../support/fixtures';
import { readTestState, rowsFor } from '../support/db';

test('agent revoke and device registration update product state', async ({ page, request, baseURL }) => {
  test.skip(!(await testAuthEnabled(request, baseURL)), 'Set AGENT_TICK_TEST_AUTH=1 for deterministic product-flow E2E tests');
  const stamp = Date.now();
  const user = await signInAsTestUser(page, request, baseURL, { subject: `manage_${stamp}`, email: `manage_${stamp}@example.test`, name: 'Manage User' });
  const agent = await createAgentToken(request, baseURL, user, `Managed Agent ${stamp}`);
  const device = await registerMobileDevice(request, baseURL, user, `Managed iPhone ${stamp}`);

  let state = await readTestState(request, baseURL);
  expect(rowsFor(state.agentTokens, 'agent_id', agent.agentId)).toHaveLength(1);
  expect(rowsFor(state.devices, 'device_id', device.deviceId)).toHaveLength(1);

  const revoke = await request.post(`${baseURL}/v1/agent-tokens/${agent.agentId}/revoke`, { headers: authHeaders(user) });
  expect(revoke.ok()).toBeTruthy();
  const rejected = await request.post(`${baseURL}/v1/approval-requests`, {
    headers: { authorization: `Bearer ${agent.token}` },
    data: { requester: { name: 'revoked' }, title: 'Should not create' }
  });
  expect(rejected.status()).toBe(401);

  const unregister = await request.post(`${baseURL}/v1/devices/${device.deviceId}/unregister`, { headers: authHeaders(user) });
  expect(unregister.ok()).toBeTruthy();
  state = await readTestState(request, baseURL);
  expect(rowsFor(state.agentTokens, 'agent_id', agent.agentId)[0].revoked_at).toBeTruthy();
  expect(rowsFor(state.devices, 'device_id', device.deviceId)[0].unregistered_at).toBeTruthy();
});

test('hosted solo mode exposes upgrade gate instead of team controls', async ({ page, request, baseURL }) => {
  test.skip(!(await testAuthEnabled(request, baseURL)), 'Set AGENT_TICK_TEST_AUTH=1 for deterministic product-flow E2E tests');
  const stamp = Date.now();
  await signInAsTestUser(page, request, baseURL, { subject: `gate_${stamp}`, email: `gate_${stamp}@example.test`, name: 'Gate User' });
  await expect(page.getByRole('link', { name: 'Upgrade for teams' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Invites' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Pending members' })).toHaveCount(0);
});
