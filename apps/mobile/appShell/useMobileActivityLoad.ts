import AsyncStorage from "@react-native-async-storage/async-storage";
import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import { AgentTickClient, type SessionSummary, type StatusUpdateRecord } from "@self-deprecated/agent-tick-sdk";

import {
  flattenConnectionWorkspaceActivities,
  loadConnectionWorkspaceValues,
  requestLoadConnectionStatus,
  resolveConnectionWorkspaceIDs,
} from "../AppLogic";
import { diagnosticEvents, recordDiagnostic } from "../diagnostics";
import { mobileSessionStorageKeys, type RuntimeAuthConfig, type SavedMobileAccount } from "../mobileAuth";
import {
  mobileRequestMatchesSelection,
  normalizeRequests,
  requestSourceID,
  shouldScheduleLocalNotifications,
  type MobileRequest,
} from "../requests";
import type { MobileSessionSummary } from "../mobileTypes";
import type { ConnectionStatus, NotificationStatus, PushStatus } from "../SettingsScreen";
import { toMobileSessionSummary } from "../sessions/sessionDetailConnection";
import { maybeShowNotificationSettingsReminder, notifyForNewRequests } from "./mobileNotificationHelpers";
import {
  attachWorkspaceMemberCounts,
  filterRequestsBySource,
  loadWorkspaceMemberCount,
  selectRequestID,
  workspaceMemberCountsForRequests,
} from "./mobileActivityHelpers";
import { getStoredConnectionToken } from "./mobileSessionClientHelpers";

type LoadActivity = (options?: { visible?: boolean }) => Promise<void>;

type UseMobileActivityLoadOptions = {
  authProvider?: RuntimeAuthConfig["authProvider"];
  didPrimeNotifications: MutableRefObject<boolean>;
  didShowNotificationSettingsReminder: MutableRefObject<boolean>;
  notificationsEnabled: boolean;
  notificationStatus: NotificationStatus;
  notificationTargetID: string | null;
  onOpenNotificationSettings: () => void;
  pushStatus: PushStatus;
  savedAccounts: SavedMobileAccount[];
  sdk: AgentTickClient;
  seenRequestIDs: MutableRefObject<Set<string>>;
  selectedID: string | null;
  selectedSourceID: string | null;
  selectedWorkspaceID: string;
  serverURL: string;
  setConnectionStatus: Dispatch<SetStateAction<ConnectionStatus>>;
  setDiagnosticsEventCount: Dispatch<SetStateAction<number>>;
  setError: Dispatch<SetStateAction<string | null>>;
  setLoading: Dispatch<SetStateAction<boolean>>;
  setNotificationTargetID: Dispatch<SetStateAction<string | null>>;
  setRequests: Dispatch<SetStateAction<MobileRequest[]>>;
  setSelectedID: Dispatch<SetStateAction<string | null>>;
  setSelectedSourceID: Dispatch<SetStateAction<string | null>>;
  setSessionSummaries: Dispatch<SetStateAction<MobileSessionSummary[]>>;
  setStatusUpdates: Dispatch<SetStateAction<StatusUpdateRecord[]>>;
};

export function useMobileActivityLoad({
  authProvider,
  didPrimeNotifications,
  didShowNotificationSettingsReminder,
  notificationsEnabled,
  notificationStatus,
  notificationTargetID,
  onOpenNotificationSettings,
  pushStatus,
  savedAccounts,
  sdk,
  seenRequestIDs,
  selectedID,
  selectedSourceID,
  selectedWorkspaceID,
  serverURL,
  setConnectionStatus,
  setDiagnosticsEventCount,
  setError,
  setLoading,
  setNotificationTargetID,
  setRequests,
  setSelectedID,
  setSelectedSourceID,
  setSessionSummaries,
  setStatusUpdates,
}: UseMobileActivityLoadOptions): { load: LoadActivity } {
  const load = useCallback(async (options?: { visible?: boolean }) => {
    if (authProvider === "clerk" && !selectedWorkspaceID && savedAccounts.length === 0) {
      setConnectionStatus("checking");
      return;
    }
    const visible = options?.visible ?? false;
    if (visible) {
      setLoading(true);
    }
    setError(null);
    try {
      const connectionActivityResults = await Promise.allSettled(savedAccounts.map(async (account) => {
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
          const workspaceClient = new AgentTickClient({
            baseUrl: account.serverURL,
            tokenProvider: () => connectionToken,
            workspaceIdProvider: () => workspaceID || null,
          });
          const [activityResult, requests, workspaceMemberCount, sessions] = await Promise.all([
            workspaceClient.listActivity({ limit: 50 }).catch(() => []),
            workspaceClient.listRequests(),
            loadWorkspaceMemberCount(workspaceClient, workspaceID),
            workspaceClient.listSessions({ limit: 25 }).catch(() => []),
          ]);
          return { activity: activityResult, requests, workspaceMemberCount, sessions };
        });
        const audienceRequests = await connectionClient.listAudienceRequests().catch(() => []);
        return {
          failedCount: workspaceResults.failedCount,
          values: [
            ...flattenConnectionWorkspaceActivities(account, workspaceResults.values),
            ...(audienceRequests.length ? [{ account, workspaceID: null, activity: [], requests: audienceRequests, workspaceMemberCount: undefined }] : []),
          ],
        };
      }));
      const failedConnectionCount = connectionActivityResults.reduce((total, result) => total + (result.status === "rejected" ? 1 : result.value.failedCount), 0);
      const connectionActivities = connectionActivityResults.flatMap((result) => result.status === "fulfilled" ? result.value.values : []) as Array<{ account: SavedMobileAccount; workspaceID: string | null; activity: Awaited<ReturnType<AgentTickClient["listActivity"]>>; requests: Awaited<ReturnType<AgentTickClient["listRequests"]>>; workspaceMemberCount?: number; sessions?: SessionSummary[] }>;
      if (failedConnectionCount > 0) {
        recordDiagnostic("warn", "requests", "connection_load_partial_failure", { failedConnectionCount, connectionCount: savedAccounts.length });
      }

      const useStoredConnections = savedAccounts.length > 0;
      const shouldFallbackToBootstrapSession = !useStoredConnections || connectionActivityResults.every((result) => result.status === "fulfilled" && result.value.failedCount === 0 && result.value.values.length === 0);
      const fallbackActivity = shouldFallbackToBootstrapSession && connectionActivities.length === 0
        ? await sdk.listActivity({ limit: 50 }).catch(() => [])
        : [];
      const fallbackSessions = shouldFallbackToBootstrapSession && connectionActivities.length === 0
        ? await sdk.listSessions({ limit: 25 }).catch(() => [])
        : [];
      const fallbackRequestsWithoutMemberCounts = shouldFallbackToBootstrapSession && connectionActivities.length === 0
        ? normalizeRequests([...(await sdk.listRequests()), ...(await sdk.listAudienceRequests().catch(() => []))])
        : [];
      const fallbackMemberCounts = await workspaceMemberCountsForRequests(sdk, fallbackRequestsWithoutMemberCounts);
      const fallbackRequests = attachWorkspaceMemberCounts(fallbackRequestsWithoutMemberCounts, fallbackMemberCounts).map((request) => ({
        ...request,
        connectionServerURL: serverURL,
      }));
      const fallbackSucceeded = shouldFallbackToBootstrapSession && connectionActivities.length === 0;
      const activity = connectionActivities.length > 0
        ? connectionActivities.flatMap(({ activity: connectionActivity }) => connectionActivity)
        : fallbackActivity;
      const activityRequests = connectionActivities.length > 0
        ? connectionActivities.flatMap(({ account, requests: connectionRequests, workspaceMemberCount }) => normalizeRequests(connectionRequests).map((request) => ({
            ...request,
            ...(workspaceMemberCount === undefined ? {} : { workspaceMemberCount }),
            connectionID: account.id,
            connectionLabel: account.label,
            connectionServerURL: account.serverURL,
          })))
        : fallbackRequests;
      const loadedSessionSummaries: MobileSessionSummary[] = connectionActivities.length > 0
        ? connectionActivities.flatMap(({ account, workspaceID, sessions = [] }) => sessions.map((session) => toMobileSessionSummary(session, {
            connectionID: account.id,
            connectionLabel: account.label,
            connectionServerURL: account.serverURL,
            workspaceID,
          })))
        : fallbackSessions.map((session) => toMobileSessionSummary(session));
      const latestStatuses = activity
        .filter((item) => item.kind === "status_update")
        .map((item) => item.statusUpdate)
        .slice(0, 5);
      const pendingRequests = activityRequests.filter((request) => request.status === "pending");
      recordDiagnostic("info", "requests", "loaded", {
        pendingRequestCount: pendingRequests.length,
        connectionCount: new Set(pendingRequests.map((request) => request.connectionID).filter(Boolean)).size,
        fallbackAttempted: shouldFallbackToBootstrapSession && connectionActivities.length === 0,
        fallbackSucceeded,
        selectedRequestKey: selectedID || undefined,
      });
      setDiagnosticsEventCount(diagnosticEvents().length);
      setStatusUpdates(latestStatuses);
      setSessionSummaries(loadedSessionSummaries);
      const newRequests = await notifyForNewRequests(
        pendingRequests,
        seenRequestIDs,
        didPrimeNotifications,
        shouldScheduleLocalNotifications(pushStatus, notificationsEnabled),
      );
      await maybeShowNotificationSettingsReminder({
        newRequests,
        notificationsEnabled,
        notificationStatus,
        reminderSeen: didShowNotificationSettingsReminder,
        onOpenNotificationSettings,
      });
      setRequests(pendingRequests);
      setConnectionStatus(requestLoadConnectionStatus({
        successfulConnectionCount: connectionActivities.length,
        fallbackAttempted: shouldFallbackToBootstrapSession && connectionActivities.length === 0,
        fallbackSucceeded,
      }));
      const activeSourceID = pendingRequests.some(
        (request) => selectedSourceID && requestSourceID(request) === selectedSourceID,
      )
        ? selectedSourceID
        : null;
      if (selectedSourceID && !activeSourceID) {
        setSelectedSourceID(null);
      }
      const selectableRequests = filterRequestsBySource(pendingRequests, activeSourceID);
      setSelectedID((current) =>
        selectRequestID(selectableRequests, notificationTargetID, current),
      );
      if (
        notificationTargetID &&
        pendingRequests.some((request) => mobileRequestMatchesSelection(request, notificationTargetID))
      ) {
        setNotificationTargetID(null);
      }
    } catch (err) {
      setConnectionStatus("disconnected");
      const message = err instanceof Error ? err.message : "Failed to load requests";
      recordDiagnostic("warn", "requests", "load_failed", { message });
      setDiagnosticsEventCount(diagnosticEvents().length);
      setError(null);
    } finally {
      if (visible) {
        setLoading(false);
      }
    }
  }, [notificationTargetID, notificationsEnabled, notificationStatus, pushStatus, authProvider, savedAccounts, sdk, selectedWorkspaceID, selectedSourceID, onOpenNotificationSettings]);

  return { load };
}
