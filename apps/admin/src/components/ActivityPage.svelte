<script lang="ts">
	import type { ActivityItem, RequestRecord, RespondRequest, WorkspaceMemberRecord } from '@self-deprecated/agent-tick-sdk';

	let {
		workspace,
		activity = [],
		selectedRequestId = '',
		respondingRequestId = '',
		onSelectRequest,
		onRespond,
		onLoadMore
	}: {
		workspace?: WorkspaceMemberRecord;
		activity?: ActivityItem[];
		selectedRequestId?: string;
		respondingRequestId?: string;
		onSelectRequest: (requestId: string) => void;
		onRespond: (request: RequestRecord, response: RespondRequest) => void | Promise<void>;
		onLoadMore: () => void | Promise<void>;
	} = $props();

	let requests = $derived(activity.filter((item) => item.kind === 'request').map((item) => item.request));
	let pendingRequests = $derived(requests.filter((request) => request.status === 'pending'));
	let recentActivity = $derived(activity.filter((item) => item.kind === 'status_update' || item.request.status !== 'pending'));
	let selectedRequest = $derived(requests.find((request) => request.id === selectedRequestId) ?? pendingRequests[0] ?? requests[0]);

	function missingDeviceRecipients(request: RequestRecord): number {
		return request.quorum?.recipients.filter((recipient) => !recipient.hasActiveDevice && !recipient.respondedAt).length ?? 0;
	}

	function quorumText(request: RequestRecord): string {
		if (!request.quorum) return request.status;
		return `${request.quorum.receivedResponseCount}/${request.quorum.requiredResponseCount} Responses · waiting for ${request.quorum.waitingFor}`;
	}
</script>

<section class="page-grid">
	<div class="main-column">
		<div class="section-header compact">
			<p class="eyebrow">Activity</p>
			<h1>{workspace?.name ?? 'Workspace'} activity</h1>
			<p>Pending actionable Requests first, then recent routed Activity.</p>
		</div>

		<div class="activity-list">
			{#if pendingRequests.length}
				<h2>Pending Requests</h2>
				{#each pendingRequests as request (request.id)}
					<button class="activity-row actionable" class:active={selectedRequest?.id === request.id} onclick={() => onSelectRequest(request.id)}>
						<span><strong>{request.title}</strong><small>{request.requestType} · {quorumText(request)}</small></span>
						<span class="status-pill warning">Pending</span>
					</button>
				{/each}
			{/if}

			<h2>Recent Activity</h2>
			{#if recentActivity.length === 0 && pendingRequests.length === 0}
				<p class="empty">No routed Activity yet.</p>
			{/if}
			{#each recentActivity as item (item.kind + item.id)}
				{#if item.kind === 'status_update'}
					<div class="activity-row">
						<span><strong>{item.statusUpdate.message}</strong><small>Status Update · {item.statusUpdate.state} · {new Date(item.createdAt).toLocaleString()}</small></span>
						{#if item.statusUpdate.isTest}<span class="status-pill">Test</span>{/if}
					</div>
				{:else}
					<button class="activity-row" class:active={selectedRequest?.id === item.request.id} onclick={() => onSelectRequest(item.request.id)}>
						<span><strong>{item.request.title}</strong><small>Request · {item.request.status} · {new Date(item.createdAt).toLocaleString()}</small></span>
						{#if item.request.isTest}<span class="status-pill">Test</span>{/if}
					</button>
				{/if}
			{/each}
			<button class="secondary" onclick={() => void onLoadMore()}>Load older history</button>
		</div>
	</div>

	<aside class="side-panel detail-panel">
		{#if selectedRequest}
			<p class="eyebrow">Request detail</p>
			<h2>{selectedRequest.title}</h2>
			<p class="subtle">{selectedRequest.requestType} · {selectedRequest.status} · {quorumText(selectedRequest)}</p>
			{#if selectedRequest.body}<p>{selectedRequest.body}</p>{/if}
			{#if selectedRequest.command}<pre>{selectedRequest.command}</pre>{/if}
			{#if selectedRequest.isTest}<p class="status-pill">Test Request{selectedRequest.testLabel ? ` · ${selectedRequest.testLabel}` : ''}</p>{/if}
			{#if missingDeviceRecipients(selectedRequest)}
				<p class="warning">{missingDeviceRecipients(selectedRequest)} routed recipient{missingDeviceRecipients(selectedRequest) === 1 ? '' : 's'} have no active Approval Device.</p>
			{/if}
			{#if selectedRequest.quorum?.responses.length}
				<h3>Submitted Responses</h3>
				<ul class="plain-list">
					{#each selectedRequest.quorum.responses as response (response.responseId)}
						<li>{response.userId}: {response.choiceId ?? response.message ?? 'Response'} · {new Date(response.createdAt).toLocaleString()}</li>
					{/each}
				</ul>
			{/if}
			{#if selectedRequest.status === 'pending' && selectedRequest.quorum?.currentUserEligible !== false && !selectedRequest.quorum?.currentUserResponded}
				<h3>Respond</h3>
				<div class="choice-stack">
					{#each selectedRequest.choices as choice (choice.id)}
						<button disabled={respondingRequestId === selectedRequest.id} class:danger={choice.kind === 'deny'} onclick={() => void onRespond(selectedRequest, { choiceId: choice.id })}>{choice.label}</button>
					{/each}
				</div>
			{/if}
		{:else}
			<h2>No Request selected</h2>
			<p class="subtle">Open a pending or recent Request to inspect quorum and Responses.</p>
		{/if}
	</aside>
</section>
