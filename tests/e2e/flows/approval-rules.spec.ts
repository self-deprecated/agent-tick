import { expect, test } from '@playwright/test';
import { authHeaders, signInAsTestUser, testAuthEnabled } from '../support/auth';
import { readTestState, rowsFor } from '../support/db';
import { createAgentToken, createApprovalRequest, createOrganization } from '../support/fixtures';

test('team-scoped approval rule is stored and controls responder eligibility', async ({ page, request, baseURL }) => {
  test.skip(!(await testAuthEnabled(request, baseURL)), 'Set AGENT_TICK_TEST_AUTH=1 for deterministic product-flow E2E tests');
  const stamp = Date.now();
  const owner = await signInAsTestUser(page, request, baseURL, { subject: `rule_owner_${stamp}`, email: `rule_owner_${stamp}@example.test`, name: 'Rule Owner' });
  const org = await createOrganization(request, baseURL, owner, `Rules Org ${stamp}`);

  const teamResponse = await request.post(`${baseURL}/v1/teams`, {
    headers: authHeaders(owner, org.organizationId),
    data: { name: `Platform ${stamp}` }
  });
  expect(teamResponse.ok()).toBeTruthy();
  const team = await teamResponse.json() as { teamId: string };

  const policyResponse = await request.post(`${baseURL}/v1/policies`, {
    headers: authHeaders(owner, org.organizationId),
    data: { name: `Production rule ${stamp}`, teamId: team.teamId, requiredApprovals: 1 }
  });
  expect(policyResponse.ok()).toBeTruthy();
  const policy = await policyResponse.json() as { policyId: string };

  const updatedPolicyResponse = await request.patch(`${baseURL}/v1/policies/${policy.policyId}`, {
    headers: authHeaders(owner, org.organizationId),
    data: { name: `Edited production rule ${stamp}`, requiredApprovals: 1, enabled: true }
  });
  expect(updatedPolicyResponse.ok()).toBeTruthy();
  expect(await updatedPolicyResponse.json()).toMatchObject({ name: `Edited production rule ${stamp}`, requiredApprovals: 1 });

  const tokenResponse = await request.post(`${baseURL}/v1/agent-tokens`, {
    headers: authHeaders(owner, org.organizationId),
    data: { name: `Scoped Agent ${stamp}`, teamId: team.teamId, defaultApprovalPolicy: policy.policyId }
  });
  expect(tokenResponse.ok()).toBeTruthy();
  const token = await tokenResponse.json() as { token: string };
  const approval = await createApprovalRequest(request, baseURL, token.token, `Scoped approval ${stamp}`);

  const outsider = await signInAsTestUser(page, request, baseURL, { subject: `outsider_${stamp}`, email: `outsider_${stamp}@example.test`, name: 'Outsider' });
  const denied = await request.post(`${baseURL}/v1/approval-requests/${approval.request.id}/responses`, {
    headers: authHeaders(outsider, org.organizationId),
    data: { choiceId: 'approve' }
  });
  expect(denied.status()).toBe(403);

  const approved = await request.post(`${baseURL}/v1/approval-requests/${approval.request.id}/responses`, {
    headers: authHeaders(owner, org.organizationId),
    data: { choiceId: 'approve' }
  });
  expect(approved.ok()).toBeTruthy();

  const state = await readTestState(request, baseURL);
  expect(rowsFor(state.policies, 'policy_id', policy.policyId)[0]).toMatchObject({ name: `Edited production rule ${stamp}` });
  expect(rowsFor(state.approvals, 'title', `Scoped approval ${stamp}`)[0]).toMatchObject({ status: 'responded' });
});
