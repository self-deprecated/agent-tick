import { expect, test, type Browser, type Page } from '@playwright/test';

const email = process.env.AGENT_TICK_E2E_CLERK_EMAIL;
const password = process.env.AGENT_TICK_E2E_CLERK_PASSWORD;
const inviteeEmail = process.env.AGENT_TICK_E2E_CLERK_INVITEE_EMAIL;
const inviteePassword = process.env.AGENT_TICK_E2E_CLERK_INVITEE_PASSWORD;
const hasClerkCredentials = Boolean(email && password);
const hasInviteeCredentials = Boolean(inviteeEmail && inviteePassword);

test('Clerk sign-in lands on a polished solo workflow', async ({ page, baseURL }) => {
	test.skip(!hasClerkCredentials, 'Set AGENT_TICK_E2E_CLERK_EMAIL/PASSWORD for Clerk dashboard smoke tests');

	await page.goto('/', { waitUntil: 'networkidle' });
	await expect(page.getByRole('heading', { name: /approve agent actions without slowing down/i })).toBeVisible();
	await expect(page.getByText('__PUBLIC_URL__')).toHaveCount(0);

	await signIn(page, email!, password!, baseURL);

	await expect(page.getByRole('heading', { name: /you're signed in and ready/i })).toBeVisible();
	await expect(page.getByRole('heading', { name: 'Your approval workflow' })).toBeVisible();
	await expect(page.getByText('2. Sign in on mobile', { exact: true })).toBeVisible();
	await expect(page.getByRole('heading', { name: 'Create an agent token' })).toBeVisible();
	await expect(page.getByRole('heading', { name: 'Runtime' })).toHaveCount(0);
	await expect(page.getByRole('heading', { name: 'Invites' })).toHaveCount(0);
	await expect(page.getByRole('heading', { name: 'Pending members' })).toHaveCount(0);
});

test('solo dashboard can connect an agent and approve a request', async ({ page, request, baseURL }) => {
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

	await page.getByRole('button', { name: 'Refresh approvals' }).click();
	const approvalCard = page.locator('li', { hasText: `E2E approval ${stamp}` });
	await expect(approvalCard.getByRole('heading', { name: `E2E approval ${stamp}` })).toBeVisible();
	await approvalCard.getByRole('button', { name: 'Approve' }).click();
	await expect(approvalCard.getByText('Response: approve')).toBeVisible();

	const agentTokensSection = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Create an agent token' }) });
	const agentTokenCard = agentTokensSection.locator('.item-card', { hasText: `E2E Agent ${stamp}` });
	await agentTokenCard.getByRole('button', { name: 'Revoke' }).click();
	await expect(agentTokenCard.getByText(/revoked/i)).toBeVisible();
});

test('team administration is opt-in from the hosted solo dashboard', async ({ page, baseURL }) => {
	test.skip(!hasClerkCredentials, 'Set AGENT_TICK_E2E_CLERK_EMAIL/PASSWORD for Clerk dashboard smoke tests');

	await signIn(page, email!, password!, baseURL);
	await expect(page.getByRole('heading', { name: 'Invites' })).toHaveCount(0);
	await page.getByRole('button', { name: 'Team settings' }).click();
	await expect(page.getByRole('heading', { name: 'Team workspace settings' })).toBeVisible();
	await expect(page.getByRole('heading', { name: 'Invites' })).toBeVisible();
	await expect(page.getByText(/Need teams, projects, policies, or invites/)).toBeVisible();
});

test('Clerk invite acceptance creates a pending member that an admin can approve', async ({ browser, page, baseURL }) => {
	test.skip(!hasClerkCredentials || !hasInviteeCredentials, 'Set owner and invitee Clerk credentials for invite E2E tests');

	await signIn(page, email!, password!, baseURL);
	await page.getByRole('button', { name: 'Team settings' }).click();
	const stamp = Date.now();
	const organizationName = await page.locator('#organization-select option:checked').innerText();

	await page.getByLabel('Invite label').fill(`E2E Member Invite ${stamp}`);
	await page.getByLabel('Invite email').fill(inviteeEmail!);
	await page.getByRole('button', { name: 'Create invite' }).click();
	const inviteURL = await page.locator('.token code').first().innerText();
	const invitePath = new URL(inviteURL).pathname;

	const inviteePage = await newSignedOutPage(browser);
	await inviteePage.goto(invitePath, { waitUntil: 'networkidle' });
	await expect(inviteePage.getByText(organizationName.replace(/ \(.+\)$/, ''))).toBeVisible();
	await signIn(inviteePage, inviteeEmail!, inviteePassword!, baseURL);

	await page.getByRole('button', { name: 'Refresh pending members' }).click();
	const pendingMembersSection = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Pending members' }) });
	const pendingMember = pendingMembersSection.locator('.item-card', { hasText: inviteeEmail! });
	await expect(pendingMember).toBeVisible();
	await pendingMember.getByRole('button', { name: 'Approve' }).click();
	await expect(pendingMember).toHaveCount(0);

	await inviteePage.goto('/', { waitUntil: 'domcontentloaded' });
	await inviteePage.getByRole('button', { name: 'Team settings' }).click();
	await expect(inviteePage.locator('#organization-select')).toContainText(organizationName.replace(/ \(.+\)$/, ''), { timeout: 30_000 });
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

async function newSignedOutPage(browser: Browser): Promise<Page> {
	const context = await browser.newContext();
	return context.newPage();
}
