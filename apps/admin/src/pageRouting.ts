export type Page = 'setup' | 'approvals' | 'organization' | 'admin' | 'invite';
export type DashboardLoadKey = 'approvals' | 'devices' | 'agents' | 'organizations';
export type BillingPanelStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface BillingPanelInput {
	activePage: Page;
	isOrgAdmin: boolean;
	isUserMode: boolean;
	billingStatus: BillingPanelStatus;
	billingError: string;
	billingPlan?: string;
}

export interface SetupStatusInput {
	hasActiveDevice: boolean;
	hasActiveAgent: boolean;
}

export function defaultPageForSetupStatus(input: SetupStatusInput): Page {
	return input.hasActiveDevice && input.hasActiveAgent ? 'approvals' : 'setup';
}

export function pageFromHash(hash: string, isOrgAdmin: boolean, defaultPage: Page = 'setup'): Page {
	const page = hash.replace(/^#/, '');
	if (page === '') return defaultPage;
	if (page === 'admin') return isOrgAdmin ? 'admin' : 'setup';
	if (page.startsWith('/invite/') || page.startsWith('invite/')) return 'invite';
	if (page === 'organization') return 'organization';
	if (page === 'approvals') return 'approvals';
	return 'setup';
}

export function refreshLoadKeys(activePage: Page): DashboardLoadKey[] {
	if (activePage === 'invite') return ['organizations'];
	const loads: DashboardLoadKey[] = ['devices', 'agents'];
	if (activePage !== 'approvals') loads.push('approvals');
	if (activePage !== 'organization' && activePage !== 'admin') loads.push('organizations');
	return loads;
}

export function shouldShowBillingPanel(input: BillingPanelInput): boolean {
	if (input.activePage !== 'admin' || !input.isOrgAdmin || !input.isUserMode) return false;
	if (input.billingStatus === 'loading') return true;
	if (input.billingError !== '') return true;
	return input.billingPlan !== undefined && input.billingPlan !== 'self-hosted';
}
