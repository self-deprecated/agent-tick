<script lang="ts">
	import { onMount } from 'svelte';
	import {
		AgentTickApiError,
		AgentTickClient,
		type ActivityItem,
		type AgentCredential,
		type AgentTokenRecord,
		type AuditEventRecord,
		type AuthConfig,
		type BillingStatus,
		type DeviceRecord,
		type MeResponse,
		type OnboardingStatus,
		type RequestRecord,
		type RespondRequest,
		type RoutingPreview,
		type RoutingRuleRecord,
		type SendTestActivityResponse,
		type SessionDetail,
		type SessionSummary,
		type WorkspaceMemberRecord
	} from '@self-deprecated/agent-tick-sdk';
	import type { Clerk as ClerkJS } from '@clerk/clerk-js';
	import ConsoleHeader from './components/ConsoleHeader.svelte';
	import SetupPage from './components/SetupPage.svelte';
	import ActivityPage from './components/ActivityPage.svelte';
	import WorkspacePage from './components/WorkspacePage.svelte';
	import SettingsPage from './components/SettingsPage.svelte';
	import type { AdminConfig } from './app';
	import { clerkRedirectTarget, hasClerkRedirectCallback } from './clerkRedirect';
	import { canManageConnections, pageFromPath, pathForPage, selectedWorkspaceReadiness, type Page, type ShellPage } from './pageRouting';
	import { initPlausibleAnalytics, trackPlausibleEvent } from './analytics';
	import {
		activateMessages,
		defaultLocale,
		isSupportedLocale,
		localeName,
		localePreferenceStorageKey,
		resolveLocalePreference,
		supportedLocales,
		systemLocaleFromIntl,
		type LocalePreference,
		type SupportedLocale
	} from '@agent-tick/i18n';

	const adminTokenStorageKey = 'agent_tick_admin_token';
	const workspaceStorageKey = 'agent_tick_workspace_id';
	const testAuthTokenStorageKey = 'agent_tick_test_auth_token';

	let { config: initialConfig }: { config: AdminConfig } = $props();

	let runtimeConfig = $state<AuthConfig | undefined>();
	let clerk = $state<ClerkJS | undefined>();
	let clerkSignedIn = $state(false);
	let currentUser = $state<MeResponse | undefined>();
	let workspaces = $state<WorkspaceMemberRecord[]>([]);
	let workspaceMembers = $state<WorkspaceMemberWithAvailability[]>([]);
	let workspaceMemberCountsById = $state<Record<string, number>>({});
	let selectedWorkspaceId = $state('');
	let activity = $state<ActivityItem[]>([]);
	let sessionSummaries = $state<SessionSummary[]>([]);
	let selectedSessionId = $state('');
	let sessionDetail = $state<SessionDetail | undefined>();
	let activitySessionsError = $state('');
	let agentTokens = $state<AgentTokenRecord[]>([]);
	let routingRules = $state<RoutingRuleRecord[]>([]);
	let routingPreviews = $state<Record<string, RoutingPreview>>({});
	let devices = $state<DeviceRecord[]>([]);
	let auditEvents = $state<AuditEventRecord[]>([]);
	let billingStatus = $state<BillingStatus | undefined>();
	let onboardingStatus = $state<OnboardingStatus | undefined>();
	let createdCredential = $state<AgentCredential | undefined>();
	let selectedRequestId = $state('');
	let selectedTestAgentTokenId = $state('');
	let testBusy = $state<'' | 'status' | 'steering' | 'sanction'>('');
	let lastTest = $state<(SendTestActivityResponse & { sentAt: string }) | undefined>();
	let testError = $state('');
	let respondingRequestId = $state('');
	let newWorkspaceName = $state('');
	let newTokenLabel = $state(hostLabel());
	let newRoutingRuleName = $state('');
	let newRoutingRuleRecipientUserIds = $state<string[]>([]);
	let newRoutingRuleRequiredResponseCount = $state(1);
	let adminToken = $state('');
	let testAuthToken = $state('');
	let activePage = $state<Page>('setup');
	let loading = $state(false);
	let error = $state('');
	let cliSetup = $state<CliSetupRequest | undefined>();
	let cliSetupStatus = $state<'idle' | 'authorizing' | 'complete' | 'cancelled' | 'error'>('idle');
	let cliSetupError = $state('');
	let cliFollowUpURL = $state('');
	let activeLocale = $state<SupportedLocale>(defaultLocale);
	let localePreference = $state<LocalePreference>('system');
	let pendingRequestCount = $state(0);
	let activeClerkOrganizationId = $state<string | null | undefined>();


	type CliSetupRequest = { callbackURL: string; state: string; name: string; server: string };
	type WorkspaceMemberWithAvailability = WorkspaceMemberRecord & { availabilityState?: string; lastSeenAt?: string }; 
	let selectedWorkspace = $derived(workspaces.find((workspace) => workspace.workspaceId === selectedWorkspaceId) ?? workspaces[0]);
	let selectedWorkspaceCanManageConnections = $derived(canManageConnections(selectedWorkspace));
	let localeOptions = $derived([
		{ value: 'system' as LocalePreference, label: 'System' },
		...supportedLocales.map((locale) => ({ value: locale.code as LocalePreference, label: localeName(locale.code) }))
	]);

	function apiClient(options: { includeWorkspace?: boolean } = {}): AgentTickClient {
		return new AgentTickClient({
			baseUrl: window.location.origin,
			tokenProvider: async () => {
				if (runtimeConfig?.testAuth && testAuthToken) return testAuthToken;
				if (runtimeConfig?.authProvider === 'clerk') return (await clerk?.session?.getToken()) ?? null;
				return adminToken || null;
			},
			workspaceIdProvider: options.includeWorkspace === false ? undefined : () => selectedWorkspaceId || selectedWorkspace?.workspaceId || null
		});
	}

	onMount(() => {
		initPlausibleAnalytics();
		adminToken = localStorage.getItem(adminTokenStorageKey) ?? '';
		testAuthToken = localStorage.getItem(testAuthTokenStorageKey) ?? '';
		selectedWorkspaceId = localStorage.getItem(workspaceStorageKey) ?? '';
		activePage = pageFromPath(window.location.pathname, window.location.search);
		selectedSessionId = sessionIdFromLocation();
		syncCliSetupFromLocation();
		const onPopState = () => {
			activePage = pageFromPath(window.location.pathname, window.location.search);
			selectedSessionId = sessionIdFromLocation();
			syncCliSetupFromLocation();
		};
		window.addEventListener('popstate', onPopState);
		void loadLocalePreference();
		void load();
		return () => window.removeEventListener('popstate', onPopState);
	});

	$effect(() => {
		if (!loading && !error && workspaces.length > 0 && activePage === 'workspace' && selectedWorkspace?.type !== 'shared') replacePage('connections');
	});

	async function loadLocalePreference(): Promise<void> {
		const savedPreference = localStorage.getItem(localePreferenceStorageKey);
		localePreference = savedPreference === 'system' || isSupportedLocale(savedPreference) ? savedPreference : 'system';
		activeLocale = await activateMessages(resolveLocalePreference(localePreference, systemLocaleFromIntl()));
	}

	async function changeLocalePreference(nextPreference: LocalePreference): Promise<void> {
		localePreference = nextPreference;
		localStorage.setItem(localePreferenceStorageKey, nextPreference);
		activeLocale = await activateMessages(resolveLocalePreference(nextPreference, systemLocaleFromIntl()));
	}

	function syncCliSetupFromLocation(): void {
		const params = new URLSearchParams(window.location.search);
		const callbackURL = params.get('cli_callback') ?? '';
		const state = params.get('cli_state') ?? '';
		if (!callbackURL || !state) {
			cliSetup = undefined;
			return;
		}
		try {
			const callback = new URL(callbackURL);
			if (callback.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(callback.hostname)) throw new Error('Invalid callback URL');
			cliSetup = {
				callbackURL: callback.toString(),
				state,
				name: params.get('cli_name')?.trim() || hostLabel(),
				server: normalizeCliSetupServer(params.get('cli_server') ?? window.location.origin)
			};
			activePage = 'cli-authorize';
		} catch {
			cliSetupStatus = 'error';
			cliSetupError = 'The CLI sign-in callback URL is invalid. Please retry agent-tick login.';
		}
	}

	function normalizeCliSetupServer(value: string): string {
		const url = new URL(value);
		if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('Invalid CLI server URL');
		return url.toString().replace(/\/$/, '');
	}

	function organizationIdFromClerkResource(resource: unknown): string | null | undefined {
		if (resource === null) return null;
		if (resource === undefined) return undefined;
		const id = (resource as { id?: unknown }).id;
		return typeof id === 'string' && id ? id : undefined;
	}

	function workspaceIdForActiveClerkOrganization(memberships: WorkspaceMemberRecord[]): string {
		if (runtimeConfig?.authProvider !== 'clerk') return '';
		if (activeClerkOrganizationId === null) return memberships.find((workspace) => workspace.type === 'personal')?.workspaceId ?? '';
		if (activeClerkOrganizationId) return memberships.find((workspace) => workspace.type === 'shared' && workspace.clerkOrganizationId === activeClerkOrganizationId)?.workspaceId ?? '';
		return '';
	}

	async function load(): Promise<void> {
		loading = true;
		error = '';
		try {
			runtimeConfig = await apiClient({ includeWorkspace: false }).getAuthConfig();
			if (runtimeConfig.testAuth && testAuthToken) {
				clerkSignedIn = true;
				await refreshWorkspaceData();
			} else if (runtimeConfig.authProvider === 'clerk') {
				await initialiseClerk(runtimeConfig);
			} else {
				await refreshWorkspaceData();
			}
		} catch (err) {
			error = messageForError(err);
		} finally {
			loading = false;
		}
	}

	async function initialiseClerk(nextConfig: AuthConfig): Promise<void> {
		if (!nextConfig.clerkPublishableKey) throw new Error('Missing Clerk publishable key from server auth config');
		const { Clerk } = await import('@clerk/clerk-js');
		const clerkUI = await loadClerkUiBundle(nextConfig.clerkPublishableKey);
		const nextClerk = new Clerk(nextConfig.clerkPublishableKey);
		await nextClerk.load({
			ui: { ClerkUI: clerkUI },
			localization: {
				organizationSwitcher: {
					personalWorkspace: 'Personal Workspace',
					action__createOrganization: 'Create shared workspace'
				}
			}
		} as Parameters<ClerkJS['load']>[0]);
		if (hasClerkRedirectCallback(window.location.href)) {
			const callbackUrl = window.location.href;
			const redirectTarget = clerkRedirectTarget(callbackUrl);
			await nextClerk.handleRedirectCallback({
				signInFallbackRedirectUrl: redirectTarget,
				signUpFallbackRedirectUrl: redirectTarget,
				signInForceRedirectUrl: redirectTarget,
				signUpForceRedirectUrl: redirectTarget
			});
			if (window.location.href === callbackUrl) replaceLocation(redirectTarget);
		}
		clerk = nextClerk;
		clerkSignedIn = nextClerk.isSignedIn;
		activeClerkOrganizationId = organizationIdFromClerkResource((nextClerk as unknown as { organization?: unknown }).organization);
		nextClerk.addListener((resources) => {
			clerkSignedIn = nextClerk.isSignedIn;
			activeClerkOrganizationId = organizationIdFromClerkResource(resources.organization);
			if (nextClerk.isSignedIn) void refreshWorkspaceData();
		});
		if (nextClerk.isSignedIn) {
			await refreshWorkspaceData();
		} else {
			await redirectToClerkAccount();
		}
	}

	type ClerkUiWindow = Window & typeof globalThis & { __internal_ClerkUICtor?: unknown };

	async function loadClerkUiBundle(publishableKey: string): Promise<unknown> {
		const clerkWindow = window as ClerkUiWindow;
		if (clerkWindow.__internal_ClerkUICtor) return clerkWindow.__internal_ClerkUICtor;
		const clerkDomainSegment = publishableKey.split('_')[2];
		if (!clerkDomainSegment) throw new Error('Invalid Clerk publishable key');
		const clerkDomain = atob(clerkDomainSegment).slice(0, -1);
		await new Promise<void>((resolve, reject) => {
			const existingScript = document.getElementById('clerk-ui-bundle') as HTMLScriptElement | null;
			if (existingScript) {
				if (clerkWindow.__internal_ClerkUICtor) resolve();
				else reject(new Error('Clerk UI bundle script is present but UI components are unavailable'));
				return;
			}
			const script = document.createElement('script');
			script.id = 'clerk-ui-bundle';
			script.src = `https://${clerkDomain}/npm/@clerk/ui@1/dist/ui.browser.js`;
			script.async = true;
			script.crossOrigin = 'anonymous';
			script.onload = () => resolve();
			script.onerror = () => reject(new Error('Failed to load Clerk UI bundle'));
			document.head.appendChild(script);
		});
		if (!clerkWindow.__internal_ClerkUICtor) throw new Error('Clerk UI bundle loaded without registering UI components');
		return clerkWindow.__internal_ClerkUICtor;
	}

	async function redirectToClerkAccount(): Promise<void> {
		if (!clerk) return;
		const redirectTarget = clerkRedirectTarget(window.location.href);
		await clerk.redirectToSignIn({
			redirectUrl: redirectTarget,
			signInFallbackRedirectUrl: redirectTarget,
			signUpFallbackRedirectUrl: redirectTarget,
			signInForceRedirectUrl: redirectTarget,
			signUpForceRedirectUrl: redirectTarget
		});
	}

	async function refreshWorkspaceData(): Promise<void> {
		const baseClient = apiClient({ includeWorkspace: false });
		const memberships = await baseClient.listWorkspaces();
		workspaces = memberships;
		const nextWorkspaceMemberCountsById = Object.fromEntries(await Promise.all(memberships.map(async (workspace) => {
			const members = await baseClient.listWorkspaceMembers(workspace.workspaceId).catch(() => []);
			return [workspace.workspaceId, members.filter((member) => member.status !== 'removed').length] as const;
		})));
		workspaceMemberCountsById = nextWorkspaceMemberCountsById;

		const savedWorkspaceId = localStorage.getItem(workspaceStorageKey) ?? '';
		const clerkWorkspaceId = workspaceIdForActiveClerkOrganization(memberships);
		const nextWorkspaceId = clerkWorkspaceId
			|| (memberships.some((workspace) => workspace.workspaceId === selectedWorkspaceId)
				? selectedWorkspaceId
				: memberships.some((workspace) => workspace.workspaceId === savedWorkspaceId)
					? savedWorkspaceId
					: memberships[0]?.workspaceId ?? '');
		selectedWorkspaceId = nextWorkspaceId;
		if (nextWorkspaceId) localStorage.setItem(workspaceStorageKey, nextWorkspaceId);
		if (!nextWorkspaceId) {
			pendingRequestCount = 0;
			workspaceMembers = [];
			sessionSummaries = [];
			selectedSessionId = '';
			sessionDetail = undefined;
			activitySessionsError = '';
			resolveRootLanding('connections');
			return;
		}
		const scoped = apiClient();
		const activityRequest = activePage === 'activity'
			? scoped.listActivityHistory({ workspaceId: nextWorkspaceId, limit: 100 })
			: scoped.listActivity({ workspaceId: nextWorkspaceId, limit: 30 });
		let nextSessionError = '';
		const sessionRequest = scoped.listSessions({ workspaceId: nextWorkspaceId, limit: activePage === 'activity' ? 100 : 30 }).catch((err) => {
			nextSessionError = messageForError(err);
			return [];
		});
		const [me, nextActivity, nextSessions, nextPendingCount, nextMembers, nextTokens, nextRules, nextDevices, nextAudit, nextBilling, nextOnboarding] = await Promise.all([
			scoped.getMe().catch(() => undefined),
			activityRequest.catch(() => []),
			sessionRequest,
			scoped.getPendingRequestCount({ workspaceId: nextWorkspaceId }).catch(() => ({ pendingRequests: 0 })),
			scoped.listWorkspaceMembers(nextWorkspaceId).catch(() => []),
			scoped.listAgentTokens().catch(() => []),
			scoped.listRoutingRules({ workspaceId: nextWorkspaceId }).catch(() => []),
			scoped.listDevices().catch(() => []),
			scoped.listAuditEvents({ limit: 25 }).catch(() => []),
			scoped.getBillingStatus().catch(() => undefined),
			scoped.getOnboardingStatus().catch(() => undefined)
		]);
		currentUser = me;
		activity = nextActivity;
		sessionSummaries = nextSessions;
		activitySessionsError = nextSessionError;
		pendingRequestCount = nextPendingCount.pendingRequests;
		workspaceMembers = nextMembers;
		agentTokens = nextTokens;
		routingRules = nextRules;
		routingPreviews = Object.fromEntries((await Promise.all(nextRules.map(async (rule) => {
			const preview = await scoped.previewRouting({ workspaceId: nextWorkspaceId, routingRuleId: rule.routingRuleId }).catch(() => undefined);
			return preview ? [[rule.routingRuleId, preview] as const] : [];
		}))).flat());
		devices = nextDevices;
		auditEvents = nextAudit;
		billingStatus = nextBilling;
		onboardingStatus = nextOnboarding;
		const requestedSessionId = selectedSessionId || sessionIdFromLocation();
		const nextSelectedSessionId = requestedSessionId && nextSessions.some((session) => session.sessionId === requestedSessionId)
			? requestedSessionId
			: nextSessions[0]?.sessionId ?? '';
		selectedSessionId = nextSelectedSessionId;
		sessionDetail = nextSelectedSessionId ? await scoped.getSession(nextSelectedSessionId, { workspaceId: nextWorkspaceId, limit: 100 }).catch((err) => {
			activitySessionsError = messageForError(err);
			return undefined;
		}) : undefined;
		if (!selectedRequestId) selectedRequestId = sessionDetail?.timeline.find((item) => item.kind === 'request' && item.request.status === 'pending')?.id ?? activity.find((item) => item.kind === 'request')?.id ?? '';
		resolveRootLanding(selectedWorkspaceReadiness({
			workspace: memberships.find((workspace) => workspace.workspaceId === nextWorkspaceId),
			activeMemberCount: nextWorkspaceMemberCountsById[nextWorkspaceId],
			onboarding: nextOnboarding,
			agentTokens: nextTokens,
			routingRules: nextRules,
			routingPreviews,
			devices: nextDevices,
			pendingRequestCount: nextPendingCount.pendingRequests
		}).landingPage);
	}

	function resolveRootLanding(landingPage: 'workspace' | 'connections' | 'activity'): void {
		if (activePage !== 'root') return;
		activePage = landingPage;
		window.history.replaceState({}, '', pathForPage(landingPage));
	}

	async function selectWorkspace(workspaceId: string): Promise<void> {
		const workspace = workspaces.find((candidate) => candidate.workspaceId === workspaceId);
		if (runtimeConfig?.authProvider === 'clerk' && clerk) {
			await clerkSetActiveOrganization(workspace);
		}
		selectedWorkspaceId = workspaceId;
		localStorage.setItem(workspaceStorageKey, workspaceId);
		createdCredential = undefined;
		selectedRequestId = '';
		selectedSessionId = '';
		sessionDetail = undefined;
		await refreshWorkspaceData();
	}

	async function selectSession(sessionId: string): Promise<void> {
		selectedSessionId = sessionId;
		selectedRequestId = '';
		activitySessionsError = '';
		syncSelectedSessionInLocation(sessionId);
		sessionDetail = selectedWorkspaceId ? await apiClient().getSession(sessionId, { workspaceId: selectedWorkspaceId, limit: 100 }).catch((err) => {
			activitySessionsError = messageForError(err);
			return undefined;
		}) : undefined;
	}

	function navigate(page: ShellPage): void {
		activePage = page;
		window.history.pushState({}, '', pathForPage(page));
		if (page === 'activity') void refreshWorkspaceData();
	}

	function replacePage(page: ShellPage): void {
		activePage = page;
		window.history.replaceState({}, '', pathForPage(page));
	}

	function replaceLocation(target: string): void {
		const url = new URL(target);
		if (url.origin === window.location.origin) window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
	}

	function sessionIdFromLocation(): string {
		if (typeof window === 'undefined') return '';
		return new URLSearchParams(window.location.search).get('session') ?? '';
	}

	function syncSelectedSessionInLocation(sessionId: string): void {
		if (typeof window === 'undefined' || activePage !== 'activity') return;
		const url = new URL(window.location.href);
		url.searchParams.set('session', sessionId);
		window.history.replaceState({}, '', `${url.pathname}${url.search}`);
	}

	async function createSharedWorkspace(): Promise<void> {
		const name = newWorkspaceName.trim() || window.prompt('Shared Workspace name')?.trim() || '';
		if (!name) return;
		if (runtimeConfig?.authProvider === 'clerk') {
			await createClerkBackedSharedWorkspace(name);
			newWorkspaceName = '';
			trackPlausibleEvent('onboarding_started', { action: 'clerk_workspace_create' });
			return;
		}
		const membership = await apiClient({ includeWorkspace: false }).createSharedWorkspace({ name });
		newWorkspaceName = '';
		await refreshWorkspaceData();
		await selectWorkspace(membership.workspaceId);
		trackPlausibleEvent('onboarding_started', { action: 'workspace_created' });
	}

	async function createAgentToken(label = newTokenLabel.trim() || hostLabel()): Promise<void> {
		if (!selectedWorkspaceId) return;
		createdCredential = await apiClient().createAgentToken({ label, workspaceId: selectedWorkspaceId });
		newTokenLabel = hostLabel();
		await refreshWorkspaceData();
	}

	async function updateTokenLabel(token: AgentTokenRecord): Promise<void> {
		const label = window.prompt('Agent Token label', token.label)?.trim();
		if (!label || label === token.label) return;
		await apiClient().updateAgentToken(token.agentTokenId, { label });
		await refreshWorkspaceData();
	}

	async function assignTokenRule(token: AgentTokenRecord, routingRuleId: string): Promise<void> {
		await apiClient().updateAgentToken(token.agentTokenId, { routingRuleId: routingRuleId || null });
		await refreshWorkspaceData();
	}

	async function revokeAgentToken(token: AgentTokenRecord): Promise<void> {
		if (!window.confirm(`Revoke Agent Token ${token.label}?`)) return;
		await apiClient().revokeAgentToken(token.agentTokenId);
		await refreshWorkspaceData();
	}

	async function disconnectDevice(device: DeviceRecord): Promise<void> {
		if (!window.confirm(`Disconnect Approval Device ${device.name}?`)) return;
		await apiClient().unpairDevice(device.deviceId);
		await refreshWorkspaceData();
	}

	async function createRoutingRule(): Promise<void> {
		if (!selectedWorkspaceId) return;
		const recipientUserIds = newRoutingRuleRecipientUserIds;
		if (!newRoutingRuleName.trim() || recipientUserIds.length === 0) {
			window.alert('Routing Rules require a name and at least one selected Workspace Member.');
			return;
		}
		await apiClient().createRoutingRule({
			workspaceId: selectedWorkspaceId,
			name: newRoutingRuleName.trim(),
			recipientUserIds,
			requiredResponseMode: 'any_one',
			requiredResponseCount: newRoutingRuleRequiredResponseCount
		});
		newRoutingRuleName = '';
		newRoutingRuleRecipientUserIds = [];
		newRoutingRuleRequiredResponseCount = 1;
		await refreshWorkspaceData();
	}

	function setNewRoutingRuleRecipient(userId: string, selected: boolean): void {
		newRoutingRuleRecipientUserIds = selected
			? Array.from(new Set([...newRoutingRuleRecipientUserIds, userId]))
			: newRoutingRuleRecipientUserIds.filter((candidate) => candidate !== userId);
	}

	async function updateRoutingRuleRecipients(rule: RoutingRuleRecord, recipientUserIds: string[], requiredResponseCount: number): Promise<void> {
		await apiClient().updateRoutingRule(rule.routingRuleId, { recipientUserIds, requiredResponseCount });
		await refreshWorkspaceData();
	}

	async function toggleWorkspacePrivateRequestsRequired(required: boolean): Promise<void> {
		if (!selectedWorkspaceId) return;
		await apiClient().updateWorkspace(selectedWorkspaceId, { privateRequestsRequired: required });
		await refreshWorkspaceData();
	}

	async function deleteRoutingRule(rule: RoutingRuleRecord): Promise<void> {
		if (!window.confirm(`Delete Routing Rule ${rule.name}?`)) return;
		await apiClient().deleteRoutingRule(rule.routingRuleId);
		await refreshWorkspaceData();
	}

	async function runTest(kind: 'status' | 'steering' | 'sanction', options: { routingRuleId?: string } = {}): Promise<void> {
		if (!selectedWorkspaceId) return;
		testBusy = kind;
		testError = '';
		try {
			const token = selectedTestAgentTokenId || agentTokens.find((entry) => !entry.revokedAt && (selectedWorkspace?.type === 'personal' || entry.routingRuleId))?.agentTokenId;
			lastTest = { ...(await apiClient().sendTestActivity({ kind, context: options.routingRuleId ? 'routing_rule' : 'setup', workspaceId: selectedWorkspaceId, agentTokenId: token, routingRuleId: options.routingRuleId })), sentAt: new Date().toISOString() };
			await refreshWorkspaceData();
		} catch (error) {
			testError = testActivityErrorMessage(error);
		} finally {
			testBusy = '';
		}
	}

	/** Safe, SQL-free message for a failed Send Test Activity request, including the server code and request id when present. */
	function testActivityErrorMessage(error: unknown): string {
		if (error instanceof AgentTickApiError) {
			const detail = error.code === 'schema_mismatch'
				? 'The Agent Tick database schema is incompatible with this server. Run migrations or roll back.'
				: (error.message || 'Test activity could not be sent.');
			const ref = error.requestId ? ` (request ${error.requestId})` : '';
			return `${detail}${ref}`;
		}
		return error instanceof Error ? error.message : 'Test activity could not be sent.';
	}

	async function respondToRequest(request: RequestRecord, response: RespondRequest): Promise<void> {
		respondingRequestId = request.id;
		try {
			await apiClient().respondToRequest(request.id, response, { responseSurface: 'web-fallback' });
			await refreshWorkspaceData();
		} finally {
			respondingRequestId = '';
		}
	}

	async function updateOwnAvailability(state: string): Promise<void> {
		await apiClient().setAvailability({ state });
		await refreshWorkspaceData();
	}

	async function authorizeCliSetup(): Promise<void> {
		if (!cliSetup || !selectedWorkspaceId) return;
		cliSetupStatus = 'authorizing';
		cliSetupError = '';
		const followUp = window.open('about:blank', '_blank');
		try {
			const credential = await apiClient().createAgentToken({ label: cliSetup.name, workspaceId: selectedWorkspaceId });
			createdCredential = credential;
			const callback = new URL(cliSetup.callbackURL);
			callback.searchParams.set('state', cliSetup.state);
			callback.searchParams.set('token', credential.token);
			callback.searchParams.set('server', cliSetup.server);
			await fetch(callback.toString(), { method: 'GET', mode: 'no-cors' });
			const followUpURL = `${window.location.origin}/connections`;
			cliFollowUpURL = followUpURL;
			if (followUp) followUp.location.href = followUpURL;
			cliSetupStatus = 'complete';
			await refreshWorkspaceData();
		} catch (err) {
			cliSetupError = messageForError(err);
			cliSetupStatus = 'error';
			if (followUp) followUp.close();
		}
	}

	function cancelCliSetup(): void {
		cliSetupStatus = 'cancelled';
		cliSetupError = 'Authorization cancelled. You can close this tab and retry agent-tick login.';
	}

	async function createClerkBackedSharedWorkspace(name: string): Promise<void> {
		if (!clerk) return;
		const clerkOrganization = clerk as ClerkJS & {
			createOrganization?: (input: { name: string }) => Promise<{ id?: string }>;
			redirectToCreateOrganization?: (props?: Record<string, unknown>) => Promise<void>;
			setActive?: (input: { organization: string | null }) => Promise<void>;
		};
		if (clerkOrganization.createOrganization) {
			const organization = await clerkOrganization.createOrganization({ name });
			if (organization.id && clerkOrganization.setActive) await clerkOrganization.setActive({ organization: organization.id });
			await refreshWorkspaceData();
			return;
		}
		if (clerkOrganization.redirectToCreateOrganization) {
			await clerkOrganization.redirectToCreateOrganization({
				afterCreateOrganizationUrl: '/workspace',
				redirectUrl: '/workspace'
			});
		}
	}

	async function clerkSetActiveOrganization(workspace: WorkspaceMemberRecord | undefined): Promise<void> {
		const setActive = (clerk as (ClerkJS & { setActive?: (input: { organization: string | null }) => Promise<void> }) | undefined)?.setActive;
		if (!setActive) return;
		await setActive({ organization: workspace?.type === 'shared' ? workspace.clerkOrganizationId ?? null : null });
	}

	function messageForError(err: unknown): string {
		if (err instanceof AgentTickApiError) return err.message;
		return err instanceof Error ? err.message : String(err);
	}

	function headerPage(page: Page): ShellPage {
		if (page === 'activity' || page === 'workspace' || page === 'settings') return page;
		return 'connections';
	}

	function hostLabel(): string {
		return typeof window === 'undefined' ? 'Local agent' : `${window.location.hostname || 'local'} agent`;
	}
</script>

<svelte:head>
	<title>Agent Tick Console</title>
</svelte:head>

<div class="shell">
	{#if activePage !== 'cli-authorize'}
		<ConsoleHeader
			activePage={headerPage(activePage)}
			{workspaces}
			{selectedWorkspaceId}
			{clerk}
			{clerkSignedIn}
			{pendingRequestCount}
			onNavigate={navigate}
			onWorkspaceChange={(workspaceId) => void selectWorkspace(workspaceId)}
		/>
	{/if}

	{#if loading}
		<div class="panel"><p>Loading Agent Tick Console…</p></div>
	{:else if error}
		<div class="panel danger-panel"><strong>Error</strong><p>{error}</p><button class="secondary" onclick={() => void load()}>Retry</button></div>
	{:else if cliSetup}
		<section class="focused-flow">
			<p class="eyebrow">CLI authorization</p>
			<h1>Authorize Agent Token</h1>
			<p>Agent Tick CLI requested an Agent Token named <strong>{cliSetup.name}</strong> for server <code>{cliSetup.server}</code>.</p>
			<label>
				<span>Workspace</span>
				<select value={selectedWorkspaceId} onchange={(event) => void selectWorkspace(event.currentTarget.value)}>
					{#each workspaces as workspace (workspace.workspaceId)}<option value={workspace.workspaceId}>{workspace.name} · {workspace.type}</option>{/each}
				</select>
			</label>
			<div class="button-row">
				<button disabled={cliSetupStatus === 'authorizing'} onclick={() => void authorizeCliSetup()}>{cliSetupStatus === 'authorizing' ? 'Authorizing…' : 'Authorize'}</button>
				<button class="secondary" onclick={cancelCliSetup}>Cancel</button>
			</div>
			{#if cliSetupStatus === 'complete'}<p class="success">Agent Token authorized. Return to your terminal.</p>{/if}
			{#if cliFollowUpURL}<p>Follow-up page: <a href={cliFollowUpURL}>{cliFollowUpURL}</a></p>{/if}
			{#if cliSetupError}<p class="warning">{cliSetupError}</p>{/if}
		</section>
	{:else if runtimeConfig?.authProvider === 'clerk' && !clerkSignedIn}
		<div class="panel"><p>Redirecting to sign in…</p></div>
	{:else if activePage === 'activity'}
		<ActivityPage
			workspace={selectedWorkspace}
			{activity}
			sessions={sessionSummaries}
			{selectedSessionId}
			{sessionDetail}
			sessionError={activitySessionsError}
			{selectedRequestId}
			{workspaceMemberCountsById}
			{respondingRequestId}
			onSelectSession={(sessionId) => void selectSession(sessionId)}
			onSelectRequest={(requestId) => (selectedRequestId = requestId)}
			onRespond={respondToRequest}
			onLoadMore={() => refreshWorkspaceData()}
		/>
	{:else if activePage === 'workspace'}
		<WorkspacePage
			workspace={selectedWorkspace}
			{workspaceMembers}
			{workspaceMemberCountsById}
			{selectedWorkspaceId}
			{routingRules}
			{devices}
			{billingStatus}
			{clerk}
			{clerkSignedIn}
			{currentUser}
			onUpdateOwnAvailability={updateOwnAvailability}
			onOpenConnections={() => navigate('connections')}
			onTogglePrivateRequestsRequired={toggleWorkspacePrivateRequestsRequired}
		/>
	{:else if activePage === 'settings'}
		<SettingsPage
			{workspaces}
			workspace={selectedWorkspace}
			{clerk}
			{clerkSignedIn}
			{currentUser}
			{agentTokens}
			{routingRules}
			{devices}
			{onboardingStatus}
			{auditEvents}
			{createdCredential}
			{newWorkspaceName}
			{newTokenLabel}
			{newRoutingRuleName}
			newRoutingRuleRecipients={newRoutingRuleRecipientUserIds.join(',')}
			{activeLocale}
			{localePreference}
			{localeOptions}
			onCreateWorkspace={() => void createSharedWorkspace()}
			onCreateToken={() => void createAgentToken()}
			onUpdateTokenLabel={updateTokenLabel}
			onAssignTokenRule={assignTokenRule}
			onRevokeToken={revokeAgentToken}
			onCreateRoutingRule={() => void createRoutingRule()}
			onDeleteRoutingRule={deleteRoutingRule}
			onRunRuleTest={(rule, kind) => runTest(kind, { routingRuleId: rule.routingRuleId })}
			onLocaleChange={changeLocalePreference}
			onWorkspaceNameChange={(value) => (newWorkspaceName = value)}
			onTokenLabelChange={(value) => (newTokenLabel = value)}
			onRoutingRuleNameChange={(value) => (newRoutingRuleName = value)}
			onRoutingRuleRecipientsChange={() => undefined}
			onSelectedRoutingRuleChange={() => undefined}
		/>
	{:else}
		<SetupPage
			serverUrl={window.location.origin}
			workspace={selectedWorkspace}
			onboarding={onboardingStatus}
			{agentTokens}
			{routingRules}
			{routingPreviews}
			{workspaceMembers}
			{devices}
			{newRoutingRuleName}
			{newRoutingRuleRecipientUserIds}
			{newRoutingRuleRequiredResponseCount}
			{selectedTestAgentTokenId}
			{testBusy}
			{lastTest}
			{testError}
			onSelectTestAgent={(agentTokenId) => (selectedTestAgentTokenId = agentTokenId)}
			onDisconnectDevice={disconnectDevice}
			onAssignTokenRule={selectedWorkspaceCanManageConnections ? assignTokenRule : undefined}
			onCreateRoutingRule={selectedWorkspaceCanManageConnections ? () => void createRoutingRule() : undefined}
			onNewRoutingRuleNameChange={(value) => (newRoutingRuleName = value)}
			onNewRoutingRuleRecipientChange={setNewRoutingRuleRecipient}
			onNewRoutingRuleRequiredResponseCountChange={(value) => (newRoutingRuleRequiredResponseCount = value)}
			onUpdateRoutingRuleRecipients={selectedWorkspaceCanManageConnections ? updateRoutingRuleRecipients : undefined}
			onRunRuleTest={selectedWorkspaceCanManageConnections ? (rule, kind) => runTest(kind, { routingRuleId: rule.routingRuleId }) : undefined}
			onRunTest={runTest}
		/>
	{/if}
</div>
