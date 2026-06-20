import { translateSource } from "@agent-tick/i18n";
import type { SessionDetail, StatusUpdateRecord } from "@self-deprecated/agent-tick-sdk";
import type { ActivityItem, ToolActivityRecord } from "@self-deprecated/agent-tick-shared";
import { canRespondToRequest, normalizeRequest, requestStatusLabel, type MobileRequest } from "../requests";

export type TimelineRenderWindow = { start: number; end: number };

type TimelineRenderGroupBounds = { start: number; end: number; requestId?: string };

export const SESSION_TIMELINE_INITIAL_RENDER_COUNT = 28;
export const SESSION_TIMELINE_RENDER_INCREMENT = 18;
export const SESSION_TIMELINE_CONTENT_TOP_PADDING = 14;

export function sessionTimelineItemCreatedAt(item: ActivityItem): string {
  return item.kind === "request" ? item.request.createdAt : item.kind === "status_update" ? item.statusUpdate.createdAt : item.toolActivity.createdAt;
}

export function sessionTimelineItemKey(item: ActivityItem): string {
  return item.kind === "request" ? `request:${item.request.id}` : item.kind === "status_update" ? `status:${item.statusUpdate.statusId}` : `tool:${item.toolActivity.toolActivityId}`;
}

export function orderedSessionTimeline(detail: SessionDetail): ActivityItem[] {
  return [...detail.timeline].sort((left, right) => {
    const leftTime = new Date(sessionTimelineItemCreatedAt(left)).getTime();
    const rightTime = new Date(sessionTimelineItemCreatedAt(right)).getTime();
    if (leftTime !== rightTime) return leftTime - rightTime;
    return sessionTimelineItemKey(left).localeCompare(sessionTimelineItemKey(right));
  });
}

export function newestActionableRequestID(timeline: ActivityItem[]): string | null {
  for (let index = timeline.length - 1; index >= 0; index -= 1) {
    const item = timeline[index];
    if (!item || item.kind !== "request") continue;
    const request = normalizeRequest(item.request);
    if (canRespondToRequest(request)) return request.id;
  }
  return null;
}

export function shouldAutoFocusSessionTimelineNewActivity(input: { userIdle: boolean; userAtTimelineEnd: boolean }): boolean {
  return input.userIdle || input.userAtTimelineEnd;
}

function timelineRenderGroupBounds(timeline: ActivityItem[]): TimelineRenderGroupBounds[] {
  const groups: TimelineRenderGroupBounds[] = [];
  let current: { kind: "tool"; start: number; toolGroupKey?: string } | undefined;
  let segmentIndex = 0;
  const flush = (end: number) => {
    if (!current) return;
    groups.push({ start: current.start, end });
    current = undefined;
  };

  for (let index = 0; index < timeline.length; index += 1) {
    const item = timeline[index];
    if (!item) continue;
    if (item.kind === "status_update") {
      flush(index);
      groups.push({ start: index, end: index + 1 });
      continue;
    }
    if (item.kind === "tool_activity") {
      const toolGroupKey = item.toolActivity.turnId ? `turn:${item.toolActivity.turnId}` : `segment:${segmentIndex}`;
      if (current?.kind !== "tool" || current.toolGroupKey !== toolGroupKey) {
        flush(index);
        current = { kind: "tool", start: index, toolGroupKey };
      }
      continue;
    }
    flush(index);
    groups.push({ start: index, end: index + 1, requestId: normalizeRequest(item.request).id });
    segmentIndex += 1;
  }
  flush(timeline.length);
  return groups;
}

export function sessionTimelineRenderWindow(timeline: ActivityItem[], focusedRequestID: string | null): TimelineRenderWindow {
  const groups = timelineRenderGroupBounds(timeline);
  if (groups.length <= SESSION_TIMELINE_INITIAL_RENDER_COUNT) return { start: 0, end: timeline.length };
  const focusedGroupIndex = focusedRequestID
    ? groups.findIndex((group) => group.requestId === focusedRequestID)
    : -1;
  if (focusedGroupIndex >= 0) {
    const startGroup = Math.max(0, focusedGroupIndex - 4);
    const endGroup = Math.min(groups.length, Math.max(startGroup + SESSION_TIMELINE_INITIAL_RENDER_COUNT, focusedGroupIndex + 16));
    const adjustedStartGroup = Math.max(0, Math.min(startGroup, Math.max(0, endGroup - SESSION_TIMELINE_INITIAL_RENDER_COUNT)));
    return { start: groups[adjustedStartGroup]?.start ?? 0, end: groups[endGroup - 1]?.end ?? timeline.length };
  }
  const startGroup = Math.max(0, groups.length - SESSION_TIMELINE_INITIAL_RENDER_COUNT);
  return { start: groups[startGroup]?.start ?? 0, end: timeline.length };
}

export type SessionToolActivityGroup = { key: string; toolActivities: ToolActivityRecord[] };

export type SessionTimelineRenderItem =
  | { kind: "status_group"; key: string; statusUpdates: StatusUpdateRecord[] }
  | { kind: "tool_activity_group"; group: SessionToolActivityGroup }
  | { kind: "request"; timelineItem: Extract<ActivityItem, { kind: "request" }>; request: Extract<ActivityItem, { kind: "request" }>["request"] };

export function groupSessionTimelineItems(timeline: ActivityItem[]): SessionTimelineRenderItem[] {
  const items: SessionTimelineRenderItem[] = [];
  let statusUpdates: StatusUpdateRecord[] = [];
  let toolActivities: ToolActivityRecord[] = [];
  let segmentIndex = 0;
  let currentToolGroupKey = "";
  const flushStatusUpdates = () => {
    if (statusUpdates.length === 0) return;
    const first = statusUpdates[0];
    items.push({ kind: "status_group", key: `status:${first?.statusId ?? "first"}`, statusUpdates });
    statusUpdates = [];
  };
  const flushToolActivities = () => {
    if (toolActivities.length === 0) return;
    const first = toolActivities[0];
    items.push({ kind: "tool_activity_group", group: { key: `tools:${currentToolGroupKey}:${first?.toolActivityId ?? "first"}`, toolActivities } });
    toolActivities = [];
    currentToolGroupKey = "";
  };

  for (const item of timeline) {
    if (item.kind === "status_update") {
      flushToolActivities();
      statusUpdates.push(item.statusUpdate);
      continue;
    }
    if (item.kind === "tool_activity") {
      flushStatusUpdates();
      const groupKey = item.toolActivity.turnId ? `turn:${item.toolActivity.turnId}` : `segment:${segmentIndex}`;
      if (toolActivities.length > 0 && groupKey !== currentToolGroupKey) flushToolActivities();
      currentToolGroupKey = groupKey;
      toolActivities.push(item.toolActivity);
      continue;
    }
    flushStatusUpdates();
    flushToolActivities();
    items.push({ kind: "request", timelineItem: item, request: item.request });
    segmentIndex += 1;
  }
  flushStatusUpdates();
  flushToolActivities();
  return items;
}

export function toolActivityNameCounts(toolActivities: ToolActivityRecord[]): Array<{ name: string; count: number }> {
  const toolCallsByName = new Map<string, Set<string>>();
  for (const activity of toolActivities) {
    const set = toolCallsByName.get(activity.toolName) ?? new Set<string>();
    set.add(activity.toolCallId || activity.toolActivityId);
    toolCallsByName.set(activity.toolName, set);
  }
  return [...toolCallsByName.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([name, calls]) => ({ name, count: calls.size }));
}

export function toolActivityCountsLabel(toolActivities: ToolActivityRecord[]): string {
  return toolActivityNameCounts(toolActivities).map(({ name, count }) => `${name} ×${count}`).join(", ");
}

type ToolActivityCallRollup = {
  key: string;
  toolName: string;
  hasStarted: boolean;
  hasFinished: boolean;
  outcome?: "success" | "failed" | "cancelled";
};

function toolActivityCallRollups(toolActivities: ToolActivityRecord[]): ToolActivityCallRollup[] {
  const calls = new Map<string, ToolActivityCallRollup>();
  const ordered = [...toolActivities].sort((left, right) => {
    const leftTime = new Date(left.createdAt).getTime();
    const rightTime = new Date(right.createdAt).getTime();
    if (leftTime !== rightTime) return leftTime - rightTime;
    return left.toolActivityId.localeCompare(right.toolActivityId);
  });
  for (const activity of ordered) {
    const key = activity.toolCallId || activity.toolActivityId;
    const previous = calls.get(key);
    calls.set(key, {
      key,
      toolName: previous?.toolName ?? activity.toolName,
      hasStarted: Boolean(previous?.hasStarted || activity.state === "started"),
      hasFinished: Boolean(previous?.hasFinished || activity.state === "finished"),
      outcome: activity.outcome ?? previous?.outcome,
    });
  }
  return [...calls.values()];
}

export function toolActivityCallCount(toolActivities: ToolActivityRecord[]): number {
  return toolActivityCallRollups(toolActivities).length;
}

export function toolActivityCallCountLabel(toolActivities: ToolActivityRecord[]): string {
  const count = toolActivityCallCount(toolActivities);
  return `${count} ${count === 1 ? translateSource("tool call") : translateSource("tool calls")}`;
}

export function toolActivityGroupInProgress(toolActivities: ToolActivityRecord[]): boolean {
  return toolActivityCallRollups(toolActivities).some((call) => call.hasStarted && !call.hasFinished);
}

function countLabel(count: number, singular: string, plural: string): string | undefined {
  return count > 0 ? `${count} ${translateSource(count === 1 ? singular : plural)}` : undefined;
}

export function toolActivityGroupOutcomeLabel(toolActivities: ToolActivityRecord[]): string {
  const calls = toolActivityCallRollups(toolActivities);
  const running = calls.filter((call) => call.hasStarted && !call.hasFinished).length;
  const failed = calls.filter((call) => call.outcome === "failed").length;
  const cancelled = calls.filter((call) => call.outcome === "cancelled").length;
  const completed = Math.max(0, calls.length - running - failed - cancelled);
  const exceptional = [
    countLabel(running, "running", "running"),
    countLabel(failed, "failed", "failed"),
    countLabel(cancelled, "cancelled", "cancelled"),
  ].filter(Boolean) as string[];
  if (exceptional.length > 0) {
    const completedLabel = countLabel(completed, "completed", "completed");
    return [...exceptional, ...(completedLabel ? [completedLabel] : [])].join(", ");
  }
  if (calls.length === 1) return translateSource("Completed");
  return `${calls.length} ${translateSource("completed")}`;
}

export function requestChoiceLabel(request: MobileRequest, choiceID?: string): string {
  if (!choiceID) return "";
  return request.choices?.find((choice) => choice.id === choiceID)?.label || choiceID;
}

export function requestAnswerSummary(request: MobileRequest): string {
  const answers = request.response?.answers;
  if (answers && Object.keys(answers).length > 0) {
    const selected = Object.values(answers).flat().filter(Boolean);
    return selected.length ? selected.join(", ") : translateSource("Answered");
  }
  const choiceLabel = requestChoiceLabel(request, request.response?.choiceId);
  if (choiceLabel) return choiceLabel;
  if (request.response?.message?.trim()) return request.response.message.trim();
  const responses = request.quorum?.responses ?? request.responses ?? [];
  const responseChoice = responses.find((response) => response.choiceId)?.choiceId;
  const responseChoiceLabel = requestChoiceLabel(request, responseChoice);
  if (responseChoiceLabel) return responseChoiceLabel;
  return requestStatusLabel(request);
}
