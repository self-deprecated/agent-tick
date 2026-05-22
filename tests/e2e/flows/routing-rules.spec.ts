import { expect, test } from '@playwright/test';
import { authHeaders, signInAsTestUser, testAuthEnabled } from '../support/auth';
import { readTestState, rowsFor } from '../support/db';
import { createAgentToken, createRequest, createRoutingRule, createSharedWorkspace } from '../support/fixtures';

test('Routing Rule assignment controls Shared Workspace responder eligibility', async ({ page, request, baseURL }) => {
  test.skip(!(await testAuthEnabled(request, baseURL)), 'Set AGENT_TICK_TEST_AUTH=1 for deterministic product-flow E2E tests');
  const stamp = Date.now();
  const owner = await signInAsTestUser(page, request, baseURL, { subject: `rule_owner_${stamp}`, email: `rule_owner_${stamp}@example.test`, name: 'Rule Owner' });
  const workspace = await createSharedWorkspace(request, baseURL, owner, `Rules Workspace ${stamp}`);
  const rule = await createRoutingRule(request, baseURL, owner, workspace.workspaceId, `Production routing ${stamp}`, [owner.userId]);
  const agent = await createAgentToken(request, baseURL, owner, `Scoped Agent ${stamp}`, workspace.workspaceId);

  const routed = await request.patch(`${baseURL}/v1/agent-tokens/${agent.agentTokenId}`, {
    headers: authHeaders(owner, workspace.workspaceId),
    data: { routingRuleId: rule.routingRuleId }
  });
  expect(routed.ok()).toBeTruthy();

  const created = await createRequest(request, baseURL, agent.token, `Scoped Request ${stamp}`);

  const outsider = await signInAsTestUser(page, request, baseURL, { subject: `outsider_${stamp}`, email: `outsider_${stamp}@example.test`, name: 'Outsider' });
  const denied = await request.post(`${baseURL}/v1/requests/${created.request.id}/responses`, {
    headers: authHeaders(outsider, workspace.workspaceId),
    data: { choiceId: 'approve' }
  });
  expect(denied.status()).toBe(403);

  const approved = await request.post(`${baseURL}/v1/requests/${created.request.id}/responses`, {
    headers: authHeaders(owner, workspace.workspaceId),
    data: { choiceId: 'approve' }
  });
  expect(approved.ok()).toBeTruthy();

  const state = await readTestState(request, baseURL);
  expect(rowsFor(state.routingRules, 'routing_rule_id', rule.routingRuleId)[0]).toMatchObject({ name: `Production routing ${stamp}`, workspace_id: workspace.workspaceId });
  expect(rowsFor(state.routingRuleRecipients, 'routing_rule_id', rule.routingRuleId)[0]).toMatchObject({ user_id: owner.userId });
  expect(rowsFor(state.agentTokens, 'agent_token_id', agent.agentTokenId)[0]).toMatchObject({ routing_rule_id: rule.routingRuleId });
  expect(rowsFor(state.requests, 'title', `Scoped Request ${stamp}`)[0]).toMatchObject({ status: 'responded', routing_rule_id: rule.routingRuleId });
});
