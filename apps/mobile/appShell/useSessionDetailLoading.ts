import { useCallback, useEffect, type Dispatch, type SetStateAction } from "react";
import { AgentTickClient } from "@self-deprecated/agent-tick-sdk";

import { isMobileSessionDetailFresh } from "../AppLogic";
import { diagnosticEvents, recordDiagnostic } from "../diagnostics";
import { getStoredConnectionToken } from "./mobileSessionClientHelpers";
import { decryptMobileSessionDetail } from "../mobilePrivateRequests";
import { attachSessionDetailConnection } from "../sessions/sessionDetailConnection";
import { sessionStackSessionKey } from "../sessionStackState";
import type { SavedMobileAccount } from "../mobileAuth";
import type { MobileSessionDetail, MobileSessionSummary } from "../mobileTypes";
import { apiStatus } from "./mobileActivityHelpers";
import { hashDiagnosticID } from "./clerkSessionHelpers";

export type UseSessionDetailLoadingOptions = {
  sdk: AgentTickClient;
  savedAccounts: SavedMobileAccount[];
  deviceID: string;
  hasRequestAuth: boolean;
  selectedSessionID: string | null;
  sessionSummaries: MobileSessionSummary[];
  sessionDetails: Record<string, MobileSessionDetail | undefined>;
  visibleSessionSummaries: MobileSessionSummary[];
  setSessionDetails: Dispatch<SetStateAction<Record<string, MobileSessionDetail | undefined>>>;
  setDiagnosticsEventCount: Dispatch<SetStateAction<number>>;
};

export function useSessionDetailLoading({
  sdk,
  savedAccounts,
  deviceID,
  hasRequestAuth,
  selectedSessionID,
  sessionSummaries,
  sessionDetails,
  visibleSessionSummaries,
  setSessionDetails,
  setDiagnosticsEventCount,
}: UseSessionDetailLoadingOptions) {
  const loadSessionDetailForSummary = useCallback(async (summary: MobileSessionSummary, cancelled: () => boolean) => {
    try {
      let detailClient = sdk;
      if (summary.connectionID) {
        const connection = savedAccounts.find((account) => account.id === summary.connectionID);
        const connectionToken = connection ? await getStoredConnectionToken(connection) : null;
        if (!connection || !connectionToken) return;
        detailClient = new AgentTickClient({
          baseUrl: connection.serverURL,
          tokenProvider: () => connectionToken,
          workspaceIdProvider: () => summary.workspaceID || connection.workspaceID || null,
        });
      }
      const detail = await detailClient.getSession(summary.sessionId, { workspaceId: summary.workspaceID || undefined, limit: 100 });
      const connectedDetail = attachSessionDetailConnection(detail, summary);
      const decryptedDetail = await decryptMobileSessionDetail(connectedDetail, { activeDeviceID: deviceID || undefined, savedAccounts });
      if (cancelled()) return;
      setSessionDetails((current) => ({ ...current, [sessionStackSessionKey(summary)]: decryptedDetail }));
    } catch (err) {
      recordDiagnostic("warn", "sessions", "detail_load_failed", { sessionIDHash: hashDiagnosticID(summary.sessionId), message: err instanceof Error ? err.message : String(err), status: apiStatus(err) });
      setDiagnosticsEventCount(diagnosticEvents().length);
    }
  }, [deviceID, savedAccounts, sdk, setDiagnosticsEventCount, setSessionDetails]);

  useEffect(() => {
    if (!selectedSessionID || !hasRequestAuth) return;
    const summary = sessionSummaries.find((session) => sessionStackSessionKey(session) === selectedSessionID);
    if (!summary) return;
    if (isMobileSessionDetailFresh(summary, sessionDetails[selectedSessionID])) return;
    let cancelled = false;
    void loadSessionDetailForSummary(summary, () => cancelled);
    return () => {
      cancelled = true;
    };
  }, [hasRequestAuth, loadSessionDetailForSummary, selectedSessionID, sessionDetails, sessionSummaries]);

  useEffect(() => {
    if (!hasRequestAuth || selectedSessionID) return;
    const summariesNeedingDetail = visibleSessionSummaries
      .filter((summary) => !isMobileSessionDetailFresh(summary, sessionDetails[sessionStackSessionKey(summary)]))
      .slice(0, 8);
    if (summariesNeedingDetail.length === 0) return;
    let cancelled = false;
    for (const summary of summariesNeedingDetail) {
      void loadSessionDetailForSummary(summary, () => cancelled);
    }
    return () => {
      cancelled = true;
    };
  }, [hasRequestAuth, loadSessionDetailForSummary, selectedSessionID, sessionDetails, visibleSessionSummaries]);

  return { loadSessionDetailForSummary };
}
