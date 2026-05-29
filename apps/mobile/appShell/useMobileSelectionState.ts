import { useMemo } from "react";
import type { MeResponse, WorkspaceMemberRecord } from "@self-deprecated/agent-tick-sdk";

import { currentSavedAccounts } from "../AppLogic";
import { type RuntimeAuthConfig, type SavedMobileAccount } from "../mobileAuth";
import { mobileRequestMatchesSelection, type MobileRequest } from "../requests";
import { filterRequestsBySource } from "./mobileActivityHelpers";

export function useMobileSelectionState({
  activeClerkSessionID,
  currentAccountProfile,
  deviceID,
  requests,
  runtimeAuthProvider,
  savedAccounts,
  selectedID,
  selectedSourceID,
  selectedWorkspaceID,
  serverURL,
  token,
  workspaces,
}: {
  activeClerkSessionID: string | null;
  currentAccountProfile: MeResponse | null;
  deviceID: string;
  requests: MobileRequest[];
  runtimeAuthProvider?: RuntimeAuthConfig["authProvider"];
  savedAccounts: SavedMobileAccount[];
  selectedID: string | null;
  selectedSourceID: string | null;
  selectedWorkspaceID: string;
  serverURL: string;
  token: string;
  workspaces: WorkspaceMemberRecord[];
}) {
  const visibleRequests = useMemo(
    () => filterRequestsBySource(requests, selectedSourceID),
    [requests, selectedSourceID],
  );

  const selectedWorkspace = workspaces.find((workspace) => workspace.workspaceId === selectedWorkspaceID);
  const selected = useMemo(
    () => visibleRequests.find((request) => mobileRequestMatchesSelection(request, selectedID)) ?? visibleRequests[0],
    [selectedID, visibleRequests],
  );
  const hasRequestAuth = runtimeAuthProvider === "clerk" ? Boolean(selectedWorkspaceID || savedAccounts.length) : Boolean(token || savedAccounts.length);
  const connectedBillingAccounts = useMemo(() => savedAccounts.filter((account) => currentSavedAccounts([account], {
    authProvider: "clerk",
    clerkSessionID: activeClerkSessionID,
    currentAccountProfile,
    deviceID,
    selectedWorkspaceID,
    serverURL,
  }).length === 0), [activeClerkSessionID, currentAccountProfile, deviceID, savedAccounts, selectedWorkspaceID, serverURL]);
  const connectedBillingAccountsKey = connectedBillingAccounts.map((account) => `${account.id}:${account.updatedAt ?? ""}:${account.workspaceID ?? ""}`).join("|");

  return {
    connectedBillingAccounts,
    connectedBillingAccountsKey,
    hasRequestAuth,
    selected,
    selectedWorkspace,
    visibleRequests,
  };
}
