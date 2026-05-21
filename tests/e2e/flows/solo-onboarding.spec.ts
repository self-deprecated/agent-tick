import { expect, test } from '@playwright/test';
import { signInAsTestUser, testAuthEnabled } from '../support/auth';
import { readTestState, rowsFor } from '../support/db';
import { createApprovalRequest } from '../support/fixtures';
import { expectApprovalsHidden, expectSoloOnboarding } from '../support/pages';

test('solo user moves through token, CLI, mobile, and first approval readiness', async ({ page, request, baseURL }) => {
  test.skip(!(await testAuthEnabled(request, baseURL)), 'Set AGENT_TICK_TEST_AUTH=1 for deterministic product-flow E2E tests');
  const stamp = Date.now();
  const user = await signInAsTestUser(page, request, baseURL, { subject: `solo_${stamp}`, email: `solo_${stamp}@example.test`, name: 'Solo User' });

  await expectSoloOnboarding(page);
  await expect(page.getByTestId('approvals-locked')).toBeVisible();
  await expectApprovalsHidden(page);

  await page.getByLabel('Agent name').fill(`Solo Agent ${stamp}`);
  await page.getByRole('button', { name: 'Create token' }).click();
  const token = (await page.locator('code', { hasText: /^agent_/ }).last().innerText()).trim();
  expect(token).toMatch(/^agent_/);
  await expect(page.getByText(/agent-tick config --server/)).toBeVisible();
  await expect(page.getByTestId('approvals-locked')).toBeVisible();

  let state = await readTestState(request, baseURL);
  expect(rowsFor(state.agentTokens, 'owner_user_id', user.userId)).toHaveLength(1);
  expect(JSON.stringify(state.agentTokens)).not.toContain(token);

  await createApprovalRequest(request, baseURL, token, `First mobile approval ${stamp}`);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expectSoloOnboarding(page);
  await expect(page.getByTestId('mobile-required')).toBeVisible();
  await expectApprovalsHidden(page);

  await page.getByRole('button', { name: 'I installed the mobile app' }).click();
  await expect(page.getByTestId('setup-complete')).toBeVisible();
  await expect(page.getByTestId('approval-requests')).toBeVisible();
  await expect(page.getByRole('heading', { name: `First mobile approval ${stamp}` })).toBeVisible();

  state = await readTestState(request, baseURL);
  expect(rowsFor(state.devices, 'user_id', user.userId)).toHaveLength(1);
  expect(rowsFor(state.approvals, 'title', `First mobile approval ${stamp}`)).toHaveLength(1);
});
