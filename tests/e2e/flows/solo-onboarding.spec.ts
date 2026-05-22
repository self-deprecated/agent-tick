import { expect, test } from '@playwright/test';
import { authHeaders, signInAsTestUser, testAuthEnabled } from '../support/auth';
import { readTestState, rowsFor } from '../support/db';
import { createAgentToken, createRequest, registerMobileDevice } from '../support/fixtures';

test('Personal Workspace moves through Agent Token, check-in, device, and first Request readiness', async ({ page, request, baseURL }) => {
  test.skip(!(await testAuthEnabled(request, baseURL)), 'Set AGENT_TICK_TEST_AUTH=1 for deterministic product-flow E2E tests');
  const stamp = Date.now();
  const user = await signInAsTestUser(page, request, baseURL, { subject: `solo_${stamp}`, email: `solo_${stamp}@example.test`, name: 'Solo User' });

  await expect(page.getByRole('heading', { name: 'Make this Workspace ready' })).toBeVisible();
  await expect(page.getByText('Personal · Personal')).toBeVisible();

  let onboarding = await (await request.get(`${baseURL}/v1/onboarding`, { headers: authHeaders(user) })).json() as Record<string, unknown>;
  expect(onboarding).toMatchObject({ stage: 'needs_agent_token', hasAgentToken: false });

  const agent = await createAgentToken(request, baseURL, user, `Solo Agent ${stamp}`);
  onboarding = await (await request.get(`${baseURL}/v1/onboarding`, { headers: authHeaders(user) })).json() as Record<string, unknown>;
  expect(onboarding).toMatchObject({ stage: 'needs_agent_check_in', hasAgentToken: true, hasAgentCheckIn: false });

  const created = await createRequest(request, baseURL, agent.token, `First mobile Request ${stamp}`);
  onboarding = await (await request.get(`${baseURL}/v1/onboarding`, { headers: authHeaders(user) })).json() as Record<string, unknown>;
  expect(onboarding).toMatchObject({ stage: 'needs_mobile_app', hasAgentCheckIn: true, hasMobileDevice: false });

  await registerMobileDevice(request, baseURL, user, `Solo iPhone ${stamp}`);
  onboarding = await (await request.get(`${baseURL}/v1/onboarding`, { headers: authHeaders(user) })).json() as Record<string, unknown>;
  expect(onboarding).toMatchObject({ stage: 'ready', hasMobileDevice: true });

  const response = await request.post(`${baseURL}/v1/requests/${created.request.id}/responses`, {
    headers: authHeaders(user),
    data: { choiceId: 'approve' }
  });
  expect(response.ok()).toBeTruthy();

  const state = await readTestState(request, baseURL);
  expect(rowsFor(state.workspaces, 'workspace_id', user.workspaceId)[0]).toMatchObject({ name: 'Personal', type: 'personal' });
  expect(rowsFor(state.workspaceMembers, 'user_id', user.userId).some((row) => row.workspace_id === user.workspaceId && row.role === 'owner')).toBeTruthy();
  expect(rowsFor(state.agentTokens, 'creator_user_id', user.userId)).toHaveLength(1);
  expect(rowsFor(state.approvalDevices, 'user_id', user.userId)).toHaveLength(1);
  expect(rowsFor(state.requests, 'title', `First mobile Request ${stamp}`)[0]).toMatchObject({ status: 'responded' });
  expect(rowsFor(state.responses, 'request_id', created.request.id)[0]).toMatchObject({ choice_id: 'approve', final: 1 });
});
