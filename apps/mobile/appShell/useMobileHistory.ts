import AsyncStorage from "@react-native-async-storage/async-storage";
import { useCallback, useEffect, type Dispatch, type SetStateAction } from "react";
import { AgentTickClient, type SessionDetail, type SessionSummary } from "@self-deprecated/agent-tick-sdk";

import {
  loadConnectionWorkspaceValues,
  resolveConnectionWorkspaceIDs,
  shouldFallbackToBootstrapHistory,
  type Screen,
} from "../AppLogic";
import { diagnosticEvents, recordDiagnostic } from "../diagnostics";
import { mobileSessionStorageKeys, type SavedMobileAccount } from "../mobileAuth";
import { normalizeRequests, type MobileRequest } from "../requests";
import { sessionStackSessionKey } from "../sessionStackState";
import { attachSessionDetailConnection, toMobileSessionSummary } from "../sessions/sessionDetailConnection";
import type { MobileSessionDetail, MobileSessionSummary } from "../mobileTypes";
import type { ConnectionStatus } from "../SettingsScreen";
import { attachWorkspaceMemberCounts, loadWorkspaceMemberCount, workspaceMemberCountsForRequests } from "./mobileActivityHelpers";
import { getStoredConnectionToken } from "./mobileSessionClientHelpers";

const activityHistoryPageSize = 20;

type UseMobileHistoryOptions = {
  savedAccounts: SavedMobileAccount[];
  screen: Screen;
  sdk: AgentTickClient;
  setConnectionStatus: Dispatch<SetStateAction<ConnectionStatus>>;
  setDiagnosticsEventCount: Dispatch<SetStateAction<number>>;
  setError: Dispatch<SetStateAction<string | null>>;
  setHistory: Dispatch<SetStateAction<MobileRequest[]>>;
  setHistoryLoading: Dispatch<SetStateAction<boolean>>;
  setHistorySessionDetails: Dispatch<SetStateAction<Record<string, MobileSessionDetail | undefined>>>;
  setHistorySessions: Dispatch<SetStateAction<MobileSessionSummary[]>>;
};

export function useMobileHistory({
  savedAccounts,
  screen,
  sdk,
  setConnectionStatus,
  setDiagnosticsEventCount,
  setError,
  setHistory,
  setHistoryLoading,
  setHistorySessionDetails,
  setHistorySessions,
}: UseMobileHistoryOptions) {
  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    setError(null);
    try {
      const connectionHistoryResults = await Promise.allSettled(savedAccounts.map(async (account) => {
        const connectionToken = await getStoredConnectionToken(account);
        if (!connectionToken) return { failedCount: 0, values: [] };
        const connectionClient = new AgentTickClient({
          baseUrl: account.serverURL,
          tokenProvider: () => connectionToken,
        });
        const scopedKeys = mobileSessionStorageKeys(account.serverURL);
        const storedWorkspaceID = account.workspaceID || (await AsyncStorage.getItem(scopedKeys.workspaceID)) || "";
        const workspaceIDs = await resolveConnectionWorkspaceIDs(account, connectionClient, storedWorkspaceID);
        const workspaceResults = await loadConnectionWorkspaceValues(workspaceIDs, async (workspaceID) => {
          const historyClient = new AgentTickClient({
            baseUrl: account.serverURL,
            tokenProvider: () => connectionToken,
            workspaceIdProvider: () => workspaceID || null,
          });
          const [activity, workspaceMemberCount, sessions] = await Promise.all([
            historyClient.listActivityHistory({ limit: activityHistoryPageSize }),
            loadWorkspaceMemberCount(historyClient, workspaceID),
            historyClient.listSessions({ limit: activityHistoryPageSize }).catch(() => []),
          ]);
          const sessionDetails = await Promise.all(sessions.map(async (session) => historyClient.getSession(session.sessionId, { workspaceId: workspaceID || undefined, limit: 100 }).catch(() => undefined)));
          return { activity, workspaceMemberCount, sessions, sessionDetails };
        });
        return {
          failedCount: workspaceResults.failedCount,
          values: workspaceResults.values.map(({ workspaceID, value }) => ({ account, workspaceID, activity: value.activity, workspaceMemberCount: value.workspaceMemberCount, sessions: value.sessions, sessionDetails: value.sessionDetails })),
        };
      }));
      const connectionHistories = connectionHistoryResults.flatMap((result) => result.status === "fulfilled" ? result.value.values : []) as Array<{ account: SavedMobileAccount; workspaceID: string | null; activity: Awaited<ReturnType<AgentTickClient["listActivityHistory"]>>; workspaceMemberCount?: number; sessions?: SessionSummary[]; sessionDetails?: Array<SessionDetail | undefined> }>;
      const failedConnectionCount = connectionHistoryResults.reduce((total, result) => total + (result.status === "rejected" ? 1 : result.value.failedCount), 0);
      if (failedConnectionCount > 0) recordDiagnostic("warn", "requests", "connection_history_partial_failure", { failedConnectionCount, connectionCount: savedAccounts.length });
      const useStoredConnections = savedAccounts.length > 0;
      const shouldFallbackToBootstrapSession = shouldFallbackToBootstrapHistory({
        savedAccountCount: savedAccounts.length,
        connectionHistoryCount: connectionHistories.length,
        connectionResultSummaries: connectionHistoryResults.map((result) => result.status === "fulfilled"
          ? { status: "fulfilled" as const, failedCount: result.value.failedCount, valueCount: result.value.values.length }
          : { status: "rejected" as const }),
      });
      const fallbackActivity = shouldFallbackToBootstrapSession && connectionHistories.length === 0
        ? await sdk.listActivityHistory({ limit: activityHistoryPageSize })
        : [];
      const fallbackSessions = shouldFallbackToBootstrapSession && connectionHistories.length === 0
        ? await sdk.listSessions({ limit: activityHistoryPageSize }).catch(() => [])
        : [];
      const fallbackSessionDetails = fallbackSessions.length
        ? await Promise.all(fallbackSessions.map((session) => sdk.getSession(session.sessionId, { limit: 100 }).catch(() => undefined)))
        : [];
      if (connectionHistories.length > 0) {
        const nextHistorySessions = connectionHistories.flatMap(({ account, workspaceID, sessions = [] }) => sessions.map((session) => toMobileSessionSummary(session, {
          connectionID: account.id,
          connectionLabel: account.label,
          connectionServerURL: account.serverURL,
          workspaceID,
        })));
        const nextHistorySessionDetails = Object.fromEntries(connectionHistories.flatMap(({ account, workspaceID, sessions = [], sessionDetails = [] }) => sessions.flatMap((session, index) => {
          const detail = sessionDetails[index];
          const mobileSummary = toMobileSessionSummary(session, { connectionID: account.id, connectionLabel: account.label, connectionServerURL: account.serverURL, workspaceID });
          return detail ? [[sessionStackSessionKey(mobileSummary), attachSessionDetailConnection(detail, mobileSummary)]] : [];
        })));
        setHistorySessions(nextHistorySessions);
        setHistorySessionDetails(nextHistorySessionDetails);
        setHistory(connectionHistories.flatMap(({ account, activity, workspaceMemberCount }) => normalizeRequests(activity.filter((item) => item.kind === "request").map((item) => item.request)).map((request) => ({
          ...request,
          ...(workspaceMemberCount === undefined ? {} : { workspaceMemberCount }),
          connectionID: account.id,
          connectionLabel: account.label,
          connectionServerURL: account.serverURL,
        }))));
      } else if (shouldFallbackToBootstrapSession) {
        const nextHistorySessions = fallbackSessions.map((session) => toMobileSessionSummary(session));
        setHistorySessions(nextHistorySessions);
        setHistorySessionDetails(Object.fromEntries(nextHistorySessions.flatMap((session, index) => fallbackSessionDetails[index] ? [[sessionStackSessionKey(session), fallbackSessionDetails[index]]] : [])));
        const historyRequests = normalizeRequests(fallbackActivity.filter((item) => item.kind === "request").map((item) => item.request));
        const historyMemberCounts = await workspaceMemberCountsForRequests(sdk, historyRequests);
        setHistory(attachWorkspaceMemberCounts(historyRequests, historyMemberCounts));
      } else if (useStoredConnections) {
        setHistory([]);
        setHistorySessions([]);
        setHistorySessionDetails({});
      } else {
        setHistory([]);
        setHistorySessions([]);
        setHistorySessionDetails({});
      }
      setConnectionStatus(useStoredConnections && connectionHistories.length === 0 && !shouldFallbackToBootstrapSession ? "disconnected" : "connected");
    } catch (err) {
      setConnectionStatus("disconnected");
      const message = err instanceof Error ? err.message : "Failed to load history";
      recordDiagnostic("warn", "requests", "history_load_failed", { message });
      setDiagnosticsEventCount(diagnosticEvents().length);
      setError(message);
    } finally {
      setHistoryLoading(false);
    }
  }, [savedAccounts, sdk]);

  useEffect(() => {
    if (screen === "history") {
      void loadHistory();
    }
  }, [loadHistory, screen]);

  return { loadHistory };
}
