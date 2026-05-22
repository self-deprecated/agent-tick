import { expect, test } from '@playwright/test';
import { authHeaders, signInAsTestUser, testAuthEnabled } from '../support/auth';
import { createAgentToken, createRoutingRule, createSharedWorkspace } from '../support/fixtures';
import { readTestState, rowsFor } from '../support/db';

test('Shared Workspace starts with an owner and requires Routing Rules for agent activity', async ({ page, request, baseURL }) => {
  test.skip(!(await testAuthEnabled(request, baseURL)), 'Set AGENT_TICK_TEST_AUTH=1 for deterministic product-flow E2E tests');
  const stamp = Date.now();
  const owner = await signInAsTestUser(page, request, baseURL, { subject: `shared_owner_${stamp}`, email: `shared_owner_${stamp}@example.test`, name: 'Shared Owner' });
  const workspace = await createSharedWorkspace(request, baseURL, owner, `Shared Routing ${stamp}`);
  const agent = await createAgentToken(request, baseURL, owner, `Unrouted Agent ${stamp}`, workspace.workspaceId);

  const unrouted = await request.post(`${baseURL}/v1/status-updates`, {
    headers: { authorization: `Bearer ${agent.token}` },
    data: { message: 'This should wait for routing', state: 'working' }
  });
  expect(unrouted.status()).toBe(409);
  expect(await unrouted.json()).toMatchObject({ error: { code: 'routing_required' } });

  const rule = await createRoutingRule(request, baseURL, owner, workspace.workspaceId, `Owner-only routing ${stamp}`, [owner.userId]);
  const assignment = await request.patch(`${baseURL}/v1/agent-tokens/${agent.agentTokenId}`, {
    headers: authHeaders(owner, workspace.workspaceId),
    data: { routingRuleId: rule.routingRuleId }
  });
  expect(assignment.ok()).toBeTruthy();

  const routed = await request.post(`${baseURL}/v1/status-updates`, {
    headers: { authorization: `Bearer ${agent.token}` },
    data: { message: `Routed status ${stamp}`, state: 'done' }
  });
  expect(routed.ok()).toBeTruthy();

  const state = await readTestState(request, baseURL);
  expect(rowsFor(state.workspaces, 'workspace_id', workspace.workspaceId)[0]).toMatchObject({ name: `Shared Routing ${stamp}`, type: 'shared' });
  expect(rowsFor(state.workspaceMembers, 'workspace_id', workspace.workspaceId).filter((row) => row.user_id === owner.userId && row.role === 'owner')).toHaveLength(1);
  expect(rowsFor(state.routingRuleRecipients, 'routing_rule_id', rule.routingRuleId)[0]).toMatchObject({ user_id: owner.userId });
  expect(rowsFor(state.statusUpdates, 'message', `Routed status ${stamp}`)[0]).toMatchObject({ routing_rule_id: rule.routingRuleId });
});
