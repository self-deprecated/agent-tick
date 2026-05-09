import { expect, type Page } from '@playwright/test';

export async function expectSoloOnboarding(page: Page): Promise<void> {
  await expect(page.getByTestId('solo-onboarding')).toBeVisible();
  await expect(page.getByTestId('onboarding-create-token')).toBeVisible();
  await expect(page.getByTestId('onboarding-cli-setup')).toBeVisible();
  await expect(page.getByTestId('onboarding-mobile-app')).toBeVisible();
}

export async function expectApprovalsHidden(page: Page): Promise<void> {
  await expect(page.getByTestId('approval-requests')).toHaveCount(0);
}
