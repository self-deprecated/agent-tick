import { useEffect, type Dispatch, type SetStateAction } from "react";

import { sessionStackSessionKey, updateStableSessionOrder, type SessionStackLocalState } from "../sessionStackState";
import type { MobileSessionSummary } from "../mobileTypes";

export type UseSessionSelectionSyncOptions = {
  sessionSummaries: MobileSessionSummary[];
  dashboardSessionSummaries: MobileSessionSummary[];
  notificationTargetSessionID: string | null;
  setSessionStackLocalState: Dispatch<SetStateAction<SessionStackLocalState>>;
  setSelectedSessionID: Dispatch<SetStateAction<string | null>>;
};

export function useSessionSelectionSync({
  sessionSummaries,
  dashboardSessionSummaries,
  notificationTargetSessionID,
  setSessionStackLocalState,
  setSelectedSessionID,
}: UseSessionSelectionSyncOptions) {
  useEffect(() => {
    setSessionStackLocalState((current) => updateStableSessionOrder(current, sessionSummaries));
  }, [sessionSummaries, setSessionStackLocalState]);

  useEffect(() => {
    if (dashboardSessionSummaries.length === 0) {
      setSelectedSessionID(null);
      return;
    }
    setSelectedSessionID((current) => {
      const notificationTargetKey = notificationTargetSessionID
        ? dashboardSessionSummaries.find((session) => session.sessionId === notificationTargetSessionID)
        : null;
      if (notificationTargetKey) return sessionStackSessionKey(notificationTargetKey);
      if (current && dashboardSessionSummaries.some((session) => sessionStackSessionKey(session) === current)) return current;
      if (dashboardSessionSummaries.length === 1) return dashboardSessionSummaries[0] ? sessionStackSessionKey(dashboardSessionSummaries[0]) : null;
      return null;
    });
  }, [dashboardSessionSummaries, notificationTargetSessionID, setSelectedSessionID]);
}
