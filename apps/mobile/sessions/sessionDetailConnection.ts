import { type ActivityItem } from "@self-deprecated/agent-tick-shared";
import { type SessionDetail, type SessionSummary } from "@self-deprecated/agent-tick-sdk";

import { mobileSessionKey } from "../AppLogic";
import { normalizeRequest, type MobileRequest } from "../requests";
import type { MobileSessionDetail, MobileSessionSummary } from "../mobileTypes";

export function toMobileSessionSummary(session: SessionSummary, context: Omit<MobileSessionSummary, keyof SessionSummary | "mobileSessionKey"> = {}): MobileSessionSummary {
  const summary = { ...session, ...context };
  return { ...summary, mobileSessionKey: mobileSessionKey(summary) };
}

export function updateSessionDetailsRequest(
  details: Record<string, MobileSessionDetail | undefined>,
  original: Pick<MobileRequest, "id" | "connectionID" | "workspaceId">,
  updated: MobileRequest,
): Record<string, MobileSessionDetail | undefined> {
  let changed = false;
  const next = Object.fromEntries(Object.entries(details).map(([sessionKey, detail]) => {
    if (!detail) return [sessionKey, detail] as const;
    let detailChanged = false;
    const timeline = detail.timeline.map((item): ActivityItem => {
      if (item.kind !== "request") return item;
      const request = normalizeRequest(item.request);
      const matches = request.id === original.id &&
        (!original.connectionID || request.connectionID === original.connectionID) &&
        (!original.workspaceId || request.workspaceId === original.workspaceId);
      if (!matches) return item;
      detailChanged = true;
      return { ...item, request: { ...updated } } as ActivityItem;
    });
    if (!detailChanged) return [sessionKey, detail] as const;
    changed = true;
    return [sessionKey, { ...detail, timeline }] as const;
  }));
  return changed ? next : details;
}

export function attachSessionDetailConnection(detail: SessionDetail, summary: MobileSessionSummary): MobileSessionDetail {
  const timeline = detail.timeline.map((item): ActivityItem => {
    if (item.kind !== "request") return item;
    return {
      ...item,
      request: {
        ...item.request,
        ...(summary.connectionID ? { connectionID: summary.connectionID } : {}),
        ...(summary.connectionLabel ? { connectionLabel: summary.connectionLabel } : {}),
        ...(summary.connectionServerURL ? { connectionServerURL: summary.connectionServerURL } : {}),
      },
    } as ActivityItem;
  });
  return {
    ...detail,
    timeline,
    ...(summary.connectionID ? { connectionID: summary.connectionID } : {}),
    ...(summary.connectionLabel ? { connectionLabel: summary.connectionLabel } : {}),
    ...(summary.connectionServerURL ? { connectionServerURL: summary.connectionServerURL } : {}),
    ...(summary.workspaceID !== undefined ? { workspaceID: summary.workspaceID } : {}),
  };
}
