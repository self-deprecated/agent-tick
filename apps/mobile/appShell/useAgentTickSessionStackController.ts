import type { useActiveMobileConnectionIdentity } from "./useActiveMobileConnectionIdentity";
import type { useAgentTickAppState } from "./useAgentTickAppState";
import { useSessionSelectionSync } from "./useSessionSelectionSync";
import { useSessionStackDashboard } from "./useSessionStackDashboard";
import { useSessionStackPersistence } from "./useSessionStackPersistence";

type AgentTickAppState = ReturnType<typeof useAgentTickAppState>;

type UseAgentTickSessionStackControllerInput = {
  activeConnectionIdentity: ReturnType<typeof useActiveMobileConnectionIdentity>;
  activityState: AgentTickAppState["activityState"];
  appStatusState: AgentTickAppState["appStatusState"];
  connectionAccountState: AgentTickAppState["connectionAccountState"];
  notificationTargetState: AgentTickAppState["notificationTargetState"];
};

export function useAgentTickSessionStackController({
  activeConnectionIdentity,
  activityState,
  appStatusState,
  connectionAccountState,
  notificationTargetState,
}: UseAgentTickSessionStackControllerInput) {
  const sessionStackPersistence = useSessionStackPersistence({
    serverURL: connectionAccountState.serverURL,
    activeConnectionID: activeConnectionIdentity.activeConnectionID,
    currentAccountProfile: connectionAccountState.currentAccountProfile,
    deviceID: connectionAccountState.deviceID,
    selectedWorkspaceID: connectionAccountState.selectedWorkspaceID,
    settingsLoaded: appStatusState.settingsLoaded,
  });

  const sessionStackDashboard = useSessionStackDashboard({
    requests: activityState.requests,
    statusUpdates: activityState.statusUpdates,
    sessionSummaries: activityState.sessionSummaries,
    selectedSessionID: activityState.selectedSessionID,
    sessionDetails: activityState.sessionDetails,
    sessionStackLocalState: sessionStackPersistence.sessionStackLocalState,
    setSessionStackLocalState: sessionStackPersistence.setSessionStackLocalState,
    setSelectedSessionID: activityState.setSelectedSessionID,
  });

  useSessionSelectionSync({
    sessionSummaries: activityState.sessionSummaries,
    dashboardSessionSummaries: sessionStackDashboard.dashboardSessionSummaries,
    notificationTargetSessionID: notificationTargetState.notificationTargetSessionID,
    setSessionStackLocalState: sessionStackPersistence.setSessionStackLocalState,
    setSelectedSessionID: activityState.setSelectedSessionID,
  });

  return { sessionStackDashboard, sessionStackPersistence };
}
