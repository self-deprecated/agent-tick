<script lang="ts">
	import { onMount, tick } from 'svelte';
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
		type InvitePreview,
		type OrganizationInviteRecord,
		type OrganizationMembership,
		type OrganizationMembershipRequestRecord,
		type PairingToken,
		type PolicyRecord,
		type ProjectRecord,
		type TeamMembership,
		type TeamRecord
	} from '@agent-tick/sdk';
	import type { Clerk as ClerkJS } from '@clerk/clerk-js';
	import type { AdminConfig } from './app';
	import { inviteTokenFromLocation } from './inviteRouting';
	import { inviteAcceptedMessage } from './inviteStatus';

	const adminTokenStorageKey = 'agent_tick_admin_token';
	const organizationStorageKey = 'agent_tick_organization_id';

	let { config: initialConfig }: { config: AdminConfig } = $props();
	let runtimeConfig = $state<AuthConfig | undefined>();
	let approvals = $state<ApprovalRequest[]>([]);
	let agentTokens = $state<AgentTokenRecord[]>([]);
	let auditEvents = $state<AuditEventRecord[]>([]);
	let billingStatus = $state<BillingStatus | undefined>();
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
	let createdCredential = $state<AgentCredential | undefined>();
	let pairingToken = $state<PairingToken | undefined>();
	let adminToken = $state('');
	let agentName = $state('Local agent');
	let agentProjectId = $state('');
	let agentTeamId = $state('');
	let agentPolicyId = $state('');
	let loading = $state(false);
	let error = $state('');
	let clerk = $state<ClerkJS | undefined>();
	let clerkSignedIn = $state(false);
	let signInElement = $state<HTMLDivElement | undefined>();
	let eventSource: EventSource | undefined;
	let eventStreamOrganizationId = '';
	let eventStreamRefreshTimer: ReturnType<typeof setTimeout> | undefined;
	let eventStreamReconnectTimer: ReturnType<typeof setTimeout> | undefined;

	function client(options: { includeOrganization?: boolean } = {}): AgentTickClient {
		return new AgentTickClient({
			baseUrl: window.location.origin,
			tokenProvider: async () => {
				if (runtimeConfig?.authProvider === 'clerk') return (await clerk?.session?.getToken()) ?? null;
				return adminToken || null;
			},
			organizationIdProvider: options.includeOrganization === false ? undefined : () => selectedOrganizationId || null
		});
	}

	onMount(() => {
		adminToken = localStorage.getItem(adminTokenStorageKey) ?? '';
		selectedOrganizationId = localStorage.getItem(organizationStorageKey) ?? '';
		syncInviteTokenFromLocation();
		const onHashChange = () => syncInviteTokenFromLocation();
		window.addEventListener('hashchange', onHashChange);
		void load();
		return () => {
			window.removeEventListener('hashchange', onHashChange);
			stopEventStream();
		};
	});

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
		if (!inviteToken || inviteAccepted || inviteAutoAcceptAttempted) return;
		if (runtimeConfig?.authProvider === 'clerk' && !clerkSignedIn) return;
		inviteAutoAcceptAttempted = true;
		await acceptCurrentInvite();
	}

	async function load(): Promise<void> {
		loading = true;
		error = '';
		try {
			runtimeConfig = await client().getAuthConfig();
			if (runtimeConfig.authProvider === 'clerk') {
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
		await tick();
		if (!nextClerk.isSignedIn && signInElement) {
			nextClerk.mountSignIn(signInElement);
		} else if (nextClerk.isSignedIn) {
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
		await tick();
		if (clerk && signInElement) clerk.mountSignIn(signInElement);
	}

	async function refreshWorkspace(): Promise<void> {
		await refreshOrganizations();
		await Promise.all([refreshApprovals(), refreshAgentTokens(), refreshAuditEvents(), refreshBilling(), refreshProjects(), refreshTeams(), refreshPolicies(), refreshInvites(), refreshOrganizationMembers(), refreshMembershipRequests(), refreshMyMembershipRequests()]);
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
			await Promise.all([refreshAgentTokens(), refreshAuditEvents()]);
		} catch (err) {
			error = messageForError(err);
		}
	}

	async function revokeAgentToken(agentId: string): Promise<void> {
		error = '';
		try {
			await client().revokeAgentToken(agentId);
			if (createdCredential?.agentId === agentId) createdCredential = undefined;
			await Promise.all([refreshAgentTokens(), refreshAuditEvents()]);
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
</script>

<svelte:head>
	<title>Agent Tick</title>
</svelte:head>

<main class="shell">
	<header class="hero">
		<div>
			<p class="eyebrow">Agent Tick</p>
			<h1>Human approvals for agent actions</h1>
			<p class="subtle">TypeScript server preview. Create an agent token, run the npm CLI, and approve pending requests here.</p>
		</div>
		<button onclick={load} disabled={loading}>{loading ? 'Refreshing…' : 'Refresh'}</button>
	</header>

	{#if runtimeConfig}
		<section class="card grid">
			<div>
				<h2>Runtime</h2>
				<p><strong>Mode:</strong> {runtimeConfig.mode}</p>
				<p><strong>Auth provider:</strong> {runtimeConfig.authProvider}</p>
				{#if runtimeConfig.publicURL}<p><strong>Public URL:</strong> {runtimeConfig.publicURL}</p>{/if}
				<p><strong>Admin origin:</strong> {initialConfig.publicURL}</p>
			</div>
			{#if runtimeConfig.mode === 'single'}
				<form class="stack" onsubmit={(event) => { event.preventDefault(); void saveAdminToken(); }}>
					<label for="admin-token">Admin token</label>
					<input id="admin-token" bind:value={adminToken} type="password" autocomplete="off" placeholder="Optional for localhost single mode" />
					<button type="submit">Save token</button>
				</form>
			{:else}
				<div class="stack">
					{#if clerkSignedIn}
						<p class="subtle">Signed in with Clerk.</p>
						<button onclick={signOut}>Sign out</button>
					{:else}
						<p class="warning">Sign in with Clerk to manage Agent Tick approvals.</p>
						<div class="clerk-card" bind:this={signInElement}></div>
					{/if}
				</div>
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

	{#if runtimeConfig && (runtimeConfig.authProvider !== 'clerk' || clerkSignedIn)}
		<section class="card grid">
			<div class="stack">
				<h2>Organization</h2>
				{#if organizations.length > 0}
					<label for="organization-select">Active local organization</label>
					<select id="organization-select" bind:value={selectedOrganizationId} onchange={(event) => void selectOrganization(event.currentTarget.value)}>
						{#each organizations as membership}
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

	{#if runtimeConfig && (runtimeConfig.authProvider !== 'clerk' || clerkSignedIn) && myMembershipRequests.length > 0}
		<section class="card stack">
			<div class="section-heading">
				<h2>Your organization requests</h2>
				<button onclick={refreshMyMembershipRequests}>Refresh requests</button>
			</div>
			<ul class="item-list">
				{#each myMembershipRequests as request}
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

	{#if runtimeConfig && (runtimeConfig.authProvider !== 'clerk' || clerkSignedIn)}
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
						{#each teams as team}
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
					{#each organizationInvites as invite}
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
					{#each membershipRequests as request}
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
					{#each projects as project}
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
						{#each teams as team}
							<option value={team.teamId}>{team.name}</option>
						{/each}
					</select>
					<label for="team-member-user" class="inline-label">Member</label>
					<select id="team-member-user" bind:value={selectedUserForTeam}>
						<option value="">Choose organization member</option>
						{#each organizationMembers as member}
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
					{#each teams as team}
						<li class="item-card" class:is-muted={Boolean(team.archivedAt)}>
							<div>
								<strong>{team.name}</strong>
								<p class="subtle">{team.teamId} · {team.slug}{team.archivedAt ? ` · archived ${new Date(team.archivedAt).toLocaleString()}` : ''}</p>
								{#if team.description}<p>{team.description}</p>{/if}
								{#if teamMembers[team.teamId]?.length}
									<div class="member-list">
										{#each teamMembers[team.teamId] as member}
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
		<section class="card stack">
			<div class="section-heading">
				<h2>Policies</h2>
				<button onclick={refreshPolicies}>Refresh policies</button>
			</div>
			<form class="stack" onsubmit={(event) => { event.preventDefault(); void createPolicy(); }}>
				<div class="row">
					<input bind:value={newPolicyName} aria-label="Policy name" placeholder="Policy name" />
					<label for="policy-required-approvals" class="inline-label">Required approvals</label>
					<input id="policy-required-approvals" bind:value={newPolicyRequiredApprovals} type="number" min="1" max="10" />
				</div>
				<div class="row">
					<label for="policy-project" class="inline-label">Project</label>
					<select id="policy-project" bind:value={newPolicyProjectId}>
						<option value="">Any project</option>
						{#each projects as project}
							<option value={project.projectId}>{project.name} ({project.slug})</option>
						{/each}
					</select>
					<label for="policy-team" class="inline-label">Team</label>
					<select id="policy-team" bind:value={newPolicyTeamId}>
						<option value="">Any team</option>
						{#each teams as team}
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
					{#each policies as policy}
						<li class="item-card" class:is-muted={!policy.enabled || Boolean(policy.archivedAt)}>
							<div>
								<strong>{policy.name}</strong>
								<p class="subtle">
									{policy.policyId} · {policy.enabled ? 'enabled' : 'disabled'} · {policy.requiredApprovals} approval{policy.requiredApprovals === 1 ? '' : 's'}
									{policy.projectId ? ` · project ${projectLabel(policy.projectId)}` : ''}
									{policy.teamId ? ` · team ${teamLabel(policy.teamId)}` : ''}
									{policy.archivedAt ? ` · archived ${new Date(policy.archivedAt).toLocaleString()}` : ''}
								</p>
								{#if policy.description}<p>{policy.description}</p>{/if}
							</div>
						</li>
					{/each}
				</ul>
			{/if}
		</section>
	{/if}

	{#if runtimeConfig?.authProvider !== 'clerk' || clerkSignedIn}
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

	<section class="card stack">
		<h2>Create an agent token</h2>
		<form class="stack" onsubmit={(event) => { event.preventDefault(); void createAgentToken(); }}>
			<div class="row">
				<input bind:value={agentName} aria-label="Agent name" />
				<button type="submit">Create token</button>
			</div>
			<div class="row">
				<label for="agent-project" class="inline-label">Project</label>
				<select id="agent-project" bind:value={agentProjectId}>
					<option value="">Any project</option>
					{#each projects as project}
						<option value={project.projectId}>{project.name} ({project.slug})</option>
					{/each}
				</select>
				<label for="agent-team" class="inline-label">Team</label>
				<select id="agent-team" bind:value={agentTeamId}>
					<option value="">Any team</option>
					{#each teams as team}
						<option value={team.teamId}>{team.name} ({team.slug})</option>
					{/each}
				</select>
				<label for="agent-policy" class="inline-label">Policy</label>
				<select id="agent-policy" bind:value={agentPolicyId}>
					<option value="">Default policy</option>
					{#each policies as policy}
						<option value={policy.policyId}>{policy.name}</option>
					{/each}
				</select>
			</div>
		</form>
		{#if createdCredential}
			<div class="token">
				<p><strong>{createdCredential.name}</strong> ({createdCredential.agentId})</p>
				<code>{createdCredential.token}</code>
				<button onclick={copyToken}>Copy</button>
				<p class="subtle">Use it with: <code>agent-tick setup --server {window.location.origin} --token {createdCredential.token}</code></p>
			</div>
		{/if}
		{#if agentTokens.length > 0}
			<ul class="item-list">
				{#each agentTokens as token}
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

	<section class="card stack">
		<div class="section-heading">
			<h2>Approval requests</h2>
			<button onclick={refreshApprovals}>Refresh approvals</button>
		</div>
		{#if approvals.length === 0}
			<p class="subtle">No approval requests yet.</p>
		{:else}
			<ul class="approvals">
				{#each approvals as approval}
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

	<section class="card stack">
		<div class="section-heading">
			<h2>Audit events</h2>
			<button onclick={refreshAuditEvents}>Refresh audit</button>
		</div>
		{#if auditEvents.length === 0}
			<p class="subtle">No audit events yet.</p>
		{:else}
			<ul class="item-list">
				{#each auditEvents as event}
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
</main>

<style>
	:global(body) {
		margin: 0;
		font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
		background: #0f172a;
		color: #e2e8f0;
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
		border: 1px solid rgba(148, 163, 184, 0.25);
		border-radius: 18px;
		background: rgba(15, 23, 42, 0.84);
		box-shadow: 0 20px 60px rgba(2, 6, 23, 0.35);
	}

	.eyebrow,
	.subtle {
		color: #94a3b8;
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
		border: 1px solid #334155;
		border-radius: 10px;
		background: #020617;
		color: #e2e8f0;
	}

	button {
		padding: 10px 14px;
		border: 0;
		border-radius: 10px;
		background: #38bdf8;
		color: #082f49;
		font-weight: 700;
		cursor: pointer;
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
		background: rgba(239, 68, 68, 0.14);
		color: #fecaca;
	}

	.warning {
		background: rgba(250, 204, 21, 0.12);
		color: #fde68a;
	}

	.token {
		display: grid;
		gap: 8px;
		padding: 12px;
		border: 1px dashed #475569;
		border-radius: 12px;
	}

	code,
	pre {
		padding: 3px 6px;
		border-radius: 6px;
		background: #020617;
		color: #bae6fd;
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
		border: 1px solid #334155;
		border-radius: 14px;
		background: rgba(2, 6, 23, 0.48);
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
		border: 1px solid #334155;
		border-radius: 999px;
		color: #cbd5e1;
		font-size: 0.85rem;
	}

	.link-button {
		padding: 0;
		background: transparent;
		color: #38bdf8;
		font: inherit;
	}

	.danger-text {
		color: #fb7185;
	}

	.item-card.is-muted {
		opacity: 0.62;
	}

	.audit-card {
		align-items: stretch;
	}

	.approve {
		background: #22c55e;
		color: #052e16;
	}

	.reject {
		background: #fb7185;
		color: #4c0519;
	}

	.danger {
		background: #f97316;
		color: #431407;
	}

	@media (max-width: 760px) {
		.hero,
		.section-heading,
		.row,
		.grid,
		.approvals li,
		.item-card {
			align-items: stretch;
			flex-direction: column;
		}

		input,
		select {
			min-width: 0;
		}
	}
</style>
