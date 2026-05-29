import type { RequestRecord } from '@self-deprecated/agent-tick-sdk';

export type WorkspaceMemberCountsById = Record<string, number | undefined>;

export function isOneUserWorkspaceRequest(request: RequestRecord, workspaceMemberCountsById: WorkspaceMemberCountsById): boolean {
	return workspaceMemberCountsById[request.workspaceId] === 1;
}

export function shouldSuppressResponseProgress(request: RequestRecord, workspaceMemberCountsById: WorkspaceMemberCountsById): boolean {
	return request.status === 'pending' && isOneUserWorkspaceRequest(request, workspaceMemberCountsById);
}

export function quorumText(request: RequestRecord, workspaceMemberCountsById: WorkspaceMemberCountsById = {}): string {
	if (!request.quorum || shouldSuppressResponseProgress(request, workspaceMemberCountsById)) return request.status;
	return `${request.quorum.receivedResponseCount}/${request.quorum.requiredResponseCount} Responses · waiting for ${request.quorum.waitingFor}`;
}

export function requiresHighRiskConfirmation(request: RequestRecord, choice?: { kind?: string }): boolean {
	return request.requestType === 'sanction' && request.risk === 'high' && choice?.kind !== 'deny';
}
