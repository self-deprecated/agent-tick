<script lang="ts">
	import type { AgentCredential, AgentTokenRecord, AuditEventRecord, BillingStatus, DeviceRecord, RoutingRuleRecord, WorkspaceMemberRecord } from '@agent-tick/sdk';
	import type { LocalePreference, SupportedLocale } from '@agent-tick/i18n';

	let {
		workspaces = [],
		workspace,
		agentTokens = [],
		routingRules = [],
		devices = [],
		billingStatus,
		auditEvents = [],
		createdCredential,
		newWorkspaceName = '',
		newTokenLabel = '',
		newRoutingRuleName = '',
		newRoutingRuleRecipients = '',
		selectedRoutingRuleId = '',
		activeLocale,
		localePreference,
		localeOptions = [],
		onCreateWorkspace,
		onCreateToken,
		onUpdateTokenLabel,
		onAssignTokenRule,
		onRevokeToken,
		onCreateRoutingRule,
		onDeleteRoutingRule,
		onRunRuleTest,
		onOpenAccount,
		onLocaleChange,
		onWorkspaceNameChange,
		onTokenLabelChange,
		onRoutingRuleNameChange,
		onRoutingRuleRecipientsChange,
		onSelectedRoutingRuleChange
	}: {
		workspaces?: WorkspaceMemberRecord[];
		workspace?: WorkspaceMemberRecord;
		agentTokens?: AgentTokenRecord[];
		routingRules?: RoutingRuleRecord[];
		devices?: DeviceRecord[];
		billingStatus?: BillingStatus;
		auditEvents?: AuditEventRecord[];
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
		onOpenAccount: () => void;
		onLocaleChange: (preference: LocalePreference) => void | Promise<void>;
		onWorkspaceNameChange: (value: string) => void;
		onTokenLabelChange: (value: string) => void;
		onRoutingRuleNameChange: (value: string) => void;
		onRoutingRuleRecipientsChange: (value: string) => void;
		onSelectedRoutingRuleChange: (value: string) => void;
	} = $props();
</script>

<section class="settings-layout">
	<div class="section-header compact">
		<p class="eyebrow">Settings</p>
		<h1>Workspace operations</h1>
		<p>Account, Workspaces, Agent Tokens, Routing Rules, Approval Devices, Entitlement Status, Activity, and Language.</p>
	</div>

	<details open>
		<summary>Account</summary>
		<div class="settings-section">
			<p>{workspace ? `${workspace.name} · ${workspace.role}` : 'No Workspace selected'}</p>
			<button class="secondary" onclick={onOpenAccount}>Manage account</button>
		</div>
	</details>

	<details>
		<summary>Workspaces</summary>
		<div class="settings-section">
			<ul class="plain-list">
				{#each workspaces as item (item.workspaceId)}
					<li><strong>{item.name}</strong> · {item.type} · {item.role}{item.type === 'personal' ? ' · read-only' : ''}</li>
				{/each}
			</ul>
			<label>
				<span>Create Shared Workspace</span>
				<input value={newWorkspaceName} oninput={(event) => onWorkspaceNameChange(event.currentTarget.value)} placeholder="Backend routing" />
			</label>
			<button onclick={() => void onCreateWorkspace()}>Create shared workspace</button>
		</div>
	</details>

	<details open>
		<summary>Agent Tokens</summary>
		<div class="settings-section">
			<label>
				<span>New Agent Token label</span>
				<input value={newTokenLabel} oninput={(event) => onTokenLabelChange(event.currentTarget.value)} placeholder="{navigator.userAgent.includes('Mac') ? 'MacBook agent' : 'Local agent'}" />
			</label>
			<button onclick={() => void onCreateToken()}>Create Agent Token</button>
			{#if createdCredential}
				<div class="credential-box">
					<strong>{createdCredential.label}</strong>
					<code>{createdCredential.token}</code>
					<pre>agent-tick config --server {location.origin} --token {createdCredential.token}</pre>
				</div>
			{/if}
			<ul class="item-list">
				{#each agentTokens as token (token.agentTokenId)}
					<li class="item-row" class:muted={Boolean(token.revokedAt)}>
						<div>
							<strong>{token.label}</strong>
							<p>{token.agentTokenId} · {token.lastCheckInAt ? `connected ${new Date(token.lastCheckInAt).toLocaleString()}` : 'not checked in'}{token.routingRuleId ? ` · routed to ${token.routingRuleId}` : ''}</p>
						</div>
						<select value={token.routingRuleId ?? ''} onchange={(event) => void onAssignTokenRule(token, event.currentTarget.value)}>
							<option value="">No Routing Rule</option>
							{#each routingRules as rule (rule.routingRuleId)}<option value={rule.routingRuleId}>{rule.name}</option>{/each}
						</select>
						<button class="secondary" onclick={() => void onUpdateTokenLabel(token)}>Save label</button>
						{#if !token.revokedAt}<button class="danger" onclick={() => void onRevokeToken(token)}>Revoke</button>{/if}
					</li>
				{/each}
			</ul>
		</div>
	</details>

	<details open>
		<summary>Routing</summary>
		<div class="settings-section">
			<label><span>Rule name</span><input value={newRoutingRuleName} oninput={(event) => onRoutingRuleNameChange(event.currentTarget.value)} placeholder="Backend routing" /></label>
			<label><span>Recipient user IDs (comma-separated)</span><input value={newRoutingRuleRecipients} oninput={(event) => onRoutingRuleRecipientsChange(event.currentTarget.value)} placeholder="usr_123, usr_456" /></label>
			<button onclick={() => void onCreateRoutingRule()}>Create Routing Rule</button>
			<ul class="item-list">
				{#each routingRules as rule (rule.routingRuleId)}
					<li class="item-row">
						<div>
							<strong>{rule.name}</strong>
							<p>{rule.requiredResponseMode} · {rule.requiredResponseCount} required · {rule.recipientUserIds.length} recipients</p>
						</div>
						<div class="row-actions">
							<button class="secondary" onclick={() => void onRunRuleTest(rule, 'status')}>Test Status</button>
							<button class="secondary" onclick={() => void onRunRuleTest(rule, 'steering')}>Test Steering</button>
							<button class="secondary" onclick={() => void onRunRuleTest(rule, 'sanction')}>Test Sanction</button>
							<button class="danger" onclick={() => void onDeleteRoutingRule(rule)}>Delete</button>
						</div>
					</li>
				{/each}
			</ul>
		</div>
	</details>

	<details>
		<summary>Approval Devices</summary>
		<div class="settings-section">
			<ul class="plain-list">
				{#each devices as device (device.deviceId)}
					<li>{device.name} · {device.expoPushToken ? 'push on' : 'push off'} · {device.unregisteredAt ? `unregistered ${new Date(device.unregisteredAt).toLocaleString()}` : `updated ${new Date(device.updatedAt).toLocaleString()}`}</li>
				{/each}
			</ul>
		</div>
	</details>

	<details>
		<summary>Entitlement Status</summary>
		<div class="settings-section">
			<p>{billingStatus ? `${billingStatus.plan} · ${billingStatus.usage.activeMembers} active members` : 'Entitlement Status unavailable.'}</p>
			<p>Purchases and subscription changes are handled in the mobile app/app store for now.</p>
		</div>
	</details>

	<details>
		<summary>Activity</summary>
		<div class="settings-section">
			<ul class="plain-list">
				{#each auditEvents.slice(0, 10) as event (event.eventId)}
					<li>{event.eventType} · {event.targetId} · {new Date(event.createdAt).toLocaleString()}</li>
				{/each}
			</ul>
		</div>
	</details>

	<details>
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
</section>
