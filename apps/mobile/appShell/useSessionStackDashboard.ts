import { useCallback, useMemo, type Dispatch, type SetStateAction } from "react";
import { Alert } from "react-native";
import type { StatusUpdateRecord } from "@self-deprecated/agent-tick-sdk";
import { translateSource } from "@agent-tick/i18n";

import type { MobileRequest } from "../requests";
import {
  archiveSession,
  isSessionArchivedInStack,
  orderSessionStackSummaries,
  setSessionStackPreferences,
  setVisibleSessionLaneSizes,
  sessionStackSessionKey,
  type SessionLaneSize,
  type SessionStackLocalState,
} from "../sessionStackState";
import { synthesizeSessionlessActivityStack } from "../sessions/sessionlessActivityStack";
import type { MobileSessionDetail, MobileSessionSummary } from "../mobileTypes";

type UseSessionStackDashboardInput = {
  requests: MobileRequest[];
  statusUpdates: StatusUpdateRecord[];
  sessionSummaries: MobileSessionSummary[];
  selectedSessionID: string | null;
  sessionDetails: Record<string, MobileSessionDetail | undefined>;
  sessionStackLocalState: SessionStackLocalState;
  setSessionStackLocalState: Dispatch<SetStateAction<SessionStackLocalState>>;
  setSelectedSessionID: Dispatch<SetStateAction<string | null>>;
};

export function useSessionStackDashboard({
  requests,
  statusUpdates,
  sessionSummaries,
  selectedSessionID,
  sessionDetails,
  sessionStackLocalState,
  setSessionStackLocalState,
  setSelectedSessionID,
}: UseSessionStackDashboardInput) {
  const visibleSessionSummaries = useMemo(() => orderSessionStackSummaries(sessionStackLocalState, sessionSummaries.filter((session) => !isSessionArchivedInStack(sessionStackLocalState, session))), [sessionStackLocalState, sessionSummaries]);
  const sessionlessActivityStack = useMemo(() => sessionSummaries.length === 0 ? synthesizeSessionlessActivityStack(requests, statusUpdates) : { summaries: [], details: {} }, [requests, sessionSummaries.length, statusUpdates]);
  const dashboardSessionSummaries = visibleSessionSummaries.length > 0 ? visibleSessionSummaries : sessionSummaries.length === 0 ? sessionlessActivityStack.summaries : [];
  const dashboardSessionDetails = sessionSummaries.length === 0 ? { ...sessionDetails, ...sessionlessActivityStack.details } : sessionDetails;
  const selectedVisibleSessionSummary = selectedSessionID ? visibleSessionSummaries.find((session) => sessionStackSessionKey(session) === selectedSessionID) : null;
  const archiveSelectedSession = useCallback((session: MobileSessionSummary) => {
    Alert.alert(
      translateSource("Archive this Session?"),
      translateSource("Archived Sessions are hidden from the main stack until new Activity arrives."),
      [
        { text: translateSource("Cancel"), style: "cancel" },
        {
          text: translateSource("Archive Session"),
          style: "destructive",
          onPress: () => {
            setSessionStackLocalState((current) => archiveSession(current, session));
            setSelectedSessionID(null);
          },
        },
      ],
    );
  }, [setSelectedSessionID, setSessionStackLocalState]);
  const archiveVisibleSessionStack = useCallback(() => {
    const sessionsToArchive = visibleSessionSummaries;
    if (sessionsToArchive.length === 0) return;
    Alert.alert(
      translateSource("Clear Session Stack?"),
      translateSource("This hides every visible Session Lane from the stack until new Activity arrives."),
      [
        { text: translateSource("Cancel"), style: "cancel" },
        {
          text: translateSource("Archive all"),
          style: "destructive",
          onPress: () => {
            setSessionStackLocalState((current) => sessionsToArchive.reduce((next, session) => archiveSession(next, session), current));
            setSelectedSessionID(null);
          },
        },
      ],
    );
  }, [setSelectedSessionID, setSessionStackLocalState, visibleSessionSummaries]);
  const setVisibleSessionStackSize = useCallback((size?: SessionLaneSize) => {
    const sessions = visibleSessionSummaries;
    if (sessions.length === 0) return;
    setSessionStackLocalState((current) => setVisibleSessionLaneSizes(current, sessions, size));
  }, [setSessionStackLocalState, visibleSessionSummaries]);
  const toggleSessionStackInteractionMode = useCallback(() => {
    setSessionStackLocalState((current) => setSessionStackPreferences(current, { interactionMode: current.preferences.interactionMode === "overview" ? "stack" : "overview" }));
  }, [setSessionStackLocalState]);
  const openSessionStackActions = useCallback(() => {
    if (visibleSessionSummaries.length === 0) return;
    Alert.alert(
      translateSource("Session Stack actions"),
      translateSource("Adjust visible Session Lanes or archive the stack."),
      [
        { text: translateSource("Cancel"), style: "cancel" },
        { text: translateSource("Expand all"), onPress: () => setVisibleSessionStackSize("normal") },
        { text: translateSource("Collapse all"), onPress: () => setVisibleSessionStackSize("collapsed") },
        { text: translateSource("Auto size"), onPress: () => setVisibleSessionStackSize(undefined) },
        { text: translateSource("Archive all"), style: "destructive", onPress: archiveVisibleSessionStack },
      ],
    );
  }, [archiveVisibleSessionStack, setVisibleSessionStackSize, visibleSessionSummaries.length]);
  const openSessionActions = useCallback(() => {
    if (selectedVisibleSessionSummary) {
      archiveSelectedSession(selectedVisibleSessionSummary);
      return;
    }
    openSessionStackActions();
  }, [archiveSelectedSession, openSessionStackActions, selectedVisibleSessionSummary]);

  return {
    visibleSessionSummaries,
    sessionlessActivityStack,
    dashboardSessionSummaries,
    dashboardSessionDetails,
    selectedVisibleSessionSummary,
    archiveSelectedSession,
    archiveVisibleSessionStack,
    setVisibleSessionStackSize,
    toggleSessionStackInteractionMode,
    openSessionStackActions,
    openSessionActions,
  };
}
