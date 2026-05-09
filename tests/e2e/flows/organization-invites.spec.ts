import { expect, test } from '@playwright/test';
import { authHeaders, signInAsTestUser, testAuthEnabled } from '../support/auth';
import { readTestState, rowsFor } from '../support/db';
import { createOrganization } from '../support/fixtures';

test('organization invite acceptance creates a pending membership request', async ({ page, request, baseURL }) => {
  test.skip(!(await testAuthEnabled(request, baseURL)), 'Set AGENT_TICK_TEST_AUTH=1 for deterministic product-flow E2E tests');
  const stamp = Date.now();
  const owner = await signInAsTestUser(page, request, baseURL, { subject: `owner_${stamp}`, email: `owner_${stamp}@example.test`, name: 'Owner User' });
  const org = await createOrganization(request, baseURL, owner, `Invite Org ${stamp}`);

  const inviteResponse = await request.post(`${baseURL}/v1/organization-invites`, {
    headers: authHeaders(owner, org.organizationId),
    data: { label: `Invite ${stamp}`, role: 'admin', approvalRequired: true, email: `joiner_${stamp}@example.test` }
  });
  expect(inviteResponse.ok()).toBeTruthy();
  const invite = await inviteResponse.json() as { token: string; inviteId: string };

  const preview = await request.get(`${baseURL}/v1/invites/${invite.token}`);
  expect(preview.ok()).toBeTruthy();
  expect(await preview.json()).toMatchObject({ organizationName: `Invite Org ${stamp}`, role: 'admin', approvalRequired: true });
  expect(JSON.stringify(await preview.json())).not.toContain(org.organizationId);

  const joiner = await signInAsTestUser(page, request, baseURL, { subject: `joiner_${stamp}`, email: `joiner_${stamp}@example.test`, name: 'Joiner User' });
  const accepted = await request.post(`${baseURL}/v1/invites/${invite.token}/accept`, { headers: authHeaders(joiner) });
  expect(accepted.ok()).toBeTruthy();
  expect(await accepted.json()).toMatchObject({ status: 'pending_approval' });

  let state = await readTestState(request, baseURL);
  expect(rowsFor(state.membershipRequests, 'user_id', joiner.userId)).toHaveLength(1);
  expect(rowsFor(state.memberships, 'user_id', joiner.userId).filter((row) => row.organization_id === org.organizationId && row.status === 'active')).toHaveLength(0);

  const [membershipRequest] = rowsFor(state.membershipRequests, 'user_id', joiner.userId);
  const approved = await request.post(`${baseURL}/v1/organization-membership-requests/${membershipRequest.request_id}/approve`, {
    headers: authHeaders(owner, org.organizationId)
  });
  expect(approved.ok()).toBeTruthy();

  state = await readTestState(request, baseURL);
  expect(rowsFor(state.memberships, 'user_id', joiner.userId).filter((row) => row.organization_id === org.organizationId && row.status === 'active')).toHaveLength(1);
});
