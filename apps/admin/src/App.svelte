<script lang="ts">
	import { onMount } from 'svelte';
	import {
		AdminApiClient,
		csrfTokenFromCookie,
		type AgentCredential,
		type AgentTokenRecord,
		type ApprovalRequest,
		type Choice,
		type DeviceRecord,
		type PairingToken,
		type Requester,
		type SessionCredential
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
	let creatingAgent = $state(false);
	let busyAgent = $state('');
	let newAgentCredential = $state<AgentCredential | null>(null);

	const api = new AdminApiClient({
		bearerToken: () => bearerToken,
		csrfToken: csrfTokenFromCookie
	});

	let isUserMode = $derived(mode === 'user');
	let canShowDashboard = $derived(!isUserMode || session !== null);
	let signedInLabel = $derived(session?.email || session?.name || session?.userId || 'Signed in');
	let setupCommand = $derived(
		newAgentCredential
			? `agent-tick setup --server ${shellQuote(publicURL)} --token ${shellQuote(newAgentCredential.token)}`
			: ''
	);
	let testCommand = $derived(
		"agent-tick request --title 'Run command?' --body 'Agent Tick test approval from the CLI' --command 'npm install'"
	);

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
		await Promise.all([loadApprovals(), loadDevices(), loadAgents()]);
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
			newAgentCredential = await api.createAgentToken({
				name: agentName.trim() || 'agent',
				scopes: ['approval:write']
			});
			agentName = 'agent';
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

	function formatDate(value: string | undefined): string {
		if (!value) return 'Unknown time';
		const date = new Date(value);
		return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
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
					<p class="muted">Session cookies and CSRF protection are active for dashboard actions.</p>
				</div>
			{:else}
				<form class="connect-form" onsubmit={connectDashboard}>
					<label>
						<span>Admin bearer token</span>
						<input bind:value={bearerToken} type="password" autocomplete="off" placeholder="Paste token and press Enter" />
					</label>
					<button type="submit" disabled={approvalsStatus === 'loading' || devicesStatus === 'loading' || agentsStatus === 'loading'}>Connect</button>
				</form>
			{/if}
			<button class="secondary" onclick={refreshDashboard} disabled={approvalsStatus === 'loading' || devicesStatus === 'loading' || agentsStatus === 'loading'}>Refresh all</button>
			{#if authError}
				<p class="error" role="alert">{authError}</p>
			{/if}
		</section>

		<nav class="quick-actions" aria-label="Dashboard sections">
			<a href="#approvals">Approvals</a>
			<a href="#devices">Devices</a>
			<a href="#agents">Agents</a>
		</nav>

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
					<div class="empty-state">No approval requests yet.</div>
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
								{#if approval.questions?.length}
									<div class="question-list">
										{#each approval.questions as question, index (`${approval.id}-${index}`)}
											<div>
												<strong>{question.header || question.question}</strong>
												{#if question.header && question.question}
													<p>{question.question}</p>
												{/if}
												{#if question.options.length}
													<p class="muted">Options: {question.options.map((option) => option.label).join(', ')}</p>
												{/if}
											</div>
										{/each}
									</div>
								{/if}
								{#if approval.response}
									<p class="muted">Response: {approval.response.choiceId || 'answered'}{approval.respondedAt ? ` · ${formatDate(approval.respondedAt)}` : ''}</p>
								{/if}
								{#if isActionable(approval)}
									<div class="toolbar">
										{#each approval.choices as choice (choice.id)}
											<button onclick={() => respond(approval.id, choice)} disabled={busyApproval !== ''} class={choice.kind === 'deny' || choice.id === 'deny' ? 'danger' : ''}>
												{busyApproval === `${approval.id}:${choice.id}` ? 'Sending…' : choiceLabel(choice)}
											</button>
										{/each}
									</div>
								{:else if approval.status === 'pending' && approval.requestType === 'questionnaire'}
									<p class="muted">Respond in the phone app for questionnaire requests.</p>
								{/if}
							</article>
						{/each}
					</div>
				{/if}
			</section>

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
					<form class="agent-form" onsubmit={createAgentToken}>
						<label>
							<span>Token name</span>
							<input bind:value={agentName} type="text" autocomplete="off" placeholder="agent" />
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
							<p class="muted">Run setup once. The token will not be shown again after you refresh or create another token.</p>
							<pre>{setupCommand + '\n' + testCommand}</pre>
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
										<p class="muted">Scopes: {agent.scopes.join(', ') || 'none'}</p>
									</div>
									{#if !agent.revokedAt}
										<button class="secondary danger-text" onclick={() => revokeAgent(agent)} disabled={busyAgent === agent.agentId}>{busyAgent === agent.agentId ? 'Revoking…' : 'Revoke'}</button>
									{/if}
								</article>
							{/each}
						</div>
					{/if}
				</div>
			</details>
		</main>
	{/if}
</div>
