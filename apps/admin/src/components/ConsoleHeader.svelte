<script lang="ts">
	import type { Clerk as ClerkJS } from '@clerk/clerk-js';
	import type { WorkspaceMemberRecord } from '@self-deprecated/agent-tick-sdk';
	import type { ShellPage } from '../pageRouting';

	let {
		activePage,
		workspaces = [],
		selectedWorkspaceId = '',
		clerk,
		clerkSignedIn = false,
		pendingRequestCount = 0,
		onNavigate,
		onWorkspaceChange
	}: {
		activePage: ShellPage;
		workspaces?: WorkspaceMemberRecord[];
		selectedWorkspaceId?: string;
		clerk?: ClerkJS;
		clerkSignedIn?: boolean;
		pendingRequestCount?: number;
		onNavigate: (page: ShellPage) => void;
		onWorkspaceChange: (workspaceId: string) => void;
	} = $props();

	let userButtonElement: HTMLDivElement | undefined = $state();
	let organizationSwitcherElement: HTMLDivElement | undefined = $state();
	let selectedWorkspace = $derived(workspaces.find((workspace) => workspace.workspaceId === selectedWorkspaceId));
	let showWorkspaceSwitcher = $derived(workspaces.length > 1);
	let showWorkspacePage = $derived(selectedWorkspace?.type === 'shared');
	const workspaceSwitcherAppearance = {
		elements: {
			userPreviewAvatarContainer: 'agent-tick-hidden-clerk-preview-avatar',
			organizationPreviewAvatarContainer: 'agent-tick-hidden-clerk-preview-avatar'
		}
	};

	function workspaceLabel(workspace: WorkspaceMemberRecord): string {
		return workspace.type === 'personal' ? 'Personal' : `${workspace.name} · Shared Workspace`;
	}

	$effect(() => {
		const target = organizationSwitcherElement;
		const organizationSwitcher = clerk as (ClerkJS & { mountOrganizationSwitcher?: (target: HTMLDivElement, props?: Record<string, unknown>) => void; unmountOrganizationSwitcher?: (target: HTMLDivElement) => void }) | undefined;
		if (!clerkSignedIn || !organizationSwitcher?.mountOrganizationSwitcher || !target) return;
		organizationSwitcher.mountOrganizationSwitcher(target, {
			createOrganizationMode: 'modal',
			organizationProfileMode: 'modal',
			appearance: workspaceSwitcherAppearance,
			afterCreateOrganizationUrl: window.location.pathname,
			afterSelectOrganizationUrl: window.location.pathname,
			afterSelectPersonalUrl: window.location.pathname
		});
		return () => organizationSwitcher.unmountOrganizationSwitcher?.(target);
	});

	$effect(() => {
		const target = userButtonElement;
		if (!clerkSignedIn || !clerk || !target) return;
		clerk.mountUserButton(target, { userProfileMode: 'modal' });
		return () => clerk.unmountUserButton(target);
	});
</script>

<header class="console-header">
	<div class="brand-block">
		<div class="brand">Agent Tick</div>
	</div>

	<nav aria-label="Primary navigation">
		<button class:active={activePage === 'activity'} onclick={() => onNavigate('activity')} aria-label={pendingRequestCount > 0 ? `Activity, ${pendingRequestCount} active Requests` : 'Activity'}>
			<span>Activity</span>
			{#if pendingRequestCount > 0}<span class="nav-badge" aria-hidden="true">{pendingRequestCount}</span>{/if}
		</button>
		<button class:active={activePage === 'connections'} onclick={() => onNavigate('connections')}>Connections</button>
		{#if showWorkspacePage}<button class:active={activePage === 'workspace'} onclick={() => onNavigate('workspace')}>Workspace</button>{/if}
		<button class:active={activePage === 'settings'} onclick={() => onNavigate('settings')}>Settings</button>
	</nav>

	<div class="header-actions">
		{#if clerkSignedIn && clerk}
			<div class="workspace-switcher clerk-workspace-switcher">
				<div aria-label="Clerk Workspace switcher" bind:this={organizationSwitcherElement}></div>
			</div>
		{:else if showWorkspaceSwitcher}
			<label class="workspace-switcher">
				<span>Workspace</span>
				<select value={selectedWorkspaceId} onchange={(event) => onWorkspaceChange(event.currentTarget.value)}>
					{#each workspaces as workspace (workspace.workspaceId)}
						<option value={workspace.workspaceId}>{workspaceLabel(workspace)}</option>
					{/each}
				</select>
			</label>
		{/if}
		{#if clerkSignedIn && clerk}
			<div class="account-chip" aria-label="Account menu">
				<div class="clerk-user-button" bind:this={userButtonElement}></div>
			</div>
		{/if}
	</div>
</header>
