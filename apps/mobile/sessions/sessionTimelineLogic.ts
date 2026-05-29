import { translateSource } from "@agent-tick/i18n";
import type { SessionDetail, StatusUpdateRecord } from "@self-deprecated/agent-tick-sdk";
import type { ActivityItem } from "@self-deprecated/agent-tick-shared";
import { canRespondToRequest, normalizeRequest, requestStatusLabel, type MobileRequest } from "../requests";

export type TimelineRenderWindow = { start: number; end: number };

export const SESSION_TIMELINE_INITIAL_RENDER_COUNT = 28;
export const SESSION_TIMELINE_RENDER_INCREMENT = 18;
export const SESSION_TIMELINE_CONTENT_TOP_PADDING = 14;

export function sessionTimelineItemCreatedAt(item: ActivityItem): string {
  return item.kind === "request" ? item.request.createdAt : item.statusUpdate.createdAt;
}

export function sessionTimelineItemKey(item: ActivityItem): string {
  return item.kind === "request" ? `request:${item.request.id}` : `status:${item.statusUpdate.statusId}`;
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

export function sessionTimelineRenderWindow(timeline: ActivityItem[], focusedRequestID: string | null): TimelineRenderWindow {
  if (timeline.length <= SESSION_TIMELINE_INITIAL_RENDER_COUNT) return { start: 0, end: timeline.length };
  const focusedIndex = focusedRequestID
    ? timeline.findIndex((item) => item.kind === "request" && normalizeRequest(item.request).id === focusedRequestID)
    : -1;
  if (focusedIndex >= 0) {
    const start = Math.max(0, focusedIndex - 4);
    const end = Math.min(timeline.length, Math.max(start + SESSION_TIMELINE_INITIAL_RENDER_COUNT, focusedIndex + 16));
    return { start: Math.max(0, Math.min(start, Math.max(0, end - SESSION_TIMELINE_INITIAL_RENDER_COUNT))), end };
  }
  return { start: Math.max(0, timeline.length - SESSION_TIMELINE_INITIAL_RENDER_COUNT), end: timeline.length };
}

export type SessionTimelineRenderItem =
  | { kind: "status_group"; key: string; statusUpdates: StatusUpdateRecord[] }
  | { kind: "request"; timelineItem: Extract<ActivityItem, { kind: "request" }>; request: Extract<ActivityItem, { kind: "request" }>["request"] };

export function groupSessionTimelineItems(timeline: ActivityItem[]): SessionTimelineRenderItem[] {
  const items: SessionTimelineRenderItem[] = [];
  let statusUpdates: StatusUpdateRecord[] = [];
  const flushStatusUpdates = () => {
    if (statusUpdates.length === 0) return;
    const first = statusUpdates[0];
    const last = statusUpdates[statusUpdates.length - 1];
    items.push({ kind: "status_group", key: `status:${first?.statusId ?? "first"}:${last?.statusId ?? "last"}:${statusUpdates.length}`, statusUpdates });
    statusUpdates = [];
  };

  for (const item of timeline) {
    if (item.kind === "status_update") {
      statusUpdates.push(item.statusUpdate);
      continue;
    }
    flushStatusUpdates();
    items.push({ kind: "request", timelineItem: item, request: item.request });
  }
  flushStatusUpdates();
  return items;
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
