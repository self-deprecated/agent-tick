import type { AgentTickClient, WorkspaceMemberRecord } from "@self-deprecated/agent-tick-sdk";

import { mobileRequestKey, mobileRequestMatchesSelection, requestSourceID, type MobileRequest } from "../requests";
import { isRefreshableRequestWaiter } from "../RequestWaiterLiveness";
import type { AccountPendingState, MobileSessionSummary } from "../mobileTypes";

export function activeWorkspaceMemberCount(members: WorkspaceMemberRecord[]) {
  return members.filter((member) => member.status !== "removed").length;
}

export async function loadWorkspaceMemberCount(client: AgentTickClient, workspaceID?: string | null): Promise<number | undefined> {
  if (!workspaceID) return undefined;
  try {
    return activeWorkspaceMemberCount(await client.listWorkspaceMembers(workspaceID));
  } catch {
    return undefined;
  }
}

export async function workspaceMemberCountsForRequests(client: AgentTickClient, requests: MobileRequest[]): Promise<Record<string, number | undefined>> {
  const workspaceIDs = Array.from(new Set(requests.map((request) => request.workspaceId).filter(Boolean)));
  const entries = await Promise.all(workspaceIDs.map(async (workspaceID) => [workspaceID, await loadWorkspaceMemberCount(client, workspaceID)] as const));
  return Object.fromEntries(entries);
}

export function attachWorkspaceMemberCounts(requests: MobileRequest[], counts: Record<string, number | undefined>) {
  return requests.map((request) => {
    const workspaceMemberCount = counts[request.workspaceId];
    return workspaceMemberCount === undefined ? request : { ...request, workspaceMemberCount };
  });
}

export function decrementReadyAccountPending(current: Record<string, AccountPendingState>, accountID: string): Record<string, AccountPendingState> {
  const pending = current[accountID];
  if (pending?.status !== "ready" || pending.count <= 0) return current;
  return {
    ...current,
    [accountID]: { status: "ready", count: pending.count - 1 },
  };
}

export function filterRequestsBySource(
  requests: MobileRequest[],
  sourceID: string | null,
) {
  if (!sourceID) {
    return requests;
  }
  return requests.filter((request) => requestSourceID(request) === sourceID);
}

export function selectRequestID(
  requests: MobileRequest[],
  notificationTargetID: string | null,
  currentID: string | null,
) {
  if (notificationTargetID) {
    const notificationRequest = requests.find((request) => mobileRequestMatchesSelection(request, notificationTargetID));
    if (notificationRequest) return mobileRequestKey(notificationRequest);
  }
  if (currentID && requests.some((request) => mobileRequestMatchesSelection(request, currentID))) {
    return currentID;
  }
  return requests[0] ? mobileRequestKey(requests[0]) : null;
}

export function isUsableProjectID(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value !== "00000000-0000-0000-0000-000000000000" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  );
}

export function apiStatus(error: unknown): number | undefined {
  const status = (error as { status?: unknown }).status;
  return typeof status === "number" ? status : undefined;
}

export function apiCode(error: unknown): string | undefined {
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

export function sessionHasRefreshableWaiter(summary: Pick<MobileSessionSummary, "pendingRequests" | "latestActivity" | "pendingRequestCount">): boolean {
  if (summary.pendingRequestCount <= 0) return false;
  return Boolean(summary.pendingRequests?.some((request) => isRefreshableRequestWaiter(request.agentWaiter)) || isRefreshableRequestWaiter(summary.latestActivity.agentWaiter));
}
