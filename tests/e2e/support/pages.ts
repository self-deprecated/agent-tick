import { expect, type Page } from '@playwright/test';

export async function expectSetupPage(page: Page): Promise<void> {
  await expect(page.getByRole('heading', { name: 'Make this Workspace ready' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Setup' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Activity' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Settings' })).toBeVisible();
}

export async function expectNoPendingRequests(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Activity' }).click();
  await expect(page.getByText('No routed Activity yet.')).toBeVisible();
}
