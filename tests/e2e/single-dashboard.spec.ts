import { expect, test } from '@playwright/test';

const adminToken = process.env.AGENT_TICK_E2E_ADMIN_TOKEN;

test('single mode dashboard works with an admin token', async ({ page, request, baseURL }) => {
	const configResponse = await request.get(`${baseURL}/v1/auth/config`);
	const config = await configResponse.json() as { mode?: string };
	test.skip(config.mode !== 'single', 'Single-mode dashboard test requires AGENT_TICK_MODE=single server');
	test.skip(!adminToken, 'Set AGENT_TICK_E2E_ADMIN_TOKEN for single-mode dashboard smoke tests');

	await page.goto('/', { waitUntil: 'networkidle' });
	await expect(page.getByRole('heading', { name: /approve agent actions without slowing down/i })).toBeVisible();
	await expect(page.getByText('__PUBLIC_URL__')).toHaveCount(0);

	await page.getByLabel('Admin token').fill(adminToken!);
	await page.getByRole('button', { name: 'Save token' }).click();
	await expect(page.getByRole('heading', { name: 'Organization' })).toBeVisible();

	await page.getByRole('button', { name: 'Create pairing code' }).click();
	await expect(page.locator('.token code').filter({ hasText: /^pair_/ })).toBeVisible();

	const stamp = Date.now();
	await page.getByLabel('Invite label').fill(`Single Invite ${stamp}`);
	await page.getByRole('button', { name: 'Create invite' }).click();
	await expect(page.getByText('Invite created:')).toBeVisible();
	const invitesSection = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Invites' }) });
	const inviteCard = invitesSection.locator('.item-card', { hasText: `Single Invite ${stamp}` });
	await expect(inviteCard).toBeVisible();

	await page.getByLabel('Project name').fill(`Single Project ${stamp}`);
	await page.getByRole('button', { name: 'Create project' }).click();
	await expect(page.locator('strong', { hasText: `Single Project ${stamp}` })).toBeVisible();

	await page.getByLabel('Team name').fill(`Single Team ${stamp}`);
	await page.getByRole('button', { name: 'Create team' }).click();
	await expect(page.locator('strong', { hasText: `Single Team ${stamp}` })).toBeVisible();

	await page.getByLabel('Policy name').fill(`Single Policy ${stamp}`);
	await page.getByRole('button', { name: 'Create policy' }).click();
	await expect(page.locator('strong', { hasText: `Single Policy ${stamp}` })).toBeVisible();

	await page.getByLabel('Agent name').fill(`Single Agent ${stamp}`);
	await page.getByRole('button', { name: 'Create token' }).click();
	const agentToken = (await page.locator('code', { hasText: /^agent_/ }).last().innerText()).trim();
	expect(agentToken).toMatch(/^agent_/);

	const created = await request.post(`${baseURL}/v1/approval-requests`, {
		headers: { authorization: `Bearer ${agentToken}` },
		data: {
			requester: { name: `Single Agent ${stamp}` },
			title: `Single approval ${stamp}`,
			choices: [
				{ id: 'approve', label: 'Approve', kind: 'approve' },
				{ id: 'reject', label: 'Reject', kind: 'reject' }
			]
		}
	});
	expect(created.ok()).toBeTruthy();

	await page.getByRole('button', { name: 'Refresh approvals' }).click();
	const approvalCard = page.locator('li', { hasText: `Single approval ${stamp}` });
	await expect(approvalCard.getByRole('heading', { name: `Single approval ${stamp}` })).toBeVisible();
	await approvalCard.getByRole('button', { name: 'Approve' }).click();
	await expect(approvalCard.getByText('Response: approve')).toBeVisible();

	await inviteCard.getByRole('button', { name: 'Revoke' }).click();
	await expect(inviteCard.getByText(/revoked/i)).toBeVisible();
});
