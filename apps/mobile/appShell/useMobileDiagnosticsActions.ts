import { useCallback, type Dispatch, type SetStateAction } from "react";
import { Alert } from "react-native";
import type { AgentTickClient } from "@self-deprecated/agent-tick-sdk";

import { diagnosticEvents, recordDiagnostic, sendDiagnosticSnapshotWithClients, setDiagnosticsEnabled as saveDiagnosticsEnabled } from "../diagnostics";
import type { RuntimeAuthConfig, SavedMobileAccount } from "../mobileAuth";
import type { ConnectionStatus, NotificationStatus, PushStatus } from "../SettingsScreen";
import type { Screen } from "../AppLogic";
import { diagnosticClientsForConnections } from "./mobileSessionClientHelpers";
import { diagnosticsSnapshot } from "./mobileDiagnosticsSnapshot";

type UseMobileDiagnosticsActionsOptions = {
  connectionStatus: ConnectionStatus;
  error: string | null;
  hasRequestAuth: boolean;
  notificationStatus: NotificationStatus;
  notificationsEnabled: boolean;
  pushStatus: PushStatus;
  runtimeAuthProvider?: RuntimeAuthConfig["authProvider"];
  savedAccounts: SavedMobileAccount[];
  screen: Screen;
  sdk: AgentTickClient;
  serverURL: string;
  setDiagnosticsEnabled: Dispatch<SetStateAction<boolean>>;
  setDiagnosticsEventCount: Dispatch<SetStateAction<number>>;
  setDiagnosticsLastSentAt: Dispatch<SetStateAction<string>>;
};

export function useMobileDiagnosticsActions({
  connectionStatus,
  error,
  hasRequestAuth,
  notificationStatus,
  notificationsEnabled,
  pushStatus,
  runtimeAuthProvider,
  savedAccounts,
  screen,
  sdk,
  serverURL,
  setDiagnosticsEnabled,
  setDiagnosticsEventCount,
  setDiagnosticsLastSentAt,
}: UseMobileDiagnosticsActionsOptions): {
  toggleDiagnostics: (enabled: boolean) => Promise<void>;
  sendDiagnostics: () => Promise<void>;
} {
  const toggleDiagnostics = useCallback(async (enabled: boolean) => {
    await saveDiagnosticsEnabled(enabled);
    setDiagnosticsEnabled(enabled);
    recordDiagnostic("info", "diagnostics", enabled ? "enabled" : "disabled");
    setDiagnosticsEventCount(diagnosticEvents().length);
  }, [setDiagnosticsEnabled, setDiagnosticsEventCount]);

  const sendDiagnostics = useCallback(async () => {
    if (!hasRequestAuth) {
      Alert.alert("Sign in required", "Diagnostics can only be sent after a hosted or self-hosted connection is available.");
      return;
    }
    try {
      const clients = await diagnosticClientsForConnections(savedAccounts);
      const accepted = await sendDiagnosticSnapshotWithClients(clients.length > 0 ? clients : [sdk], diagnosticsSnapshot({
        serverURL,
        authMode: runtimeAuthProvider,
        connectionStatus,
        pushStatus,
        notificationStatus,
        notificationsEnabled,
        currentScreen: screen,
        lastErrorMessage: error ?? undefined,
      }));
      setDiagnosticsLastSentAt(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
      setDiagnosticsEventCount(diagnosticEvents().length);
      Alert.alert("Diagnostics sent", `Sent ${accepted} diagnostic event${accepted === 1 ? "" : "s"}.`);
    } catch (err) {
      Alert.alert("Diagnostics failed", err instanceof Error ? err.message : "Could not send diagnostics");
    }
  }, [connectionStatus, error, hasRequestAuth, notificationStatus, notificationsEnabled, pushStatus, runtimeAuthProvider, savedAccounts, screen, sdk, serverURL, setDiagnosticsEventCount, setDiagnosticsLastSentAt]);

  return { toggleDiagnostics, sendDiagnostics };
}
