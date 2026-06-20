import crypto from 'node:crypto';
import { deriveSessionSummaryTitle, semanticStatusUpdateState, suppressRedundantWaitingStatusUpdates, type ActivityItem, type RequestRecord, type SessionDetail, type SessionLatestActivity, type SessionPendingRequestSummary, type SessionState, type SessionSummary, type StatusUpdateRecord } from '@self-deprecated/agent-tick-shared';

const SYNTHETIC_SESSION_WINDOW_MS = 30 * 60 * 1000;
const ACTIVE_SESSION_WINDOW_MS = 60 * 60 * 1000;

interface SessionGroup {
  sessionId: string;
  sourceKey: string;
  explicit: boolean;
  items: ActivityItem[];
  startedAt: string;
  updatedAt: string;
}

export function deriveSessionDetails(activity: ActivityItem[], now = new Date()): SessionDetail[] {
  const groups = groupActivityIntoSessions(activity);
  return groups.map((group) => {
    const timeline = suppressRedundantWaitingStatusUpdates([...group.items].sort((left, right) => left.createdAt.localeCompare(right.createdAt)));
    const summary = summarizeSession(group.sessionId, timeline, now);
    return { summary, timeline };
  }).sort((left, right) => sessionSortKey(left.summary).localeCompare(sessionSortKey(right.summary)));
}

export function findSessionDetail(activity: ActivityItem[], sessionId: string, now = new Date()): SessionDetail | undefined {
  return deriveSessionDetails(activity, now).find((detail) => detail.summary.sessionId === sessionId);
}

function groupActivityIntoSessions(activity: ActivityItem[]): SessionGroup[] {
  const groups: SessionGroup[] = [];
  const explicitGroups = new Map<string, SessionGroup>();
  const latestSyntheticBySource = new Map<string, SessionGroup>();
  const sorted = [...activity].sort((left, right) => left.createdAt.localeCompare(right.createdAt));

  for (const item of sorted) {
    const explicitSessionId = activitySessionId(item);
    if (!explicitSessionId) continue;
    const sessionId = `session_${hashForSessionId(`${item.workspaceId}:${explicitSessionId}`)}`;
    const existing = explicitGroups.get(sessionId);
    if (existing) {
      addToGroup(existing, item);
    } else {
      const group: SessionGroup = { sessionId, sourceKey: explicitSessionId, explicit: true, items: [item], startedAt: item.createdAt, updatedAt: item.createdAt };
      explicitGroups.set(sessionId, group);
      groups.push(group);
    }
  }

  const explicitCandidates = [...explicitGroups.values()];
  for (const item of sorted) {
    if (activitySessionId(item)) continue;
    const explicitGroup = nearestCompatibleExplicitGroup(item, explicitCandidates);
    if (explicitGroup) {
      addToGroup(explicitGroup, item);
      continue;
    }

    const sourceKey = syntheticSourceKey(item);
    const previous = latestSyntheticBySource.get(sourceKey);
    if (previous && withinSyntheticWindow(previous.updatedAt, item.createdAt)) {
      addToGroup(previous, item);
      continue;
    }

    const group: SessionGroup = { sessionId: `synthetic_${hashForSessionId(`${sourceKey}:${item.createdAt}`)}`, sourceKey, explicit: false, items: [item], startedAt: item.createdAt, updatedAt: item.createdAt };
    latestSyntheticBySource.set(sourceKey, group);
    groups.push(group);
  }

  return groups;
}

function addToGroup(group: SessionGroup, item: ActivityItem): void {
  group.items.push(item);
  if (item.createdAt < group.startedAt) group.startedAt = item.createdAt;
  if (item.createdAt > group.updatedAt) group.updatedAt = item.createdAt;
}

function activitySessionId(item: ActivityItem): string | undefined {
  return item.kind === 'request' ? item.request.sessionId : item.kind === 'status_update' ? item.statusUpdate.sessionId : item.toolActivity.sessionId;
}

function syntheticSourceKey(item: ActivityItem): string {
  if (item.kind === 'tool_activity') {
    const tool = item.toolActivity;
    return [item.workspaceId, tool.agentTokenId, tool.agentTokenLabel].filter(Boolean).join('\u001f') || item.workspaceId;
  }
  if (item.kind === 'request') {
    const requester = item.request.requester;
    const stable = [item.workspaceId, item.request.agentTokenId, requester.clientName, requester.host, requester.workingDirectory].filter(Boolean);
    return (stable.length > 1 ? stable : [item.workspaceId, requester.name].filter(Boolean)).join('\u001f') || item.workspaceId;
  }
  const status = item.statusUpdate;
  const stable = [item.workspaceId, status.agentTokenId, status.clientName, status.host, status.workingDirectory].filter(Boolean);
  return (stable.length > 1 ? stable : [item.workspaceId, status.agentTokenLabel].filter(Boolean)).join('\u001f') || item.workspaceId;
}

function nearestCompatibleExplicitGroup(item: ActivityItem, groups: SessionGroup[]): SessionGroup | undefined {
  const itemSourceKey = syntheticSourceKey(item);
  let nearest: { group: SessionGroup; distance: number } | undefined;
  for (const group of groups) {
    if (!group.items.some((candidate) => syntheticSourceKey(candidate) === itemSourceKey)) continue;
    const distance = distanceToSessionWindowMs(group, item.createdAt);
    if (distance > SYNTHETIC_SESSION_WINDOW_MS) continue;
    if (!nearest || distance < nearest.distance) nearest = { group, distance };
  }
  return nearest?.group;
}

function distanceToSessionWindowMs(group: SessionGroup, createdAt: string): number {
  const created = Date.parse(createdAt);
  const started = Date.parse(group.startedAt);
  const updated = Date.parse(group.updatedAt);
  if (!Number.isFinite(created) || !Number.isFinite(started) || !Number.isFinite(updated)) return Number.POSITIVE_INFINITY;
  if (created >= started && created <= updated) return 0;
  return Math.min(Math.abs(created - started), Math.abs(created - updated));
}

function withinSyntheticWindow(previousAt: string, nextAt: string): boolean {
  const previous = Date.parse(previousAt);
  const next = Date.parse(nextAt);
  return Number.isFinite(previous) && Number.isFinite(next) && next - previous <= SYNTHETIC_SESSION_WINDOW_MS;
}

function hashForSessionId(value: string): string {
  return crypto.createHash('sha256').update(value).digest('base64url').slice(0, 16);
}

function summarizeSession(sessionId: string, timeline: ActivityItem[], now: Date): SessionSummary {
  const latestOverall = [...timeline].sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
  if (!latestOverall) throw new Error('Cannot summarize an empty Session');
  const pendingRequests = pendingRequestSummaries(timeline);
  const latest = latestActivityAnchor(timeline, pendingRequests) ?? latestOverall;
  return {
    sessionId,
    title: deriveSessionSummaryTitle(timeline),
    state: deriveSessionState(timeline, now),
    latestActivity: latestActivityPreview(latest),
    pendingRequestCount: pendingRequests.length,
    ...(pendingRequests.length ? { pendingRequests } : {}),
    sourceLabels: sourceLabels(timeline),
    startedAt: timeline[0]?.createdAt ?? latestOverall.createdAt,
    updatedAt: latestOverall.createdAt
  };
}

function pendingRequestSummaries(timeline: ActivityItem[]): SessionPendingRequestSummary[] {
  return timeline
    .filter((item): item is Extract<ActivityItem, { kind: 'request' }> => item.kind === 'request' && item.request.status === 'pending')
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .map((item) => ({
      id: item.request.id,
      title: item.request.title,
      createdAt: item.request.createdAt,
      status: item.request.status,
      ...(item.request.agentWaiter ? { agentWaiter: item.request.agentWaiter } : {})
    }));
}

function latestActivityAnchor(timeline: ActivityItem[], pendingRequests: SessionPendingRequestSummary[]): ActivityItem | undefined {
  const newestPending = pendingRequests[0];
  if (newestPending) return timeline.find((item) => item.kind === 'request' && item.request.id === newestPending.id);
  return [...timeline].reverse().find((item) => item.kind === 'status_update' || item.kind === 'tool_activity');
}

function deriveSessionState(timeline: ActivityItem[], now: Date): SessionState {
  if (timeline.some((item) => item.kind === 'request' && item.request.status === 'pending')) return 'needs-input';
  const latestStatus = [...timeline].reverse().find((item): item is Extract<ActivityItem, { kind: 'status_update' }> => item.kind === 'status_update')?.statusUpdate;
  const semanticState = latestStatus ? semanticStatusUpdateState(latestStatus.state) : undefined;
  if (semanticState === 'failed') return 'failed';
  if (semanticState === 'blocked') return 'blocked';
  if (semanticState === 'done') return 'complete';
  if (semanticState === 'waiting' && latestStatus) return isRecent(latestStatus.createdAt, now, ACTIVE_SESSION_WINDOW_MS) ? 'waiting' : 'recent';
  if (semanticState === 'working' && latestStatus) return isRecent(latestStatus.createdAt, now, ACTIVE_SESSION_WINDOW_MS) ? 'active' : 'recent';
  return 'recent';
}

function isRecent(value: string, now: Date, windowMs: number): boolean {
  const time = Date.parse(value);
  return Number.isFinite(time) && now.getTime() - time <= windowMs;
}

function latestActivityPreview(item: ActivityItem): SessionLatestActivity {
  if (item.kind === 'request') {
    return {
      kind: 'request',
      id: item.id,
      createdAt: item.createdAt,
      preview: item.request.title,
      requestStatus: item.request.status,
      ...(item.request.agentWaiter ? { agentWaiter: item.request.agentWaiter } : {})
    };
  }
  if (item.kind === 'tool_activity') {
    return {
      kind: 'tool_activity',
      id: item.id,
      createdAt: item.createdAt,
      preview: item.toolActivity.summary ?? `Tool activity: ${item.toolActivity.toolName}`,
      state: item.toolActivity.outcome ?? item.toolActivity.state
    };
  }
  return {
    kind: 'status_update',
    id: item.id,
    createdAt: item.createdAt,
    preview: item.statusUpdate.message,
    state: item.statusUpdate.state
  };
}

function sourceLabels(timeline: ActivityItem[]): string[] {
  const labels = new Set<string>();
  for (const item of timeline) {
    if (item.kind === 'request') {
      addLabel(labels, item.request.requester.clientName);
      addLabel(labels, item.request.requester.name);
      addLabel(labels, item.request.requester.host);
    } else if (item.kind === 'tool_activity') {
      addLabel(labels, item.toolActivity.agentTokenLabel);
    } else {
      addLabel(labels, item.statusUpdate.clientName);
      addLabel(labels, item.statusUpdate.agentTokenLabel);
      addLabel(labels, item.statusUpdate.host);
    }
  }
  return [...labels].slice(0, 4);
}

function addLabel(labels: Set<string>, value: string | undefined): void {
  const label = value?.trim();
  if (label) labels.add(label);
}

function sessionSortKey(summary: SessionSummary): string {
  const priority = { 'needs-input': 0, failed: 1, blocked: 2, active: 3, waiting: 4, recent: 5, complete: 6 }[summary.state] ?? 9;
  return `${String(priority).padStart(2, '0')}:${String(9999999999999 - Date.parse(summary.updatedAt)).padStart(13, '0')}`;
}
