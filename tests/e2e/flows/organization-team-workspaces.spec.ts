import { expect, test } from '@playwright/test';
import { authHeaders, signInAsTestUser, testAuthEnabled } from '../support/auth';
import { createOrganization } from '../support/fixtures';
import { readTestState, rowsFor } from '../support/db';

test('creating an organization and team creates owner memberships', async ({ page, request, baseURL }) => {
  test.skip(!(await testAuthEnabled(request, baseURL)), 'Set AGENT_TICK_TEST_AUTH=1 for deterministic product-flow E2E tests');
  const stamp = Date.now();
  const owner = await signInAsTestUser(page, request, baseURL, { subject: `team_owner_${stamp}`, email: `team_owner_${stamp}@example.test`, name: 'Team Owner' });
  const org = await createOrganization(request, baseURL, owner, `Team Org ${stamp}`);

  const teamResponse = await request.post(`${baseURL}/v1/teams`, {
    headers: authHeaders(owner, org.organizationId),
    data: { name: `Platform ${stamp}` }
  });
  expect(teamResponse.ok()).toBeTruthy();
  const team = await teamResponse.json() as { teamId: string };

  const state = await readTestState(request, baseURL);
  expect(rowsFor(state.organizations, 'id', org.organizationId)).toHaveLength(1);
  expect(rowsFor(state.memberships, 'organization_id', org.organizationId).filter((row) => row.user_id === owner.userId && row.role === 'owner')).toHaveLength(1);
  expect(rowsFor(state.teams, 'team_id', team.teamId)).toHaveLength(1);
  expect(rowsFor(state.teamMemberships, 'team_id', team.teamId).filter((row) => row.user_id === owner.userId && row.role === 'owner')).toHaveLength(1);
});
