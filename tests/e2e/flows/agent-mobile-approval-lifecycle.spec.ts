import { expect, test } from '@playwright/test';
import { authHeaders, signInAsTestUser, testAuthEnabled } from '../support/auth';
import { createAgentToken, createApprovalRequest, registerMobileDevice } from '../support/fixtures';

test('onboarding status moves from token to CLI to mobile readiness', async ({ page, request, baseURL }) => {
  test.skip(!(await testAuthEnabled(request, baseURL)), 'Set AGENT_TICK_TEST_AUTH=1 for deterministic product-flow E2E tests');
  const stamp = Date.now();
  const user = await signInAsTestUser(page, request, baseURL, { subject: `life_${stamp}`, email: `life_${stamp}@example.test`, name: 'Lifecycle User' });

  let statusResponse = await request.get(`${baseURL}/v1/onboarding`, { headers: authHeaders(user) });
  expect(await statusResponse.json()).toMatchObject({ stage: 'needs_agent_token', hasAgentToken: false });

  const agent = await createAgentToken(request, baseURL, user, `Lifecycle Agent ${stamp}`);
  statusResponse = await request.get(`${baseURL}/v1/onboarding`, { headers: authHeaders(user) });
  expect(await statusResponse.json()).toMatchObject({ stage: 'needs_cli_setup', hasAgentToken: true, hasCliHeartbeat: false });

  await createApprovalRequest(request, baseURL, agent.token, `Lifecycle approval ${stamp}`);
  statusResponse = await request.get(`${baseURL}/v1/onboarding`, { headers: authHeaders(user) });
  expect(await statusResponse.json()).toMatchObject({ stage: 'needs_mobile_app', hasCliHeartbeat: true, hasMobileDevice: false });

  await registerMobileDevice(request, baseURL, user, `Lifecycle iPhone ${stamp}`);
  statusResponse = await request.get(`${baseURL}/v1/onboarding`, { headers: authHeaders(user) });
  expect(await statusResponse.json()).toMatchObject({ stage: 'ready_for_first_request', hasMobileDevice: true, canUseWebApprovals: true });
});
