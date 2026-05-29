import { semanticStatusUpdateState } from './statusPolicy.js';
import type { ActivityItem, RequestRecord, SessionMetadata, StatusUpdateRecord } from './index.js';

export function sessionMetadataTitle(session: SessionMetadata | undefined): string | undefined {
  return session?.title?.trim() || session?.label?.trim() || undefined;
}

export function deriveSessionSummaryTitle(activity: ActivityItem[], fallback = 'Agent activity'): string {
  const latestFirst = [...activity].sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  for (const item of latestFirst) {
    const title = sessionMetadataTitle(item.kind === 'request' ? item.request.session : item.statusUpdate.session);
    if (title) return title;
  }
  for (const item of latestFirst) {
    const title = item.kind === 'request' ? item.request.title : item.statusUpdate.message;
    if (title.trim()) return title.trim();
  }
  return fallback;
}

export const REDUNDANT_WAITING_STATUS_UPDATE_WINDOW_MS = 10_000;

export function isRedundantWaitingStatusUpdateAfterRequest(statusUpdate: StatusUpdateRecord, request: RequestRecord, windowMs = REDUNDANT_WAITING_STATUS_UPDATE_WINDOW_MS): boolean {
  if (semanticStatusUpdateState(statusUpdate.state) !== 'waiting') return false;
  if (request.status !== 'pending') return false;
  if (statusUpdate.workspaceId !== request.workspaceId) return false;
  const statusTime = Date.parse(statusUpdate.createdAt);
  const requestTime = Date.parse(request.createdAt);
  if (!Number.isFinite(statusTime) || !Number.isFinite(requestTime)) return false;
  return statusTime >= requestTime && statusTime - requestTime <= windowMs;
}

export function suppressRedundantWaitingStatusUpdates(activity: ActivityItem[], windowMs = REDUNDANT_WAITING_STATUS_UPDATE_WINDOW_MS): ActivityItem[] {
  let lastPendingRequest: RequestRecord | undefined;
  return activity.filter((item) => {
    if (item.kind === 'request') {
      if (item.request.status === 'pending') lastPendingRequest = item.request;
      return true;
    }
    if (lastPendingRequest && isRedundantWaitingStatusUpdateAfterRequest(item.statusUpdate, lastPendingRequest, windowMs)) return false;
    return true;
  });
}
