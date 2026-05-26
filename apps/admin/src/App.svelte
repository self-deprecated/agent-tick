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
		type RoutingRuleRecord,
		type SendTestActivityResponse,
		type WorkspaceMemberRecord
	} from '@agent-tick/sdk';
	import type { Clerk as ClerkJS } from '@clerk/clerk-js';
	import ConsoleHeader from './components/ConsoleHeader.svelte';
	import SetupPage from './components/SetupPage.svelte';
	import ActivityPage from './components/ActivityPage.svelte';
	import SettingsPage from './components/SettingsPage.svelte';
	import type { AdminConfig } from './app';
	import { clerkRedirectTarget, hasClerkRedirectCallback } from './clerkRedirect';
	import { pageFromPath, type Page } from './pageRouting';
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
	let selectedWorkspaceId = $state('');
	let activity = $state<ActivityItem[]>([]);
	let agentTokens = $state<AgentTokenRecord[]>([]);
	let routingRules = $state<RoutingRuleRecord[]>([]);
	let devices = $state<DeviceRecord[]>([]);
	let auditEvents = $state<AuditEventRecord[]>([]);
	let billingStatus = $state<BillingStatus | undefined>();
	let onboardingStatus = $state<OnboardingStatus | undefined>();
	let createdCredential = $state<AgentCredential | undefined>();
	let selectedRequestId = $state('');
	let selectedTestAgentTokenId = $state('');
	let testBusy = $state<'' | 'status' | 'steering' | 'sanction'>('');
	let lastTest = $state<(SendTestActivityResponse & { sentAt: string }) | undefined>();
	let respondingRequestId = $state('');
	let newWorkspaceName = $state('');
	let newTokenLabel = $state(hostLabel());
	let newRoutingRuleName = $state('');
	let newRoutingRuleRecipients = $state('');
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


	type CliSetupRequest = { callbackURL: string; state: string; name: string; server: string };
	let selectedWorkspace = $derived(workspaces.find((workspace) => workspace.workspaceId === selectedWorkspaceId) ?? workspaces[0]);
	let pendingRequestCount = $derived(activity.filter((item) => item.kind === 'request' && item.request.status === 'pending').length);
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
		syncCliSetupFromLocation();
		const onPopState = () => {
			activePage = pageFromPath(window.location.pathname, window.location.search);
			syncCliSetupFromLocation();
		};
		window.addEventListener('popstate', onPopState);
		void loadLocalePreference();
		void load();
		return () => window.removeEventListener('popstate', onPopState);
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
		const nextClerk = new Clerk(nextConfig.clerkPublishableKey);
		await nextClerk.load();
		if (hasClerkRedirectCallback(window.location.href)) {
			const redirectTarget = clerkRedirectTarget(window.location.href);
			await nextClerk.handleRedirectCallback({
				signInFallbackRedirectUrl: redirectTarget,
				signUpFallbackRedirectUrl: redirectTarget,
				signInForceRedirectUrl: redirectTarget,
				signUpForceRedirectUrl: redirectTarget
			});
		}
		clerk = nextClerk;
		clerkSignedIn = nextClerk.isSignedIn;
		nextClerk.addListener(() => {
			clerkSignedIn = nextClerk.isSignedIn;
			if (nextClerk.isSignedIn) void refreshWorkspaceData();
		});
		if (nextClerk.isSignedIn) {
			await refreshWorkspaceData();
		} else {
			await redirectToClerkAccount();
		}
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

	async function signOut(): Promise<void> {
		await clerk?.signOut();
		clerkSignedIn = false;
		currentUser = undefined;
		workspaces = [];
		activity = [];
		agentTokens = [];
		routingRules = [];
		devices = [];
	}

	async function refreshWorkspaceData(): Promise<void> {
		const baseClient = apiClient({ includeWorkspace: false });
		const memberships = await baseClient.listWorkspaces();
		workspaces = memberships;
		const savedWorkspaceId = localStorage.getItem(workspaceStorageKey) ?? '';
		const nextWorkspaceId = memberships.some((workspace) => workspace.workspaceId === selectedWorkspaceId)
			? selectedWorkspaceId
			: memberships.some((workspace) => workspace.workspaceId === savedWorkspaceId)
				? savedWorkspaceId
				: memberships[0]?.workspaceId ?? '';
		selectedWorkspaceId = nextWorkspaceId;
		if (nextWorkspaceId) localStorage.setItem(workspaceStorageKey, nextWorkspaceId);
		if (!nextWorkspaceId) return;
		const scoped = apiClient();
		const activityRequest = activePage === 'activity'
			? scoped.listActivityHistory({ workspaceId: nextWorkspaceId, limit: 100 })
			: scoped.listActivity({ workspaceId: nextWorkspaceId, limit: 30 });
		const [me, nextActivity, nextTokens, nextRules, nextDevices, nextAudit, nextBilling, nextOnboarding] = await Promise.all([
			scoped.getMe().catch(() => undefined),
			activityRequest.catch(() => []),
			scoped.listAgentTokens().catch(() => []),
			scoped.listRoutingRules({ workspaceId: nextWorkspaceId }).catch(() => []),
			scoped.listDevices().catch(() => []),
			scoped.listAuditEvents({ limit: 25 }).catch(() => []),
			scoped.getBillingStatus().catch(() => undefined),
			scoped.getOnboardingStatus().catch(() => undefined)
		]);
		currentUser = me;
		activity = nextActivity;
		agentTokens = nextTokens;
		routingRules = nextRules;
		devices = nextDevices;
		auditEvents = nextAudit;
		billingStatus = nextBilling;
		onboardingStatus = nextOnboarding;
		if (!selectedRequestId) selectedRequestId = activity.find((item) => item.kind === 'request')?.id ?? '';
	}

	async function selectWorkspace(workspaceId: string): Promise<void> {
		selectedWorkspaceId = workspaceId;
		localStorage.setItem(workspaceStorageKey, workspaceId);
		createdCredential = undefined;
		selectedRequestId = '';
		await refreshWorkspaceData();
	}

	function navigate(page: 'setup' | 'activity' | 'settings'): void {
		activePage = page;
		const path = page === 'setup' ? '/setup' : `/${page}`;
		window.history.pushState({}, '', path);
		if (page === 'activity') void refreshWorkspaceData();
	}

	async function createSharedWorkspace(): Promise<void> {
		const name = newWorkspaceName.trim() || window.prompt('Shared Workspace name')?.trim() || '';
		if (!name) return;
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

	async function createRoutingRule(): Promise<void> {
		if (!selectedWorkspaceId) return;
		const recipientUserIds = newRoutingRuleRecipients.split(',').map((value) => value.trim()).filter(Boolean);
		if (!newRoutingRuleName.trim() || recipientUserIds.length === 0) {
			window.alert('Routing Rules require a name and at least one recipient user ID.');
			return;
		}
		await apiClient().createRoutingRule({
			workspaceId: selectedWorkspaceId,
			name: newRoutingRuleName.trim(),
			recipientUserIds,
			requiredResponseMode: 'any_one',
			requiredResponseCount: 1
		});
		newRoutingRuleName = '';
		newRoutingRuleRecipients = '';
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
		try {
			const token = selectedTestAgentTokenId || agentTokens.find((entry) => !entry.revokedAt && (selectedWorkspace?.type === 'personal' || entry.routingRuleId))?.agentTokenId;
			lastTest = { ...(await apiClient().sendTestActivity({ kind, context: options.routingRuleId ? 'routing_rule' : 'setup', workspaceId: selectedWorkspaceId, agentTokenId: token, routingRuleId: options.routingRuleId })), sentAt: new Date().toISOString() };
			await refreshWorkspaceData();
		} finally {
			testBusy = '';
		}
	}

	async function respondToRequest(request: RequestRecord, response: RespondRequest): Promise<void> {
		respondingRequestId = request.id;
		try {
			await apiClient().respondToRequest(request.id, response);
			await refreshWorkspaceData();
		} finally {
			respondingRequestId = '';
		}
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
			const followUpURL = selectedWorkspace?.type === 'shared' && !credential.routingRuleId
				? `${window.location.origin}/settings?highlight=${encodeURIComponent(credential.agentTokenId)}#routing`
				: `${window.location.origin}/setup`;
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

	function openAccount(): void {
		if (runtimeConfig?.authProvider === 'clerk') void clerk?.redirectToUserProfile();
	}

	function messageForError(err: unknown): string {
		if (err instanceof AgentTickApiError) return err.message;
		return err instanceof Error ? err.message : String(err);
	}

	function headerPage(page: Page): 'setup' | 'activity' | 'settings' {
		return page === 'activity' || page === 'settings' ? page : 'setup';
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
			{clerkSignedIn}
			onNavigate={navigate}
			onWorkspaceChange={(workspaceId) => void selectWorkspace(workspaceId)}
			onCreateWorkspace={() => void createSharedWorkspace()}
			onOpenAccount={openAccount}
			onSignOut={signOut}
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
		<div class="panel"><p>Redirecting to sign in…</p><button onclick={() => void redirectToClerkAccount()}>Continue to sign in</button></div>
	{:else if activePage === 'activity'}
		<ActivityPage
			workspace={selectedWorkspace}
			{activity}
			{selectedRequestId}
			{respondingRequestId}
			onSelectRequest={(requestId) => (selectedRequestId = requestId)}
			onRespond={respondToRequest}
			onLoadMore={() => refreshWorkspaceData()}
		/>
	{:else if activePage === 'settings'}
		<SettingsPage
			{workspaces}
			workspace={selectedWorkspace}
			{agentTokens}
			{routingRules}
			{devices}
			{billingStatus}
			{auditEvents}
			{createdCredential}
			{newWorkspaceName}
			{newTokenLabel}
			{newRoutingRuleName}
			{newRoutingRuleRecipients}
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
			onOpenAccount={openAccount}
			onLocaleChange={changeLocalePreference}
			onWorkspaceNameChange={(value) => (newWorkspaceName = value)}
			onTokenLabelChange={(value) => (newTokenLabel = value)}
			onRoutingRuleNameChange={(value) => (newRoutingRuleName = value)}
			onRoutingRuleRecipientsChange={(value) => (newRoutingRuleRecipients = value)}
			onSelectedRoutingRuleChange={() => undefined}
		/>
	{:else}
		<SetupPage
			serverUrl={window.location.origin}
			workspace={selectedWorkspace}
			onboarding={onboardingStatus}
			{agentTokens}
			{routingRules}
			{devices}
			{selectedTestAgentTokenId}
			{testBusy}
			{lastTest}
			onSelectTestAgent={(agentTokenId) => (selectedTestAgentTokenId = agentTokenId)}
			onRunTest={runTest}
		/>
	{/if}
</div>
