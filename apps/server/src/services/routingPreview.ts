import type { AgentTokenRecord, RoutingPreview, RoutingRuleRecord, WorkspaceMemberRecord } from '@self-deprecated/agent-tick-shared';
import type { AsyncAgentTickStore as AgentTickStore } from '@agent-tick/db';

export interface RoutingPreviewRequest {
  workspaceId: string;
  routingRule?: RoutingRuleRecord;
  agentToken?: AgentTokenRecord;
  recipientUserIds?: string[];
  requiredResponseMode?: string;
  requiredResponseCount?: number;
}

export async function previewRouting(store: AgentTickStore, input: RoutingPreviewRequest): Promise<RoutingPreview> {
  const routingRule = input.routingRule;
  const recipientUserIds = unique(input.recipientUserIds ?? routingRule?.recipientUserIds ?? []);
  const requiredResponseMode = input.requiredResponseMode ?? routingRule?.requiredResponseMode ?? 'any_one';
  const requiredResponseCount = input.requiredResponseCount ?? routingRule?.requiredResponseCount ?? 1;
  const members = await store.listWorkspaceMembers(input.workspaceId);
  const devices = await store.listPushDevicesForUsers(recipientUserIds);
  const selectedDeviceUsers = new Set(devices.filter((device) => !device.unregisteredAt && Boolean(device.expoPushToken)).map((device) => device.userId));
  const selected = members.filter((member) => member.status !== 'removed' && recipientUserIds.includes(member.userId));
  const availabilityByUserId = new Map<string, string | undefined>();
  await Promise.all(selected.map(async (member) => {
    const availability = await store.getAvailability(member.userId, input.workspaceId);
    availabilityByUserId.set(member.userId, availability?.state);
  }));
  const selectedIds = new Set(selected.map((member) => member.userId));
  const selectedPushReady = selected.filter((member) => selectedDeviceUsers.has(member.userId));
  const selectedAvailable = selected.filter((member) => !isUnavailable(availabilityByUserId.get(member.userId)));
  const assignedAgentConnectionCount = input.agentToken ? 1 : (await store.listAgentTokens(input.workspaceId)).filter((token) => !token.revokedAt && token.routingRuleId === routingRule?.routingRuleId).length;
  const unhealthyReasons: string[] = [];
  if (selected.length === 0) unhealthyReasons.push('no_recipients');
  if (selected.length > 0 && selectedPushReady.length === 0) unhealthyReasons.push('no_push_ready_recipients');
  if (selected.some((member) => isUnavailable(availabilityByUserId.get(member.userId)))) unhealthyReasons.push('selected_recipients_unavailable');
  if (requiredResponseCount > selected.length) unhealthyReasons.push('impossible_quorum');
  if (assignedAgentConnectionCount > 0 && unhealthyReasons.length > 0) unhealthyReasons.push('assigned_agent_unroutable');
  const recipients = members.filter((member) => member.status !== 'removed').map((member) => {
    const selectedMember = selectedIds.has(member.userId);
    const availabilityState = availabilityByUserId.get(member.userId);
    const pushReady = selectedDeviceUsers.has(member.userId);
    return {
      userId: member.userId,
      ...(member.displayName ? { displayName: member.displayName } : {}),
      ...(member.email ? { email: member.email } : {}),
      role: member.role,
      selected: selectedMember,
      ...(availabilityState ? { availabilityState } : {}),
      pushReady: selectedMember && pushReady,
      readiness: selectedMember ? readinessFor(pushReady, availabilityState) : 'not_selected'
    };
  });
  return {
    workspaceId: input.workspaceId,
    ...(routingRule?.routingRuleId ? { routingRuleId: routingRule.routingRuleId } : {}),
    ...(input.agentToken?.agentTokenId ? { agentTokenId: input.agentToken.agentTokenId } : {}),
    status: unhealthyReasons.length ? 'unhealthy' : 'healthy',
    summary: `${selected.length} selected · ${selectedPushReady.length} push-ready · ${selectedAvailable.length} available`,
    selectedRecipientCount: selected.length,
    pushReadyRecipientCount: selectedPushReady.length,
    availableRecipientCount: selectedAvailable.length,
    requiredResponseMode,
    requiredResponseCount,
    recipients,
    unhealthyReasons,
    assignedAgentConnectionCount
  };
}

export function safeRoutingExplanation(preview: RoutingPreview): Record<string, unknown> {
  return {
    routingRuleId: preview.routingRuleId,
    agentTokenId: preview.agentTokenId,
    status: preview.status,
    selectedRecipientCount: preview.selectedRecipientCount,
    pushReadyRecipientCount: preview.pushReadyRecipientCount,
    availableRecipientCount: preview.availableRecipientCount,
    requiredResponseMode: preview.requiredResponseMode,
    requiredResponseCount: preview.requiredResponseCount,
    unhealthyReasons: preview.unhealthyReasons
  };
}

function isUnavailable(state: string | undefined): boolean {
  return state === 'busy' || state === 'do-not-disturb' || state === 'off-call';
}

function readinessFor(pushReady: boolean, availabilityState: string | undefined): string {
  if (isUnavailable(availabilityState)) return 'unavailable';
  if (!pushReady) return 'needs_push_ready_device';
  return 'ready';
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}
