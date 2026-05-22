import { expect, test } from '@playwright/test';
import { authHeaders, signInAsTestUser, testAuthEnabled } from '../support/auth';
import { readTestState, rowsFor } from '../support/db';
import { addWorkspaceMember, createSharedWorkspace } from '../support/fixtures';

test('Shared Workspace owner can add an active member by email', async ({ page, request, baseURL }) => {
  test.skip(!(await testAuthEnabled(request, baseURL)), 'Set AGENT_TICK_TEST_AUTH=1 for deterministic product-flow E2E tests');
  const stamp = Date.now();
  const owner = await signInAsTestUser(page, request, baseURL, { subject: `owner_${stamp}`, email: `owner_${stamp}@example.test`, name: 'Owner User' });
  const workspace = await createSharedWorkspace(request, baseURL, owner, `Member Workspace ${stamp}`);
  const joiner = await signInAsTestUser(page, request, baseURL, { subject: `joiner_${stamp}`, email: `joiner_${stamp}@example.test`, name: 'Joiner User' });

  const added = await addWorkspaceMember(request, baseURL, owner, workspace.workspaceId, joiner.email, 'admin') as { userId: string; workspaceId: string; role: string; status: string };
  expect(added).toMatchObject({ userId: joiner.userId, workspaceId: workspace.workspaceId, role: 'admin', status: 'active' });

  const listed = await request.get(`${baseURL}/v1/workspaces`, { headers: authHeaders(joiner) });
  expect(listed.ok()).toBeTruthy();
  const memberships = await listed.json() as Array<{ workspaceId: string; name: string; role: string }>;
  expect(memberships.some((membership) => membership.workspaceId === workspace.workspaceId && membership.name === `Member Workspace ${stamp}` && membership.role === 'admin')).toBeTruthy();

  const state = await readTestState(request, baseURL);
  expect(rowsFor(state.workspaceMembers, 'workspace_id', workspace.workspaceId).filter((row) => row.user_id === owner.userId && row.role === 'owner')).toHaveLength(1);
  expect(rowsFor(state.workspaceMembers, 'workspace_id', workspace.workspaceId).filter((row) => row.user_id === joiner.userId && row.role === 'admin' && row.status === 'active')).toHaveLength(1);
});
