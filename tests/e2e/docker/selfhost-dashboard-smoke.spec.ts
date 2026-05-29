import { expect, test } from '@playwright/test';
import { createAgentToken, createSanctionRequest } from './support/selfhost';

const adminToken = process.env.AGENT_TICK_E2E_ADMIN_TOKEN;

test.describe('Docker self-host dashboard smoke', () => {
  test('serves the built dashboard and renders seeded request state', async ({ page, request, baseURL }) => {
    test.skip(!adminToken, 'AGENT_TICK_E2E_ADMIN_TOKEN is required for Docker dashboard smoke coverage');

    const stamp = Date.now();
    const agentToken = await createAgentToken(request, baseURL, `Docker dashboard smoke ${stamp}`);
    await createSanctionRequest(request, baseURL, agentToken.token, `Docker dashboard request ${stamp}`);

    await page.addInitScript(({ token }) => {
      window.localStorage.setItem('agent_tick_admin_token', token);
    }, { token: adminToken! });

    await page.goto('/', { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: /Activity/ }).click();

    const requestRow = page.locator('button.activity-row', { hasText: `Docker dashboard request ${stamp}` }).last();
    await expect(requestRow).toBeVisible();
    await requestRow.click();
    await expect(page.getByText(/sanction · pending/)).toBeVisible();
    await page.getByRole('button', { name: 'Approve' }).click();
    await expect(page.getByText(/sanction · responded/)).toBeVisible();

    await page.getByRole('button', { name: 'Settings' }).click();
    await expect(page.getByRole('heading', { name: 'Preferences' }).first()).toBeVisible();
  });
});
