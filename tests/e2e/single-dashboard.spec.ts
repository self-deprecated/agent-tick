import { expect, test } from '@playwright/test';

const adminToken = process.env.AGENT_TICK_E2E_ADMIN_TOKEN;

test('single mode Personal Console works with an admin token', async ({ page, request, baseURL }) => {
	const configResponse = await request.get(`${baseURL}/v1/auth/config`);
	const config = await configResponse.json() as { mode?: string };
	test.skip(config.mode !== 'single', 'Single-mode dashboard test requires AGENT_TICK_MODE=single server');
	test.skip(!adminToken, 'Set AGENT_TICK_E2E_ADMIN_TOKEN for single-mode dashboard smoke tests');

	await page.addInitScript(({ token }) => {
		window.localStorage.setItem('agent_tick_admin_token', token);
	}, { token: adminToken! });

	await page.goto('/settings', { waitUntil: 'networkidle' });
	await expect(page.getByRole('heading', { name: 'Workspace operations' })).toBeVisible();
	await expect(page.getByText('Personal · owner')).toBeVisible();

	const stamp = Date.now();
	await page.getByLabel('New Agent Token label').fill(`Single Agent ${stamp}`);
	await page.getByRole('button', { name: 'Create Agent Token' }).click();
	const agentToken = (await page.locator('code', { hasText: /^agent_/ }).last().innerText()).trim();
	expect(agentToken).toMatch(/^agent_/);

	const created = await request.post(`${baseURL}/v1/requests`, {
		headers: { authorization: `Bearer ${agentToken}` },
		data: {
			requester: { name: `Single Agent ${stamp}` },
			requestType: 'sanction',
			title: `Single Request ${stamp}`,
			choices: [
				{ id: 'approve', label: 'Approve', kind: 'approve' },
				{ id: 'deny', label: 'Deny', kind: 'deny' }
			]
		}
	});
	expect(created.ok()).toBeTruthy();

	await page.getByRole('button', { name: 'Activity' }).click();
	const requestRow = page.locator('button.activity-row', { hasText: `Single Request ${stamp}` });
	await expect(requestRow).toBeVisible();
	await requestRow.click();
	await page.getByRole('button', { name: 'Approve' }).click();
	await expect(page.getByText('responded')).toBeVisible();

	await page.getByRole('button', { name: 'Settings' }).click();
	const tokenRow = page.locator('.item-row', { hasText: `Single Agent ${stamp}` });
	page.once('dialog', (dialog) => void dialog.accept());
	await tokenRow.getByRole('button', { name: 'Revoke' }).click();
	await expect(tokenRow).toHaveClass(/muted/);
});
