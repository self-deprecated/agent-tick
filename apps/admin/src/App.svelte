<script lang="ts">
	import { onMount } from 'svelte';
	import {
		AdminApiClient,
		csrfTokenFromCookie,
		type AgentCredential,
		type AgentTokenRecord,
		type ApprovalPolicyPreview,
		type ApprovalPolicyRecord,
		type ApprovalRequest,
		type AuditEventRecord,
		type BillingStatus,
		type Choice,
		type DeviceRecord,
		type OnCallScheduleRecord,
		type OrganizationMembershipRecord,
		type PairingToken,
		type ProjectRecord,
		type Requester,
		type SessionCredential,
		type TeamCoverageRecord,
		type TeamRecord,
		type UserAvailabilityRecord
	} from './api';
	import type { AdminConfig } from './app';

	type LoadStatus = 'idle' | 'loading' | 'ready' | 'error';

	let { config }: { config: AdminConfig } = $props();

	let mode = $derived(config.mode);
	let publicURL = $derived(config.publicURL || window.location.origin);

	let bearerToken = $state('');
	let email = $state('');
	let password = $state('');
	let session = $state<SessionCredential | null>(null);
	let authStatus = $state<LoadStatus>('idle');
	let authError = $state('');

	let approvals = $state.raw<ApprovalRequest[]>([]);
	let approvalsStatus = $state<LoadStatus>('idle');
	let approvalsError = $state('');
	let busyApproval = $state('');

	let devices = $state.raw<DeviceRecord[]>([]);
	let devicesStatus = $state<LoadStatus>('idle');
	let devicesError = $state('');
	let busyDevice = $state('');
	let pairing = $state<PairingToken | null>(null);
	let pairingStatus = $state<LoadStatus>('idle');
	let pairingError = $state('');
	let pairingClearTimer: number | undefined;

	let agents = $state.raw<AgentTokenRecord[]>([]);
	let agentsStatus = $state<LoadStatus>('idle');
	let agentsError = $state('');
	let agentActionError = $state('');
	let agentName = $state('agent');
	let agentProjectID = $state('');
	let agentNewProjectName = $state('');
	let agentOwnerUserID = $state('');
	let agentTeamID = $state('');
	let agentDefaultPolicy = $state('');
	let creatingAgent = $state(false);
	let busyAgent = $state('');
	let newAgentCredential = $state<AgentCredential | null>(null);

	let organizations = $state.raw<OrganizationMembershipRecord[]>([]);
	let organizationsStatus = $state<LoadStatus>('idle');
	let organizationsError = $state('');
	let organizationName = $state('');
	let organizationActionError = $state('');
	let creatingOrganization = $state(false);

	let teams = $state.raw<TeamRecord[]>([]);
	let teamsStatus = $state<LoadStatus>('idle');
	let teamsError = $state('');
	let teamActionError = $state('');
	let teamName = $state('');
	let teamDescription = $state('');
	let creatingTeam = $state(false);
	let selectedTeamID = $state('');
	let teamAvailability = $state.raw<UserAvailabilityRecord[]>([]);
	let teamCoverage = $state<TeamCoverageRecord | null>(null);
	let onCallSchedules = $state.raw<OnCallScheduleRecord[]>([]);
	let onCallPrimaryUserID = $state('');
	let onCallSecondaryUserID = $state('');
	let teamPresenceStatus = $state<LoadStatus>('idle');
	let teamPresenceError = $state('');
	let savingOnCall = $state(false);

	let projects = $state.raw<ProjectRecord[]>([]);
	let projectsStatus = $state<LoadStatus>('idle');
	let projectsError = $state('');
	let projectActionError = $state('');
	let projectName = $state('');
	let projectDescription = $state('');
	let projectTeamID = $state('');
	let projectDefaultPolicyID = $state('');
	let creatingProject = $state(false);
	let selectedProjectID = $state('');

	let policies = $state.raw<ApprovalPolicyRecord[]>([]);
	let policiesStatus = $state<LoadStatus>('idle');
	let policiesError = $state('');
	let policyActionError = $state('');
	let policyName = $state('');
	let policyTemplate = $state('owner-only');
	let policyTeamID = $state('');
	let policyQuorum = $state('2');
	let policyTimeout = $state('3600');
	let policyEscalationTarget = $state('');
	let policyDenyVeto = $state(true);
	let creatingPolicy = $state(false);
	let selectedPolicyID = $state('');
	let policyPreview = $state<ApprovalPolicyPreview | null>(null);
	let policyPreviewError = $state('');

	let billing = $state<BillingStatus | null>(null);
	let billingStatus = $state<LoadStatus>('idle');
	let billingError = $state('');

	let auditEvents = $state.raw<AuditEventRecord[]>([]);
	let auditStatus = $state<LoadStatus>('idle');
	let auditError = $state('');
	let auditEventType = $state('');
	let auditExporting = $state(false);

	const api = new AdminApiClient({
		bearerToken: () => bearerToken,
		csrfToken: csrfTokenFromCookie
	});

	let isUserMode = $derived(mode === 'user');
	let canShowDashboard = $derived(!isUserMode || session !== null);
	let signedInLabel = $derived(session?.email || session?.name || session?.userId || 'Signed in');
	let organizationLabel = $derived(organizations[0]?.name || 'Default organization');
	let anyDashboardLoading = $derived(
		approvalsStatus === 'loading' || devicesStatus === 'loading' || agentsStatus === 'loading' || teamsStatus === 'loading' || projectsStatus === 'loading' || policiesStatus === 'loading' || billingStatus === 'loading' || auditStatus === 'loading'
	);
	let selectedTeam = $derived(teams.find((team) => team.teamId === selectedTeamID));
	let selectedProject = $derived(projects.find((project) => project.projectId === selectedProjectID));
	let selectedPolicy = $derived(policies.find((policy) => policy.policyId === selectedPolicyID));
	let setupCommand = $derived(
		newAgentCredential
			? `agent-tick setup --server ${shellQuote(publicURL)} --token ${shellQuote(newAgentCredential.token)}`
			: ''
	);
	let setupEnvCommand = $derived.by(() => {
		if (!newAgentCredential) return '';
		const lines = [
			`export AGENT_TICK_SERVER=${shellQuote(publicURL)}`,
			`export AGENT_TICK_TOKEN=${shellQuote(newAgentCredential.token)}`
		];
		if (newAgentCredential.projectId) lines.push(`export AGENT_TICK_PROJECT_ID=${shellQuote(newAgentCredential.projectId)}`);
		if (newAgentCredential.teamId) lines.push(`export AGENT_TICK_TEAM=${shellQuote(newAgentCredential.teamId)}`);
		if (newAgentCredential.defaultApprovalPolicy) lines.push(`export AGENT_TICK_APPROVAL_POLICY=${shellQuote(newAgentCredential.defaultApprovalPolicy)}`);
		return lines.join('\n');
	});
	let testCommand = $derived(
		"agent-tick request --title 'Run command?' --body 'Agent Tick test approval from the CLI' --command 'npm install'"
	);
	let billingUsageRows = $derived.by(() => {
		if (!billing) return [];
		return [
			{ label: 'Seats', used: billing.usage.activeUsers, limit: billing.limits.seats, help: 'Organization members with access.' },
			{ label: 'Teams', used: billing.usage.teams, limit: billing.limits.teams, help: 'Team workspaces for routing and on-call coverage.' },
			{ label: 'Active agents', used: billing.usage.activeAgents, limit: billing.limits.agents, help: 'Non-revoked agent tokens.' },
			{ label: 'Approval requests', used: billing.usage.approvalRequests30d, limit: billing.limits.requests, help: 'Requests created in the last 30 days.' },
			{ label: 'Push notifications', used: billing.usage.pushNotifications30d, limit: -1, help: 'Remote push notification attempts in the last 30 days.' },
			{ label: 'Audit events', used: billing.usage.auditEventsRetained, limit: -1, help: `${formatLimit(billing.limits.auditRetentionDays, 'days')} audit retention.` }
		];
	});

	onMount(() => {
		if (isUserMode) {
			void resumeSession();
		}
	});

	async function resumeSession() {
		authStatus = 'loading';
		authError = '';
		try {
			session = await api.getSession();
			authStatus = 'ready';
			await refreshDashboard();
		} catch {
			session = null;
			authStatus = 'idle';
		}
	}

	async function login(event?: SubmitEvent) {
		event?.preventDefault();
		authError = '';
		if (!email.trim() || !password) {
			authError = 'Enter your email and password.';
			return;
		}

		authStatus = 'loading';
		try {
			session = await api.login({ email: email.trim(), password });
			password = '';
			authStatus = 'ready';
			await refreshDashboard();
		} catch (error) {
			session = null;
			authStatus = 'error';
			authError = errorMessage(error);
		}
	}

	async function connectDashboard(event?: SubmitEvent) {
		event?.preventDefault();
		authError = '';
		clearPairing();
		await refreshDashboard();
	}

	async function refreshDashboard() {
		if (!canShowDashboard) return;
		await Promise.all([loadApprovals(), loadDevices(), loadAgents(), loadOrganizations(), loadTeams(), loadProjects(), loadPolicies(), loadBilling(), loadAuditEvents()]);
	}

	async function loadBilling() {
		billingStatus = 'loading';
		billingError = '';
		try {
			billing = await api.getBillingStatus();
			billingStatus = 'ready';
		} catch (error) {
			billing = null;
			billingStatus = 'error';
			billingError = errorMessage(error);
		}
	}

	async function loadAuditEvents() {
		auditStatus = 'loading';
		auditError = '';
		try {
			auditEvents = await api.listAuditEvents(auditEventType, 100);
			auditStatus = 'ready';
		} catch (error) {
			auditEvents = [];
			auditStatus = 'error';
			auditError = errorMessage(error);
		}
	}

	async function exportAuditEvents() {
		auditExporting = true;
		auditError = '';
		try {
			const csv = await api.exportAuditEventsCSV(auditEventType, 1000);
			const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
			const link = document.createElement('a');
			link.href = url;
			link.download = `agent-tick-audit-${new Date().toISOString().slice(0, 10)}.csv`;
			link.click();
			URL.revokeObjectURL(url);
		} catch (error) {
			auditError = errorMessage(error);
		} finally {
			auditExporting = false;
		}
	}

	async function loadApprovals() {
		approvalsStatus = 'loading';
		approvalsError = '';
		try {
			approvals = await api.listApprovals();
			approvalsStatus = 'ready';
		} catch (error) {
			approvals = [];
			approvalsStatus = 'error';
			approvalsError = errorMessage(error);
		}
	}

	async function loadDevices() {
		devicesStatus = 'loading';
		devicesError = '';
		try {
			devices = await api.listDevices();
			devicesStatus = 'ready';
		} catch (error) {
			devices = [];
			devicesStatus = 'error';
			devicesError = errorMessage(error);
		}
	}

	async function loadAgents() {
		agentsStatus = 'loading';
		agentsError = '';
		try {
			agents = await api.listAgentTokens();
			agentsStatus = 'ready';
		} catch (error) {
			agents = [];
			agentsStatus = 'error';
			agentsError = errorMessage(error);
		}
	}

	async function loadOrganizations() {
		organizationsStatus = 'loading';
		organizationsError = '';
		try {
			organizations = await api.listOrganizations();
			organizationsStatus = 'ready';
		} catch (error) {
			organizations = [];
			organizationsStatus = 'error';
			organizationsError = errorMessage(error);
		}
	}

	async function loadTeams() {
		teamsStatus = 'loading';
		teamsError = '';
		try {
			teams = await api.listTeams();
			teamsStatus = 'ready';
		} catch (error) {
			teams = [];
			teamsStatus = 'error';
			teamsError = errorMessage(error);
		}
	}

	async function loadTeamPresence(teamID = selectedTeamID) {
		if (!teamID) return;
		teamPresenceStatus = 'loading';
		teamPresenceError = '';
		try {
			const [availability, coverage, schedules] = await Promise.all([api.listTeamAvailability(teamID), api.getTeamCoverage(teamID), api.listOnCallSchedules(teamID)]);
			teamAvailability = availability;
			teamCoverage = coverage;
			onCallSchedules = schedules;
			onCallPrimaryUserID = schedules[0]?.primaryUserId || coverage.primaryUserId || '';
			onCallSecondaryUserID = schedules[0]?.secondaryUserId || coverage.secondaryUserId || '';
			teamPresenceStatus = 'ready';
		} catch (error) {
			teamAvailability = [];
			teamCoverage = null;
			onCallSchedules = [];
			teamPresenceStatus = 'error';
			teamPresenceError = errorMessage(error);
		}
	}

	async function saveOnCallSchedule(event?: SubmitEvent) {
		event?.preventDefault();
		if (!selectedTeamID) return;
		teamPresenceError = '';
		if (!onCallPrimaryUserID.trim()) {
			teamPresenceError = 'Enter a primary approver user ID.';
			return;
		}
		savingOnCall = true;
		try {
			await api.upsertOnCallSchedule(selectedTeamID, { primaryUserId: onCallPrimaryUserID.trim(), secondaryUserId: onCallSecondaryUserID.trim() || undefined });
			await loadTeamPresence(selectedTeamID);
		} catch (error) {
			teamPresenceError = errorMessage(error);
		} finally {
			savingOnCall = false;
		}
	}

	async function loadProjects() {
		projectsStatus = 'loading';
		projectsError = '';
		try {
			projects = await api.listProjects();
			projectsStatus = 'ready';
		} catch (error) {
			projects = [];
			projectsStatus = 'error';
			projectsError = errorMessage(error);
		}
	}

	async function loadPolicies() {
		policiesStatus = 'loading';
		policiesError = '';
		try {
			policies = await api.listPolicies();
			policiesStatus = 'ready';
		} catch (error) {
			policies = [];
			policiesStatus = 'error';
			policiesError = errorMessage(error);
		}
	}

	async function createOrganization(event?: SubmitEvent) {
		event?.preventDefault();
		organizationActionError = '';
		if (!organizationName.trim()) {
			organizationActionError = 'Enter an organization name.';
			return;
		}
		creatingOrganization = true;
		try {
			await api.createOrganization({ name: organizationName.trim() });
			organizationName = '';
			await loadOrganizations();
			await Promise.all([loadTeams(), loadProjects()]);
		} catch (error) {
			organizationActionError = errorMessage(error);
		} finally {
			creatingOrganization = false;
		}
	}

	async function createTeam(event?: SubmitEvent) {
		event?.preventDefault();
		teamActionError = '';
		if (!teamName.trim()) {
			teamActionError = 'Enter a team name.';
			return;
		}
		creatingTeam = true;
		try {
			await api.createTeam({ name: teamName.trim(), description: teamDescription.trim() });
			teamName = '';
			teamDescription = '';
			await loadTeams();
		} catch (error) {
			teamActionError = errorMessage(error);
		} finally {
			creatingTeam = false;
		}
	}

	async function createProject(event?: SubmitEvent) {
		event?.preventDefault();
		projectActionError = '';
		if (!projectName.trim()) {
			projectActionError = 'Enter a project name.';
			return;
		}
		creatingProject = true;
		try {
			await api.createProject({ name: projectName.trim(), description: projectDescription.trim(), teamId: projectTeamID || undefined, defaultPolicyId: projectDefaultPolicyID || undefined });
			projectName = '';
			projectDescription = '';
			projectTeamID = '';
			projectDefaultPolicyID = '';
			await loadProjects();
		} catch (error) {
			projectActionError = errorMessage(error);
		} finally {
			creatingProject = false;
		}
	}

	async function createPolicy(event?: SubmitEvent) {
		event?.preventDefault();
		policyActionError = '';
		if (!policyName.trim()) {
			policyActionError = 'Enter a policy name.';
			return;
		}
		creatingPolicy = true;
		try {
			const policy = await api.createPolicy({
				name: policyName.trim(),
				template: policyTemplate,
				teamId: policyTeamID || undefined,
				settings: {
					quorum: policyQuorum,
					timeoutSeconds: policyTimeout,
					escalationTarget: policyEscalationTarget,
					denyVeto: String(policyDenyVeto)
				}
			});
			policyName = '';
			policyEscalationTarget = '';
			selectedPolicyID = policy.policyId;
			await loadPolicies();
			await previewPolicy(policy.policyId);
		} catch (error) {
			policyActionError = errorMessage(error);
		} finally {
			creatingPolicy = false;
		}
	}

	async function previewPolicy(policyID: string) {
		selectedPolicyID = policyID;
		policyPreview = null;
		policyPreviewError = '';
		try {
			policyPreview = await api.previewPolicy(policyID);
		} catch (error) {
			policyPreviewError = errorMessage(error);
		}
	}

	async function respond(id: string, choice: Choice) {
		busyApproval = `${id}:${choice.id}`;
		approvalsError = '';
		try {
			await api.respondToApproval(id, choice.id);
			await loadApprovals();
		} catch (error) {
			approvalsError = errorMessage(error);
		} finally {
			busyApproval = '';
		}
	}

	async function createPairing() {
		pairingStatus = 'loading';
		pairingError = '';
		try {
			pairing = await api.createPairingToken();
			pairingStatus = 'ready';
			schedulePairingClear(pairing.expiresAt);
		} catch (error) {
			pairing = null;
			pairingStatus = 'error';
			pairingError = errorMessage(error);
		}
	}

	function clearPairing() {
		if (pairingClearTimer !== undefined) {
			window.clearTimeout(pairingClearTimer);
			pairingClearTimer = undefined;
		}
		pairing = null;
		pairingStatus = 'idle';
		pairingError = '';
	}

	function schedulePairingClear(expiresAt: string) {
		if (pairingClearTimer !== undefined) {
			window.clearTimeout(pairingClearTimer);
		}
		const expiry = new Date(expiresAt).getTime();
		if (Number.isFinite(expiry)) {
			pairingClearTimer = window.setTimeout(clearPairing, Math.max(0, expiry - Date.now()));
		}
	}

	async function revokeDevice(device: DeviceRecord) {
		if (!window.confirm(`Revoke ${device.name || device.deviceId}? The device will no longer be able to authenticate.`)) {
			return;
		}
		busyDevice = device.deviceId;
		devicesError = '';
		try {
			await api.unpairDevice(device.deviceId);
			await loadDevices();
		} catch (error) {
			devicesError = errorMessage(error);
		} finally {
			busyDevice = '';
		}
	}

	async function createAgentToken(event?: SubmitEvent) {
		event?.preventDefault();
		creatingAgent = true;
		agentActionError = '';
		newAgentCredential = null;
		try {
			let projectID = agentProjectID;
			if (agentNewProjectName.trim()) {
				const project = await api.createProject({ name: agentNewProjectName.trim(), teamId: agentTeamID || undefined });
				projectID = project.projectId;
				await loadProjects();
			}
			newAgentCredential = await api.createAgentToken({
				name: agentName.trim() || 'agent',
				scopes: ['approval:write'],
				projectId: projectID || undefined,
				ownerUserId: (agentOwnerUserID || session?.userId || '').trim() || undefined,
				teamId: agentTeamID || undefined,
				defaultApprovalPolicy: agentDefaultPolicy || undefined
			});
			agentName = 'agent';
			agentProjectID = projectID;
			agentNewProjectName = '';
			await loadAgents();
		} catch (error) {
			agentActionError = errorMessage(error);
		} finally {
			creatingAgent = false;
		}
	}

	async function revokeAgent(agent: AgentTokenRecord) {
		if (!window.confirm(`Revoke ${agent.name || agent.agentId}? This cannot be undone.`)) {
			return;
		}
		busyAgent = agent.agentId;
		agentsError = '';
		try {
			await api.revokeAgentToken(agent.agentId);
			await loadAgents();
		} catch (error) {
			agentsError = errorMessage(error);
		} finally {
			busyAgent = '';
		}
	}

	async function rotateAgent(agent: AgentTokenRecord) {
		if (!window.confirm(`Rotate ${agent.name || agent.agentId}? Existing setup commands using this token will stop working.`)) {
			return;
		}
		busyAgent = agent.agentId;
		agentsError = '';
		newAgentCredential = null;
		try {
			newAgentCredential = await api.rotateAgentToken(agent.agentId);
			await loadAgents();
		} catch (error) {
			agentsError = errorMessage(error);
		} finally {
			busyAgent = '';
		}
	}

	function selectTeam(teamID: string) {
		selectedTeamID = teamID;
		void loadTeamPresence(teamID);
	}

	function closeTeam() {
		selectedTeamID = '';
		teamAvailability = [];
		teamCoverage = null;
		onCallSchedules = [];
		teamPresenceError = '';
	}

	function requesterLabel(requester: Requester): string {
		const base = requester.projectName || requester.host || requester.name || 'Agent';
		if (requester.workingDirectory && requester.workingDirectory !== base) {
			return `${base} · ${requester.workingDirectory}`;
		}
		return base;
	}

	function choiceLabel(choice: Choice): string {
		return choice.label || choice.id;
	}

	function isActionable(approval: ApprovalRequest): boolean {
		return approval.status === 'pending' && approval.requestType !== 'questionnaire' && approval.choices.length > 0;
	}

	function teamNameForID(teamID: string | undefined): string {
		if (!teamID) return 'No team';
		return teams.find((team) => team.teamId === teamID)?.name || teamID;
	}

	function projectNameForID(projectID: string | undefined): string {
		if (!projectID) return 'Default project';
		return projects.find((project) => project.projectId === projectID)?.name || projectID;
	}

	function policyLabel(policy: string | undefined): string {
		if (!policy) return 'No default policy';
		return policies.find((record) => record.policyId === policy)?.name || policy
			.split('-')
			.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
			.join(' ');
	}

	function projectCountForTeam(teamID: string): number {
		return projects.filter((project) => project.teamId === teamID).length;
	}

	function availabilityLabel(record: UserAvailabilityRecord): string {
		const seen = record.lastSeenAt ? ` · last seen ${formatDate(record.lastSeenAt)}` : ' · no heartbeat yet';
		const until = record.overrideUntil ? ` until ${formatDate(record.overrideUntil)}` : '';
		return `${record.state}${until}${seen}`;
	}

	function formatDate(value: string | undefined): string {
		if (!value) return 'Unknown time';
		const date = new Date(value);
		return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
	}

	function formatLimit(value: number, unit = ''): string {
		if (value < 0) return 'Unlimited';
		return `${value.toLocaleString()}${unit ? ` ${unit}` : ''}`;
	}

	function usagePercent(used: number, limit: number): number {
		if (limit <= 0) return 0;
		return Math.min(100, Math.round((used / limit) * 100));
	}

	function payloadLabel(payload: Record<string, unknown>): string {
		const entries = Object.entries(payload ?? {}).slice(0, 4);
		if (entries.length === 0) return 'No payload';
		return entries.map(([key, value]) => `${key}: ${String(value)}`).join(' · ');
	}

	function statusText(status: LoadStatus, loading: string): string {
		return status === 'loading' ? loading : '';
	}

	function errorMessage(error: unknown): string {
		if (error instanceof Error) return error.message;
		return 'Something went wrong. Please try again.';
	}

	function shellQuote(value: string): string {
		return "'" + String(value).replace(/'/g, "'\\''") + "'";
	}
</script>

<svelte:head>
	<title>Agent Tick Admin</title>
</svelte:head>

<div class="shell">
	<header class="hero">
		<div>
			<p class="eyebrow">Approval dashboard</p>
			<h1>Agent Tick</h1>
			<p class="hero-copy">Pair phones, create scoped agent tokens, and clear approval requests without leaving the browser.</p>
		</div>
		<div class="mode-pill">{isUserMode ? 'User mode' : 'Single-user mode'}</div>
	</header>

	{#if isUserMode && !session}
		<section class="auth-card" aria-labelledby="signin-title">
			<div>
				<p class="eyebrow">Sign in</p>
				<h2 id="signin-title">Connect your dashboard</h2>
				<p class="muted">Use your Agent Tick account to resume your session, pair phones, and manage your own agent tokens.</p>
			</div>
			<form class="auth-form" onsubmit={login}>
				<label>
					<span>Email</span>
					<input bind:value={email} type="email" autocomplete="username" placeholder="you@example.com" required />
				</label>
				<label>
					<span>Password</span>
					<input bind:value={password} type="password" autocomplete="current-password" placeholder="••••••••" required />
				</label>
				<div class="toolbar">
					<button type="submit" disabled={authStatus === 'loading'}>{authStatus === 'loading' ? 'Signing in…' : 'Sign in'}</button>
					<button type="button" class="secondary" onclick={resumeSession} disabled={authStatus === 'loading'}>Resume session</button>
				</div>
				{#if authError}
					<p class="error" role="alert">{authError}</p>
				{:else if authStatus === 'loading'}
					<p class="muted">Checking your session…</p>
				{/if}
			</form>
		</section>
	{:else}
		<section class="auth-card compact" aria-label="Dashboard connection">
			{#if isUserMode}
				<div>
					<p class="eyebrow">Session</p>
					<h2>{signedInLabel}</h2>
					<p class="muted">{organizationLabel} · Session cookies and CSRF protection are active for dashboard actions.</p>
				</div>
			{:else}
				<form class="connect-form" onsubmit={connectDashboard}>
					<label>
						<span>Admin bearer token</span>
						<input bind:value={bearerToken} type="password" autocomplete="off" placeholder="Paste token and press Enter" />
					</label>
					<button type="submit" disabled={anyDashboardLoading}>Connect</button>
				</form>
			{/if}
			<button class="secondary" onclick={refreshDashboard} disabled={anyDashboardLoading}>Refresh all</button>
			{#if authError}
				<p class="error" role="alert">{authError}</p>
			{/if}
		</section>

		<nav class="quick-actions" aria-label="Dashboard sections">
			<a href="#setup">Start here</a>
			<a href="#devices">Pair phone</a>
			<a href="#agents">Agent token</a>
			<a href="#approvals">Approvals</a>
			<a href="#more">More</a>
		</nav>

		<section id="setup" class="onboarding-card" aria-labelledby="setup-title">
			<div>
				<p class="eyebrow">First run</p>
				<h2 id="setup-title">Connect an agent to your phone in three steps</h2>
				<p class="muted">This dashboard is focused on setup. Pair a phone, create one scoped agent token, then send a test approval.</p>
			</div>
			<ol class="setup-steps">
				<li><a href="#devices"><strong>Pair mobile</strong><span>Create a QR and scan it from the app.</span></a></li>
				<li><a href="#agents"><strong>Create agent token</strong><span>Copy the one-time setup command.</span></a></li>
				<li><a href="#approvals"><strong>Test approval</strong><span>Run the request command and approve on mobile.</span></a></li>
			</ol>
		</section>

		<main class="dashboard-grid">
			<section id="approvals" class="panel approvals-panel" aria-labelledby="approvals-title">
				<div class="panel-heading">
					<div>
						<p class="eyebrow">Approvals</p>
						<h2 id="approvals-title">Requests</h2>
					</div>
					<button class="secondary" onclick={loadApprovals} disabled={approvalsStatus === 'loading'}>Refresh</button>
				</div>

				{#if approvalsError}
					<div class="inline-error" role="alert"><strong>Error</strong><span>{approvalsError}</span></div>
				{/if}
				{#if approvalsStatus === 'idle'}
					<div class="empty-state">Connect to load approval requests.</div>
				{:else if approvalsStatus === 'loading'}
					<div class="empty-state">{statusText(approvalsStatus, 'Loading approvals…')}</div>
				{:else if approvals.length === 0 && !approvalsError}
					<div class="empty-state">No approval requests yet. After setup, test requests appear here.</div>
				{:else}
					<div class="request-list">
						{#each approvals as approval (approval.id)}
							<article class={['request-card', `status-${approval.status}`]}>
								<div class="request-meta-row">
									<span class="status-pill">{approval.status}</span>
									<time datetime={approval.createdAt}>{formatDate(approval.createdAt)}</time>
								</div>
								<h3>{approval.title}</h3>
								<p class="muted">{requesterLabel(approval.requester)}</p>
								{#if approval.body}
									<p>{approval.body}</p>
								{/if}
								{#if approval.command}
									<pre>{approval.command}</pre>
								{/if}
								{#if approval.response}
									<p class="muted">Response: {approval.response.choiceId || 'answered'}{approval.respondedAt ? ` · ${formatDate(approval.respondedAt)}` : ''}</p>
								{/if}
								{#if isActionable(approval)}
									<div class="toolbar">
										{#each approval.choices as choice (choice.id)}
											<button onclick={() => respond(approval.id, choice)} disabled={busyApproval !== ''} class={choice.kind === 'deny' || choice.id === 'deny' ? 'danger' : ''}>{busyApproval === `${approval.id}:${choice.id}` ? 'Sending…' : choiceLabel(choice)}</button>
										{/each}
									</div>
								{/if}
							</article>
						{/each}
					</div>
				{/if}
			</section>
			<details id="billing" class="panel secondary-panel">
				<summary>
					<span>
						<span class="eyebrow">Billing</span>
						<strong>Plan and settings</strong>
					</span>
					<span class="summary-count">{billing?.plan || '—'}</span>
				</summary>
				<div class="panel-body">
					{#if billingError}
						<div class="inline-error" role="alert"><strong>Error</strong><span>{billingError}</span></div>
					{/if}
					{#if billingStatus === 'idle'}
						<div class="empty-state">Connect to load billing settings.</div>
					{:else if billingStatus === 'loading'}
						<div class="empty-state">Loading billing settings…</div>
					{:else if billing}
						<div class="billing-summary">
							<div>
								<p class="eyebrow">Current plan</p>
								<h3>{billing.plan}</h3>
								<p class="muted">Organization <code>{billing.organizationId}</code></p>
							</div>
							<div>
								<p class="eyebrow">Retention</p>
								<p><strong>{formatLimit(billing.limits.auditRetentionDays, 'days')}</strong> audit</p>
								<p><strong>{formatLimit(billing.limits.approvalRetentionDays, 'days')}</strong> approvals</p>
							</div>
						</div>
						<div class="usage-grid">
							{#each billingUsageRows as row (row.label)}
								<article class="usage-card">
									<div class="request-meta-row">
										<strong>{row.label}</strong>
										<span>{row.used.toLocaleString()} / {formatLimit(row.limit)}</span>
									</div>
									<div class="usage-meter" aria-hidden="true"><span style:width={`${usagePercent(row.used, row.limit)}%`}></span></div>
									<p class="muted">{row.help}</p>
								</article>
							{/each}
						</div>
						<div class="billing-actions">
							<div class="link-card">
								<strong>Billing portal</strong>
								{#if billing.portalUrl}
									<a class="button-link" href={billing.portalUrl}>Open portal</a>
								{:else}
									<p class="muted">Portal link is not configured for this self-hosted plan yet.</p>
								{/if}
							</div>
							<div class="link-card">
								<strong>Invoices</strong>
								{#if billing.invoicesUrl}
									<a class="button-link" href={billing.invoicesUrl}>View invoices</a>
								{:else}
									<p class="muted">Invoice links appear here when a hosted billing provider is connected.</p>
								{/if}
							</div>
							<div class="link-card highlight">
								<strong>Need more seats or agents?</strong>
								<p class="muted">Limits are shown before you hit them. Self-hosted installs stay unlimited by default.</p>
								{#if billing.upgradeUrl}
									<a class="button-link" href={billing.upgradeUrl}>Contact / upgrade</a>
								{/if}
							</div>
						</div>
					{/if}
				</div>
			</details>

			<details id="audit" class="panel secondary-panel">
				<summary>
					<span>
						<span class="eyebrow">Audit</span>
						<strong>Security events</strong>
					</span>
					<span class="summary-count">{auditEvents.length}</span>
				</summary>
				<div class="panel-body">
					<form class="agent-form" onsubmit={(event) => { event.preventDefault(); void loadAuditEvents(); }}>
						<label>
							<span>Event type filter</span>
							<input bind:value={auditEventType} type="text" autocomplete="off" placeholder="team.created" />
						</label>
						<button type="submit" disabled={auditStatus === 'loading'}>{auditStatus === 'loading' ? 'Loading…' : 'Filter'}</button>
						<button type="button" class="secondary" onclick={exportAuditEvents} disabled={auditExporting || auditStatus === 'loading'}>{auditExporting ? 'Exporting…' : 'Export CSV'}</button>
					</form>
					<p class="muted">Admins see only the authenticated organization. Exports include event id, actor user id, target id, timestamp, and JSON payload.</p>
					{#if auditError}
						<div class="inline-error" role="alert"><strong>Error</strong><span>{auditError}</span></div>
					{/if}
					{#if auditStatus === 'idle'}
						<div class="empty-state">Connect to load audit events.</div>
					{:else if auditStatus === 'loading'}
						<div class="empty-state">Loading audit events…</div>
					{:else if auditEvents.length === 0 && !auditError}
						<div class="empty-state">No audit events match this filter yet.</div>
					{:else}
						<div class="item-list audit-list">
							{#each auditEvents as event (event.eventId)}
								<article class="item-card audit-card">
									<div>
										<strong>{event.eventType}</strong>
										<p class="muted">{formatDate(event.createdAt)} · actor <code>{event.userId}</code></p>
										<p class="muted">Target: <code>{event.targetId || event.organizationId}</code></p>
										<p>{payloadLabel(event.payload)}</p>
									</div>
									<code>#{event.eventId}</code>
								</article>
							{/each}
						</div>
					{/if}
				</div>
			</details>


			<details id="devices" class="panel" open>
				<summary>
					<span>
						<span class="eyebrow">Devices</span>
						<strong>Phones and pairing</strong>
					</span>
					<span class="summary-count">{devices.length}</span>
				</summary>
				<div class="panel-body">
					<div class="pairing-card">
						<div>
							<h3>Pair a phone</h3>
							<p class="muted">Create a short-lived QR only when your phone is ready to scan.</p>
						</div>
						{#if pairing}
							<div class="qr-wrap">
								{#if pairing.qrDataUrl}
									<img src={pairing.qrDataUrl} alt="Agent Tick phone pairing QR" />
								{/if}
								<p class="muted">Expires {formatDate(pairing.expiresAt)}. The pairing secret is hidden.</p>
								<div class="toolbar">
									<button class="secondary" onclick={createPairing} disabled={pairingStatus === 'loading'}>Renew</button>
									<button class="ghost" onclick={clearPairing}>Clear</button>
								</div>
							</div>
						{:else}
							<button class="secondary" onclick={createPairing} disabled={pairingStatus === 'loading'}>{pairingStatus === 'loading' ? 'Creating QR…' : 'Create QR'}</button>
						{/if}
						{#if pairingError}
							<p class="error" role="alert">{pairingError}</p>
						{/if}
					</div>

					{#if devicesError}
						<div class="inline-error" role="alert"><strong>Error</strong><span>{devicesError}</span></div>
					{/if}
					{#if devicesStatus === 'idle'}
						<div class="empty-state">Connect to load paired devices.</div>
					{:else if devicesStatus === 'loading'}
						<div class="empty-state">Loading devices…</div>
					{:else if devices.length === 0 && !devicesError}
						<div class="empty-state">No paired devices yet.</div>
					{:else}
						<div class="item-list">
							{#each devices as device (device.deviceId)}
								<article class={['item-card', device.unpairedAt ? 'is-muted' : '']}>
									<div>
										<strong>{device.name || 'Phone'}</strong>
										<code>{device.deviceId}</code>
										<p class="muted">
											{device.unpairedAt ? `Unpaired ${formatDate(device.unpairedAt)}` : `${device.pushNotifications ? 'Push on' : 'Push off'} · Paired ${formatDate(device.createdAt)}`}
										</p>
									</div>
									{#if !device.unpairedAt}
										<button class="secondary danger-text" onclick={() => revokeDevice(device)} disabled={busyDevice === device.deviceId}>{busyDevice === device.deviceId ? 'Revoking…' : 'Revoke'}</button>
									{/if}
								</article>
							{/each}
						</div>
					{/if}
				</div>
			</details>

			<details id="agents" class="panel" open>
				<summary>
					<span>
						<span class="eyebrow">Agents</span>
						<strong>Agent tokens</strong>
					</span>
					<span class="summary-count">{agents.length}</span>
				</summary>
				<div class="panel-body">
					<form class="wizard-form" onsubmit={createAgentToken}>
						<div>
							<p class="eyebrow">Registration wizard</p>
							<h3>Where is this agent running, what project is it for, and who can approve it?</h3>
						</div>
						<label>
							<span>1. Agent name</span>
							<input bind:value={agentName} type="text" autocomplete="off" placeholder="codex-laptop" />
						</label>
						<label>
							<span>2. Existing project</span>
							<select bind:value={agentProjectID}>
								<option value="">Default project</option>
								{#each projects as project (project.projectId)}
									<option value={project.projectId}>{project.name}</option>
								{/each}
							</select>
						</label>
						<label>
							<span>Or create project</span>
							<input bind:value={agentNewProjectName} type="text" autocomplete="off" placeholder="New project name" />
						</label>
						<label>
							<span>3. Owner user ID</span>
							<input bind:value={agentOwnerUserID} type="text" autocomplete="off" placeholder={session?.userId || 'usr_default'} />
						</label>
						<label>
							<span>4. Team access</span>
							<select bind:value={agentTeamID}>
								<option value="">No team restriction</option>
								{#each teams as team (team.teamId)}
									<option value={team.teamId}>{team.name}</option>
								{/each}
							</select>
						</label>
						<label>
							<span>5. Default approval policy</span>
							<select bind:value={agentDefaultPolicy}>
								<option value="">Use project or organization default</option>
								{#each policies as policy (policy.policyId)}
									<option value={policy.policyId}>{policy.name}</option>
								{/each}
							</select>
						</label>
						<button type="submit" disabled={creatingAgent}>{creatingAgent ? 'Creating…' : 'Create Agent Token'}</button>
					</form>
					<p class="muted">Dashboard-created agent tokens use the <code>approval:write</code> scope for CLI request creation and polling.</p>
					{#if agentActionError}
						<p class="error" role="alert">{agentActionError}</p>
					{/if}
					{#if newAgentCredential}
						<details class="setup-output" open>
							<summary>Setup commands for {newAgentCredential.name}</summary>
							<p class="muted">Run one of these setup paths once. The token will not be shown again after you refresh or create another token.</p>
							<strong>Config-file setup</strong>
							<pre>{setupCommand + '\n' + testCommand}</pre>
							<strong>Environment-variable setup</strong>
							<pre>{setupEnvCommand + '\n' + testCommand}</pre>
						</details>
					{/if}

					{#if agentsError}
						<div class="inline-error" role="alert"><strong>Error</strong><span>{agentsError}</span></div>
					{/if}
					{#if agentsStatus === 'idle'}
						<div class="empty-state">Connect to load agent tokens.</div>
					{:else if agentsStatus === 'loading'}
						<div class="empty-state">Loading agents…</div>
					{:else if agents.length === 0 && !agentsError}
						<div class="empty-state">No agent tokens yet.</div>
					{:else}
						<div class="item-list">
							{#each agents as agent (agent.agentId)}
								<article class={['item-card', agent.revokedAt ? 'is-muted' : '']}>
									<div>
										<strong>{agent.name || 'agent'}</strong>
										<code>{agent.agentId}</code>
										<p class="muted">
											{agent.revokedAt ? `Revoked ${formatDate(agent.revokedAt)}` : `Active · Created ${formatDate(agent.createdAt)}`}
										</p>
										<p class="muted">Owner: {agent.ownerUserId || 'default'} · Project: {projectNameForID(agent.projectId)} · Team: {teamNameForID(agent.teamId)}</p>
										<p class="muted">Policy: {policyLabel(agent.defaultApprovalPolicy)} · Last request: {agent.lastRequestAt ? formatDate(agent.lastRequestAt) : 'never'}</p>
										<p class="muted">Scopes: {agent.scopes.join(', ') || 'none'}</p>
									</div>
									{#if !agent.revokedAt}
										<div class="toolbar">
											<button class="secondary" onclick={() => rotateAgent(agent)} disabled={busyAgent !== ''}>{busyAgent === agent.agentId ? 'Working…' : 'Rotate'}</button>
											<button class="secondary danger-text" onclick={() => revokeAgent(agent)} disabled={busyAgent !== ''}>{busyAgent === agent.agentId ? 'Working…' : 'Revoke'}</button>
										</div>
									{/if}
								</article>
							{/each}
						</div>
					{/if}
				</div>
			</details>

			<details id="teams" class="panel secondary-panel">
				<summary>
					<span>
						<span class="eyebrow">Teams</span>
						<strong>Team workspace</strong>
					</span>
					<span class="summary-count">{teams.length}</span>
				</summary>
				<div class="panel-body">
					{#if organizationsError}
						<div class="inline-error" role="alert"><strong>Organization</strong><span>{organizationsError}</span></div>
					{:else if organizationsStatus === 'ready'}
						<p class="muted">Managing <strong>{organizationLabel}</strong> as {organizations[0]?.role || 'owner'}.</p>
					{/if}
					<form class="agent-form" onsubmit={createOrganization}>
						<label>
							<span>Organization name</span>
							<input bind:value={organizationName} type="text" autocomplete="organization" placeholder="Acme AI" />
						</label>
						<button type="submit" class="secondary" disabled={creatingOrganization}>{creatingOrganization ? 'Creating…' : 'Create Organization'}</button>
					</form>
					{#if organizationActionError}
						<p class="error" role="alert">{organizationActionError}</p>
					{/if}
					<form class="agent-form" onsubmit={createTeam}>
						<label>
							<span>Team name</span>
							<input bind:value={teamName} type="text" autocomplete="off" placeholder="Platform" />
						</label>
						<label>
							<span>Description</span>
							<input bind:value={teamDescription} type="text" autocomplete="off" placeholder="Optional context" />
						</label>
						<button type="submit" disabled={creatingTeam}>{creatingTeam ? 'Creating…' : 'Create Team'}</button>
					</form>
					{#if teamActionError}
						<p class="error" role="alert">{teamActionError}</p>
					{/if}
					{#if teamsError}
						<div class="inline-error" role="alert"><strong>Error</strong><span>{teamsError}</span></div>
					{/if}
					{#if teamsStatus === 'idle'}
						<div class="empty-state">Connect to load teams.</div>
					{:else if teamsStatus === 'loading'}
						<div class="empty-state">Loading teams…</div>
					{:else if teams.length === 0 && !teamsError}
						<div class="empty-state">No teams yet. Small installs can keep using the default organization without creating one.</div>
					{:else}
						<div class="item-list">
							{#each teams as team (team.teamId)}
								<article class="item-card">
									<div>
										<strong>{team.name}</strong>
										<code>{team.teamId}</code>
										{#if team.description}
											<p>{team.description}</p>
										{/if}
										<p class="muted">{projectCountForTeam(team.teamId)} projects · Created {formatDate(team.createdAt)}</p>
									</div>
									<button class="secondary" onclick={() => selectTeam(team.teamId)}>Details</button>
								</article>
							{/each}
						</div>
					{/if}
					{#if selectedTeam}
						<section class="detail-card" aria-label="Team details">
							<div class="panel-heading">
								<div>
									<p class="eyebrow">Team detail</p>
									<h3>{selectedTeam.name}</h3>
								</div>
								<button class="ghost" onclick={closeTeam}>Close</button>
							</div>
							<p class="muted">{selectedTeam.description || 'No description yet.'}</p>
							<p><code>{selectedTeam.teamId}</code></p>
							<p class="muted">Created {formatDate(selectedTeam.createdAt)} · Updated {formatDate(selectedTeam.updatedAt)}</p>
							<p class="muted">Projects: {projects.filter((project) => project.teamId === selectedTeam.teamId).map((project) => project.name).join(', ') || 'none yet'}</p>
							<div class="coverage-card">
								<div class="panel-heading compact-heading">
									<div>
										<p class="eyebrow">Coverage</p>
										<strong>{teamCoverage?.summary || 'No coverage data yet.'}</strong>
									</div>
									<button class="secondary" onclick={() => loadTeamPresence(selectedTeam.teamId)} disabled={teamPresenceStatus === 'loading'}>{teamPresenceStatus === 'loading' ? 'Refreshing…' : 'Refresh coverage'}</button>
								</div>
								<p class="muted">Preview uses coarse last-seen and manual availability. Mobile users can set Do Not Disturb or Off-call from Settings.</p>
								{#if teamPresenceError}
									<p class="error" role="alert">{teamPresenceError}</p>
								{/if}
								<form class="agent-form" onsubmit={saveOnCallSchedule}>
									<label>
										<span>Primary on-call user ID</span>
										<input bind:value={onCallPrimaryUserID} type="text" autocomplete="off" placeholder="usr_..." />
									</label>
									<label>
										<span>Secondary fallback user ID</span>
										<input bind:value={onCallSecondaryUserID} type="text" autocomplete="off" placeholder="usr_..." />
									</label>
									<button type="submit" disabled={savingOnCall}>{savingOnCall ? 'Saving…' : 'Save on-call'}</button>
								</form>
								{#if onCallSchedules.length}
									<p class="muted">Current on-call: primary {onCallSchedules[0].primaryUserId}{onCallSchedules[0].secondaryUserId ? ` · secondary ${onCallSchedules[0].secondaryUserId}` : ''}</p>
								{/if}
								{#if teamAvailability.length}
									<div class="mini-list">
										{#each teamAvailability as member (member.userId)}
											<div class="mini-row">
												<code>{member.userId}</code>
												<span>{availabilityLabel(member)}</span>
											</div>
										{/each}
									</div>
								{/if}
							</div>
						</section>
					{/if}
				</div>
			</details>

			<details id="policies" class="panel secondary-panel">
				<summary>
					<span>
						<span class="eyebrow">Policies</span>
						<strong>Approval templates</strong>
					</span>
					<span class="summary-count">{policies.length}</span>
				</summary>
				<div class="panel-body">
					<form class="wizard-form" onsubmit={createPolicy}>
						<div>
							<p class="eyebrow">Policy builder</p>
							<h3>Start with a human-readable template.</h3>
						</div>
						<label>
							<span>Policy name</span>
							<input bind:value={policyName} type="text" autocomplete="off" placeholder="Backend team quorum" />
						</label>
						<label>
							<span>Template</span>
							<select bind:value={policyTemplate}>
								<option value="owner-only">Just me</option>
								<option value="any-team-member">Anyone on a team</option>
								<option value="on-call">On-call person</option>
								<option value="recently-active">Most recently active</option>
								<option value="quorum">Require multiple approvals</option>
								<option value="sequence">Multi-step flow</option>
								<option value="risk-based">Risk-based flow</option>
							</select>
						</label>
						<label>
							<span>Team</span>
							<select bind:value={policyTeamID}>
								<option value="">No team</option>
								{#each teams as team (team.teamId)}
									<option value={team.teamId}>{team.name}</option>
								{/each}
							</select>
						</label>
						<label>
							<span>Quorum size</span>
							<input bind:value={policyQuorum} type="number" min="1" inputmode="numeric" />
						</label>
						<label>
							<span>Timeout seconds</span>
							<input bind:value={policyTimeout} type="number" min="0" inputmode="numeric" />
						</label>
						<label>
							<span>Escalation target</span>
							<input bind:value={policyEscalationTarget} type="text" autocomplete="off" placeholder="on-call-backup@example.com" />
						</label>
						<label class="checkbox-label">
							<input bind:checked={policyDenyVeto} type="checkbox" />
							<span>Any denial blocks the command</span>
						</label>
						<button type="submit" disabled={creatingPolicy}>{creatingPolicy ? 'Creating…' : 'Create Policy'}</button>
					</form>
					{#if policyActionError}
						<p class="error" role="alert">{policyActionError}</p>
					{/if}
					{#if policiesError}
						<div class="inline-error" role="alert"><strong>Error</strong><span>{policiesError}</span></div>
					{/if}
					{#if policiesStatus === 'idle'}
						<div class="empty-state">Connect to load approval policies.</div>
					{:else if policiesStatus === 'loading'}
						<div class="empty-state">Loading policies…</div>
					{:else if policies.length === 0 && !policiesError}
						<div class="empty-state">No policies yet. Create one from a template, then attach it to projects or agents.</div>
					{:else}
						<div class="item-list">
							{#each policies as policy (policy.policyId)}
								<article class="item-card">
									<div>
										<strong>{policy.name}</strong>
										<code>{policy.policyId}</code>
										<p class="muted">{policy.summary}</p>
										<p class="muted">Template: {policyLabel(policy.template)} · Team: {teamNameForID(policy.teamId)}</p>
									</div>
									<button class="secondary" onclick={() => previewPolicy(policy.policyId)}>Preview</button>
								</article>
							{/each}
						</div>
					{/if}
					{#if selectedPolicy || policyPreviewError}
						<section class="detail-card" aria-label="Policy preview">
							<div class="panel-heading">
								<div>
									<p class="eyebrow">Policy preview</p>
									<h3>{selectedPolicy?.name || 'Preview unavailable'}</h3>
								</div>
								<button class="ghost" onclick={() => { selectedPolicyID = ''; policyPreview = null; policyPreviewError = ''; }}>Close</button>
							</div>
							{#if policyPreview}
								<p>{policyPreview.summary}</p>
								<p class="muted">Would notify: {policyPreview.notifies.join(', ')}</p>
								{#if policyPreview.limitations?.length}
									<p class="muted">Limitations: {policyPreview.limitations.join('; ')}</p>
								{/if}
							{:else if policyPreviewError}
								<p class="error" role="alert">{policyPreviewError}</p>
							{/if}
						</section>
					{/if}
				</div>
			</details>

			<details id="more" class="panel secondary-panel">
				<summary>
					<span>
						<span class="eyebrow">More</span>
						<strong>Advanced settings</strong>
					</span>
					<span class="summary-count">•••</span>
				</summary>
				<div class="panel-body submenu-grid">
					<a href="#billing">Billing</a>
					<a href="#audit">Audit</a>
					<a href="#teams">Teams</a>
					<a href="#policies">Policies</a>
					<a href="#projects">Projects</a>
				</div>
			</details>

			<details id="projects" class="panel secondary-panel">
				<summary>
					<span>
						<span class="eyebrow">Projects</span>
						<strong>Project grouping</strong>
					</span>
					<span class="summary-count">{projects.length}</span>
				</summary>
				<div class="panel-body">
					<form class="agent-form" onsubmit={createProject}>
						<label>
							<span>Project name</span>
							<input bind:value={projectName} type="text" autocomplete="off" placeholder="Website" />
						</label>
						<label>
							<span>Team</span>
							<select bind:value={projectTeamID}>
								<option value="">No team</option>
								{#each teams as team (team.teamId)}
									<option value={team.teamId}>{team.name}</option>
								{/each}
							</select>
						</label>
						<label>
							<span>Description</span>
							<input bind:value={projectDescription} type="text" autocomplete="off" placeholder="Optional context" />
						</label>
						<label>
							<span>Default policy</span>
							<select bind:value={projectDefaultPolicyID}>
								<option value="">No project default</option>
								{#each policies as policy (policy.policyId)}
									<option value={policy.policyId}>{policy.name}</option>
								{/each}
							</select>
						</label>
						<button type="submit" disabled={creatingProject}>{creatingProject ? 'Creating…' : 'Create Project'}</button>
					</form>
					{#if projectActionError}
						<p class="error" role="alert">{projectActionError}</p>
					{/if}
					{#if projectsError}
						<div class="inline-error" role="alert"><strong>Error</strong><span>{projectsError}</span></div>
					{/if}
					{#if projectsStatus === 'idle'}
						<div class="empty-state">Connect to load projects.</div>
					{:else if projectsStatus === 'loading'}
						<div class="empty-state">Loading projects…</div>
					{:else if projects.length === 0 && !projectsError}
						<div class="empty-state">No projects yet. Agent Tick creates a default project automatically for first-run simplicity.</div>
					{:else}
						<div class="item-list">
							{#each projects as project (project.projectId)}
								<article class="item-card">
									<div>
										<strong>{project.name}</strong>
										<code>{project.slug}</code>
										<p class="muted">{teamNameForID(project.teamId)} · Policy: {policyLabel(project.defaultPolicyId)} · {project.projectId}</p>
										{#if project.description}
											<p>{project.description}</p>
										{/if}
										<p class="muted">Created {formatDate(project.createdAt)}</p>
									</div>
									<button class="secondary" onclick={() => (selectedProjectID = project.projectId)}>Details</button>
								</article>
							{/each}
						</div>
					{/if}
					{#if selectedProject}
						<section class="detail-card" aria-label="Project details">
							<div class="panel-heading">
								<div>
									<p class="eyebrow">Project detail</p>
									<h3>{selectedProject.name}</h3>
								</div>
								<button class="ghost" onclick={() => (selectedProjectID = '')}>Close</button>
							</div>
							<p class="muted">{selectedProject.description || 'No description yet.'}</p>
							<p><code>{selectedProject.projectId}</code> <code>{selectedProject.slug}</code></p>
							<p class="muted">Team: {teamNameForID(selectedProject.teamId)} · Default policy: {policyLabel(selectedProject.defaultPolicyId)}</p>
							<p class="muted">Created {formatDate(selectedProject.createdAt)} · Updated {formatDate(selectedProject.updatedAt)}</p>
						</section>
					{/if}
				</div>
			</details>
		</main>
	{/if}
</div>
