import { expect, test, type Page } from '@playwright/test';

const email = process.env.AGENT_TICK_E2E_CLERK_EMAIL;
const password = process.env.AGENT_TICK_E2E_CLERK_PASSWORD;
const hasClerkCredentials = Boolean(email && password);

test('Clerk sign-in lands on the Personal Console setup workflow', async ({ page, baseURL }) => {
	test.skip(!hasClerkCredentials, 'Set AGENT_TICK_E2E_CLERK_EMAIL/PASSWORD for Clerk dashboard smoke tests');

	await page.goto('/', { waitUntil: 'networkidle' });
	await expect(page.getByText('__PUBLIC_URL__')).toHaveCount(0);

	await signIn(page, email!, password!, baseURL);

	await expect(page.getByRole('heading', { name: 'Make this Workspace ready' })).toBeVisible();
	await expect(page.getByText('Personal · Personal')).toBeVisible();
	await expect(page.getByRole('button', { name: 'Setup' })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Activity' })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Settings' })).toBeVisible();
	await expect(page.getByRole('heading', { name: 'Runtime' })).toHaveCount(0);
});

test('Personal Console can create an Agent Token and show a Request in Activity', async ({ page, request, baseURL }) => {
	test.skip(!hasClerkCredentials, 'Set AGENT_TICK_E2E_CLERK_EMAIL/PASSWORD for Clerk dashboard smoke tests');

	await signIn(page, email!, password!, baseURL);
	const stamp = Date.now();

	await page.getByRole('button', { name: 'Settings' }).click();
	await page.getByLabel('New Agent Token label').fill(`E2E Agent ${stamp}`);
	await page.getByRole('button', { name: 'Create Agent Token' }).click();
	const agentToken = (await page.locator('code', { hasText: /^agent_/ }).last().innerText()).trim();
	expect(agentToken).toMatch(/^agent_/);
	await expect(page.getByText(/agent-tick config --server/)).toBeVisible();

	const created = await request.post(`${baseURL}/v1/requests`, {
		headers: { authorization: `Bearer ${agentToken}` },
		data: {
			requester: { name: `E2E Agent ${stamp}` },
			requestType: 'sanction',
			title: `E2E Request ${stamp}`,
			body: 'Created by Playwright to verify the Clerk Personal Console flow.',
			command: 'echo playwright',
			choices: [
				{ id: 'approve', label: 'Approve', kind: 'approve' },
				{ id: 'deny', label: 'Deny', kind: 'deny' }
			]
		}
	});
	expect(created.ok()).toBeTruthy();

	await page.getByRole('button', { name: 'Activity' }).click();
	await expect(page.getByRole('heading', { name: 'Personal activity' })).toBeVisible();
	await expect(page.getByText(`E2E Request ${stamp}`)).toBeVisible();

	const tokenRow = page.locator('.item-row', { hasText: `E2E Agent ${stamp}` });
	await page.getByRole('button', { name: 'Settings' }).click();
	page.once('dialog', (dialog) => void dialog.accept());
	await tokenRow.getByRole('button', { name: 'Revoke' }).click();
	await expect(tokenRow).toHaveClass(/muted/);
});

test('hosted Personal Console shows Entitlement Status without web checkout', async ({ page, baseURL }) => {
	test.skip(!hasClerkCredentials, 'Set AGENT_TICK_E2E_CLERK_EMAIL/PASSWORD for Clerk dashboard smoke tests');

	await signIn(page, email!, password!, baseURL);
	await page.getByRole('button', { name: 'Settings' }).click();
	await expect(page.getByText('Entitlement Status', { exact: true })).toBeVisible();
	await expect(page.getByRole('link', { name: /upgrade|checkout/i })).toHaveCount(0);
	await expect(page.getByRole('button', { name: /upgrade|checkout/i })).toHaveCount(0);
});

async function signIn(page: Page, userEmail: string, userPassword: string, baseURL?: string): Promise<void> {
	if (!page.url().startsWith('http')) await page.goto('/', { waitUntil: 'networkidle' });
	if (!page.url().includes('accounts.dev')) {
		await page.getByRole('button', { name: /sign in|create account|continue to sign in/i }).click();
		await page.waitForURL(/accounts\.dev\/sign-in/, { timeout: 30_000 });
	}
	await page.getByRole('textbox', { name: /email/i }).fill(userEmail);
	await page.getByRole('textbox', { name: /^password$/i }).fill(userPassword);
	await page.getByRole('button', { name: /^continue$/i }).click();
	if (baseURL) {
		const { host } = new URL(baseURL);
		await page.waitForURL((url) => url.host === host, { timeout: 60_000 });
	}
	await expect(page.getByRole('heading', { name: 'Make this Workspace ready' })).toBeVisible({ timeout: 60_000 });
}
