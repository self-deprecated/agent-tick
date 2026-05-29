<script lang="ts">
	import type { ActivityItem, RequestAgentWaiterSummary, RequestRecord, RespondRequest, SessionDetail, SessionSummary, WorkspaceMemberRecord } from '@self-deprecated/agent-tick-sdk';
	import { quorumText, requiresHighRiskConfirmation, type WorkspaceMemberCountsById } from './activityProgress';

	let {
		workspace,
		activity = [],
		sessions = [],
		selectedSessionId = '',
		sessionDetail,
		sessionError = '',
		selectedRequestId = '',
		respondingRequestId = '',
		workspaceMemberCountsById = {},
		onSelectSession,
		onSelectRequest,
		onRespond,
		onLoadMore
	}: {
		workspace?: WorkspaceMemberRecord;
		activity?: ActivityItem[];
		sessions?: SessionSummary[];
		selectedSessionId?: string;
		sessionDetail?: SessionDetail;
		sessionError?: string;
		selectedRequestId?: string;
		respondingRequestId?: string;
		workspaceMemberCountsById?: WorkspaceMemberCountsById;
		onSelectSession?: (sessionId: string) => void | Promise<void>;
		onSelectRequest: (requestId: string) => void;
		onRespond: (request: RequestRecord, response: RespondRequest) => void | Promise<void>;
		onLoadMore: () => void | Promise<void>;
	} = $props();

	type SessionSummaryWithWaiters = SessionSummary & {
		pendingRequests?: Array<{ agentWaiter?: RequestAgentWaiterSummary }>;
		latestActivity: SessionSummary['latestActivity'] & { agentWaiter?: RequestAgentWaiterSummary };
	};

	let usesSessions = $derived(sessions.length > 0 || Boolean(sessionDetail));
	let needsInputSessions = $derived(sessions.filter((session) => session.state === 'needs-input' || session.pendingRequestCount > 0));
	let recentSessions = $derived(sessions.filter((session) => !needsInputSessions.some((candidate) => candidate.sessionId === session.sessionId)));
	let timeline = $derived(sessionDetail?.timeline ?? []);
	let timelineRequests = $derived(timeline.filter((item) => item.kind === 'request').map((item) => item.request));
	let fallbackRequests = $derived(activity.filter((item) => item.kind === 'request').map((item) => item.request));
	let requests = $derived(usesSessions ? timelineRequests : fallbackRequests);
	let pendingRequests = $derived(requests.filter((request) => request.status === 'pending'));
	let recentActivity = $derived(activity.filter((item) => item.kind === 'status_update' || item.request.status !== 'pending'));
	let selectedRequest = $derived(requests.find((request) => request.id === selectedRequestId) ?? pendingRequests[0] ?? requests[0]);

	function missingDeviceRecipients(request: RequestRecord): number {
		return request.quorum?.recipients.filter((recipient) => !recipient.hasActiveDevice && !recipient.respondedAt).length ?? 0;
	}

	function waiterLivenessLabel(waiter: RequestAgentWaiterSummary | undefined): string {
		if (!waiter) return '';
		switch (waiter.state) {
			case 'waiting': return 'Agent waiting for answer';
			case 'stale': return 'Agent wait stale';
			case 'expired': return 'Agent wait expired';
			case 'stopped': return 'Agent stopped waiting';
			case 'errored': return 'Agent wait failed';
			default: return '';
		}
	}

	function sessionWaiterLivenessLabel(session: SessionSummary): string {
		const enriched = session as SessionSummaryWithWaiters;
		const waiter = enriched.pendingRequests?.find((request) => request.agentWaiter)?.agentWaiter ?? enriched.latestActivity.agentWaiter;
		return waiterLivenessLabel(waiter);
	}

	function requestWaiterLivenessLabel(request: RequestRecord): string {
		return waiterLivenessLabel(request.agentWaiter);
	}

	function sessionMeta(session: SessionSummary): string {
		const pending = session.pendingRequestCount > 0 ? `${session.pendingRequestCount} pending Request${session.pendingRequestCount === 1 ? '' : 's'} · ` : '';
		const waiter = sessionWaiterLivenessLabel(session);
		const waiterText = waiter ? `${waiter} · ` : '';
		const sources = session.sourceLabels.length ? `${session.sourceLabels.join(', ')} · ` : '';
		return `${pending}${waiterText}${sources}${new Date(session.updatedAt).toLocaleString()}`;
	}

	function timelineLabel(item: SessionDetail['timeline'][number]): string {
		if (item.kind === 'status_update') return `Status Update · ${item.statusUpdate.state} · ${new Date(item.createdAt).toLocaleString()}`;
		const waiter = requestWaiterLivenessLabel(item.request);
		return `Request · ${item.request.status}${waiter ? ` · ${waiter}` : ''} · ${new Date(item.createdAt).toLocaleString()}`;
	}

	function submitResponse(request: RequestRecord, response: RespondRequest): void {
		const choice = request.choices.find((candidate) => candidate.id === response.choiceId);
		if (requiresHighRiskConfirmation(request, choice) && !window.confirm('Approve this high-risk Sanction? Review the command before continuing.')) return;
		void onRespond(request, response);
	}
</script>

<section class="page-grid">
	<div class="main-column">
		<div class="section-header compact">
			<p class="eyebrow">Activity</p>
			<h1>{workspace?.name ?? 'Workspace'} activity</h1>
			<p>Sessions needing input first, then recent Session activity. Use the Native App for day-to-day approvals; this web view remains available as a fallback.</p>
		</div>

		{#if sessionError}
			<p class="warning">Session Activity is temporarily unavailable. Showing the latest Activity fallback where possible.</p>
		{/if}

		{#if usesSessions}
			<div class="activity-list session-master-list" aria-label="Session list">
				{#if needsInputSessions.length}
					<h2>Needs input</h2>
					{#each needsInputSessions as session (session.sessionId)}
						<button class="activity-row actionable" class:active={selectedSessionId === session.sessionId} onclick={() => void onSelectSession?.(session.sessionId)}>
							<span><strong>{session.title}</strong><small>{sessionMeta(session)}</small></span>
							<span class="status-pill warning">Needs input</span>
						</button>
					{/each}
				{/if}

				<h2>Recent Sessions</h2>
				{#if sessions.length === 0}
					<p class="empty">You’re ready. Agent activity will appear here; use the Native App for day-to-day approvals.</p>
				{:else if needsInputSessions.length === 0}
					<p class="subtle">No Sessions need input right now. Terminal and recent Sessions stay available below.</p>
				{/if}
				{#each recentSessions as session (session.sessionId)}
					<button class="activity-row" class:active={selectedSessionId === session.sessionId} onclick={() => void onSelectSession?.(session.sessionId)}>
						<span><strong>{session.title}</strong><small>{sessionMeta(session)}</small></span>
						<span class="status-pill">{session.state}</span>
					</button>
				{/each}
				<button class="secondary" onclick={() => void onLoadMore()}>Refresh Activity</button>
			</div>
		{:else}
			<div class="activity-list">
				{#if pendingRequests.length}
					<h2>Pending Requests</h2>
					{#each pendingRequests as request (request.id)}
						<button class="activity-row actionable" class:active={selectedRequest?.id === request.id} onclick={() => onSelectRequest(request.id)}>
							<span><strong>{request.title}</strong><small>{request.requestType} · {quorumText(request, workspaceMemberCountsById)}{requestWaiterLivenessLabel(request) ? ` · ${requestWaiterLivenessLabel(request)}` : ''}</small></span>
							<span class="status-pill warning">Pending</span>
						</button>
					{/each}
				{/if}

				<h2>Recent Activity</h2>
				{#if recentActivity.length === 0 && pendingRequests.length === 0}
					<p class="empty">You’re ready. Agent activity will appear here; use the Native App for day-to-day approvals.</p>
				{/if}
				{#each recentActivity as item (item.kind + item.id)}
					{#if item.kind === 'status_update'}
						<div class="activity-row">
							<span><strong>{item.statusUpdate.message}</strong><small>Status Update · {item.statusUpdate.state} · {new Date(item.createdAt).toLocaleString()}</small></span>
							{#if item.statusUpdate.isTest}<span class="status-pill">Test</span>{/if}
						</div>
					{:else}
						<button class="activity-row" class:active={selectedRequest?.id === item.request.id} onclick={() => onSelectRequest(item.request.id)}>
							<span><strong>{item.request.title}</strong><small>{timelineLabel(item)}</small></span>
							{#if item.request.isTest}<span class="status-pill">Test</span>{/if}
						</button>
					{/if}
				{/each}
				<button class="secondary" onclick={() => void onLoadMore()}>Load older history</button>
			</div>
		{/if}
	</div>

	<aside class="side-panel detail-panel session-detail-panel">
		{#if usesSessions}
			<p class="eyebrow">Session detail</p>
			<h2>{sessionDetail?.summary.title ?? 'Select a Session'}</h2>
			{#if timeline.length === 0}
				<p class="subtle">Open a Session to inspect Status Updates, Requests, and Responses in timeline order.</p>
			{/if}
			{#each timeline as item (item.kind + item.id)}
				{#if item.kind === 'status_update'}
					<div class="activity-row">
						<span><strong>{item.statusUpdate.message}</strong><small>{timelineLabel(item)}</small></span>
						{#if item.statusUpdate.isTest}<span class="status-pill">Test</span>{/if}
					</div>
				{:else}
					<button class="activity-row" class:active={selectedRequest?.id === item.request.id} onclick={() => onSelectRequest(item.request.id)}>
						<span><strong>{item.request.title}</strong><small>{timelineLabel(item)}</small></span>
						{#if item.request.status === 'pending'}<span class="status-pill warning">{requestWaiterLivenessLabel(item.request) || 'Pending'}</span>{/if}
					</button>
				{/if}
			{/each}
		{/if}

		{#if selectedRequest}
			<p class="eyebrow">Request detail</p>
			<h2>{selectedRequest.title}</h2>
			<p class="subtle">{selectedRequest.requestType} · {selectedRequest.status} · {quorumText(selectedRequest, workspaceMemberCountsById)}{requestWaiterLivenessLabel(selectedRequest) ? ` · ${requestWaiterLivenessLabel(selectedRequest)}` : ''}</p>
			{#if selectedRequest.body}<p>{selectedRequest.body}</p>{/if}
			{#if selectedRequest.command}<pre>{selectedRequest.command}</pre>{/if}
			{#if selectedRequest.risk}<p class="status-pill">Risk: {selectedRequest.risk}</p>{/if}
			{#if selectedRequest.isTest}<p class="status-pill">Test Request{selectedRequest.testLabel ? ` · ${selectedRequest.testLabel}` : ''}</p>{/if}
			{#if missingDeviceRecipients(selectedRequest)}
				<p class="warning">{missingDeviceRecipients(selectedRequest)} routed recipient{missingDeviceRecipients(selectedRequest) === 1 ? '' : 's'} have no push-ready Approval Device.</p>
			{/if}
			{#if selectedRequest.quorum?.responses.length}
				<h3>Submitted Responses</h3>
				<ul class="plain-list">
					{#each selectedRequest.quorum.responses as response (response.responseId)}
						<li>{response.choiceId ?? response.message ?? 'Response'} · {new Date(response.createdAt).toLocaleString()}</li>
					{/each}
				</ul>
			{/if}
			{#if selectedRequest.status === 'pending' && selectedRequest.quorum?.currentUserEligible !== false && !selectedRequest.quorum?.currentUserResponded}
				<h3>Respond</h3>
				<p class="subtle">Web fallback responses are available here; use the Native App for day-to-day approvals.</p>
				<div class="choice-stack">
					{#each selectedRequest.choices as choice (choice.id)}
						<button disabled={respondingRequestId === selectedRequest.id} class:danger={choice.kind === 'deny'} onclick={() => submitResponse(selectedRequest, { choiceId: choice.id })}>{choice.label}</button>
					{/each}
				</div>
			{/if}
		{:else if !usesSessions}
			<h2>No Request selected</h2>
			<p class="subtle">Open a pending or recent Request to inspect quorum and Responses.</p>
		{/if}
	</aside>
</section>
