import { translateSource } from "@agent-tick/i18n";
import type { SessionSummary, StatusUpdateRecord } from "@self-deprecated/agent-tick-sdk";
import { semanticStatusUpdateState, type ActivityItem } from "@self-deprecated/agent-tick-shared";
import { mobileSessionKey } from "../AppLogic";
import type { MobileSessionDetail, MobileSessionSummary } from "../mobileTypes";
import type { MobileRequest } from "../requests";
import { sessionStackSessionKey } from "../sessionStackState";

function toMobileSessionSummary(session: SessionSummary, context: Omit<MobileSessionSummary, keyof SessionSummary | "mobileSessionKey"> = {}): MobileSessionSummary {
  const summary = { ...session, ...context };
  return { ...summary, mobileSessionKey: mobileSessionKey(summary) };
}

export function synthesizeSessionlessActivityStack(requests: MobileRequest[], statusUpdates: StatusUpdateRecord[]): { summaries: MobileSessionSummary[]; details: Record<string, MobileSessionDetail> } {
  const requestSummaries = requests.map((request) => sessionlessRequestSession(request));
  const requestStatusIDs = new Set(requests.map((request) => request.id));
  const statusSummaries = statusUpdates
    .filter((status) => !requestStatusIDs.has(status.statusId))
    .slice(0, Math.max(1, 5 - requestSummaries.length))
    .map((status) => sessionlessStatusSession(status));
  const entries = [...requestSummaries, ...statusSummaries].sort((left, right) => sessionlessSessionSortKey(left.summary).localeCompare(sessionlessSessionSortKey(right.summary)));
  return {
    summaries: entries.map((entry) => entry.summary),
    details: Object.fromEntries(entries.map((entry) => [sessionStackSessionKey(entry.summary), entry.detail])),
  };
}

function sessionlessRequestSession(request: MobileRequest): { summary: MobileSessionSummary; detail: MobileSessionDetail } {
  const createdAt = request.createdAt || new Date().toISOString();
  const sessionId = request.sessionId?.trim() || `sessionless_request_${safeSessionlessSessionPart(request.connectionID || request.workspaceId || "current")}_${safeSessionlessSessionPart(request.id)}`;
  const context = {
    ...(request.connectionID ? { connectionID: request.connectionID } : {}),
    ...(request.connectionLabel ? { connectionLabel: request.connectionLabel } : {}),
    ...(request.connectionServerURL ? { connectionServerURL: request.connectionServerURL } : {}),
    workspaceID: request.workspaceId,
  };
  const latestActivity = {
    kind: "request" as const,
    id: request.id,
    createdAt,
    preview: request.title,
    requestStatus: request.status,
    ...(request.agentWaiter ? { agentWaiter: request.agentWaiter } : {}),
  };
  const summary = toMobileSessionSummary({
    sessionId,
    title: request.session?.title || requestSessionTitle(request),
    state: request.status === "pending" ? "needs-input" : "recent",
    latestActivity,
    pendingRequestCount: request.status === "pending" ? 1 : 0,
    ...(request.status === "pending" ? { pendingRequests: [{ id: request.id, title: request.title, createdAt, status: request.status, ...(request.agentWaiter ? { agentWaiter: request.agentWaiter } : {}) }] } : {}),
    sourceLabels: sessionlessRequestSourceLabels(request),
    startedAt: createdAt,
    updatedAt: createdAt,
  }, context);
  const item = { kind: "request" as const, id: request.id, workspaceId: request.workspaceId, createdAt, request } as ActivityItem;
  return { summary, detail: { summary, timeline: [item], ...context } };
}

function sessionlessStatusSession(status: StatusUpdateRecord): { summary: MobileSessionSummary; detail: MobileSessionDetail } {
  const createdAt = status.createdAt || new Date().toISOString();
  const sessionId = status.sessionId?.trim() || `sessionless_status_${safeSessionlessSessionPart(status.workspaceId || "current")}_${safeSessionlessSessionPart(status.statusId)}`;
  const displayState = status.state ?? "working";
  const semanticState = status.semanticState ?? semanticStatusUpdateState(displayState);
  const summary = toMobileSessionSummary({
    sessionId,
    title: status.session?.title || statusSessionTitle(status),
    state: sessionlessSessionStateForStatus(semanticState),
    latestActivity: { kind: "status_update", id: status.statusId, createdAt, preview: status.message, state: displayState },
    pendingRequestCount: 0,
    sourceLabels: sessionlessStatusSourceLabels(status),
    startedAt: createdAt,
    updatedAt: createdAt,
  }, { workspaceID: status.workspaceId });
  const item = { kind: "status_update" as const, id: status.statusId, workspaceId: status.workspaceId, createdAt, statusUpdate: status } as ActivityItem;
  return { summary, detail: { summary, timeline: [item], workspaceID: status.workspaceId } };
}

function safeSessionlessSessionPart(value: string): string {
  return value.trim().replace(/[^a-zA-Z0-9_-]+/g, "_").replace(/^_+|_+$/g, "") || "activity";
}

function requestSessionTitle(request: MobileRequest): string {
  const directory = request.requester.workingDirectory?.split("/").filter(Boolean).at(-1);
  return directory || request.requester.clientName || request.requester.name || translateSource("Agent Session");
}

function statusSessionTitle(status: StatusUpdateRecord): string {
  const directory = status.workingDirectory?.split("/").filter(Boolean).at(-1);
  return directory || status.clientName || status.agentTokenLabel || translateSource("Agent Activity");
}

function sessionlessRequestSourceLabels(request: MobileRequest): string[] {
  return uniqueSessionlessLabels([request.requester.clientName, request.requester.name, request.requester.host]);
}

function sessionlessStatusSourceLabels(status: StatusUpdateRecord): string[] {
  return uniqueSessionlessLabels([status.clientName, status.agentTokenLabel, status.host]);
}

function uniqueSessionlessLabels(values: Array<string | undefined>): string[] {
  const labels = new Set<string>();
  for (const value of values) {
    const label = value?.trim();
    if (label) labels.add(label);
  }
  return [...labels].slice(0, 4);
}

function sessionlessSessionStateForStatus(semanticState: string | undefined): MobileSessionSummary["state"] {
  switch (semanticState) {
    case "failed": return "failed";
    case "blocked": return "blocked";
    case "done": return "complete";
    case "waiting": return "waiting";
    case "working": return "active";
    default: return "recent";
  }
}

function sessionlessSessionSortKey(summary: MobileSessionSummary): string {
  const priority = { "needs-input": 0, failed: 1, blocked: 2, active: 3, waiting: 4, recent: 5, complete: 6 }[summary.state] ?? 9;
  return `${String(priority).padStart(2, "0")}:${String(9999999999999 - Date.parse(summary.updatedAt)).padStart(13, "0")}`;
}
