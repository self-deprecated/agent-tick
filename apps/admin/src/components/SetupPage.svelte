<script lang="ts">
	import type { AgentTokenRecord, DeviceRecord, OnboardingStatus, RoutingRuleRecord, SendTestActivityResponse, WorkspaceMemberRecord } from '@agent-tick/sdk';

	let {
		serverUrl,
		workspace,
		onboarding,
		agentTokens = [],
		routingRules = [],
		devices = [],
		selectedTestAgentTokenId = '',
		testBusy = '',
		lastTest,
		onSelectTestAgent,
		onRunTest
	}: {
		serverUrl: string;
		workspace?: WorkspaceMemberRecord;
		onboarding?: OnboardingStatus;
		agentTokens?: AgentTokenRecord[];
		routingRules?: RoutingRuleRecord[];
		devices?: DeviceRecord[];
		selectedTestAgentTokenId?: string;
		testBusy?: '' | 'status' | 'steering' | 'sanction';
		lastTest?: SendTestActivityResponse & { sentAt: string };
		onSelectTestAgent: (agentTokenId: string) => void;
		onRunTest: (kind: 'status' | 'steering' | 'sanction') => void | Promise<void>;
	} = $props();

	let activeDevices = $derived(devices.filter((device) => !device.unregisteredAt));
	let connectedTokens = $derived(agentTokens.filter((token) => !token.revokedAt && token.lastCheckInAt));
	let routedTokens = $derived(connectedTokens.filter((token) => workspace?.type === 'personal' || token.routingRuleId));
	let selectedToken = $derived(agentTokens.find((token) => token.agentTokenId === selectedTestAgentTokenId) ?? routedTokens[0] ?? connectedTokens[0] ?? agentTokens[0]);
	let agentReady = $derived(Boolean(workspace?.type === 'personal' ? onboarding?.hasAgentCheckIn : routedTokens.length));
	let phoneReady = $derived(Boolean(onboarding?.hasMobileDevice || activeDevices.length));
	let missingTestRequirements = $derived.by(() => {
		const missing: string[] = [];
		if (!agentReady) missing.push(workspace?.type === 'shared' ? 'a connected routed Agent Token' : 'a connected Agent Token');
		if (!phoneReady) missing.push('an active Approval Device');
		return missing;
	});
	let setupPrompt = $derived(`Set up Agent Tick for this workspace. Use server ${serverUrl}. Install the Agent Tick setup skill from https://agenttick.sh/skill, sign in, create or connect an Agent Token named after this machine, then send a test Status Update.`);

	function copySetupPrompt(): void {
		void navigator.clipboard?.writeText(setupPrompt);
	}
</script>

<section class="page-grid">
	<div class="main-column">
		<div class="section-header">
			<p class="eyebrow">Setup</p>
			<h1>Make this Workspace ready</h1>
			<p>Complete the Agent and Phone steps. Account management lives in Settings.</p>
		</div>

		<div class="step-row" class:complete={agentReady}>
			<div>
				<strong>1. Agent</strong>
				{#if workspace?.type === 'shared'}
					<p>Shared Workspaces need a connected Agent Token assigned to a Routing Rule.</p>
				{:else}
					<p>Personal Workspaces are ready after an Agent Token checks in.</p>
				{/if}
			</div>
			<span class="state-pill">{agentReady ? 'Ready' : connectedTokens.length ? 'Routing required' : agentTokens.length ? 'Waiting for check-in' : 'Not connected'}</span>
			{#if !agentTokens.length}
				<div class="prompt-box">
					<pre>{setupPrompt}</pre>
					<button class="secondary" onclick={copySetupPrompt}>Copy setup prompt</button>
				</div>
			{/if}
			{#if workspace?.type === 'shared' && connectedTokens.length > 0 && routedTokens.length === 0}
				<p class="warning">Connected Agent Tokens need a Routing Rule assignment before tests can route.</p>
			{/if}
		</div>

		<div class="step-row" class:complete={phoneReady}>
			<div>
				<strong>2. Phone</strong>
				<p>Install the iOS or Android app and sign in with the same account. Push notifications are recommended but do not block setup.</p>
				<p class="links"><a href="https://apps.apple.com/" target="_blank" rel="noreferrer">iOS app</a> · <a href="https://play.google.com/store" target="_blank" rel="noreferrer">Android app</a></p>
			</div>
			<span class="state-pill">{phoneReady ? 'Connected' : 'No active device'}</span>
		</div>
	</div>

	<aside class="side-panel">
		<h2>Connection summary</h2>
		<dl>
			<dt>Workspace</dt><dd>{workspace?.name ?? 'None selected'}</dd>
			<dt>Type</dt><dd>{workspace?.type ?? '—'}</dd>
			<dt>Agent Tokens</dt><dd>{connectedTokens.length} connected / {agentTokens.filter((token) => !token.revokedAt).length} active</dd>
			<dt>Approval Devices</dt><dd>{activeDevices.length} active</dd>
		</dl>

		<h3>Setup tests</h3>
		{#if missingTestRequirements.length}
			<p class="warning">Disabled until there is {missingTestRequirements.join(' and ')}.</p>
		{/if}
		{#if agentTokens.length > 1}
			<label>
				<span>Test Agent Token</span>
				<select value={selectedToken?.agentTokenId ?? ''} onchange={(event) => onSelectTestAgent(event.currentTarget.value)}>
					{#each agentTokens as token (token.agentTokenId)}
						<option value={token.agentTokenId} disabled={workspace?.type === 'shared' && !token.routingRuleId}>{token.label}{workspace?.type === 'shared' && !token.routingRuleId ? ' · routing required' : ''}</option>
					{/each}
				</select>
			</label>
		{/if}
		<div class="button-stack">
			<button disabled={Boolean(missingTestRequirements.length || testBusy)} onclick={() => void onRunTest('status')}>{testBusy === 'status' ? 'Sending…' : 'Status Update test'}</button>
			<button disabled={Boolean(missingTestRequirements.length || testBusy)} onclick={() => void onRunTest('steering')}>{testBusy === 'steering' ? 'Sending…' : 'Steering test'}</button>
			<button disabled={Boolean(missingTestRequirements.length || testBusy)} onclick={() => void onRunTest('sanction')}>{testBusy === 'sanction' ? 'Sending…' : 'Sanction test'}</button>
		</div>
		{#if lastTest}
			<p class="success">Sent {lastTest.kind} test at {new Date(lastTest.sentAt).toLocaleTimeString()} · {lastTest.status}</p>
		{/if}
	</aside>
</section>
