import type { AgentTokenRecord, DeviceRecord, OnboardingStatus, RoutingPreview, RoutingRuleRecord, WorkspaceMemberRecord } from '@self-deprecated/agent-tick-sdk';

export type Page = 'root' | 'setup' | 'connections' | 'workspace' | 'activity' | 'settings' | 'cli-authorize';
export type RootLandingPage = 'workspace' | 'connections' | 'activity';
export type ShellPage = RootLandingPage | 'settings';
export type ConsoleLoadKey = 'setup' | 'activity' | 'settings';
export type WorkspaceReadinessReason = 'shared_needs_members' | 'needs_approval_device' | 'needs_agent_connection' | 'needs_route_health';

export interface SetupStatusInput {
	hasActiveDevice: boolean;
	hasActiveAgent: boolean;
}

export interface WorkspaceReadinessInput {
	workspace?: Pick<WorkspaceMemberRecord, 'type'>;
	activeMemberCount?: number;
	memberCount?: number;
	onboarding?: Pick<OnboardingStatus, 'hasAgentCheckIn' | 'hasMobileDevice' | 'activeMobileDeviceCount' | 'connectedAgentCount'>;
	agentTokens?: Array<Pick<AgentTokenRecord, 'revokedAt' | 'lastActivityAt' | 'lastCheckInAt' | 'routingRuleId'>>;
	devices?: Array<Pick<DeviceRecord, 'unregisteredAt' | 'expoPushToken'>>;
	routingRules?: Array<Pick<RoutingRuleRecord, 'routingRuleId' | 'recipientUserIds'>>;
	routingPreviews?: Record<string, Pick<RoutingPreview, 'status'>>;
	pendingRequestCount?: number;
}

export interface WorkspaceReadiness {
	landingPage: RootLandingPage;
	ready: boolean;
	memberReady: boolean;
	approvalDeviceReady: boolean;
	agentConnectionReady: boolean;
	routeHealthReady: boolean;
	pendingRequestCount: number;
	reasons: WorkspaceReadinessReason[];
}

export function selectedWorkspaceReadiness(input: WorkspaceReadinessInput): WorkspaceReadiness {
	const workspaceType = input.workspace?.type ?? 'personal';
	const activeMemberCount = input.activeMemberCount ?? input.memberCount ?? (workspaceType === 'personal' ? 1 : 0);
	const activeDevices = (input.devices ?? []).filter((device) => !device.unregisteredAt);
	const activeAgentTokens = (input.agentTokens ?? []).filter((token) => !token.revokedAt);
	const connectedAgentTokens = activeAgentTokens.filter((token) => Boolean(token.lastCheckInAt || token.lastActivityAt));
	const memberReady = workspaceType !== 'shared' || activeMemberCount >= 2;
	const approvalDeviceReady = (input.onboarding?.hasMobileDevice ?? ((input.onboarding?.activeMobileDeviceCount ?? 0) > 0)) || activeDevices.some((device) => Boolean(device.expoPushToken));
	const agentConnectionReady = (input.onboarding?.hasAgentCheckIn ?? ((input.onboarding?.connectedAgentCount ?? 0) > 0)) || connectedAgentTokens.length > 0;
	const routeHealthReady = workspaceType !== 'shared' || !memberReady || hasHealthySharedRoute(connectedAgentTokens, input.routingRules ?? [], input.routingPreviews ?? {});
	const reasons: WorkspaceReadinessReason[] = [];
	if (!memberReady) reasons.push('shared_needs_members');
	if (!approvalDeviceReady) reasons.push('needs_approval_device');
	if (!agentConnectionReady) reasons.push('needs_agent_connection');
	if (!routeHealthReady) reasons.push('needs_route_health');
	const landingPage: RootLandingPage = !memberReady ? 'workspace' : reasons.length ? 'connections' : 'activity';
	return {
		landingPage,
		ready: reasons.length === 0,
		memberReady,
		approvalDeviceReady,
		agentConnectionReady,
		routeHealthReady,
		pendingRequestCount: Math.max(0, input.pendingRequestCount ?? 0),
		reasons
	};
}

function hasHealthySharedRoute(
	connectedAgentTokens: Array<Pick<AgentTokenRecord, 'routingRuleId'>>,
	routingRules: Array<Pick<RoutingRuleRecord, 'routingRuleId' | 'recipientUserIds'>>,
	routingPreviews: Record<string, Pick<RoutingPreview, 'status'>>
): boolean {
	if (connectedAgentTokens.length === 0) return false;
	if (routingRules.length === 0) return false;
	return connectedAgentTokens.some((token) => {
		if (!token.routingRuleId) return false;
		const rule = routingRules.find((candidate) => candidate.routingRuleId === token.routingRuleId);
		if (!rule || rule.recipientUserIds.length === 0) return false;
		const preview = routingPreviews[rule.routingRuleId];
		return preview?.status === 'healthy';
	});
}

export function canManageConnections(workspace: Pick<WorkspaceMemberRecord, 'type' | 'role'> | undefined): boolean {
	return workspace?.type === 'shared' && (workspace.role === 'owner' || workspace.role === 'admin');
}

export function defaultPageForSetupStatus(input: SetupStatusInput): Page {
	return selectedWorkspaceReadiness({
		onboarding: {
			hasMobileDevice: input.hasActiveDevice,
			hasAgentCheckIn: input.hasActiveAgent,
			activeMobileDeviceCount: input.hasActiveDevice ? 1 : 0,
			connectedAgentCount: input.hasActiveAgent ? 1 : 0
		}
	}).landingPage;
}

export function pageFromPath(pathname: string, search = ''): Page {
	const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
	if (params.has('cli_callback') && params.has('cli_state')) return 'cli-authorize';
	const path = pathname.replace(/\/+$/, '') || '/';
	if (path === '/') return 'root';
	if (path === '/setup') return 'connections';
	if (path === '/connections') return 'connections';
	if (path === '/workspace' || path === '/members') return 'workspace';
	if (path === '/activity') return 'activity';
	if (path === '/settings') return 'settings';
	return 'setup';
}

export function pathForPage(page: Page): string {
	if (page === 'root') return '/';
	if (page === 'cli-authorize') return windowSafePathname();
	return page === 'setup' ? '/connections' : `/${page}`;
}

function windowSafePathname(): string {
	return typeof window === 'undefined' ? '/' : `${window.location.pathname}${window.location.search}`;
}

export function pageFromHash(hash: string, _isWorkspaceAdmin = false, defaultPage: Page = 'setup'): Page {
	const page = hash.replace(/^#\/?/, '');
	if (!page) return defaultPage;
	if (page === 'activity') return 'activity';
	if (page === 'setup' || page === 'connections') return 'connections';
	if (page === 'workspace' || page === 'members') return 'workspace';
	if (page === 'settings') return 'settings';
	return 'setup';
}

export function refreshLoadKeys(activePage: Page): ConsoleLoadKey[] {
	if (activePage === 'activity') return ['activity'];
	if (activePage === 'settings' || activePage === 'workspace') return ['settings'];
	return ['setup'];
}

export interface EntitlementPanelInput {
	activePage: Page;
	isWorkspaceOwner: boolean;
	billingPlan?: string;
	billingError?: string;
}

export function shouldShowEntitlementStatus(input: EntitlementPanelInput): boolean {
	return input.activePage === 'workspace' && (input.isWorkspaceOwner || Boolean(input.billingPlan) || Boolean(input.billingError?.trim()));
}
