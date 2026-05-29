import { useEffect } from "react";
import { AppState } from "react-native";

import { isRefreshableRequestWaiter } from "../RequestWaiterLiveness";
import { sessionStackSessionKey } from "../sessionStackState";
import type { MobileSessionSummary } from "../mobileTypes";
import type { MobileRequest } from "../requests";
import { sessionHasRefreshableWaiter } from "./mobileActivityHelpers";

export type UseWaiterLivenessRefreshOptions = {
  settingsLoaded: boolean;
  hasRequestAuth: boolean;
  requests: MobileRequest[];
  dashboardSessionSummaries: MobileSessionSummary[];
  selectedSessionID: string | null;
  sessionSummaries: MobileSessionSummary[];
  load: (options?: { visible?: boolean }) => Promise<void>;
  loadSessionDetailForSummary: (summary: MobileSessionSummary, cancelled: () => boolean) => Promise<void>;
};

export function useWaiterLivenessRefresh({
  settingsLoaded,
  hasRequestAuth,
  requests,
  dashboardSessionSummaries,
  selectedSessionID,
  sessionSummaries,
  load,
  loadSessionDetailForSummary,
}: UseWaiterLivenessRefreshOptions) {
  useEffect(() => {
    if (!settingsLoaded || !hasRequestAuth) return;
    const hasRefreshableWaiter = requests.some((request) => request.status === "pending" && isRefreshableRequestWaiter(request.agentWaiter)) || dashboardSessionSummaries.some(sessionHasRefreshableWaiter);
    if (!hasRefreshableWaiter) return;
    let cancelled = false;
    const refreshWaiterLiveness = () => {
      if (AppState.currentState !== "active") return;
      void load({ visible: false });
      const selectedSummary = selectedSessionID ? sessionSummaries.find((summary) => sessionStackSessionKey(summary) === selectedSessionID) : null;
      if (selectedSummary) void loadSessionDetailForSummary(selectedSummary, () => cancelled);
    };
    const timer = setInterval(refreshWaiterLiveness, 30_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [dashboardSessionSummaries, hasRequestAuth, load, loadSessionDetailForSummary, requests, selectedSessionID, sessionSummaries, settingsLoaded]);
}
