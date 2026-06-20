<script lang="ts">
	import type { AgentTokenRecord, DeviceRecord, OnboardingStatus, RoutingPreview, RoutingRuleRecord, SendTestActivityResponse, WorkspaceMemberRecord } from '@self-deprecated/agent-tick-sdk';

	type WorkspaceMemberWithAvailability = WorkspaceMemberRecord & { availabilityState?: string; lastSeenAt?: string };
	type RouteHealth = { state: 'healthy' | 'unhealthy'; summary: string; warnings: string[]; selectedCount: number; pushReadyCount: number; availableCount: number };

	let {
		serverUrl,
		workspace,
		onboarding,
		agentTokens = [],
		routingRules = [],
		routingPreviews = {},
		workspaceMembers = [],
		devices = [],
		newRoutingRuleName = '',
		newRoutingRuleRecipientUserIds = [],
		newRoutingRuleRequiredResponseCount = 1,
		selectedTestAgentTokenId = '',
		testBusy = '',
		lastTest,
		testError = '',
		onSelectTestAgent,
		onDisconnectDevice,
		onAssignTokenRule,
		onCreateRoutingRule,
		onNewRoutingRuleNameChange,
		onNewRoutingRuleRecipientChange,
		onNewRoutingRuleRequiredResponseCountChange,
		onUpdateRoutingRuleRecipients,
		onRunRuleTest,
		onRunTest
	}: {
		serverUrl: string;
		workspace?: WorkspaceMemberRecord;
		onboarding?: OnboardingStatus;
		agentTokens?: AgentTokenRecord[];
		routingRules?: RoutingRuleRecord[];
		routingPreviews?: Record<string, RoutingPreview>;
		workspaceMembers?: WorkspaceMemberWithAvailability[];
		devices?: DeviceRecord[];
		newRoutingRuleName?: string;
		newRoutingRuleRecipientUserIds?: string[];
		newRoutingRuleRequiredResponseCount?: number;
		selectedTestAgentTokenId?: string;
		testBusy?: '' | 'status' | 'steering' | 'sanction';
		lastTest?: SendTestActivityResponse & { sentAt: string };
		testError?: string;
		onSelectTestAgent: (agentTokenId: string) => void;
		onDisconnectDevice: (device: DeviceRecord) => void | Promise<void>;
		onAssignTokenRule?: (token: AgentTokenRecord, routingRuleId: string) => void | Promise<void>;
		onCreateRoutingRule?: () => void | Promise<void>;
		onNewRoutingRuleNameChange?: (value: string) => void;
		onNewRoutingRuleRecipientChange?: (userId: string, selected: boolean) => void;
		onNewRoutingRuleRequiredResponseCountChange?: (value: number) => void;
		onUpdateRoutingRuleRecipients?: (rule: RoutingRuleRecord, recipientUserIds: string[], requiredResponseCount: number) => void | Promise<void>;
		onRunRuleTest?: (rule: RoutingRuleRecord, kind: 'status' | 'steering' | 'sanction') => void | Promise<void>;
		onRunTest: (kind: 'status' | 'steering' | 'sanction') => void | Promise<void>;
	} = $props();

	let editRuleRecipients = $state<Record<string, string[]>>({});
	let editRuleRequiredCounts = $state<Record<string, number>>({});
	let activeDevices = $derived(devices.filter((device) => !device.unregisteredAt));
	let pushReadyDevices = $derived(activeDevices.filter((device) => Boolean(device.expoPushToken)));
	let activeTokens = $derived(agentTokens.filter((token) => !token.revokedAt));
	let connectedTokens = $derived(activeTokens.filter((token) => token.lastCheckInAt || token.lastActivityAt));
	let routedTokens = $derived(connectedTokens.filter((token) => workspace?.type === 'personal' || token.routingRuleId));
	let selectedToken = $derived(agentTokens.find((token) => token.agentTokenId === selectedTestAgentTokenId) ?? routedTokens[0] ?? connectedTokens[0] ?? activeTokens[0]);
	let agentReady = $derived(Boolean(workspace?.type === 'personal' ? onboarding?.hasAgentCheckIn : routedTokens.length));
	let phoneReady = $derived(Boolean(pushReadyDevices.length));
	let testRequirements = $derived(phoneReady ? [] : ['a push-ready Approval Device']);
	let phoneStateLabel = $derived(phoneReady ? 'Push ready' : activeDevices.length ? 'Push not registered' : 'No push-ready Approval Device');
	let setupPrompt = $derived(`Connect Agent Tick for this Workspace. Use server ${serverUrl}. Install the Agent Tick setup skill from https://agenttick.sh/skill, sign in, create or connect an Agent Token named after this machine, ask me to enable Private encryption in the Native App at Settings → General before rich mirroring, offer agent-tick features with private Activity as the recommended default, then send a Test Request.`);
	let routingRulesById = $derived(Object.fromEntries(routingRules.map((rule) => [rule.routingRuleId, rule])));
	let sharedRoutingRules = $derived(workspace?.type === 'shared' ? routingRules : []);
	let assignedAgentsByRule = $derived(Object.fromEntries(sharedRoutingRules.map((rule) => [rule.routingRuleId, connectedTokens.filter((token) => token.routingRuleId === rule.routingRuleId)])));
	let newRoutingRuleHealth = $derived(routeHealthForInput(newRoutingRuleRecipientUserIds, newRoutingRuleRequiredResponseCount));

	function copySetupPrompt(): void {
		void navigator.clipboard?.writeText(setupPrompt);
	}

	function formatDate(value?: string): string {
		return value ? new Date(value).toLocaleString() : 'Not seen yet';
	}

	function agentStatus(token: AgentTokenRecord): string {
		if (token.revokedAt) return 'Revoked';
		if (token.lastCheckInAt || token.lastActivityAt) return 'Connected';
		return 'Waiting for check-in';
	}

	function routeLabel(token: AgentTokenRecord): string {
		if (workspace?.type !== 'shared') return 'Personal Workspace routing';
		return token.routingRuleId ? routingRulesById[token.routingRuleId]?.name ?? 'Assigned Routing Rule' : 'Routing Rule needed';
	}

	function memberLabel(member: WorkspaceMemberWithAvailability): string {
		return member.displayName || member.email || 'Workspace member';
	}

	function memberRoleLabel(member: WorkspaceMemberWithAvailability): string {
		if (member.role === 'owner') return 'Owner';
		if (member.role === 'admin') return 'Admin';
		return 'Member';
	}

	function memberAvailabilityLabel(member: WorkspaceMemberWithAvailability): string {
		const state = member.availabilityState ?? 'available';
		if (state === 'do-not-disturb') return 'Do not disturb';
		if (state === 'off-call') return 'Off-call';
		return state.charAt(0).toUpperCase() + state.slice(1);
	}

	function memberUnavailable(member: WorkspaceMemberWithAvailability): boolean {
		return member.availabilityState === 'busy' || member.availabilityState === 'do-not-disturb' || member.availabilityState === 'off-call';
	}

	function memberPushReady(member: WorkspaceMemberWithAvailability): boolean {
		return devices.some((device) => device.userId === member.userId && !device.unregisteredAt && Boolean(device.expoPushToken));
	}

	function routeHealthForInput(recipientUserIds: string[], requiredResponseCount: number, assignedAgentCount = 0): RouteHealth {
		const selected = workspaceMembers.filter((member) => member.status !== 'removed' && recipientUserIds.includes(member.userId));
		const pushReady = selected.filter(memberPushReady);
		const available = selected.filter((member) => !memberUnavailable(member));
		const warnings: string[] = [];
		if (selected.length === 0) warnings.push('This rule has no selected recipients.');
		if (selected.length > 0 && pushReady.length === 0) warnings.push('No selected recipient has a push-ready Approval Device.');
		if (selected.some(memberUnavailable)) warnings.push('Selected recipients are unavailable; this may become Unrouted.');
		if (requiredResponseCount > selected.length) warnings.push('This rule cannot be satisfied until recipients are added or required responses are lowered.');
		if (assignedAgentCount > 0 && warnings.length > 0) warnings.push('Assigned Agent Connections may become unroutable.');
		return {
			state: warnings.length ? 'unhealthy' : 'healthy',
			summary: `${selected.length} selected · ${pushReady.length} push-ready · ${available.length} available`,
			warnings,
			selectedCount: selected.length,
			pushReadyCount: pushReady.length,
			availableCount: available.length
		};
	}

	function routeHealth(rule: RoutingRuleRecord): RouteHealth {
		const preview = routingPreviews[rule.routingRuleId];
		if (!preview) return { state: 'unhealthy', summary: 'Routing Preview unavailable', warnings: ['Routing Preview is unavailable. Review route health once the server preview loads.'], selectedCount: rule.recipientUserIds.length, pushReadyCount: 0, availableCount: 0 };
		return {
			state: preview.status,
			summary: preview.summary,
			warnings: preview.unhealthyReasons.map(routePreviewReasonLabel),
			selectedCount: preview.selectedRecipientCount,
			pushReadyCount: preview.pushReadyRecipientCount,
			availableCount: preview.availableRecipientCount
		};
	}

	function routePreviewReasonLabel(reason: string): string {
		if (reason === 'no_recipients') return 'This rule has no selected recipients.';
		if (reason === 'no_push_ready_recipients') return 'No selected recipient has a push-ready Approval Device.';
		if (reason === 'selected_recipients_unavailable') return 'Selected recipients are unavailable; this may become Unrouted.';
		if (reason === 'impossible_quorum') return 'This rule cannot be satisfied until recipients are added or required responses are lowered.';
		if (reason === 'assigned_agent_unroutable') return 'Assigned Agent Connections may become unroutable.';
		return reason;
	}

	function agentRouteHealth(token: AgentTokenRecord): RouteHealth {
		if (workspace?.type !== 'shared') return { state: 'healthy', summary: 'Personal Workspace routing', warnings: [], selectedCount: 1, pushReadyCount: pushReadyDevices.length, availableCount: pushReadyDevices.length };
		if (!token.routingRuleId) return { state: 'unhealthy', summary: 'No assigned Routing Rule', warnings: ['This Agent Connection needs a Routing Rule assignment before Shared Workspace Requests can route.'], selectedCount: 0, pushReadyCount: 0, availableCount: 0 };
		const rule = routingRulesById[token.routingRuleId];
		return rule ? routeHealth(rule) : { state: 'unhealthy', summary: 'Assigned Routing Rule was not found', warnings: ['Assigned Agent Connections may become unroutable.'], selectedCount: 0, pushReadyCount: 0, availableCount: 0 };
	}

	function assignedAgentLabels(rule: RoutingRuleRecord): string {
		const assigned = assignedAgentsByRule[rule.routingRuleId] ?? [];
		return assigned.length ? assigned.map((token) => token.label).join(', ') : 'No Agent Connections assigned';
	}

	function editRecipients(rule: RoutingRuleRecord): string[] {
		return editRuleRecipients[rule.routingRuleId] ?? rule.recipientUserIds;
	}

	function editRequiredCount(rule: RoutingRuleRecord): number {
		return editRuleRequiredCounts[rule.routingRuleId] ?? rule.requiredResponseCount;
	}

	function setEditRecipient(rule: RoutingRuleRecord, userId: string, selected: boolean): void {
		const current = editRecipients(rule);
		editRuleRecipients = {
			...editRuleRecipients,
			[rule.routingRuleId]: selected ? Array.from(new Set([...current, userId])) : current.filter((candidate) => candidate !== userId)
		};
	}

	function setEditRequiredCount(rule: RoutingRuleRecord, value: number): void {
		editRuleRequiredCounts = { ...editRuleRequiredCounts, [rule.routingRuleId]: value };
	}
</script>

<section class="page-grid">
	<div class="main-column">
		<div class="section-header">
			<p class="eyebrow">Connections</p>
			<h1>Connect this Workspace</h1>
			<p>Start with your phone: connect an Approval Device, send a Test Request from the web app to the Native App, then connect an Agent Connection so Activity can reach the right people.</p>
		</div>

		<div class="connection-card-grid" aria-label="Recommended connection order">
			<div class="connection-card" class:complete={phoneReady}>
				<strong>1. Connect your phone</strong>
				<p>Install the Native App and register push notifications for this Human Account.</p>
				<span class="state-pill">{phoneStateLabel}</span>
			</div>
			<div class="connection-card" class:complete={Boolean(lastTest)}>
				<strong>2. Send a Test Request</strong>
				<p>Use the web app to send a safe Steering Test Request to the Native App. Setup Test Requests can be answered before Trial; real Native App responses require a Trial or subscription.</p>
				<span class="state-pill">{lastTest ? 'Test sent' : phoneReady ? 'Recommended next' : 'Connect phone first'}</span>
			</div>
			<div class="connection-card" class:complete={agentReady}>
				<strong>3. Connect an Agent</strong>
				<p>Use the AI-assisted setup prompt from <a href="https://agenttick.sh/skill" target="_blank" rel="noreferrer">agenttick.sh/skill</a>. Instructions stay visible even before phone setup is complete.</p>
				<span class="state-pill">{agentReady ? 'Connected' : phoneReady ? 'Recommended after phone proof' : 'Available now'}</span>
			</div>
			<div class="connection-card" class:complete={Boolean(onboarding?.stage === 'ready')}>
				<strong>4. Receive real Agent Activity</strong>
				<p>After setup, receive a real agent-originated Request. Details are visible in the Native App before Trial, but response buttons require a Trial or subscription.</p>
				<span class="state-pill">{onboarding?.stage === 'ready' ? 'Ready' : 'Waiting for Activity'}</span>
			</div>
		</div>

		<div class="step-row" class:complete={phoneReady}>
			<div>
				<strong>Approval Devices</strong>
				<p>Only your current signed-in Human Account's Approval Devices are shown here.</p>
			</div>
			<span class="state-pill">{phoneStateLabel}</span>
			<div class="prompt-box">
				{#if activeDevices.length === 0}
					<p class="empty">No Approval Devices are connected for this account yet.</p>
				{:else}
					<ul class="item-list compact-list">
						{#each activeDevices as device (device.deviceId)}
							<li class="item-row compact-row">
								<div>
									<strong>{device.name}</strong>
									<p>{device.platform ?? 'Unknown platform'} · {device.expoPushToken ? 'Push ready' : 'Push not registered'} · updated {formatDate(device.updatedAt)}</p>
								</div>
								<button class="secondary" onclick={() => void onDisconnectDevice(device)}>Disconnect</button>
							</li>
						{/each}
					</ul>
				{/if}
			</div>
		</div>

		<div class="step-row" class:complete={agentReady}>
			<div>
				<strong>Agent Connections</strong>
				<p>{workspace?.type === 'shared' ? 'Shared Workspaces need a connected Agent Connection assigned to a Routing Rule.' : 'Personal Workspaces are ready after an Agent Connection checks in.'}</p>
			</div>
			<span class="state-pill">{agentReady ? 'Ready' : connectedTokens.length ? 'Routing required' : activeTokens.length ? 'Waiting for check-in' : 'Not connected'}</span>
			<div class="prompt-box">
				<details class="inline-details" open={!agentReady}>
					<summary>{agentReady ? 'Show Agent Connection instructions' : 'Agent Connection instructions'}</summary>
					<p class="subtle">These instructions stay visible from the start. After phone proof, this becomes the recommended next setup step.</p>
					<pre>{setupPrompt}</pre>
					<button class="secondary" onclick={copySetupPrompt}>Copy setup prompt</button>
				</details>
				{#if activeTokens.length === 0}
					<p class="empty">No Agent Connections yet.</p>
				{:else}
					<ul class="item-list compact-list">
						{#each activeTokens as token (token.agentTokenId)}
							{@const health = agentRouteHealth(token)}
							<li class="item-row compact-row">
								<div>
									<strong>{token.label}</strong>
									<p>{agentStatus(token)} · last seen {formatDate(token.lastCheckInAt ?? token.lastActivityAt)}{workspace?.type === 'shared' ? ` · assigned to ${routeLabel(token)} · route health: ${health.summary}` : ''}</p>
									{#if workspace?.type === 'shared' && health.warnings.length}
										<ul class="links">
											{#each health.warnings as warning (warning)}<li class="warning">{warning}</li>{/each}
										</ul>
									{/if}
								</div>
								{#if workspace?.type === 'shared' && onAssignTokenRule}
									<label class="inline-field">
										<span>Agent Assignment</span>
										<select value={token.routingRuleId ?? ''} onchange={(event) => void onAssignTokenRule?.(token, event.currentTarget.value)}>
											<option value="">Routing Rule needed</option>
											{#each sharedRoutingRules as rule (rule.routingRuleId)}<option value={rule.routingRuleId}>{rule.name}</option>{/each}
										</select>
									</label>
								{/if}
								<span class="status-pill" class:warning={health.state === 'unhealthy'}>{health.state === 'healthy' ? agentStatus(token) : 'Unhealthy route'}</span>
							</li>
						{/each}
					</ul>
				{/if}
				{#if workspace?.type === 'shared' && connectedTokens.length > 0 && routedTokens.length === 0}
					<p class="warning">Connected Agent Connections need a Routing Rule assignment before Shared Workspace tests can route to members.</p>
				{/if}
			</div>
		</div>

		{#if workspace?.type === 'shared'}
			<div class="step-row" class:complete={sharedRoutingRules.length > 0 && sharedRoutingRules.every((rule) => routeHealth(rule).state === 'healthy')}>
				<div>
					<strong>Routing Rules</strong>
					<p>Routing Rules decide which Workspace Members receive Requests from assigned Agent Connections.</p>
				</div>
				<span class="state-pill">{sharedRoutingRules.length === 0 ? 'Routing Rule needed' : sharedRoutingRules.every((rule) => routeHealth(rule).state === 'healthy') ? 'Healthy routes' : 'Unhealthy routes'}</span>
				<div class="prompt-box">
					{#if onCreateRoutingRule}
						<div class="connection-card">
							<strong>Create Routing Rule</strong>
							<label>
								<span>Routing Rule name</span>
								<input value={newRoutingRuleName} oninput={(event) => onNewRoutingRuleNameChange?.(event.currentTarget.value)} placeholder="Release approvals" />
							</label>
							<label class="inline-field">
								<span>Required responses</span>
								<input min="1" type="number" value={newRoutingRuleRequiredResponseCount} oninput={(event) => onNewRoutingRuleRequiredResponseCountChange?.(Number(event.currentTarget.value) || 1)} />
							</label>
							<div class="activity-list" aria-label="Workspace Member picker">
								{#each workspaceMembers as member (member.userId)}
									{@const selected = newRoutingRuleRecipientUserIds.includes(member.userId)}
									<label class="activity-row">
										<span>
											<strong>{memberLabel(member)}</strong>
											<small>{memberRoleLabel(member)} · Availability: {memberAvailabilityLabel(member)} · {memberPushReady(member) ? 'Push ready' : 'Needs a push-ready Approval Device'}</small>
										</span>
										<input checked={selected} type="checkbox" onchange={(event) => onNewRoutingRuleRecipientChange?.(member.userId, event.currentTarget.checked)} />
									</label>
								{/each}
							</div>
							<p>{newRoutingRuleHealth.summary}</p>
							{#if newRoutingRuleHealth.warnings.length}{#each newRoutingRuleHealth.warnings as warning (warning)}<p class="warning">{warning}</p>{/each}{/if}
							<button onclick={() => void onCreateRoutingRule?.()}>Save Routing Rule</button>
						</div>
					{/if}
					{#if sharedRoutingRules.length === 0}
						<p class="warning">Create a Routing Rule before Shared Workspace Requests can route to Members.</p>
					{:else}
						<ul class="item-list compact-list">
							{#each sharedRoutingRules as rule (rule.routingRuleId)}
								{@const recipients = editRecipients(rule)}
								{@const requiredCount = editRequiredCount(rule)}
								{@const health = routeHealth(rule)}
								<li class="item-row routing-row">
									<div>
										<strong>{rule.name}</strong>
										<p>{health.summary} · required responses: {requiredCount} · assigned Agent Connections: {assignedAgentLabels(rule)}</p>
										<p class="subtle">Recipient readiness is shown as aggregate counts; other members’ full Approval Device inventories stay hidden.</p>
										<label class="inline-field">
											<span>Required responses</span>
											<input disabled={!onUpdateRoutingRuleRecipients} min="1" type="number" value={requiredCount} oninput={(event) => setEditRequiredCount(rule, Number(event.currentTarget.value) || 1)} />
										</label>
										<div class="activity-list" aria-label={`Workspace Member picker for ${rule.name}`}>
											{#each workspaceMembers as member (member.userId)}
												{@const selected = recipients.includes(member.userId)}
												<label class="activity-row">
													<span>
														<strong>{memberLabel(member)}</strong>
														<small>{memberRoleLabel(member)} · Availability: {memberAvailabilityLabel(member)} · {memberPushReady(member) ? 'Push ready' : 'Needs a push-ready Approval Device'}</small>
													</span>
													<input checked={selected} disabled={!onUpdateRoutingRuleRecipients} type="checkbox" onchange={(event) => setEditRecipient(rule, member.userId, event.currentTarget.checked)} />
												</label>
											{/each}
										</div>
										{#if health.warnings.length}
											<ul class="links">
												{#each health.warnings as warning (warning)}<li class="warning">{warning}</li>{/each}
											</ul>
										{/if}
									</div>
									<div class="row-actions">
										<span class="status-pill" class:warning={health.state === 'unhealthy'}>{health.state}</span>
										{#if onUpdateRoutingRuleRecipients}<button class="secondary" onclick={() => void onUpdateRoutingRuleRecipients?.(rule, recipients, requiredCount)}>Save recipients</button>{/if}
										{#if onRunRuleTest}<button class="secondary" disabled={Boolean(testBusy)} onclick={() => void onRunRuleTest?.(rule, 'steering')}>Send route test</button>{/if}
									</div>
								</li>
							{/each}
						</ul>
					{/if}
				</div>
			</div>
		{/if}
	</div>

	<aside class="side-panel">
		<h2>Connection tests</h2>
		<p>Send a first-party Test Request from the web app. Current backend routing limits still apply for Shared Workspaces.</p>
		{#if testRequirements.length}
			<p class="warning">Recommended after there is {testRequirements.join(' and ')}.</p>
		{/if}
		{#if agentTokens.length > 1}
			<label>
				<span>Test Agent Connection</span>
				<select value={selectedToken?.agentTokenId ?? ''} onchange={(event) => onSelectTestAgent(event.currentTarget.value)}>
					{#each activeTokens as token (token.agentTokenId)}
						<option value={token.agentTokenId} disabled={workspace?.type === 'shared' && !token.routingRuleId}>{token.label}{workspace?.type === 'shared' && !token.routingRuleId ? ' · routing required' : ''}</option>
					{/each}
				</select>
			</label>
		{/if}
		<div class="button-stack">
			<button disabled={Boolean(testBusy)} onclick={() => void onRunTest('steering')}>{testBusy === 'steering' ? 'Sending…' : 'Send Steering Test Request'}</button>
			<button class="secondary" disabled={Boolean(testBusy)} onclick={() => void onRunTest('status')}>{testBusy === 'status' ? 'Sending…' : 'Send Status Update test'}</button>
			<button class="secondary" disabled={Boolean(testBusy)} onclick={() => void onRunTest('sanction')}>{testBusy === 'sanction' ? 'Sending…' : 'Send Sanction Test Request'}</button>
		</div>
		{#if lastTest}
			<p class="success">Sent {lastTest.kind} test at {new Date(lastTest.sentAt).toLocaleTimeString()} · {lastTest.status}</p>
		{/if}
		{#if testError}
			<p class="error" role="alert">Test activity failed: {testError}</p>
		{/if}
	</aside>
</section>
