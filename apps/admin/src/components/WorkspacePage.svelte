<script lang="ts">
	import type { Clerk as ClerkJS } from '@clerk/clerk-js';
	import type { BillingStatus, DeviceRecord, MeResponse, RoutingRuleRecord, WorkspaceMemberRecord } from '@self-deprecated/agent-tick-sdk';

	type WorkspaceMemberWithAvailability = WorkspaceMemberRecord & { availabilityState?: string; lastSeenAt?: string };

	let {
		workspace,
		workspaceMembers = [],
		workspaceMemberCountsById = {},
		selectedWorkspaceId = '',
		routingRules = [],
		devices = [],
		billingStatus,
		clerk,
		clerkSignedIn = false,
		currentUser,
		onUpdateOwnAvailability,
		onOpenConnections
	}: {
		workspace?: WorkspaceMemberRecord;
		workspaceMembers?: WorkspaceMemberWithAvailability[];
		workspaceMemberCountsById?: Record<string, number>;
		selectedWorkspaceId?: string;
		routingRules?: RoutingRuleRecord[];
		devices?: DeviceRecord[];
		billingStatus?: BillingStatus;
		clerk?: ClerkJS;
		clerkSignedIn?: boolean;
		currentUser?: MeResponse;
		onUpdateOwnAvailability: (value: string) => void | Promise<void>;
		onOpenConnections: () => void;
	} = $props();

	let isSharedWorkspace = $derived(workspace?.type === 'shared');
	let canManageWorkspace = $derived(isSharedWorkspace && (workspace?.role === 'owner' || workspace?.role === 'admin'));
	let activeMemberCount = $derived(workspaceMemberCountsById[selectedWorkspaceId] ?? workspaceMembers.filter((member) => member.status !== 'removed').length);

	function workspaceLabel(): string {
		if (!workspace) return 'Workspace';
		return workspace.type === 'personal' ? 'Personal Workspace' : workspace.name;
	}

	function memberName(member: WorkspaceMemberWithAvailability): string {
		return member.displayName || member.email || 'Workspace member';
	}

	function memberRoleLabel(role: string | undefined): string {
		if (role === 'owner') return 'Owner';
		if (role === 'admin') return 'Admin';
		return 'Member';
	}

	function memberAvailabilityLabel(member: WorkspaceMemberWithAvailability): string {
		const state = member.availabilityState ?? 'available';
		if (state === 'do-not-disturb') return 'Do not disturb';
		if (state === 'off-call') return 'Off-call';
		return state.charAt(0).toUpperCase() + state.slice(1);
	}

	function memberApprovalReadiness(member: WorkspaceMemberWithAvailability): string {
		if (member.status !== 'active') return 'Pending — no Approval Access yet';
		if (member.availabilityState === 'busy' || member.availabilityState === 'do-not-disturb' || member.availabilityState === 'off-call') return 'Unavailable — will not receive routed push notifications';
		const memberRules = routingRules.filter((rule) => rule.recipientUserIds.includes(member.userId));
		if (memberRules.length === 0) return 'No Routing Rules include this member';
		const pushReady = devices.some((device) => device.userId === member.userId && !device.unregisteredAt && Boolean(device.expoPushToken));
		if (!pushReady) return 'Needs a push-ready Approval Device';
		return `Can receive Requests from ${memberRules.map((rule) => rule.name).join(', ')}`;
	}

	function billingPlanLabel(status: BillingStatus): string {
		if (status.plan === 'shared-workspace') return 'Shared Workspace';
		if (status.plan === 'solo') return 'Solo';
		if (status.plan === 'self-hosted') return 'Self-hosted';
		return status.plan;
	}

	function responseEntitlementLabel(status: BillingStatus): string {
		if (status.entitlement?.responsesEnabled) return 'Responses enabled';
		if (status.workspaceType === 'shared' || isSharedWorkspace) return 'Payment required';
		return '—';
	}

	function formatDate(value?: string): string {
		return value ? new Date(value).toLocaleString() : '—';
	}

	function openClerkWorkspaceProfile(): void {
		const organizationProfile = clerk as (ClerkJS & { openOrganizationProfile?: (props?: Record<string, unknown>) => void; redirectToOrganizationProfile?: () => Promise<unknown> }) | undefined;
		if (organizationProfile?.openOrganizationProfile) organizationProfile.openOrganizationProfile();
		else void organizationProfile?.redirectToOrganizationProfile?.();
	}
</script>

<section class="page-grid">
	<div class="main-column">
		<div class="section-header">
			<p class="eyebrow">Workspace</p>
			<h1>{workspaceLabel()}</h1>
			<p>{isSharedWorkspace ? 'Manage selected Workspace members, roles, response entitlement, and approval readiness.' : 'Personal Workspace details and readiness for your own Agent Connections.'}</p>
		</div>

		<div class="panel">
			<div class="status-card-header">
				<div>
					<h2>Workspace overview</h2>
					<p>{activeMemberCount} active member{activeMemberCount === 1 ? '' : 's'} in this Workspace.</p>
				</div>
				<button onclick={onOpenConnections}>Open Connections</button>
			</div>
			<dl class="summary-list">
				<dt>Type</dt><dd>{workspace?.type ?? '—'}</dd>
				<dt>Your role</dt><dd>{memberRoleLabel(workspace?.role)}</dd>
				{#if billingStatus}
					<dt>Plan</dt><dd>{billingPlanLabel(billingStatus)}</dd>
					<dt>Response entitlement</dt><dd>{responseEntitlementLabel(billingStatus)}</dd>
					{#if billingStatus.entitlement?.responsesEntitledUntil}
						<dt>Responses entitled until</dt><dd>{formatDate(billingStatus.entitlement.responsesEntitledUntil)}</dd>
					{/if}
					<dt>Seat limit</dt><dd>{billingStatus.limits.seats ?? 'Not capped'}</dd>
				{/if}
			</dl>
			{#if isSharedWorkspace && billingStatus?.entitlement?.responsesEnabled === false}
				<p class="warning">Shared Workspace billing is separate from Personal Workspace purchases. Members cannot respond while payment is required.</p>
			{/if}
		</div>

		{#if isSharedWorkspace}
			<div class="panel">
				<div class="status-card-header">
					<div>
						<h2>Members and roles</h2>
						<p>{canManageWorkspace ? 'Invite people and change Workspace roles with Clerk.' : 'Owners and Admins manage membership. Members can update only their own Availability here.'}</p>
					</div>
					{#if canManageWorkspace && clerkSignedIn && clerk}
						<button onclick={openClerkWorkspaceProfile}>Manage in Clerk</button>
					{/if}
				</div>
				{#if activeMemberCount < 2}<p class="warning">Invite at least one more active Member before configuring Connections and routing.</p>{/if}
			</div>

			<div class="activity-list">
				{#each workspaceMembers as member (member.userId)}
					<div class="activity-row">
						<span>
							<strong>{memberName(member)}</strong>
							<small>{memberRoleLabel(member.role)} · Availability: {memberAvailabilityLabel(member)} · {memberApprovalReadiness(member)}</small>
						</span>
						{#if member.userId === currentUser?.userId}
							<label class="inline-field">
								<span>Your Availability</span>
								<select value={member.availabilityState ?? 'available'} onchange={(event) => void onUpdateOwnAvailability(event.currentTarget.value)}>
									<option value="available">Available</option>
									<option value="busy">Busy</option>
									<option value="do-not-disturb">Do not disturb</option>
									<option value="off-call">Off-call</option>
								</select>
							</label>
						{/if}
					</div>
				{/each}
			</div>
		{/if}
	</div>
</section>
