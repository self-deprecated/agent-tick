import { expect, test } from '@playwright/test';
import { authHeaders } from '../support/auth';
import { addWorkspaceMember, createAgentToken, createRequest, createRoutingRule, createSharedWorkspace } from '../support/fixtures';
import {
  bearerHeaders,
  createMobileSession,
  createTestUser,
  expectError,
  expectOk,
  grantSharedWorkspaceResponses,
  waitForRequest
} from './support/selfhost';

test.describe('Docker self-host Shared Workspace routing', () => {
  test('routes Requests only to the selected Routing Rule recipients', async ({ request, baseURL }) => {
    const stamp = Date.now();
    const owner = await createTestUser(request, baseURL, { subject: `team_owner_${stamp}`, name: 'Team Owner' });
    const selected = await createTestUser(request, baseURL, { subject: `team_selected_${stamp}`, name: 'Selected Member' });
    const nonRouted = await createTestUser(request, baseURL, { subject: `team_nonrouted_${stamp}`, name: 'Non-routed Member' });
    const outsider = await createTestUser(request, baseURL, { subject: `team_outsider_${stamp}`, name: 'Workspace Outsider' });
    const workspace = await createSharedWorkspace(request, baseURL, owner, `Docker Team Routing ${stamp}`);
    await grantSharedWorkspaceResponses(request, baseURL, workspace.workspaceId);
    await addWorkspaceMember(request, baseURL, owner, workspace.workspaceId, selected.email, 'member');
    await addWorkspaceMember(request, baseURL, owner, workspace.workspaceId, nonRouted.email, 'member');

    const rule = await createRoutingRule(request, baseURL, owner, workspace.workspaceId, `Selected only ${stamp}`, [selected.userId]);
    const agent = await createAgentToken(request, baseURL, owner, `Team routing agent ${stamp}`, workspace.workspaceId);
    const routed = await request.patch(`${baseURL}/v1/agent-tokens/${agent.agentTokenId}`, {
      headers: authHeaders(owner, workspace.workspaceId),
      data: { routingRuleId: rule.routingRuleId }
    });
    await expectOk(routed, 'PATCH /v1/agent-tokens/:id routingRuleId');

    const created = await createRequest(request, baseURL, agent.token, `Only selected gets this ${stamp}`);
    expect(created.request.workspaceId).toBe(workspace.workspaceId);

    const selectedDetail = await request.get(`${baseURL}/v1/requests/${created.request.id}`, { headers: authHeaders(selected, workspace.workspaceId) });
    await expectOk(selectedDetail, 'selected member GET routed Request');
    expect(await selectedDetail.json()).toMatchObject({ id: created.request.id, quorum: { currentUserEligible: true } });

    const nonRoutedDetail = await request.get(`${baseURL}/v1/requests/${created.request.id}`, { headers: authHeaders(nonRouted, workspace.workspaceId) });
    await expectError(nonRoutedDetail, 404, 'non-routed Workspace Member GET routed Request');

    const outsiderDetail = await request.get(`${baseURL}/v1/requests/${created.request.id}`, { headers: authHeaders(outsider, workspace.workspaceId) });
    await expectError(outsiderDetail, 403, 'outsider selecting another Workspace');

    const selectedList = await request.get(`${baseURL}/v1/requests`, { headers: authHeaders(selected, workspace.workspaceId) });
    await expectOk(selectedList, 'selected member GET /v1/requests');
    expect((await selectedList.json()) as Array<{ id: string }>).toEqual(expect.arrayContaining([expect.objectContaining({ id: created.request.id })]));

    const nonRoutedList = await request.get(`${baseURL}/v1/requests`, { headers: authHeaders(nonRouted, workspace.workspaceId) });
    await expectOk(nonRoutedList, 'non-routed member GET /v1/requests');
    expect(((await nonRoutedList.json()) as Array<{ id: string }>).some((item) => item.id === created.request.id)).toBe(false);

    const deniedResponse = await request.post(`${baseURL}/v1/requests/${created.request.id}/responses`, {
      headers: authHeaders(nonRouted, workspace.workspaceId),
      data: { choiceId: 'approve', message: 'not routed' }
    });
    await expectError(deniedResponse, 404, 'non-routed Workspace Member responding');
  });

  test('keeps a Request pending until the Routing Rule quorum is satisfied', async ({ request, baseURL }) => {
    const stamp = Date.now();
    const owner = await createTestUser(request, baseURL, { subject: `quorum_owner_${stamp}`, name: 'Quorum Owner' });
    const approverA = await createTestUser(request, baseURL, { subject: `quorum_a_${stamp}`, name: 'Quorum A' });
    const approverB = await createTestUser(request, baseURL, { subject: `quorum_b_${stamp}`, name: 'Quorum B' });
    const workspace = await createSharedWorkspace(request, baseURL, owner, `Docker Quorum ${stamp}`);
    await grantSharedWorkspaceResponses(request, baseURL, workspace.workspaceId);
    await addWorkspaceMember(request, baseURL, owner, workspace.workspaceId, approverA.email, 'member');
    await addWorkspaceMember(request, baseURL, owner, workspace.workspaceId, approverB.email, 'member');

    const rule = await createRoutingRule(request, baseURL, owner, workspace.workspaceId, `Two approvals ${stamp}`, [owner.userId, approverA.userId, approverB.userId], { requiredResponseMode: 'exact', requiredResponseCount: 2 });
    const agent = await createAgentToken(request, baseURL, owner, `Quorum agent ${stamp}`, workspace.workspaceId);
    const routed = await request.patch(`${baseURL}/v1/agent-tokens/${agent.agentTokenId}`, {
      headers: authHeaders(owner, workspace.workspaceId),
      data: { routingRuleId: rule.routingRuleId }
    });
    await expectOk(routed, 'PATCH /v1/agent-tokens/:id routingRuleId');

    const created = await createRequest(request, baseURL, agent.token, `Two people must approve ${stamp}`);
    expect(created.waiter?.token).toBeTruthy();

    const first = await request.post(`${baseURL}/v1/requests/${created.request.id}/responses`, {
      headers: authHeaders(owner, workspace.workspaceId),
      data: { choiceId: 'approve', message: 'first approval' }
    });
    await expectOk(first, 'first quorum response');
    expect(await first.json()).toMatchObject({ status: 'pending', quorum: { requiredResponseCount: 2, receivedResponseCount: 1, waitingFor: 1 } });

    const stillWaiting = await waitForRequest(request, baseURL, created.request.id, created.waiter!.token, 0);
    expect(stillWaiting).toMatchObject({ terminal: false, request: { status: 'pending' } });

    const second = await request.post(`${baseURL}/v1/requests/${created.request.id}/responses`, {
      headers: authHeaders(approverA, workspace.workspaceId),
      data: { choiceId: 'approve', message: 'second approval' }
    });
    await expectOk(second, 'second quorum response');
    expect(await second.json()).toMatchObject({ status: 'responded', response: { choiceId: 'approve' }, quorum: { requiredResponseCount: 2, receivedResponseCount: 2, waitingFor: 0 } });

    const terminal = await waitForRequest(request, baseURL, created.request.id, created.waiter!.token);
    expect(terminal).toMatchObject({ terminal: true, request: { status: 'responded', response: { choiceId: 'approve' } } });

    const late = await request.post(`${baseURL}/v1/requests/${created.request.id}/responses`, {
      headers: authHeaders(approverB, workspace.workspaceId),
      data: { choiceId: 'deny', message: 'late response should not change the result' }
    });
    await expectOk(late, 'late routed response after quorum');
    expect(await late.json()).toMatchObject({ status: 'responded', response: { choiceId: 'approve' } });
  });

  test('covers member invite, billing entitlement, and role boundaries for Shared Workspaces', async ({ request, baseURL }) => {
    const stamp = Date.now();
    const owner = await createTestUser(request, baseURL, { subject: `billing_owner_${stamp}`, name: 'Billing Owner' });
    const admin = await createTestUser(request, baseURL, { subject: `billing_admin_${stamp}`, name: 'Billing Admin' });
    const member = await createTestUser(request, baseURL, { subject: `billing_member_${stamp}`, name: 'Billing Member' });
    const workspace = await createSharedWorkspace(request, baseURL, owner, `Docker Company Billing ${stamp}`);

    const invitedAdmin = await addWorkspaceMember(request, baseURL, owner, workspace.workspaceId, admin.email, 'admin') as { userId: string; role: string; status: string };
    expect(invitedAdmin).toMatchObject({ userId: admin.userId, role: 'admin', status: 'active' });
    const invitedMember = await addWorkspaceMember(request, baseURL, owner, workspace.workspaceId, member.email, 'member') as { userId: string; role: string; status: string };
    expect(invitedMember).toMatchObject({ userId: member.userId, role: 'member', status: 'active' });

    const inactiveBilling = await request.get(`${baseURL}/v1/billing`, { headers: authHeaders(owner, workspace.workspaceId) });
    await expectOk(inactiveBilling, 'owner GET inactive Shared Workspace billing');
    expect(await inactiveBilling.json()).toMatchObject({
      workspaceId: workspace.workspaceId,
      workspaceType: 'shared',
      plan: 'shared-workspace',
      entitlement: { responsesEnabled: false, status: 'inactive' },
      usage: { activeMembers: 3, pendingMembers: 0 }
    });

    await grantSharedWorkspaceResponses(request, baseURL, workspace.workspaceId, '2099-02-01T00:00:00.000Z');
    const activeBilling = await request.get(`${baseURL}/v1/billing`, { headers: authHeaders(admin, workspace.workspaceId) });
    await expectOk(activeBilling, 'admin GET active Shared Workspace billing');
    expect(await activeBilling.json()).toMatchObject({ entitlement: { responsesEnabled: true, status: 'active' } });

    const memberBilling = await request.get(`${baseURL}/v1/billing`, { headers: authHeaders(member, workspace.workspaceId) });
    await expectError(memberBilling, 403, 'member GET Shared Workspace billing');

    const memberInvites = await request.post(`${baseURL}/v1/workspaces/${workspace.workspaceId}/members`, {
      headers: authHeaders(member, workspace.workspaceId),
      data: { email: `not-allowed-${stamp}@example.test`, role: 'member' }
    });
    await expectError(memberInvites, 403, 'member inviting another member');

    const mobileAdmin = await createMobileSession(request, baseURL, admin);
    const mobileBilling = await request.get(`${baseURL}/v1/billing`, { headers: bearerHeaders(mobileAdmin.token, workspace.workspaceId) });
    await expectError(mobileBilling, 403, 'mobile session managing web billing');
  });
});
