export type Page = 'setup' | 'activity' | 'settings' | 'cli-authorize';
export type ConsoleLoadKey = 'setup' | 'activity' | 'settings';

export interface SetupStatusInput {
	hasActiveDevice: boolean;
	hasActiveAgent: boolean;
}

export function defaultPageForSetupStatus(_input: SetupStatusInput): Page {
	return 'setup';
}

export function pageFromPath(pathname: string, search = ''): Page {
	const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
	if (params.has('cli_callback') && params.has('cli_state')) return 'cli-authorize';
	const path = pathname.replace(/\/+$/, '') || '/';
	if (path === '/' || path === '/setup') return 'setup';
	if (path === '/activity') return 'activity';
	if (path === '/settings') return 'settings';
	return 'setup';
}

export function pageFromHash(hash: string, _isWorkspaceAdmin = false, defaultPage: Page = 'setup'): Page {
	const page = hash.replace(/^#\/?/, '');
	if (!page) return defaultPage;
	if (page === 'activity') return 'activity';
	if (page === 'settings') return 'settings';
	return 'setup';
}

export function refreshLoadKeys(activePage: Page): ConsoleLoadKey[] {
	if (activePage === 'activity') return ['activity'];
	if (activePage === 'settings') return ['settings'];
	return ['setup'];
}

export interface EntitlementPanelInput {
	activePage: Page;
	isWorkspaceOwner: boolean;
	billingPlan?: string;
	billingError?: string;
}

export function shouldShowEntitlementStatus(input: EntitlementPanelInput): boolean {
	return input.activePage === 'settings' && (input.isWorkspaceOwner || Boolean(input.billingPlan) || Boolean(input.billingError?.trim()));
}
