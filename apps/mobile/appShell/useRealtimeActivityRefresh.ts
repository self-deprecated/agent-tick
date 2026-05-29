import * as Notifications from "expo-notifications";
import { useCallback, useEffect, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import { AppState } from "react-native";
import { AgentTickClient } from "@self-deprecated/agent-tick-sdk";
import { type PersonalBillingStatus } from "@self-deprecated/agent-tick-shared";

import {
  notificationRequestID,
  notificationSessionID,
  notificationStatusUpdateID,
  realtimeErrorDecision,
} from "../AppLogic";
import { diagnosticEvents, recordDiagnostic } from "../diagnostics";
import { mobileEventStreamsAvailable, subscribeToMobileEventStream, type MobileEventStreamSubscription } from "../mobileEvents";
import type { ConnectionStatus } from "../SettingsScreen";
import { hashDiagnosticID } from "./clerkSessionHelpers";
import { apiStatus } from "./mobileActivityHelpers";

type LoadActivity = (options?: { visible?: boolean }) => Promise<void>;

type UseRealtimeActivityRefreshOptions = {
  authProvider?: string;
  deviceID: string;
  hasRequestAuth: boolean;
  load: LoadActivity;
  refreshPersonalBilling: (options?: { configureStore?: boolean }) => Promise<PersonalBillingStatus | null>;
  realtimeUnavailable: boolean;
  sdk: AgentTickClient;
  seenRequestIDs: MutableRefObject<Set<string>>;
  selectedWorkspaceID: string;
  serverURL: string;
  setConnectionStatus: Dispatch<SetStateAction<ConnectionStatus>>;
  setDiagnosticsEventCount: Dispatch<SetStateAction<number>>;
  setRealtimeUnavailable: Dispatch<SetStateAction<boolean>>;
  settingsLoaded: boolean;
  token: string;
};

export function useRealtimeActivityRefresh({
  authProvider,
  deviceID,
  hasRequestAuth,
  load,
  refreshPersonalBilling,
  realtimeUnavailable,
  sdk,
  seenRequestIDs,
  selectedWorkspaceID,
  serverURL,
  setConnectionStatus,
  setDiagnosticsEventCount,
  setRealtimeUnavailable,
  settingsLoaded,
  token,
}: UseRealtimeActivityRefreshOptions) {
  const loadRef = useRef<LoadActivity | null>(null);
  const realtimeSubscriptionRef = useRef<MobileEventStreamSubscription | null>(null);
  const [realtimeRestartToken, setRealtimeRestartToken] = useState(0);

  useEffect(() => {
    setRealtimeUnavailable(false);
  }, [selectedWorkspaceID, serverURL]);

  const interruptRealtime = useCallback(() => {
    realtimeSubscriptionRef.current?.close();
    realtimeSubscriptionRef.current = null;
    setRealtimeRestartToken((value) => value + 1);
  }, []);

  useEffect(() => {
    const subscription = Notifications.addNotificationReceivedListener((notification) => {
      const data = notification.request.content.data;
      const id = notificationRequestID(data);
      const sessionID = notificationSessionID(data);
      const statusUpdateID = notificationStatusUpdateID(data);
      if (id) {
        seenRequestIDs.current.add(id);
      }
      if (id || sessionID || statusUpdateID) {
        recordDiagnostic("info", "notifications", "received", { requestId: id || undefined, sessionIDHash: hashDiagnosticID(sessionID), statusUpdateIDHash: hashDiagnosticID(statusUpdateID) });
      }
      interruptRealtime();
      void loadRef.current?.({ visible: false });
    });

    return () => subscription.remove();
  }, [interruptRealtime]);

  useEffect(() => {
    loadRef.current = load;
  }, [load]);

  useEffect(() => {
    if (!settingsLoaded || !hasRequestAuth) return;
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        interruptRealtime();
        void load({ visible: false });
        void refreshPersonalBilling({ configureStore: false });
      }
    });
    return () => subscription.remove();
  }, [hasRequestAuth, interruptRealtime, load, refreshPersonalBilling, authProvider, settingsLoaded]);

  useEffect(() => {
    if (!settingsLoaded) {
      return;
    }

    void load({ visible: false });
    if (hasRequestAuth && mobileEventStreamsAvailable() && !realtimeUnavailable) {
      return;
    }

    const timer = setInterval(() => void load({ visible: false }), hasRequestAuth ? 60_000 : 5_000);
    return () => clearInterval(timer);
  }, [hasRequestAuth, load, realtimeUnavailable, settingsLoaded]);

  useEffect(() => {
    if (!settingsLoaded || !hasRequestAuth) {
      return;
    }
    const heartbeat = () => {
      void sdk.sendHeartbeat({ deviceId: deviceID, client: "mobile" }).catch(() => undefined);
    };
    heartbeat();
    const timer = setInterval(heartbeat, 60_000);
    return () => clearInterval(timer);
  }, [deviceID, authProvider, sdk, settingsLoaded, token]);

  useEffect(() => {
    if (!settingsLoaded || !hasRequestAuth || realtimeUnavailable || !mobileEventStreamsAvailable()) {
      return;
    }

    let refreshTimer: ReturnType<typeof setTimeout> | null = null;
    const clearRefreshTimer = () => {
      if (refreshTimer) {
        clearTimeout(refreshTimer);
        refreshTimer = null;
      }
    };
    const scheduleRefresh = () => {
      if (refreshTimer) return;
      refreshTimer = setTimeout(() => {
        refreshTimer = null;
        void load({ visible: false });
      }, 100);
    };

    const subscription = subscribeToMobileEventStream({
      client: sdk,
      onAuditEvent: scheduleRefresh,
      onStatusChange: (status) => {
        if (status === "open") setConnectionStatus("connected");
      },
      onError: (eventError) => {
        const status = apiStatus(eventError);
        const decision = realtimeErrorDecision(status);
        if (decision.disableRealtime) setRealtimeUnavailable(true);
        recordDiagnostic("warn", "realtime", decision.diagnosticMessage, {
          status,
          ...(decision.diagnosticMessage === "stream_error" ? { message: eventError instanceof Error ? eventError.message : String(eventError) } : {}),
        });
        setDiagnosticsEventCount(diagnosticEvents().length);
      },
    });

    realtimeSubscriptionRef.current = subscription;

    return () => {
      clearRefreshTimer();
      subscription.close();
      if (realtimeSubscriptionRef.current === subscription) realtimeSubscriptionRef.current = null;
    };
  }, [hasRequestAuth, load, realtimeRestartToken, realtimeUnavailable, sdk, settingsLoaded]);

  return { loadRef, interruptRealtime };
}
