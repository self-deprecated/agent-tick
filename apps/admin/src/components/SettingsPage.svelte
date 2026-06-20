<script lang="ts">
	import type { Clerk as ClerkJS } from '@clerk/clerk-js';
	import type { AgentCredential, AgentTokenRecord, AuditEventRecord, DeviceRecord, MeResponse, OnboardingStatus, RoutingRuleRecord, WorkspaceMemberRecord } from '@self-deprecated/agent-tick-sdk';
	import type { LocalePreference, SupportedLocale } from '@agent-tick/i18n';

	let {
		workspaces = [],
		workspace,
		agentTokens = [],
		routingRules = [],
		devices = [],
		onboardingStatus,
		auditEvents = [],
		clerk,
		clerkSignedIn = false,
		currentUser,
		createdCredential: _createdCredential,
		newWorkspaceName: _newWorkspaceName = '',
		newTokenLabel: _newTokenLabel = '',
		newRoutingRuleName: _newRoutingRuleName = '',
		newRoutingRuleRecipients: _newRoutingRuleRecipients = '',
		selectedRoutingRuleId: _selectedRoutingRuleId = '',
		activeLocale,
		localePreference,
		localeOptions = [],
		onCreateWorkspace: _onCreateWorkspace,
		onCreateToken: _onCreateToken,
		onUpdateTokenLabel: _onUpdateTokenLabel,
		onAssignTokenRule: _onAssignTokenRule,
		onRevokeToken: _onRevokeToken,
		onCreateRoutingRule: _onCreateRoutingRule,
		onDeleteRoutingRule: _onDeleteRoutingRule,
		onRunRuleTest: _onRunRuleTest,
		onLocaleChange,
		onWorkspaceNameChange: _onWorkspaceNameChange,
		onTokenLabelChange: _onTokenLabelChange,
		onRoutingRuleNameChange: _onRoutingRuleNameChange,
		onRoutingRuleRecipientsChange: _onRoutingRuleRecipientsChange,
		onSelectedRoutingRuleChange: _onSelectedRoutingRuleChange
	}: {
		workspaces?: WorkspaceMemberRecord[];
		workspace?: WorkspaceMemberRecord;
		agentTokens?: AgentTokenRecord[];
		routingRules?: RoutingRuleRecord[];
		devices?: DeviceRecord[];
		onboardingStatus?: OnboardingStatus;
		auditEvents?: AuditEventRecord[];
		clerk?: ClerkJS;
		clerkSignedIn?: boolean;
		currentUser?: MeResponse;
		createdCredential?: AgentCredential;
		newWorkspaceName?: string;
		newTokenLabel?: string;
		newRoutingRuleName?: string;
		newRoutingRuleRecipients?: string;
		selectedRoutingRuleId?: string;
		activeLocale: SupportedLocale;
		localePreference: LocalePreference;
		localeOptions: Array<{ value: LocalePreference; label: string }>;
		onCreateWorkspace: () => void | Promise<void>;
		onCreateToken: () => void | Promise<void>;
		onUpdateTokenLabel: (token: AgentTokenRecord) => void | Promise<void>;
		onAssignTokenRule: (token: AgentTokenRecord, routingRuleId: string) => void | Promise<void>;
		onRevokeToken: (token: AgentTokenRecord) => void | Promise<void>;
		onCreateRoutingRule: () => void | Promise<void>;
		onDeleteRoutingRule: (rule: RoutingRuleRecord) => void | Promise<void>;
		onRunRuleTest: (rule: RoutingRuleRecord, kind: 'status' | 'steering' | 'sanction') => void | Promise<void>;
		onLocaleChange: (preference: LocalePreference) => void | Promise<void>;
		onWorkspaceNameChange: (value: string) => void;
		onTokenLabelChange: (value: string) => void;
		onRoutingRuleNameChange: (value: string) => void;
		onRoutingRuleRecipientsChange: (value: string) => void;
		onSelectedRoutingRuleChange: (value: string) => void;
	} = $props();

	let diagnosticsLoaded = $state(false);
	let userButtonElement: HTMLDivElement | undefined = $state();
	let isClerkAccount = $derived(currentUser?.authProvider === 'clerk');
	let accountDisplayName = $derived(currentUser?.name || currentUser?.email || 'Signed-in account');
	let accountEmail = $derived(currentUser?.email ?? 'Email unavailable');
	let accountSignInMethod = $derived(currentUser?.signInMethod ?? currentUser?.authProvider ?? '—');

	$effect(() => {
		const target = userButtonElement;
		if (!clerkSignedIn || !clerk || !target) return;
		clerk.mountUserButton(target, { showName: true, userProfileMode: 'modal' });
		return () => clerk.unmountUserButton(target);
	});


	function formatDate(value?: string): string {
		return value ? new Date(value).toLocaleString() : '—';
	}
</script>

<section class="settings-layout">
	<div class="section-header compact">
		<p class="eyebrow">Settings</p>
		<h1>{isClerkAccount ? 'Account and preferences' : 'Preferences'}</h1>
		<p>{isClerkAccount ? 'Clerk account management, low-frequency preferences, support links, and collapsed Developer diagnostics.' : 'Low-frequency preferences, support links, and collapsed Developer diagnostics.'}</p>
	</div>

	{#if isClerkAccount}
		<div class="settings-group" aria-labelledby="settings-account-heading">
			<h2 id="settings-account-heading">Account</h2>
			<details open>
				<summary>Clerk account management</summary>
				<div class="settings-section">
					<dl class="summary-list">
						<dt>Name</dt><dd>{accountDisplayName}</dd>
						<dt>Email</dt><dd>{accountEmail}</dd>
						<dt>Sign-in method</dt><dd>{accountSignInMethod}</dd>
					</dl>
					<p>Use Clerk's account menu to manage your profile, email addresses, sessions, security settings, and sign-out.</p>
					<div class="clerk-component-row" aria-label="Clerk user profile button" bind:this={userButtonElement}></div>
				</div>
			</details>
		</div>
	{/if}

	<div class="settings-group" aria-labelledby="settings-preferences-heading">
		<h2 id="settings-preferences-heading">Preferences</h2>

		<details open>
			<summary>Language</summary>
			<div class="settings-section">
				<label>
					<span>Language</span>
					<select value={localePreference} onchange={(event) => void onLocaleChange(event.currentTarget.value as LocalePreference)}>
						{#each localeOptions as option (option.value)}<option value={option.value}>{option.label}</option>{/each}
					</select>
				</label>
				<p>Current locale: {activeLocale}</p>
			</div>
		</details>
	</div>

	<div class="settings-group" aria-labelledby="settings-private-requests-heading">
		<h2 id="settings-private-requests-heading">Private Requests and encryption</h2>
		<details open>
			<summary>How encryption is enforced</summary>
			<div class="settings-section">
				<p>Agent Tick supports end-to-end encrypted Private Requests. When required for a Workspace or Routing Rule, plain CLI requests are rejected until the agent uses Private Request encryption.</p>
				<p>Manage the per-Workspace toggle on the Workspace page.</p>
				{#if currentUser?.privateRequestsPolicy === 'forced'}
					<p>This server enforces Private Requests for all Workspaces. The toggle cannot be disabled.</p>
				{:else}
					<p>The server policy lets Workspace Owners control the toggle.</p>
				{/if}
			</div>
		</details>
	</div>

	<div class="settings-group" aria-labelledby="settings-support-heading">
		<h2 id="settings-support-heading">Support and privacy</h2>
		<details open>
			<summary>Support links</summary>
			<div class="settings-section">
				<p>Use these support and legal channels for help, privacy requests, account deletion requests, and security reports.</p>
				<ul class="plain-list">
					<li><a href="https://agenttick.sh/support" target="_blank" rel="noreferrer">Support</a></li>
					<li><a href="https://agenttick.sh/privacy" target="_blank" rel="noreferrer">Privacy policy</a></li>
					<li><a href="https://agenttick.sh/terms" target="_blank" rel="noreferrer">Terms</a></li>
					<li><a href="mailto:privacy@agenttick.sh">Privacy support contact</a></li>
					<li><a href="mailto:security@agenttick.sh">Security contact</a></li>
				</ul>
			</div>
		</details>
	</div>

	<div class="settings-group" aria-labelledby="settings-developer-heading">
		<h2 id="settings-developer-heading">Developer diagnostics</h2>
		<details ontoggle={(event) => (diagnosticsLoaded = diagnosticsLoaded || event.currentTarget.open)}>
			<summary>Raw IDs and recent events</summary>
			{#if diagnosticsLoaded}
				<div class="settings-section">
					<p class="warning">Developer diagnostics may include raw Workspace, Agent Connection, Approval Device, and event identifiers.</p>
					<dl class="summary-list">
						<dt>Workspace ID</dt><dd>{workspace?.workspaceId ?? '—'}</dd>
						<dt>Agent Connections</dt><dd>{agentTokens.length}</dd>
						<dt>Approval Devices</dt><dd>{devices.length}</dd>
						<dt>Routing Rules</dt><dd>{routingRules.length}</dd>
						<dt>Onboarding stage</dt><dd>{onboardingStatus?.stage ?? '—'}</dd>
					</dl>
					<h3>Recent audit events</h3>
					<ul class="plain-list">
						{#each auditEvents.slice(0, 10) as event (event.eventId)}
							<li>{event.eventType} · {event.targetId} · {formatDate(event.createdAt)}</li>
						{/each}
					</ul>
				</div>
			{:else}
				<div class="settings-section"><p>Open this section to load Developer diagnostics.</p></div>
			{/if}
		</details>
	</div>
</section>
