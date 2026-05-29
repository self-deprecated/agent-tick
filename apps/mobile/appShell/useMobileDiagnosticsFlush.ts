import { useEffect, type Dispatch, type SetStateAction } from "react";
import type { AgentTickClient } from "@self-deprecated/agent-tick-sdk";
import type { PersonalBillingStatus } from "@self-deprecated/agent-tick-shared";

import type { Screen } from "../AppLogic";
import { diagnosticEvents, flushDiagnosticsWithClients } from "../diagnostics";
import type { SavedMobileAccount, RuntimeAuthConfig } from "../mobileAuth";
import type { ConnectionStatus, NotificationStatus, PushStatus } from "../SettingsScreen";
import { diagnosticsSnapshot } from "./mobileDiagnosticsSnapshot";
import { diagnosticClientsForConnections } from "./mobileSessionClientHelpers";

export function useMobileDiagnosticsFlush({
  appResponsesReadOnly,
  connectionStatus,
  diagnosticsEnabled,
  error,
  hasRequestAuth,
  hostedReadOnly,
  menuOpen,
  nativePaywallVisible,
  nativeEntitlementHostedResponsesUnlocked,
  nativeEntitlementHostedSubscriptionActive,
  nativeEntitlementLifetimeUnlocked,
  nativeEntitlementReadOnly,
  nativeEntitlementTrialActive,
  notificationStatus,
  notificationsEnabled,
  paywallLoading,
  paywallVisible,
  personalBillingStatus,
  pushStatus,
  runtimeAuthProvider,
  savedAccounts,
  screen,
  sdk,
  selectedRequestHosted,
  serverURL,
  settingsLoaded,
  setDiagnosticsEventCount,
  setDiagnosticsLastSentAt,
}: {
  appResponsesReadOnly: boolean;
  connectionStatus: ConnectionStatus;
  diagnosticsEnabled: boolean;
  error: string | null;
  hasRequestAuth: boolean;
  hostedReadOnly: boolean;
  menuOpen: boolean;
  nativePaywallVisible: boolean;
  nativeEntitlementHostedResponsesUnlocked: boolean;
  nativeEntitlementHostedSubscriptionActive: boolean;
  nativeEntitlementLifetimeUnlocked: boolean;
  nativeEntitlementReadOnly: boolean;
  nativeEntitlementTrialActive: boolean;
  notificationStatus: NotificationStatus;
  notificationsEnabled: boolean;
  paywallLoading: boolean;
  paywallVisible: boolean;
  personalBillingStatus: PersonalBillingStatus | null;
  pushStatus: PushStatus;
  runtimeAuthProvider: RuntimeAuthConfig["authProvider"] | undefined;
  savedAccounts: SavedMobileAccount[];
  screen: Screen;
  sdk: AgentTickClient;
  selectedRequestHosted: boolean;
  serverURL: string;
  settingsLoaded: boolean;
  setDiagnosticsEventCount: Dispatch<SetStateAction<number>>;
  setDiagnosticsLastSentAt: Dispatch<SetStateAction<string>>;
}) {
  useEffect(() => {
    if (!settingsLoaded || !diagnosticsEnabled || diagnosticEvents().length === 0) {
      return;
    }
    if (!hasRequestAuth) {
      return;
    }
    void diagnosticClientsForConnections(savedAccounts).then((clients) => flushDiagnosticsWithClients(clients.length > 0 ? clients : [sdk], diagnosticsSnapshot({
      serverURL,
      authMode: runtimeAuthProvider,
      connectionStatus,
      pushStatus,
      notificationStatus,
      notificationsEnabled,
      currentScreen: screen,
      lastErrorMessage: error ?? undefined,
    }))).then((accepted) => {
      if (accepted > 0) setDiagnosticsLastSentAt(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
      setDiagnosticsEventCount(diagnosticEvents().length);
    }).catch(() => undefined);
  }, [appResponsesReadOnly, connectionStatus, diagnosticsEnabled, error, hasRequestAuth, hostedReadOnly, menuOpen, nativeEntitlementHostedResponsesUnlocked, nativeEntitlementHostedSubscriptionActive, nativeEntitlementLifetimeUnlocked, nativeEntitlementReadOnly, nativeEntitlementTrialActive, nativePaywallVisible, notificationStatus, notificationsEnabled, paywallLoading, paywallVisible, personalBillingStatus, pushStatus, runtimeAuthProvider, savedAccounts, screen, sdk, selectedRequestHosted, serverURL, settingsLoaded]);
}
