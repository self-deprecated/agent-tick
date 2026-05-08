<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { AgentTickApiError, AgentTickClient, type AgentCredential, type ApprovalRequest, type AuthConfig } from '@agent-tick/sdk';
	import type { Clerk as ClerkJS } from '@clerk/clerk-js';
	import type { AdminConfig } from './app';

	const adminTokenStorageKey = 'agent_tick_admin_token';

	let { config: initialConfig }: { config: AdminConfig } = $props();
	let runtimeConfig = $state<AuthConfig | undefined>();
	let approvals = $state<ApprovalRequest[]>([]);
	let createdCredential = $state<AgentCredential | undefined>();
	let adminToken = $state('');
	let agentName = $state('Local agent');
	let loading = $state(false);
	let error = $state('');
	let clerk = $state<ClerkJS | undefined>();
	let clerkSignedIn = $state(false);
	let signInElement = $state<HTMLDivElement | undefined>();

	function client(): AgentTickClient {
		return new AgentTickClient({
			baseUrl: window.location.origin,
			tokenProvider: async () => {
				if (runtimeConfig?.authProvider === 'clerk') return (await clerk?.session?.getToken()) ?? null;
				return adminToken || null;
			}
		});
	}

	onMount(() => {
		adminToken = localStorage.getItem(adminTokenStorageKey) ?? '';
		void load();
	});

	async function load(): Promise<void> {
		loading = true;
		error = '';
		try {
			runtimeConfig = await client().getAuthConfig();
			if (runtimeConfig.authProvider === 'clerk') {
				await initialiseClerk(runtimeConfig);
			} else {
				await refreshApprovals();
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
			if (nextClerk.isSignedIn) void refreshApprovals();
		});
		await tick();
		if (!nextClerk.isSignedIn && signInElement) {
			nextClerk.mountSignIn(signInElement);
		} else if (nextClerk.isSignedIn) {
			await refreshApprovals();
		}
	}

	async function signOut(): Promise<void> {
		await clerk?.signOut();
		approvals = [];
		createdCredential = undefined;
		clerkSignedIn = false;
		await tick();
		if (clerk && signInElement) clerk.mountSignIn(signInElement);
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

	async function saveAdminToken(): Promise<void> {
		adminToken = adminToken.trim();
		if (adminToken) localStorage.setItem(adminTokenStorageKey, adminToken);
		else localStorage.removeItem(adminTokenStorageKey);
		await refreshApprovals();
	}

	async function createAgentToken(): Promise<void> {
		error = '';
		createdCredential = undefined;
		try {
			createdCredential = await client().createAgentToken({ name: agentName });
		} catch (err) {
			error = messageForError(err);
		}
	}

	async function respond(id: string, choiceId: string): Promise<void> {
		error = '';
		try {
			await client().respondToApproval(id, { choiceId });
			await refreshApprovals();
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

	{#if error}
		<p class="error">{error}</p>
	{/if}

	{#if runtimeConfig?.authProvider !== 'clerk' || clerkSignedIn}
	<section class="card stack">
		<h2>Create an agent token</h2>
		<form class="row" onsubmit={(event) => { event.preventDefault(); void createAgentToken(); }}>
			<input bind:value={agentName} aria-label="Agent name" />
			<button type="submit">Create token</button>
		</form>
		{#if createdCredential}
			<div class="token">
				<p><strong>{createdCredential.name}</strong> ({createdCredential.agentId})</p>
				<code>{createdCredential.token}</code>
				<button onclick={copyToken}>Copy</button>
				<p class="subtle">Use it with: <code>agent-tick setup --server {window.location.origin} --token {createdCredential.token}</code></p>
			</div>
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

	input {
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

	.approvals {
		list-style: none;
		padding: 0;
		margin: 0;
		display: grid;
		gap: 12px;
	}

	.approvals li {
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

	.approve {
		background: #22c55e;
		color: #052e16;
	}

	.reject {
		background: #fb7185;
		color: #4c0519;
	}

	@media (max-width: 760px) {
		.hero,
		.section-heading,
		.row,
		.grid,
		.approvals li {
			align-items: stretch;
			flex-direction: column;
		}

		input {
			min-width: 0;
		}
	}
</style>
