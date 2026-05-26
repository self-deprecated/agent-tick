<script lang="ts">
	import type { WorkspaceMemberRecord } from '@self-deprecated/agent-tick-sdk';

	let {
		activePage,
		workspaces = [],
		selectedWorkspaceId = '',
		clerkSignedIn = false,
		onNavigate,
		onWorkspaceChange,
		onCreateWorkspace,
		onOpenAccount,
		onSignOut
	}: {
		activePage: 'setup' | 'activity' | 'settings';
		workspaces?: WorkspaceMemberRecord[];
		selectedWorkspaceId?: string;
		clerkSignedIn?: boolean;
		onNavigate: (page: 'setup' | 'activity' | 'settings') => void;
		onWorkspaceChange: (workspaceId: string) => void;
		onCreateWorkspace: () => void;
		onOpenAccount: () => void;
		onSignOut: () => void | Promise<void>;
	} = $props();

	let showWorkspaceSwitcher = $derived(workspaces.length > 1);
	let selectedWorkspace = $derived(workspaces.find((workspace) => workspace.workspaceId === selectedWorkspaceId));
</script>

<header class="console-header">
	<div class="brand-block">
		<div class="brand">Agent Tick</div>
		{#if selectedWorkspace}
			<div class="workspace-label">{selectedWorkspace.type === 'personal' ? 'Personal' : 'Shared'} · {selectedWorkspace.name}</div>
		{/if}
	</div>

	<nav aria-label="Primary navigation">
		<button class:active={activePage === 'setup'} onclick={() => onNavigate('setup')}>Setup</button>
		<button class:active={activePage === 'activity'} onclick={() => onNavigate('activity')}>Activity</button>
		<button class:active={activePage === 'settings'} onclick={() => onNavigate('settings')}>Settings</button>
	</nav>

	<div class="header-actions">
		{#if showWorkspaceSwitcher}
			<label class="workspace-switcher">
				<span>Workspace</span>
				<select value={selectedWorkspaceId} onchange={(event) => onWorkspaceChange(event.currentTarget.value)}>
					{#each workspaces as workspace (workspace.workspaceId)}
						<option value={workspace.workspaceId}>{workspace.name} · {workspace.type}</option>
					{/each}
				</select>
			</label>
		{/if}
		<button class="secondary" onclick={onCreateWorkspace}>Create shared workspace</button>
		{#if clerkSignedIn}
			<button class="secondary" onclick={onOpenAccount}>Account</button>
			<button class="ghost" onclick={() => void onSignOut()}>Sign out</button>
		{/if}
	</div>
</header>
