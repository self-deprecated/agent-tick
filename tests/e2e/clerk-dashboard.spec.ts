import { expect, test } from '@playwright/test';

const email = process.env.AGENT_TICK_E2E_CLERK_EMAIL;
const password = process.env.AGENT_TICK_E2E_CLERK_PASSWORD;
const hasClerkCredentials = Boolean(email && password);

test('Clerk sign-in lands on a usable dashboard', async ({ page, baseURL }) => {
	test.skip(!hasClerkCredentials, 'Set AGENT_TICK_E2E_CLERK_EMAIL/PASSWORD for Clerk dashboard smoke tests');

	await page.goto('/', { waitUntil: 'networkidle' });
	await expect(page.getByText('Human approvals for agent actions')).toBeVisible();
	await expect(page.getByText('__PUBLIC_URL__')).toHaveCount(0);

	await page.getByRole('button', { name: /sign in to agent tick/i }).click();
	await page.waitForURL(/accounts\.dev\/sign-in/, { timeout: 30_000 });
	await page.getByRole('textbox', { name: /email/i }).fill(email!);
	await page.getByRole('textbox', { name: /^password$/i }).fill(password!);
	await page.getByRole('button', { name: /^continue$/i }).click();
	await page.waitForURL(baseURL ?? '**', { timeout: 60_000 });

	await expect(page.getByText('Signed in with Clerk.')).toBeVisible();
	await expect(page.getByRole('heading', { name: 'Organization' })).toBeVisible();
	await expect(page.getByRole('heading', { name: 'Create an agent token' })).toBeVisible();
});

test('dashboard can create local resources and approve an agent request', async ({ page, request, baseURL }) => {
	test.skip(!hasClerkCredentials, 'Set AGENT_TICK_E2E_CLERK_EMAIL/PASSWORD for Clerk dashboard smoke tests');

	await signIn(page);
	const stamp = Date.now();

	await page.getByLabel('Invite label').fill(`E2E Invite ${stamp}`);
	await page.getByRole('button', { name: 'Create invite' }).click();
	await expect(page.getByText('Invite created:')).toBeVisible();
	await expect(page.locator('strong', { hasText: `E2E Invite ${stamp}` })).toBeVisible();

	await page.getByLabel('Project name').fill(`E2E Project ${stamp}`);
	await page.getByRole('button', { name: 'Create project' }).click();
	await expect(page.locator('strong', { hasText: `E2E Project ${stamp}` })).toBeVisible();

	await page.getByLabel('Team name').fill(`E2E Team ${stamp}`);
	await page.getByRole('button', { name: 'Create team' }).click();
	await expect(page.locator('strong', { hasText: `E2E Team ${stamp}` })).toBeVisible();

	await page.getByLabel('Policy name').fill(`E2E Policy ${stamp}`);
	await page.getByRole('button', { name: 'Create policy' }).click();
	await expect(page.locator('strong', { hasText: `E2E Policy ${stamp}` })).toBeVisible();

	await page.getByLabel('Agent name').fill(`E2E Agent ${stamp}`);
	await page.getByRole('button', { name: 'Create token' }).click();
	const agentToken = (await page.locator('code', { hasText: /^agent_/ }).last().innerText()).trim();
	expect(agentToken).toMatch(/^agent_/);

	const created = await request.post(`${baseURL}/v1/approval-requests`, {
		headers: { authorization: `Bearer ${agentToken}` },
		data: {
			requester: { name: `E2E Agent ${stamp}` },
			title: `E2E approval ${stamp}`,
			body: 'Created by Playwright to verify the Clerk dashboard flow.',
			command: 'echo playwright',
			choices: [
				{ id: 'approve', label: 'Approve', kind: 'approve' },
				{ id: 'reject', label: 'Reject', kind: 'reject' }
			]
		}
	});
	expect(created.ok()).toBeTruthy();

	await page.getByRole('button', { name: 'Refresh approvals' }).click();
	await expect(page.getByRole('heading', { name: `E2E approval ${stamp}` })).toBeVisible();
	await page.getByRole('button', { name: 'Approve' }).first().click();
	await expect(page.getByText('Response: approve')).toBeVisible();
});

async function signIn(page: import('@playwright/test').Page): Promise<void> {
	await page.goto('/', { waitUntil: 'networkidle' });
	await page.getByRole('button', { name: /sign in to agent tick/i }).click();
	await page.waitForURL(/accounts\.dev\/sign-in/, { timeout: 30_000 });
	await page.getByRole('textbox', { name: /email/i }).fill(email!);
	await page.getByRole('textbox', { name: /^password$/i }).fill(password!);
	await page.getByRole('button', { name: /^continue$/i }).click();
	await expect(page.getByText('Signed in with Clerk.')).toBeVisible({ timeout: 60_000 });
}
