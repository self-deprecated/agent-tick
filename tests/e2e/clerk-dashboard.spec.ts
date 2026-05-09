import { expect, test, type Page } from '@playwright/test';

const email = process.env.AGENT_TICK_E2E_CLERK_EMAIL;
const password = process.env.AGENT_TICK_E2E_CLERK_PASSWORD;
const hasClerkCredentials = Boolean(email && password);

test('Clerk sign-in lands on a polished solo workflow', async ({ page, baseURL }) => {
	test.skip(!hasClerkCredentials, 'Set AGENT_TICK_E2E_CLERK_EMAIL/PASSWORD for Clerk dashboard smoke tests');

	await page.goto('/', { waitUntil: 'networkidle' });
	await expect(page.getByRole('heading', { name: /approve agent actions without slowing down/i })).toBeVisible();
	await expect(page.getByText('__PUBLIC_URL__')).toHaveCount(0);

	await signIn(page, email!, password!, baseURL);

	await expect(page.getByRole('heading', { name: /you're signed in and ready/i })).toBeVisible();
	await expect(page.getByTestId('solo-onboarding')).toBeVisible();
	await expect(page.getByTestId('onboarding-create-token')).toBeVisible();
	await expect(page.getByTestId('onboarding-mobile-app')).toBeVisible();
	await expect(page.getByRole('heading', { name: 'Create an agent token' })).toBeVisible();
	await expect(page.getByRole('heading', { name: 'Runtime' })).toHaveCount(0);
	await expect(page.getByRole('heading', { name: 'Invites' })).toHaveCount(0);
	await expect(page.getByRole('heading', { name: 'Pending members' })).toHaveCount(0);
});

test('solo dashboard can connect an agent and keeps approvals locked until mobile setup', async ({ page, request, baseURL }) => {
	test.skip(!hasClerkCredentials, 'Set AGENT_TICK_E2E_CLERK_EMAIL/PASSWORD for Clerk dashboard smoke tests');

	await signIn(page, email!, password!, baseURL);
	const stamp = Date.now();

	await page.getByLabel('Agent name').fill(`E2E Agent ${stamp}`);
	await page.getByRole('button', { name: 'Create token' }).click();
	const agentToken = (await page.locator('code', { hasText: /^agent_/ }).last().innerText()).trim();
	expect(agentToken).toMatch(/^agent_/);
	await expect(page.getByText(/agent-tick setup --server/)).toBeVisible();

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

	await page.reload({ waitUntil: 'domcontentloaded' });
	await expect(page.getByTestId('mobile-required')).toBeVisible();
	await expect(page.getByTestId('approval-requests')).toHaveCount(0);

	const agentTokensSection = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Create an agent token' }) });
	const agentTokenCard = agentTokensSection.locator('.item-card', { hasText: `E2E Agent ${stamp}` });
	await agentTokenCard.getByRole('button', { name: 'Revoke' }).click();
	await expect(agentTokenCard.getByText(/revoked/i)).toBeVisible();
});

test('hosted solo dashboard locks collaboration behind upgrade', async ({ page, baseURL }) => {
	test.skip(!hasClerkCredentials, 'Set AGENT_TICK_E2E_CLERK_EMAIL/PASSWORD for Clerk dashboard smoke tests');

	await signIn(page, email!, password!, baseURL);
	await expect(page.getByRole('heading', { name: 'Invites' })).toHaveCount(0);
	await expect(page.getByRole('button', { name: 'Team settings' })).toHaveCount(0);
	await expect(page.getByRole('link', { name: 'Upgrade for teams' })).toBeVisible();
	await expect(page.getByText(/Need teams, projects, policies, or invites/)).toBeVisible();
});

async function signIn(page: Page, userEmail: string, userPassword: string, baseURL?: string): Promise<void> {
	if (!page.url().startsWith('http')) await page.goto('/', { waitUntil: 'networkidle' });
	if (!page.url().includes('accounts.dev')) {
		await page.getByRole('button', { name: /sign in|create account/i }).click();
		await page.waitForURL(/accounts\.dev\/sign-in/, { timeout: 30_000 });
	}
	await page.getByRole('textbox', { name: /email/i }).fill(userEmail);
	await page.getByRole('textbox', { name: /^password$/i }).fill(userPassword);
	await page.getByRole('button', { name: /^continue$/i }).click();
	if (baseURL) {
		const { host } = new URL(baseURL);
		await page.waitForURL((url) => url.host === host, { timeout: 60_000 });
	}
	await expect(page.getByRole('heading', { name: /you're signed in and ready/i })).toBeVisible({ timeout: 60_000 });
}
