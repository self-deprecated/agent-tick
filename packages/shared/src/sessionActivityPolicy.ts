import { semanticStatusUpdateState } from './statusPolicy.js';
import type { ActivityItem, RequestRecord, SessionMetadata, StatusUpdateRecord } from './index.js';

export function sessionMetadataTitle(session: SessionMetadata | undefined): string | undefined {
  return session?.title?.trim() || session?.label?.trim() || undefined;
}

export function deriveSessionSummaryTitle(activity: ActivityItem[], fallback = 'Agent activity'): string {
  const latestFirst = [...activity].sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  for (const item of latestFirst) {
    const title = sessionMetadataTitle(item.kind === 'request' ? item.request.session : item.kind === 'status_update' ? item.statusUpdate.session : undefined);
    if (title) return title;
  }
  for (const item of latestFirst) {
    if (item.kind === 'tool_activity') continue;
    const title = item.kind === 'request' ? item.request.title : item.statusUpdate.message;
    if (title.trim()) return title.trim();
  }
  for (const item of latestFirst) {
    if (item.kind !== 'tool_activity') continue;
    const title = item.toolActivity.summary ?? `Tool activity: ${item.toolActivity.toolName}`;
    if (title.trim()) return title.trim();
  }
  return fallback;
}

export const REDUNDANT_WAITING_STATUS_UPDATE_WINDOW_MS = 10_000;

export function isRedundantWaitingStatusUpdateAfterRequest(statusUpdate: StatusUpdateRecord, request: RequestRecord, windowMs = REDUNDANT_WAITING_STATUS_UPDATE_WINDOW_MS): boolean {
  if (semanticStatusUpdateState(statusUpdate.state) !== 'waiting') return false;
  if (request.status !== 'pending') return false;
  if (statusUpdate.workspaceId !== request.workspaceId) return false;
  if (!sameSessionOrSourceContext(statusUpdate, request)) return false;
  const statusTime = Date.parse(statusUpdate.createdAt);
  const requestTime = Date.parse(request.createdAt);
  if (!Number.isFinite(statusTime) || !Number.isFinite(requestTime)) return false;
  return statusTime >= requestTime && statusTime - requestTime <= windowMs;
}

export function suppressRedundantWaitingStatusUpdates(activity: ActivityItem[], windowMs = REDUNDANT_WAITING_STATUS_UPDATE_WINDOW_MS): ActivityItem[] {
  const pendingRequests = activity
    .filter((item): item is Extract<ActivityItem, { kind: 'request' }> => item.kind === 'request' && item.request.status === 'pending')
    .map((item) => item.request);
  return activity.filter((item) => {
    if (item.kind !== 'status_update') return true;
    return !pendingRequests.some((request) => isRedundantWaitingStatusUpdateAfterRequest(item.statusUpdate, request, windowMs));
  });
}

function sameSessionOrSourceContext(statusUpdate: StatusUpdateRecord, request: RequestRecord): boolean {
  if (statusUpdate.sessionId && request.sessionId) return statusUpdate.sessionId === request.sessionId;
  const statusKey = sourceContextKeyForStatusUpdate(statusUpdate);
  const requestKey = sourceContextKeyForRequest(request);
  return statusKey === requestKey || statusKey === statusUpdate.workspaceId || requestKey === request.workspaceId;
}

function sourceContextKeyForStatusUpdate(statusUpdate: StatusUpdateRecord): string {
  const stable = [statusUpdate.workspaceId, statusUpdate.agentTokenId, statusUpdate.clientName, statusUpdate.host, statusUpdate.workingDirectory].filter(Boolean);
  return (stable.length > 1 ? stable : [statusUpdate.workspaceId, statusUpdate.agentTokenLabel].filter(Boolean)).join('\u001f') || statusUpdate.workspaceId;
}

function sourceContextKeyForRequest(request: RequestRecord): string {
  const requester = request.requester;
  const stable = [request.workspaceId, request.agentTokenId ?? requester.agentTokenId, requester.clientName, requester.host, requester.workingDirectory].filter(Boolean);
  return (stable.length > 1 ? stable : [request.workspaceId, requester.name].filter(Boolean)).join('\u001f') || request.workspaceId;
}
