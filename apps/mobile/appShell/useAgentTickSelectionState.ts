import type { useActiveMobileConnectionIdentity } from "./useActiveMobileConnectionIdentity";
import type { useAgentTickAppState } from "./useAgentTickAppState";
import { useMobileSelectionState } from "./useMobileSelectionState";

type AgentTickAppState = ReturnType<typeof useAgentTickAppState>;

type UseAgentTickSelectionStateInput = {
  activeConnectionIdentity: ReturnType<typeof useActiveMobileConnectionIdentity>;
  activityState: AgentTickAppState["activityState"];
  connectionAccountState: AgentTickAppState["connectionAccountState"];
};

export function useAgentTickSelectionState({
  activeConnectionIdentity,
  activityState,
  connectionAccountState,
}: UseAgentTickSelectionStateInput) {
  return useMobileSelectionState({
    activeClerkSessionID: activeConnectionIdentity.activeClerkSessionID,
    currentAccountProfile: connectionAccountState.currentAccountProfile,
    deviceID: connectionAccountState.deviceID,
    requests: activityState.requests,
    runtimeAuthProvider: connectionAccountState.runtimeAuthConfig?.authProvider,
    savedAccounts: connectionAccountState.savedAccounts,
    selectedID: activityState.selectedID,
    selectedSourceID: activityState.selectedSourceID,
    selectedWorkspaceID: connectionAccountState.selectedWorkspaceID,
    serverURL: connectionAccountState.serverURL,
    token: connectionAccountState.token,
    workspaces: connectionAccountState.workspaces,
  });
}
