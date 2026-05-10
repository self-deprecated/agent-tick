<script lang="ts">
	import { onMount } from 'svelte';
	import {
		AgentTickApiError,
		AgentTickClient,
		type AcceptInviteResponse,
		type AgentCredential,
		type AgentTokenRecord,
		type ApprovalRequest,
		type AuditEventRecord,
		type AuthConfig,
		type BillingStatus,
		type DeviceRecord,
		type InvitePreview,
		type OrganizationInviteRecord,
		type OrganizationMembership,
		type OrganizationMembershipRequestRecord,
		type OnboardingStatus,
		type PairingToken,
		type PolicyRecord,
		type ProjectRecord,
		type TeamMembership,
		type TeamRecord
	} from '@agent-tick/sdk';
	import type { Clerk as ClerkJS } from '@clerk/clerk-js';
	import AccountEntryCard from './components/AccountEntryCard.svelte';
	import SetupChecklist from './components/SetupChecklist.svelte';
	import type { AdminConfig } from './app';
	import { inviteTokenFromLocation } from './inviteRouting';
	import { inviteAcceptedMessage } from './inviteStatus';
	import { shouldContinueInviteAcceptance } from './inviteFlow';

	const adminTokenStorageKey = 'agent_tick_admin_token';
	const organizationStorageKey = 'agent_tick_organization_id';
	const testAuthTokenStorageKey = 'agent_tick_test_auth_token';

	let { config: initialConfig }: { config: AdminConfig } = $props();
	let runtimeConfig = $state<AuthConfig | undefined>();
	let approvals = $state<ApprovalRequest[]>([]);
	let agentTokens = $state<AgentTokenRecord[]>([]);
	let auditEvents = $state<AuditEventRecord[]>([]);
	let billingStatus = $state<BillingStatus | undefined>();
	let devices = $state<DeviceRecord[]>([]);
	let onboardingStatus = $state<OnboardingStatus | undefined>();
	let organizations = $state<OrganizationMembership[]>([]);
	let organizationInvites = $state<OrganizationInviteRecord[]>([]);
	let organizationMembers = $state<OrganizationMembership[]>([]);
	let membershipRequests = $state<OrganizationMembershipRequestRecord[]>([]);
	let myMembershipRequests = $state<OrganizationMembershipRequestRecord[]>([]);
	let projects = $state<ProjectRecord[]>([]);
	let teams = $state<TeamRecord[]>([]);
	let teamMembers = $state<Record<string, TeamMembership[]>>({});
	let policies = $state<PolicyRecord[]>([]);
	let selectedOrganizationId = $state('');
	let inviteToken = $state('');
	let cliSetup = $state<CliSetupRequest | undefined>();
	let cliSetupStatus = $state<'idle' | 'authorizing' | 'complete' | 'error'>('idle');
	let cliSetupError = $state('');
	let cliSetupAttempted = false;
	let invitePreview = $state<InvitePreview | undefined>();
	let inviteAccepted = $state<AcceptInviteResponse | undefined>();
	let inviteStatus = $state<'idle' | 'loading' | 'ready' | 'accepting' | 'accepted' | 'error'>('idle');
	let inviteError = $state('');
	let inviteAutoAcceptAttempted = $state(false);
	let inviteEmailMessage = $state('');
	let newOrganizationName = $state('');
	let newInviteEmail = $state('');
	let newInviteDomain = $state('');
	let newInviteRole = $state('member');
	let newInviteLabel = $state('');
	let newInviteTeamId = $state('');
	let createdInvite = $state<OrganizationInviteRecord | undefined>();
	let newProjectName = $state('');
	let newTeamName = $state('');
	let selectedTeamForMember = $state('');
	let selectedUserForTeam = $state('');
	let newTeamMemberRole = $state('member');
	let newPolicyName = $state('');
	let newPolicyRequiredApprovals = $state(1);
	let newPolicyProjectId = $state('');
	let newPolicyTeamId = $state('');
	let policyActionId = $state('');
	let createdCredential = $state<AgentCredential | undefined>();
	let pairingToken = $state<PairingToken | undefined>();
	let adminToken = $state('');
	let testAuthToken = $state('');
	let agentName = $state('Local agent');
	let agentProjectId = $state('');
	let agentTeamId = $state('');
	let agentPolicyId = $state('');
	let loading = $state(false);
	let error = $state('');
	let clerk = $state<ClerkJS | undefined>();
	let clerkSignedIn = $state(false);
	let showAdvancedWorkspace = $state(false);
	let eventSource: EventSource | undefined;
	let eventStreamOrganizationId = '';
	let eventStreamRefreshTimer: ReturnType<typeof setTimeout> | undefined;
	let eventStreamReconnectTimer: ReturnType<typeof setTimeout> | undefined;
	type CliSetupRequest = { callbackURL: string; state: string; name: string };

	function client(options: { includeOrganization?: boolean } = {}): AgentTickClient {
		return new AgentTickClient({
			baseUrl: window.location.origin,
			tokenProvider: async () => {
				if (runtimeConfig?.testAuth && testAuthToken) return testAuthToken;
				if (runtimeConfig?.authProvider === 'clerk') return (await clerk?.session?.getToken()) ?? null;
				return adminToken || null;
			},
			organizationIdProvider: options.includeOrganization === false ? undefined : () => selectedOrganizationId || null
		});
	}

	onMount(() => {
		adminToken = localStorage.getItem(adminTokenStorageKey) ?? '';
		testAuthToken = localStorage.getItem(testAuthTokenStorageKey) ?? '';
		selectedOrganizationId = localStorage.getItem(organizationStorageKey) ?? '';
		syncInviteTokenFromLocation();
		syncCliSetupFromLocation();
		const onHashChange = () => syncInviteTokenFromLocation();
		window.addEventListener('hashchange', onHashChange);
		void load();
		return () => {
			window.removeEventListener('hashchange', onHashChange);
			stopEventStream();
		};
	});

	function syncCliSetupFromLocation(): void {
		const params = new URLSearchParams(window.location.search);
		const callbackURL = params.get('cli_callback') ?? '';
		const state = params.get('cli_state') ?? '';
		if (!callbackURL || !state) return;
		try {
			const callback = new URL(callbackURL);
			if (callback.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(callback.hostname)) throw new Error('Invalid callback URL');
			cliSetup = { callbackURL: callback.toString(), state, name: params.get('cli_name')?.trim() || 'Local agent' };
		} catch {
			cliSetupStatus = 'error';
			cliSetupError = 'The CLI setup callback URL is invalid. Please retry agent-tick setup --login.';
		}
	}

	function syncInviteTokenFromLocation(): void {
		const nextToken = inviteTokenFromLocation(window.location.pathname, window.location.hash);
		if (nextToken === inviteToken) return;
		inviteToken = nextToken;
		invitePreview = undefined;
		inviteAccepted = undefined;
		inviteError = '';
		inviteAutoAcceptAttempted = false;
		inviteStatus = nextToken ? 'loading' : 'idle';
		if (nextToken) void refreshInvitePreview(nextToken);
	}

	async function refreshInvitePreview(token = inviteToken): Promise<void> {
		if (!token) return;
		inviteStatus = 'loading';
		inviteError = '';
		try {
			invitePreview = await client({ includeOrganization: false }).previewInvite(token);
			inviteStatus = inviteAccepted ? 'accepted' : 'ready';
		} catch (err) {
			inviteError = messageForError(err);
			inviteStatus = 'error';
		}
	}

	async function acceptCurrentInvite(): Promise<void> {
		if (!inviteToken) return;
		inviteStatus = 'accepting';
		inviteError = '';
		try {
			const accepted = await client({ includeOrganization: false }).acceptInvite(inviteToken);
			inviteAccepted = accepted;
			inviteStatus = 'accepted';
			if (accepted.status === 'pending_approval') {
				await Promise.all([refreshOrganizations(), refreshMyMembershipRequests()]);
			} else {
				await refreshOrganizations();
				await selectOrganization(accepted.membership.organizationId);
			}
		} catch (err) {
			inviteError = messageForError(err);
			inviteStatus = 'error';
		}
	}

	async function maybeAcceptInviteAfterSignIn(): Promise<void> {
		if (!shouldContinueInviteAcceptance({
			inviteToken,
			hasAcceptedInvite: Boolean(inviteAccepted),
			autoAcceptAttempted: inviteAutoAcceptAttempted,
			authProvider: runtimeConfig?.authProvider,
			clerkSignedIn
		})) return;
		inviteAutoAcceptAttempted = true;
		await acceptCurrentInvite();
	}

	async function load(): Promise<void> {
		loading = true;
		error = '';
		try {
			runtimeConfig = await client().getAuthConfig();
			if (runtimeConfig.testAuth && testAuthToken) {
				clerkSignedIn = true;
				await refreshWorkspace();
			} else if (runtimeConfig.authProvider === 'clerk') {
				await initialiseClerk(runtimeConfig);
			} else {
				await refreshWorkspace();
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
		clerk = nextClerk;
		clerkSignedIn = nextClerk.isSignedIn;
		nextClerk.addListener(() => {
			clerkSignedIn = nextClerk.isSignedIn;
			if (nextClerk.isSignedIn) {
				void (async () => {
					await refreshWorkspace();
					await maybeAcceptInviteAfterSignIn();
				})();
			}
		});
		if (nextClerk.isSignedIn) {
			await refreshWorkspace();
			await maybeAcceptInviteAfterSignIn();
		}
	}

	async function signOut(): Promise<void> {
		stopEventStream();
		await clerk?.signOut();
		approvals = [];
		agentTokens = [];
		auditEvents = [];
		billingStatus = undefined;
		devices = [];
		onboardingStatus = undefined;
		organizations = [];
		organizationInvites = [];
		organizationMembers = [];
		membershipRequests = [];
		inviteEmailMessage = '';
		myMembershipRequests = [];
		projects = [];
		teams = [];
		teamMembers = {};
		policies = [];
		selectedOrganizationId = '';
		createdCredential = undefined;
		clerkSignedIn = false;
		testAuthToken = '';
		localStorage.removeItem(testAuthTokenStorageKey);
	}

	async function signInWithClerk(): Promise<void> {
		if (!clerk) return;
		await clerk.redirectToSignIn({
			redirectUrl: window.location.href,
			signInFallbackRedirectUrl: window.location.href,
			signUpFallbackRedirectUrl: window.location.href
		});
	}

	async function refreshWorkspace(): Promise<void> {
		await refreshOrganizations();
		await Promise.all([refreshApprovals(), refreshAgentTokens(), refreshAuditEvents(), refreshBilling(), refreshDevices(), refreshOnboarding(), refreshProjects(), refreshTeams(), refreshPolicies(), refreshInvites(), refreshOrganizationMembers(), refreshMembershipRequests(), refreshMyMembershipRequests()]);
		void ensureEventStream();
	}

	function stopEventStream(): void {
		if (eventStreamReconnectTimer) {
			clearTimeout(eventStreamReconnectTimer);
			eventStreamReconnectTimer = undefined;
		}
		if (eventStreamRefreshTimer) {
			clearTimeout(eventStreamRefreshTimer);
			eventStreamRefreshTimer = undefined;
		}
		eventSource?.close();
		eventSource = undefined;
		eventStreamOrganizationId = '';
	}

	function scheduleEventStreamReconnect(): void {
		if (eventStreamReconnectTimer) return;
		eventStreamReconnectTimer = setTimeout(() => {
			eventStreamReconnectTimer = undefined;
			void ensureEventStream();
		}, 5000);
	}

	async function ensureEventStream(): Promise<void> {
		if (!runtimeConfig || !selectedOrganizationId) {
			stopEventStream();
			return;
		}
		if (runtimeConfig.authProvider === 'clerk' && !clerkSignedIn) {
			stopEventStream();
			return;
		}
		if (eventSource && eventStreamOrganizationId === selectedOrganizationId) return;
		stopEventStream();
		const targetOrganizationId = selectedOrganizationId;
		try {
			const source = await client().openEventStream({ lastEventId: auditEvents[0]?.eventId });
			if (targetOrganizationId !== selectedOrganizationId) {
				source.close();
				return;
			}
			eventSource = source;
			eventStreamOrganizationId = targetOrganizationId;
			source.addEventListener('audit', () => queueEventStreamRefresh());
			source.onerror = () => {
				if (eventSource === source) {
					eventSource = undefined;
					eventStreamOrganizationId = '';
					source.close();
					scheduleEventStreamReconnect();
				}
			};
		} catch {
			scheduleEventStreamReconnect();
		}
	}

	function queueEventStreamRefresh(): void {
		if (eventStreamRefreshTimer) return;
		eventStreamRefreshTimer = setTimeout(() => {
			eventStreamRefreshTimer = undefined;
			void refreshWorkspace();
		}, 250);
	}

	async function refreshOrganizations(): Promise<void> {
		const memberships = await client({ includeOrganization: false }).listOrganizations();
		organizations = memberships;
		const savedOrganizationId = localStorage.getItem(organizationStorageKey) ?? '';
		const currentIsValid = memberships.some((membership) => membership.organizationId === selectedOrganizationId);
		const savedIsValid = memberships.some((membership) => membership.organizationId === savedOrganizationId);
		const nextOrganizationId = currentIsValid
			? selectedOrganizationId
			: savedIsValid
				? savedOrganizationId
				: (memberships[0]?.organizationId ?? '');
		selectedOrganizationId = nextOrganizationId;
		if (nextOrganizationId) localStorage.setItem(organizationStorageKey, nextOrganizationId);
		else localStorage.removeItem(organizationStorageKey);
	}

	async function selectOrganization(organizationId: string): Promise<void> {
		stopEventStream();
		selectedOrganizationId = organizationId;
		if (organizationId) localStorage.setItem(organizationStorageKey, organizationId);
		else localStorage.removeItem(organizationStorageKey);
		createdInvite = undefined;
		inviteEmailMessage = '';
		teamMembers = {};
		await Promise.all([refreshApprovals(), refreshAgentTokens(), refreshAuditEvents(), refreshBilling(), refreshProjects(), refreshTeams(), refreshPolicies(), refreshInvites(), refreshOrganizationMembers(), refreshMembershipRequests()]);
		void ensureEventStream();
	}

	async function createOrganization(): Promise<void> {
		const name = newOrganizationName.trim();
		if (!name) return;
		error = '';
		try {
			const membership = await client({ includeOrganization: false }).createOrganization({ name });
			newOrganizationName = '';
			await refreshOrganizations();
			await selectOrganization(membership.organizationId);
		} catch (err) {
			error = messageForError(err);
		}
	}

	async function refreshInvites(): Promise<void> {
		try {
			organizationInvites = await client().listOrganizationInvites();
		} catch {
			organizationInvites = [];
		}
	}

	async function refreshOrganizationMembers(): Promise<void> {
		if (!selectedOrganizationId) {
			organizationMembers = [];
			return;
		}
		try {
			organizationMembers = await client().listOrganizationMembers(selectedOrganizationId);
		} catch {
			organizationMembers = [];
		}
	}

	async function refreshBilling(): Promise<void> {
		if (!selectedOrganizationId) {
			billingStatus = undefined;
			return;
		}
		try {
			billingStatus = await client().getBillingStatus();
		} catch {
			billingStatus = undefined;
		}
	}

	async function refreshDevices(): Promise<void> {
		try {
			devices = await client().listDevices();
		} catch {
			devices = [];
		}
	}

	async function refreshOnboarding(): Promise<void> {
		try {
			onboardingStatus = await client().getOnboardingStatus();
		} catch {
			onboardingStatus = undefined;
		}
	}

	async function registerDemoMobileDevice(): Promise<void> {
		error = '';
		try {
			if (runtimeConfig?.testAuth) await client().registerDevice({ deviceName: 'Mobile app', platform: 'test' });
			await Promise.all([refreshDevices(), refreshOnboarding(), refreshAuditEvents()]);
		} catch (err) {
			error = messageForError(err);
		}
	}

	async function refreshMembershipRequests(): Promise<void> {
		if (!selectedOrganizationId) {
			membershipRequests = [];
			return;
		}
		try {
			membershipRequests = await client().listMembershipRequests();
		} catch {
			membershipRequests = [];
		}
	}

	async function refreshMyMembershipRequests(): Promise<void> {
		try {
			myMembershipRequests = await client({ includeOrganization: false }).listMyMembershipRequests();
		} catch {
			myMembershipRequests = [];
		}
	}

	async function createInvite(): Promise<void> {
		error = '';
		inviteEmailMessage = '';
		createdInvite = undefined;
		try {
			createdInvite = await client().createOrganizationInvite({
				role: newInviteRole as 'owner' | 'admin' | 'approver' | 'member' | 'viewer',
				...(newInviteTeamId ? { teamIds: [newInviteTeamId] } : {}),
				...(newInviteEmail.trim() ? { email: newInviteEmail.trim() } : {}),
				...(newInviteDomain.trim() ? { domain: newInviteDomain.trim() } : {}),
				...(newInviteLabel.trim() ? { label: newInviteLabel.trim() } : {})
			});
			newInviteEmail = '';
			newInviteDomain = '';
			newInviteLabel = '';
			newInviteRole = 'member';
			newInviteTeamId = '';
			inviteEmailMessage = messageForInviteEmailDelivery(createdInvite.emailDelivery);
			await Promise.all([refreshInvites(), refreshMembershipRequests(), refreshAuditEvents()]);
		} catch (err) {
			error = messageForError(err);
		}
	}

	async function resendInvite(inviteId: string): Promise<void> {
		error = '';
		inviteEmailMessage = '';
		try {
			const result = await client().resendOrganizationInvite(inviteId);
			inviteEmailMessage = messageForInviteEmailDelivery(result.delivery);
			await Promise.all([refreshInvites(), refreshAuditEvents()]);
		} catch (err) {
			error = messageForError(err);
		}
	}

	async function revokeInvite(inviteId: string): Promise<void> {
		error = '';
		try {
			await client().revokeOrganizationInvite(inviteId);
			if (createdInvite?.inviteId === inviteId) createdInvite = undefined;
			await Promise.all([refreshInvites(), refreshAuditEvents()]);
		} catch (err) {
			error = messageForError(err);
		}
	}

	async function copyInvite(): Promise<void> {
		const value = createdInvite?.url ?? createdInvite?.token;
		if (!value) return;
		await navigator.clipboard?.writeText(value);
	}

	async function approveMembershipRequest(requestId: string): Promise<void> {
		error = '';
		try {
			await client().approveMembershipRequest(requestId);
			await Promise.all([refreshMembershipRequests(), refreshMyMembershipRequests(), refreshOrganizationMembers(), refreshBilling(), refreshAuditEvents(), refreshOrganizations()]);
		} catch (err) {
			error = messageForError(err);
		}
	}

	async function rejectMembershipRequest(requestId: string): Promise<void> {
		error = '';
		try {
			await client().rejectMembershipRequest(requestId);
			await Promise.all([refreshMembershipRequests(), refreshMyMembershipRequests(), refreshOrganizationMembers(), refreshBilling(), refreshAuditEvents()]);
		} catch (err) {
			error = messageForError(err);
		}
	}

	async function refreshApprovals(): Promise<void> {
		error = '';
		try {
			approvals = await client().listApprovalRequests();
		} catch (err) {
			error = messageForError(err);
			approvals = [];
		}
	}

	async function refreshAgentTokens(): Promise<void> {
		try {
			agentTokens = await client().listAgentTokens();
		} catch {
			agentTokens = [];
		}
	}

	async function refreshProjects(): Promise<void> {
		try {
			projects = await client().listProjects();
		} catch {
			projects = [];
		}
	}

	async function createProject(): Promise<void> {
		const name = newProjectName.trim();
		if (!name) return;
		error = '';
		try {
			await client().createProject({ name });
			newProjectName = '';
			await Promise.all([refreshProjects(), refreshAuditEvents()]);
		} catch (err) {
			error = messageForError(err);
		}
	}

	async function refreshTeams(): Promise<void> {
		try {
			teams = await client().listTeams();
			if (!selectedTeamForMember && teams[0]) selectedTeamForMember = teams[0].teamId;
			await Promise.all(teams.map((team) => refreshTeamMembers(team.teamId)));
		} catch {
			teams = [];
			teamMembers = {};
		}
	}

	async function refreshTeamMembers(teamId: string): Promise<void> {
		try {
			const members = await client().listTeamMembers(teamId);
			teamMembers = { ...teamMembers, [teamId]: members };
		} catch {
			teamMembers = { ...teamMembers, [teamId]: [] };
		}
	}

	async function createTeam(): Promise<void> {
		const name = newTeamName.trim();
		if (!name) return;
		error = '';
		try {
			const team = await client().createTeam({ name });
			newTeamName = '';
			selectedTeamForMember = team.teamId;
			await Promise.all([refreshTeams(), refreshAuditEvents()]);
		} catch (err) {
			error = messageForError(err);
		}
	}

	async function addTeamMember(): Promise<void> {
		if (!selectedTeamForMember || !selectedUserForTeam) return;
		error = '';
		try {
			await client().upsertTeamMember(selectedTeamForMember, { userId: selectedUserForTeam, role: newTeamMemberRole as 'owner' | 'lead' | 'member' | 'viewer' });
			newTeamMemberRole = 'member';
			await Promise.all([refreshTeamMembers(selectedTeamForMember), refreshAuditEvents()]);
		} catch (err) {
			error = messageForError(err);
		}
	}

	async function removeTeamMember(teamId: string, userId: string): Promise<void> {
		error = '';
		try {
			await client().removeTeamMember(teamId, userId);
			await Promise.all([refreshTeamMembers(teamId), refreshAuditEvents()]);
		} catch (err) {
			error = messageForError(err);
		}
	}

	async function refreshPolicies(): Promise<void> {
		try {
			policies = await client().listPolicies();
		} catch {
			policies = [];
		}
	}

	async function createPolicy(): Promise<void> {
		const name = newPolicyName.trim();
		if (!name) return;
		error = '';
		try {
			await client().createPolicy({
				name,
				requiredApprovals: newPolicyRequiredApprovals,
				...(newPolicyProjectId ? { projectId: newPolicyProjectId } : {}),
				...(newPolicyTeamId ? { teamId: newPolicyTeamId } : {})
			});
			newPolicyName = '';
			newPolicyRequiredApprovals = 1;
			newPolicyProjectId = '';
			newPolicyTeamId = '';
			await Promise.all([refreshPolicies(), refreshAuditEvents()]);
		} catch (err) {
			error = messageForError(err);
		}
	}

	async function updatePolicyStatus(policy: PolicyRecord, changes: { enabled?: boolean; archived?: boolean }): Promise<void> {
		policyActionId = policy.policyId;
		error = '';
		try {
			await client().updatePolicy(policy.policyId, changes);
			await Promise.all([refreshPolicies(), refreshAuditEvents()]);
		} catch (err) {
			error = messageForError(err);
		} finally {
			policyActionId = '';
		}
	}

	function projectLabel(projectId: string): string {
		const project = projects.find((entry) => entry.projectId === projectId);
		return project ? `${project.name} (${project.slug})` : projectId;
	}

	function teamLabel(teamId: string): string {
		const team = teams.find((entry) => entry.teamId === teamId);
		return team ? `${team.name} (${team.slug})` : teamId;
	}

	function seatUsageLabel(status: BillingStatus): string {
		return status.limits.seats ? `${status.usage.activeMembers}/${status.limits.seats} active seats` : `${status.usage.activeMembers} active seats (no configured limit)`;
	}

	function messageForInviteEmailDelivery(delivery: OrganizationInviteRecord['emailDelivery']): string {
		if (!delivery) return '';
		if (delivery.status === 'sent') return `Invite email sent${delivery.recipient ? ` to ${delivery.recipient}` : ''}.`;
		if (delivery.status === 'skipped') return delivery.message ?? 'Invite email was skipped.';
		return delivery.message ?? 'Invite email delivery failed.';
	}

	async function refreshAuditEvents(): Promise<void> {
		try {
			auditEvents = await client().listAuditEvents({ limit: 10 });
		} catch {
			auditEvents = [];
		}
	}

	async function saveAdminToken(): Promise<void> {
		adminToken = adminToken.trim();
		if (adminToken) localStorage.setItem(adminTokenStorageKey, adminToken);
		else localStorage.removeItem(adminTokenStorageKey);
		await refreshWorkspace();
	}

	async function createPairingToken(): Promise<void> {
		error = '';
		pairingToken = undefined;
		try {
			pairingToken = await client().createPairingToken();
		} catch (err) {
			error = messageForError(err);
		}
	}

	async function maybeCompleteCliSetup(): Promise<void> {
		if (!cliSetup || cliSetupAttempted || !selectedOrganizationId) return;
		if (runtimeConfig?.authProvider === 'clerk' && !clerkSignedIn) return;
		cliSetupAttempted = true;
		cliSetupStatus = 'authorizing';
		cliSetupError = '';
		try {
			const credential = await client().createAgentToken({ name: cliSetup.name });
			cliSetupStatus = 'complete';
			postCliSetupCallback(cliSetup.callbackURL, {
				state: cliSetup.state,
				server: window.location.origin,
				token: credential.token,
				agentId: credential.agentId
			});
		} catch (err) {
			cliSetupStatus = 'error';
			cliSetupError = messageForError(err);
		}
	}

	function postCliSetupCallback(callbackURL: string, values: Record<string, string>): void {
		const form = document.createElement('form');
		form.method = 'POST';
		form.action = callbackURL;
		form.style.display = 'none';
		for (const [name, value] of Object.entries(values)) {
			const input = document.createElement('input');
			input.type = 'hidden';
			input.name = name;
			input.value = value;
			form.append(input);
		}
		document.body.append(form);
		form.submit();
	}

	async function createAgentToken(): Promise<void> {
		error = '';
		createdCredential = undefined;
		try {
			createdCredential = await client().createAgentToken({
				name: agentName,
				...(agentProjectId ? { projectId: agentProjectId } : {}),
				...(agentTeamId ? { teamId: agentTeamId } : {}),
				...(agentPolicyId ? { defaultApprovalPolicy: agentPolicyId } : {})
			});
			await Promise.all([refreshAgentTokens(), refreshOnboarding(), refreshAuditEvents()]);
		} catch (err) {
			error = messageForError(err);
		}
	}

	async function revokeAgentToken(agentId: string): Promise<void> {
		error = '';
		try {
			await client().revokeAgentToken(agentId);
			if (createdCredential?.agentId === agentId) createdCredential = undefined;
			await Promise.all([refreshAgentTokens(), refreshOnboarding(), refreshAuditEvents()]);
		} catch (err) {
			error = messageForError(err);
		}
	}

	async function respond(id: string, choiceId: string): Promise<void> {
		error = '';
		try {
			await client().respondToApproval(id, { choiceId });
			await Promise.all([refreshApprovals(), refreshAuditEvents()]);
		} catch (err) {
			error = messageForError(err);
		}
	}

	async function copyToken(): Promise<void> {
		if (!createdCredential?.token) return;
		await navigator.clipboard?.writeText(createdCredential.token);
	}

	function messageForError(err: unknown): string {
		if (err instanceof AgentTickApiError) return `${err.status}: ${err.message}`;
		if (err instanceof Error) return err.message;
		return String(err);
	}

	function isCustomerMode(): boolean {
		return runtimeConfig?.authProvider === 'clerk';
	}

	function hasDashboardAccess(): boolean {
		return Boolean(runtimeConfig && (runtimeConfig.authProvider !== 'clerk' || clerkSignedIn));
	}

	function hasCollaborationFeatures(): boolean {
		return !isCustomerMode() || billingStatus?.plan !== 'solo';
	}

	function showWorkspaceAdmin(): boolean {
		return hasDashboardAccess() && hasCollaborationFeatures() && (!isCustomerMode() || showAdvancedWorkspace);
	}

	function showApprovalWorkflow(): boolean {
		return hasDashboardAccess() && (!isCustomerMode() || onboardingStatus?.canUseWebApprovals === true);
	}

	function onboardingStageTitle(): string {
		if (!onboardingStatus) return 'Checking setup…';
		if (onboardingStatus.stage === 'needs_agent_token') return 'Create your first agent token';
		if (onboardingStatus.stage === 'needs_cli_setup') return 'Run the CLI setup command';
		if (onboardingStatus.stage === 'needs_mobile_app') return 'Install and sign into the mobile app';
		return 'Ready for your first approval request';
	}

	function agentSetupTitle(): string {
		if (!isCustomerMode()) return 'Create an agent token';
		if (onboardingStatus?.hasCliHeartbeat) return 'Agent connected';
		if (onboardingStatus?.hasAgentToken) return 'Run the setup command';
		return 'Create an agent token';
	}

	function agentSetupDescription(): string {
		if (!isCustomerMode()) return 'Use one token per machine or agent. You can revoke it any time.';
		if (onboardingStatus?.hasCliHeartbeat) return 'Your CLI has checked in successfully. Agent setup is complete, so the next step is mobile sign-in.';
		if (onboardingStatus?.hasAgentToken) return 'Use the one-time token below if it is still visible, or create a replacement token only if you lost it.';
		return 'Use one token per machine or agent. Agent Tick will reveal the setup command after creation.';
	}

	function showAgentTokenForm(): boolean {
		return !isCustomerMode() || showAdvancedWorkspace || !onboardingStatus?.hasAgentToken;
	}

	function showCreatedCredential(): boolean {
		return Boolean(createdCredential && (!isCustomerMode() || !onboardingStatus?.hasCliHeartbeat));
	}
</script>

<svelte:head>
	<title>Agent Tick</title>
</svelte:head>

<main class="shell">
	<header class="hero">
		<div>
			<p class="eyebrow">Agent Tick</p>
			<h1>Approve agent actions without slowing down</h1>
			<p class="subtle">Connect your AI agent, sign in on mobile, and approve risky commands from wherever you are.</p>
		</div>
		<button onclick={load} disabled={loading}>{loading ? 'Refreshing…' : 'Refresh'}</button>
	</header>

	{#if runtimeConfig}
		<section class="card grid welcome-card">
			{#if runtimeConfig.mode === 'single'}
				<div>
					<p class="eyebrow">Self-hosted admin</p>
					<h2>Everything is unlocked on your server</h2>
					<p class="subtle">Use the admin token to manage local users, teams, policies, devices, and agent tokens.</p>
				</div>
				<form class="stack" onsubmit={(event) => { event.preventDefault(); void saveAdminToken(); }}>
					<label for="admin-token">Admin token</label>
					<input id="admin-token" bind:value={adminToken} type="password" autocomplete="off" placeholder="Optional for localhost single mode" />
					<button type="submit">Save token</button>
				</form>
			{:else if clerkSignedIn}
				<div>
					<p class="eyebrow">Solo workspace</p>
					<h2>You're signed in and ready to connect an agent</h2>
					<p class="subtle">This dashboard is focused on your personal approval workflow. Team administration is available when you upgrade or self-host.</p>
				</div>
				<div class="actions">
					{#if hasCollaborationFeatures()}
						<button class="secondary" onclick={() => { showAdvancedWorkspace = !showAdvancedWorkspace; }}>{showAdvancedWorkspace ? 'Hide team settings' : 'Team settings'}</button>
					{:else}
						<a class="button-link secondary-link" href="https://agenttick.sh" target="_blank" rel="noreferrer">Upgrade for teams</a>
					{/if}
					<button onclick={signOut}>Sign out</button>
				</div>
			{:else}
				<AccountEntryCard onSignIn={signInWithClerk} />
			{/if}
		</section>
	{/if}

	{#if cliSetup}
		<section class="card stack" data-testid="cli-browser-setup">
			<div class="section-heading">
				<h2>CLI sign-in</h2>
				{#if cliSetupStatus === 'error'}<button onclick={() => { cliSetupAttempted = false; void maybeCompleteCliSetup(); }}>Retry</button>{/if}
			</div>
			{#if runtimeConfig?.authProvider === 'clerk' && !clerkSignedIn}
				<p class="warning">Sign in above to finish setting up the Agent Tick CLI. Agent Tick will redirect back to your terminal automatically.</p>
			{:else if cliSetupStatus === 'authorizing'}
				<p class="subtle">Creating an agent token for <strong>{cliSetup.name}</strong>…</p>
			{:else if cliSetupStatus === 'complete'}
				<p class="success">Setup complete. Redirecting back to your terminal…</p>
			{:else if cliSetupStatus === 'error'}
				<p class="error">{cliSetupError}</p>
			{:else}
				<p class="subtle">Authorize this browser tab to create an agent token for <strong>{cliSetup.name}</strong> and return it to your terminal.</p>
				<button onclick={() => void maybeCompleteCliSetup()}>Authorize CLI setup</button>
			{/if}
		</section>
	{/if}

	{#if inviteToken}
		<section class="card stack">
			<div class="section-heading">
				<h2>Organization invite</h2>
				{#if inviteStatus === 'error'}<button onclick={() => void refreshInvitePreview()}>Retry preview</button>{/if}
			</div>
			{#if inviteStatus === 'loading'}
				<p class="subtle">Loading invite…</p>
			{/if}
			{#if invitePreview}
				<p><strong>{invitePreview.organizationName}</strong> invited you as <strong>{invitePreview.role}</strong>.</p>
				<p class="subtle">{invitePreview.approvalRequired ? 'An organization admin must approve your request before you get access.' : 'This invite grants access after acceptance.'}{invitePreview.expiresAt ? ` Expires ${new Date(invitePreview.expiresAt).toLocaleString()}.` : ''}</p>
			{/if}
			{#if inviteAccepted}
				<p class="success">{inviteAcceptedMessage(inviteAccepted.status)}</p>
			{:else if !runtimeConfig}
				<p class="subtle">Loading sign-in configuration…</p>
			{:else if runtimeConfig.authProvider === 'clerk' && !clerkSignedIn}
				<p class="warning">Sign in or create an account above to accept this invite. Agent Tick will continue automatically after sign-in.</p>
			{:else}
				<button onclick={() => void acceptCurrentInvite()} disabled={inviteStatus === 'accepting' || inviteStatus === 'loading'}>{inviteStatus === 'accepting' ? 'Accepting…' : 'Accept invite'}</button>
			{/if}
			{#if inviteError}<p class="error">{inviteError}</p>{/if}
		</section>
	{/if}

	{#if showWorkspaceAdmin()}
		<section class="card grid">
			<div class="stack">
				<h2>{isCustomerMode() ? 'Team workspace settings' : 'Organization'}</h2>
				{#if organizations.length > 0}
					<label for="organization-select">Active local organization</label>
					<select id="organization-select" bind:value={selectedOrganizationId} onchange={(event) => void selectOrganization(event.currentTarget.value)}>
						{#each organizations as membership (membership.organizationId)}
							<option value={membership.organizationId}>{membership.name} ({membership.role})</option>
						{/each}
					</select>
					<p class="subtle">Requests, agent tokens, and devices use this local Agent Tick organization. Clerk organizations are not used for authorization.</p>
					{#if billingStatus?.organizationId === selectedOrganizationId}
						<p class="subtle"><strong>Billing seats:</strong> {seatUsageLabel(billingStatus)} · {billingStatus.usage.pendingMembers} pending approval{billingStatus.usage.pendingMembers === 1 ? '' : 's'}.</p>
					{/if}
				{:else}
					<p class="subtle">No local organization memberships loaded yet.</p>
				{/if}
			</div>
			<form class="stack" onsubmit={(event) => { event.preventDefault(); void createOrganization(); }}>
				<label for="new-organization">Create local organization</label>
				<input id="new-organization" bind:value={newOrganizationName} placeholder="Organization name" />
				<button type="submit">Create organization</button>
			</form>
		</section>
	{/if}

	{#if showWorkspaceAdmin() && myMembershipRequests.length > 0}
		<section class="card stack">
			<div class="section-heading">
				<h2>Your organization requests</h2>
				<button onclick={refreshMyMembershipRequests}>Refresh requests</button>
			</div>
			<ul class="item-list">
				{#each myMembershipRequests as request (request.requestId)}
					<li class="item-card" class:is-muted={request.status !== 'pending_approval'}>
						<div>
							<strong>{request.organizationName ?? request.organizationId}</strong>
							<p class="subtle">{request.status === 'pending_approval' ? 'Pending admin approval' : request.status} · requested {request.requestedRole} · {new Date(request.acceptedAt).toLocaleString()}</p>
							{#if request.status === 'pending_approval'}<p>Your access will appear in the organization selector after an admin approves this request.</p>{/if}
						</div>
					</li>
				{/each}
			</ul>
		</section>
	{/if}

	{#if error}
		<p class="error">{error}</p>
	{/if}

	{#if hasDashboardAccess() && isCustomerMode()}
		<section class="card stack customer-start onboarding-card" data-testid="solo-onboarding">
			<div>
				<p class="eyebrow">Start here</p>
				<h2>{onboardingStageTitle()}</h2>
				<p class="subtle">Agent Tick stays focused on setup until your account, CLI, and mobile app are ready. Approval requests are hidden until a real agent can send them to your phone.</p>
			</div>
			<SetupChecklist
				hasAgentToken={onboardingStatus?.hasAgentToken}
				hasCliHeartbeat={onboardingStatus?.hasCliHeartbeat}
				hasMobileDevice={onboardingStatus?.hasMobileDevice}
			/>
			{#if onboardingStatus?.stage === 'needs_mobile_app'}
				<div class="upgrade-panel" data-testid="mobile-required">
					<div>
						<strong>Waiting for mobile sign-in</strong>
						<p class="subtle">Install Agent Tick mobile and sign in with the same account. This button refreshes setup state, and registers a deterministic device only in test mode.</p>
					</div>
					<button onclick={() => void registerDemoMobileDevice()}>I installed the mobile app</button>
				</div>
			{:else if onboardingStatus?.stage === 'ready_for_first_request'}
				<div class="upgrade-panel" data-testid="setup-complete">
					<div>
						<strong>Setup complete</strong>
						<p class="subtle">You can now send a real test request from the CLI. Web approvals can be enabled as a secondary surface later.</p>
					</div>
					<button onclick={refreshApprovals}>Check for requests</button>
				</div>
			{:else}
				<div class="upgrade-panel" data-testid="approvals-locked">
					<div>
						<strong>Approvals are locked until setup is complete</strong>
						<p class="subtle">No empty queue, policies, or audit console yet. Complete the current setup step first.</p>
					</div>
				</div>
			{/if}
		</section>
	{/if}

	{#if showWorkspaceAdmin()}
		<section class="card stack">
			<div class="section-heading">
				<h2>Invites</h2>
				<button onclick={refreshInvites}>Refresh invites</button>
			</div>
			<form class="stack" onsubmit={(event) => { event.preventDefault(); void createInvite(); }}>
				<div class="row">
					<input bind:value={newInviteEmail} aria-label="Invite email" placeholder="teammate@example.com (optional)" />
					<input bind:value={newInviteDomain} aria-label="Invite domain" placeholder="example.com domain (optional)" />
					<input bind:value={newInviteLabel} aria-label="Invite label" placeholder="Label (optional)" />
					<select bind:value={newInviteRole} aria-label="Invite role">
						<option value="member">member</option>
						<option value="approver">approver</option>
						<option value="admin">admin</option>
						<option value="viewer">viewer</option>
					</select>
					<select bind:value={newInviteTeamId} aria-label="Invite team">
						<option value="">No team</option>
						{#each teams as team (team.teamId)}
							<option value={team.teamId}>{team.name}</option>
						{/each}
					</select>
					<button type="submit">Create invite</button>
				</div>
			</form>
			{#if inviteEmailMessage}<p class="subtle">{inviteEmailMessage}</p>{/if}
			{#if createdInvite?.token}
				<div class="token">
					<p><strong>Invite created:</strong> {createdInvite.label ?? createdInvite.email ?? createdInvite.domain ?? createdInvite.role}</p>
					<code>{createdInvite.url ?? createdInvite.token}</code>
					<button onclick={copyInvite}>Copy invite</button>
					<p class="subtle">The plaintext token is shown once. Agent Tick stores only a hash. New members remain pending until an admin approves them.</p>
				</div>
			{/if}
			{#if organizationInvites.length === 0}
				<p class="subtle">No active or historical invites yet.</p>
			{:else}
				<ul class="item-list">
					{#each organizationInvites as invite (invite.inviteId)}
						<li class="item-card" class:is-muted={Boolean(invite.revokedAt)}>
							<div>
								<strong>{invite.label ?? invite.email ?? invite.domain ?? invite.inviteId}</strong>
								<p class="subtle">{invite.inviteId} · {invite.role} · {invite.approvalRequired ? 'approval required' : 'auto-approved'}{invite.teamIds?.length ? ` · teams ${invite.teamIds.map(teamLabel).join(', ')}` : ''}{invite.domain ? ` · domain ${invite.domain}` : ''} · used {invite.usedCount}{invite.maxUses ? `/${invite.maxUses}` : ''}{invite.revokedAt ? ` · revoked ${new Date(invite.revokedAt).toLocaleString()}` : ''}</p>
								{#if invite.email}<p>{invite.email}</p>{/if}
							</div>
							<div class="actions">
								{#if invite.email && !invite.revokedAt}<button onclick={() => void resendInvite(invite.inviteId)}>Email invite</button>{/if}
								{#if !invite.revokedAt}<button class="danger" onclick={() => void revokeInvite(invite.inviteId)}>Revoke</button>{/if}
							</div>
						</li>
					{/each}
				</ul>
			{/if}
		</section>
		<section class="card stack">
			<div class="section-heading">
				<h2>Pending members</h2>
				<button onclick={refreshMembershipRequests}>Refresh pending members</button>
			</div>
			{#if membershipRequests.length === 0}
				<p class="subtle">No pending organization membership requests.</p>
			{:else}
				<ul class="item-list">
					{#each membershipRequests as request (request.requestId)}
						<li class="item-card">
							<div>
								<strong>{request.userName ?? request.userEmail ?? request.userId}</strong>
								<p class="subtle">{request.requestId} · requested {request.requestedRole} · invite {request.inviteLabel ?? request.inviteId}{request.requestedTeamIds?.length ? ` · teams ${request.requestedTeamIds.map(teamLabel).join(', ')}` : ''}{request.inviteRevokedAt ? ` · invite revoked ${new Date(request.inviteRevokedAt).toLocaleString()}` : ''} · {new Date(request.acceptedAt).toLocaleString()}</p>
								{#if request.userEmail}<p>{request.userEmail}</p>{/if}
							</div>
							<div class="actions">
								<button class="approve" onclick={() => void approveMembershipRequest(request.requestId)}>Approve</button>
								<button class="danger" onclick={() => void rejectMembershipRequest(request.requestId)}>Reject</button>
							</div>
						</li>
					{/each}
				</ul>
			{/if}
		</section>
		<section class="card stack">
			<div class="section-heading">
				<h2>Projects</h2>
				<button onclick={refreshProjects}>Refresh projects</button>
			</div>
			<form class="row" onsubmit={(event) => { event.preventDefault(); void createProject(); }}>
				<input bind:value={newProjectName} aria-label="Project name" placeholder="Project name" />
				<button type="submit">Create project</button>
			</form>
			{#if projects.length === 0}
				<p class="subtle">No projects yet. Projects let agent tokens and approvals carry local workspace context.</p>
			{:else}
				<ul class="item-list">
					{#each projects as project (project.projectId)}
						<li class="item-card" class:is-muted={Boolean(project.archivedAt)}>
							<div>
								<strong>{project.name}</strong>
								<p class="subtle">{project.projectId} · {project.slug}{project.archivedAt ? ` · archived ${new Date(project.archivedAt).toLocaleString()}` : ''}</p>
								{#if project.description}<p>{project.description}</p>{/if}
							</div>
						</li>
					{/each}
				</ul>
			{/if}
		</section>
		<section class="card stack">
			<div class="section-heading">
				<h2>Teams</h2>
				<button onclick={refreshTeams}>Refresh teams</button>
			</div>
			<form class="row" onsubmit={(event) => { event.preventDefault(); void createTeam(); }}>
				<input bind:value={newTeamName} aria-label="Team name" placeholder="Team name" />
				<button type="submit">Create team</button>
			</form>
			{#if teams.length === 0}
				<p class="subtle">No teams yet. Teams will back policy routing and quorum approval rules.</p>
			{:else}
				<form class="row" onsubmit={(event) => { event.preventDefault(); void addTeamMember(); }}>
					<label for="team-member-team" class="inline-label">Team</label>
					<select id="team-member-team" bind:value={selectedTeamForMember}>
						{#each teams as team (team.teamId)}
							<option value={team.teamId}>{team.name}</option>
						{/each}
					</select>
					<label for="team-member-user" class="inline-label">Member</label>
					<select id="team-member-user" bind:value={selectedUserForTeam}>
						<option value="">Choose organization member</option>
						{#each organizationMembers as member (member.userId)}
							<option value={member.userId}>{member.name || member.userId} ({member.role})</option>
						{/each}
					</select>
					<select bind:value={newTeamMemberRole} aria-label="Team role">
						<option value="member">member</option>
						<option value="lead">lead</option>
						<option value="viewer">viewer</option>
					</select>
					<button type="submit">Add member</button>
				</form>
				<ul class="item-list">
					{#each teams as team (team.teamId)}
						<li class="item-card" class:is-muted={Boolean(team.archivedAt)}>
							<div>
								<strong>{team.name}</strong>
								<p class="subtle">{team.teamId} · {team.slug}{team.archivedAt ? ` · archived ${new Date(team.archivedAt).toLocaleString()}` : ''}</p>
								{#if team.description}<p>{team.description}</p>{/if}
								{#if teamMembers[team.teamId]?.length}
									<div class="member-list">
										{#each teamMembers[team.teamId] as member (member.userId)}
											<span class="member-pill">
												{member.userId} ({member.role})
												{#if member.role !== 'owner'}
													<button class="link-button danger-text" onclick={() => void removeTeamMember(team.teamId, member.userId)}>Remove</button>
												{/if}
											</span>
										{/each}
									</div>
								{/if}
							</div>
						</li>
					{/each}
				</ul>
			{/if}
		</section>
		<section class="card stack" data-testid="approval-rules">
			<div class="section-heading">
				<div>
					<p class="eyebrow">Approval rules</p>
					<h2>Route approvals to the right humans</h2>
					<p class="subtle">Start simple, then scope rules by project or team when your organization grows.</p>
				</div>
				<button onclick={refreshPolicies}>Refresh policies</button>
			</div>
			<form class="setup-panel stack" data-testid="approval-rule-form" onsubmit={(event) => { event.preventDefault(); void createPolicy(); }}>
				<div>
					<h3>Create a rule</h3>
					<p class="subtle">Choose a clear name, quorum, and optional routing scope.</p>
				</div>
				<div class="row">
					<input bind:value={newPolicyName} aria-label="Policy name" placeholder="Production deploys" />
					<label for="policy-required-approvals" class="inline-label">Required approvals</label>
					<input id="policy-required-approvals" bind:value={newPolicyRequiredApprovals} type="number" min="1" max="10" />
				</div>
				<div class="row">
					<label for="policy-project" class="inline-label">Project</label>
					<select id="policy-project" bind:value={newPolicyProjectId}>
						<option value="">Any project</option>
						{#each projects as project (project.projectId)}
							<option value={project.projectId}>{project.name} ({project.slug})</option>
						{/each}
					</select>
					<label for="policy-team" class="inline-label">Team</label>
					<select id="policy-team" bind:value={newPolicyTeamId}>
						<option value="">Any team</option>
						{#each teams as team (team.teamId)}
							<option value={team.teamId}>{team.name} ({team.slug})</option>
						{/each}
					</select>
					<button type="submit">Create policy</button>
				</div>
			</form>
			{#if policies.length === 0}
				<p class="subtle">No policies yet. Create a local approval policy to start modeling quorum and project/team routing.</p>
			{:else}
				<ul class="item-list">
					{#each policies as policy (policy.policyId)}
						<li class="item-card" class:is-muted={Boolean(policy.archivedAt)} data-testid="approval-rule-row">
							<div>
								<strong>{policy.name}</strong>
								<p class="subtle">
									{policy.policyId} · {policy.requiredApprovals} approval{policy.requiredApprovals === 1 ? '' : 's'}
									{policy.enabled ? ' · active' : ' · paused'}
									{policy.projectId ? ` · project ${projectLabel(policy.projectId)}` : ''}
									{policy.teamId ? ` · team ${teamLabel(policy.teamId)}` : ''}
									{policy.archivedAt ? ` · archived ${new Date(policy.archivedAt).toLocaleString()}` : ''}
								</p>
								{#if policy.description}<p>{policy.description}</p>{/if}
							</div>
							<div class="row compact-actions">
								<button type="button" disabled={policyActionId === policy.policyId || Boolean(policy.archivedAt)} onclick={() => void updatePolicyStatus(policy, { enabled: !policy.enabled })}>
									{policy.enabled ? 'Pause' : 'Resume'}
								</button>
								<button type="button" class="danger-button" disabled={policyActionId === policy.policyId || Boolean(policy.archivedAt)} onclick={() => void updatePolicyStatus(policy, { archived: true })}>
									Archive
								</button>
							</div>
						</li>
					{/each}
				</ul>
			{/if}
		</section>
	{/if}

	{#if hasDashboardAccess()}
	{#if runtimeConfig?.mode === 'single'}
	<section class="card stack">
		<h2>Pair a phone</h2>
		<p class="subtle">Create a short-lived code, then enter it in the mobile app Settings screen.</p>
		<button onclick={createPairingToken}>Create pairing code</button>
		{#if pairingToken}
			<div class="token">
				<code>{pairingToken.token}</code>
				<p class="subtle">Expires at {new Date(pairingToken.expiresAt).toLocaleString()}</p>
			</div>
		{/if}
	</section>
	{/if}

	<section class="card stack primary-card">
		<div>
			<p class="eyebrow">Connect your agent</p>
			<h2>{agentSetupTitle()}</h2>
			<p class="subtle">{agentSetupDescription()}</p>
		</div>
		{#if isCustomerMode() && onboardingStatus?.hasCliHeartbeat}
			<div class="upgrade-panel" data-testid="agent-connected">
				<div>
					<strong>CLI setup complete</strong>
					<p class="subtle">Agent Tick received a request from your token. You can create more tokens later from team settings or self-hosted admin mode.</p>
				</div>
			</div>
		{:else}
			{#if showAgentTokenForm()}
				<form class="stack" onsubmit={(event) => { event.preventDefault(); void createAgentToken(); }}>
					<div class="row">
						<input bind:value={agentName} aria-label="Agent name" />
						<button type="submit">Create token</button>
					</div>
					{#if !isCustomerMode() || showAdvancedWorkspace}
						<div class="row">
							<label for="agent-project" class="inline-label">Project</label>
							<select id="agent-project" bind:value={agentProjectId}>
								<option value="">Any project</option>
								{#each projects as project (project.projectId)}
									<option value={project.projectId}>{project.name} ({project.slug})</option>
								{/each}
							</select>
							<label for="agent-team" class="inline-label">Team</label>
							<select id="agent-team" bind:value={agentTeamId}>
								<option value="">Any team</option>
								{#each teams as team (team.teamId)}
									<option value={team.teamId}>{team.name} ({team.slug})</option>
								{/each}
							</select>
							<label for="agent-policy" class="inline-label">Policy</label>
							<select id="agent-policy" bind:value={agentPolicyId}>
								<option value="">Default policy</option>
								{#each policies as policy (policy.policyId)}
									<option value={policy.policyId}>{policy.name}</option>
								{/each}
							</select>
						</div>
					{/if}
				</form>
			{/if}
			{#if showCreatedCredential() && createdCredential}
				<div class="token">
					<p><strong>{createdCredential.name}</strong> ({createdCredential.agentId})</p>
					<code>{createdCredential.token}</code>
					<button onclick={copyToken}>Copy</button>
					<p class="subtle">Use it with: <code>agent-tick setup --server {window.location.origin} --token {createdCredential.token}</code></p>
				</div>
			{/if}
		{/if}
		{#if agentTokens.length > 0}
			<ul class="item-list">
				{#each agentTokens as token (token.agentId)}
					<li class="item-card" class:is-muted={Boolean(token.revokedAt)}>
						<div>
							<strong>{token.name}</strong>
							<p class="subtle">
								{token.agentId} · {token.scopes.join(', ')} · {token.revokedAt ? `revoked ${new Date(token.revokedAt).toLocaleString()}` : 'active'}
								{token.projectId ? ` · project ${projectLabel(token.projectId)}` : ''}
								{token.teamId ? ` · team ${teamLabel(token.teamId)}` : ''}
								{token.defaultApprovalPolicy ? ` · policy ${token.defaultApprovalPolicy}` : ''}
							</p>
						</div>
						{#if !token.revokedAt}<button class="danger" onclick={() => void revokeAgentToken(token.agentId)}>Revoke</button>{/if}
					</li>
				{/each}
			</ul>
		{/if}
	</section>

	{#if showApprovalWorkflow()}
	<section class="card stack" data-testid="approval-requests">
		<div class="section-heading">
			<h2>Approval requests</h2>
			<button onclick={refreshApprovals}>Refresh approvals</button>
		</div>
		{#if approvals.length === 0}
			<p class="subtle">No approval requests yet.</p>
		{:else}
			<ul class="approvals">
				{#each approvals as approval (approval.id)}
					<li>
						<div>
							<p class="eyebrow">{approval.status} · {approval.requester.name}</p>
							<h3>{approval.title}</h3>
							{#if approval.body}<p>{approval.body}</p>{/if}
							{#if approval.command}<pre>{approval.command}</pre>{/if}
							{#if approval.response}<p class="subtle">Response: {approval.response.choiceId ?? approval.response.message}</p>{/if}
						</div>
						{#if approval.status === 'pending'}
							<div class="actions">
								<button class="approve" onclick={() => respond(approval.id, 'approve')}>Approve</button>
								<button class="reject" onclick={() => respond(approval.id, 'reject')}>Reject</button>
							</div>
						{/if}
					</li>
				{/each}
			</ul>
		{/if}
	</section>
	{/if}

	{#if !isCustomerMode() || showAdvancedWorkspace}
	<section class="card stack">
		<div class="section-heading">
			<h2>Audit events</h2>
			<button onclick={refreshAuditEvents}>Refresh audit</button>
		</div>
		{#if auditEvents.length === 0}
			<p class="subtle">No audit events yet.</p>
		{:else}
			<ul class="item-list">
				{#each auditEvents as event (event.eventId)}
					<li class="item-card audit-card">
						<div>
							<strong>{event.eventType}</strong>
							<p class="subtle">{new Date(event.createdAt).toLocaleString()} · {event.userId} · {event.targetId}</p>
							<code>{JSON.stringify(event.payload)}</code>
						</div>
					</li>
				{/each}
			</ul>
		{/if}
	</section>
	{/if}
	{/if}
</main>

<style>
	:global(body) {
		margin: 0;
		font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
		background:
			radial-gradient(circle at 12% 0%, rgba(59, 130, 246, 0.18), transparent 30rem),
			radial-gradient(circle at 90% 8%, rgba(20, 184, 166, 0.14), transparent 28rem),
			linear-gradient(135deg, #f8fbff 0%, #eef4ff 100%);
		color: #111827;
	}

	.shell {
		max-width: 1040px;
		margin: 0 auto;
		padding: 40px 20px;
	}

	.hero,
	.section-heading,
	.row,
	.grid {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 16px;
	}

	.grid {
		align-items: flex-start;
	}

	.stack {
		display: grid;
		gap: 12px;
	}

	.card {
		margin-top: 20px;
		padding: 24px;
		border: 1px solid rgba(148, 163, 184, 0.28);
		border-radius: 24px;
		background: rgba(255, 255, 255, 0.92);
		box-shadow: 0 24px 70px rgba(15, 23, 42, 0.08);
		backdrop-filter: blur(10px);
	}

	.eyebrow,
	.subtle {
		color: #64748b;
	}

	.eyebrow {
		margin: 0;
		text-transform: uppercase;
		letter-spacing: 0.12em;
		font-size: 0.75rem;
	}

	h1,
	h2,
	h3,
	p {
		margin-top: 0;
	}

	input,
	select {
		min-width: 260px;
		padding: 10px 12px;
		border: 1px solid #d6e0ef;
		border-radius: 12px;
		background: #ffffff;
		color: #111827;
	}

	button {
		padding: 10px 14px;
		border: 0;
		border-radius: 999px;
		background: linear-gradient(135deg, #2563eb, #0f766e);
		color: white;
		font-weight: 800;
		cursor: pointer;
		box-shadow: 0 8px 18px rgba(15, 23, 42, 0.12);
	}

	.secondary-link {
		background: #ffffff;
		color: #1d4ed8;
		border: 1px solid #d8e2f3;
	}

	button:disabled {
		opacity: 0.6;
		cursor: wait;
	}

	.error,
	.warning {
		padding: 12px 14px;
		border-radius: 12px;
	}

	.error {
		border: 1px solid #fecaca;
		background: #fff2f0;
		color: #991b1b;
	}

	.warning {
		border: 1px solid #fde68a;
		background: #fff7d6;
		color: #854d0e;
	}

	.welcome-card,
	.primary-card,
	.customer-start {
		border-color: rgba(37, 99, 235, 0.22);
	}

	.welcome-card {
		position: relative;
		overflow: hidden;
		background:
			linear-gradient(90deg, rgba(244, 63, 94, 0.08), rgba(124, 58, 237, 0.08), rgba(6, 182, 212, 0.08)) top / 100% 8px no-repeat,
			rgba(255, 255, 255, 0.94);
	}

	.customer-start {
		background: linear-gradient(180deg, rgba(255, 255, 255, 0.96), rgba(239, 246, 255, 0.92));
	}

	.upgrade-panel {
		border: 1px solid #dbeafe;
		border-radius: 18px;
		padding: 16px;
		color: #334155;
	}

	.upgrade-panel strong {
		color: #1d4ed8;
	}

	.upgrade-panel {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 16px;
		background: #f8fbff;
	}

	.token {
		display: grid;
		gap: 8px;
		padding: 12px;
		border: 1px dashed #bfdbfe;
		border-radius: 16px;
		background: #eff6ff;
	}

	code,
	pre {
		padding: 3px 6px;
		border-radius: 8px;
		background: #eaf2ff;
		color: #1e3a8a;
	}

	pre {
		overflow-x: auto;
		padding: 12px;
	}

	.approvals,
	.item-list {
		list-style: none;
		padding: 0;
		margin: 0;
		display: grid;
		gap: 12px;
	}

	.approvals li,
	.item-card {
		display: flex;
		justify-content: space-between;
		gap: 20px;
		padding: 16px;
		border: 1px solid #dbeafe;
		border-radius: 18px;
		background: #f8fbff;
		color: #334155;
	}

	.actions {
		display: flex;
		gap: 8px;
		align-items: flex-start;
	}

	.member-list {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		margin-top: 8px;
	}

	.member-pill {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 4px 8px;
		border: 1px solid #bfdbfe;
		border-radius: 999px;
		background: #eff6ff;
		color: #334155;
		font-size: 0.85rem;
	}

	.link-button {
		padding: 0;
		background: transparent;
		color: #38bdf8;
		font: inherit;
	}

	.danger-text {
		color: #b91c1c;
	}

	.compact-actions {
		flex-wrap: nowrap;
		align-items: flex-start;
	}

	.danger-button {
		background: #fff1f2;
		color: #b91c1c;
		border-color: #fecdd3;
	}

	.item-card.is-muted {
		opacity: 0.62;
	}

	.audit-card {
		align-items: stretch;
	}

	.approve {
		background: linear-gradient(135deg, #16a34a, #15803d);
		color: white;
	}

	.reject,
	.danger {
		background: linear-gradient(135deg, #dc2626, #b91c1c);
		color: white;
	}

	@media (max-width: 760px) {
		.hero,
		.section-heading,
		.row,
		.grid,
		.approvals li,
		.item-card,
		.upgrade-panel {
			align-items: stretch;
			flex-direction: column;
		}

		input,
		select {
			min-width: 0;
		}
	}
</style>
