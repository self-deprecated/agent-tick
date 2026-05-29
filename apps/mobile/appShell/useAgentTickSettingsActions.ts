import type { AgentTickAppClerkControls, AgentTickAppProps } from "./AgentTickAppProps";
import { useMobileSettingsActionsController } from "./useMobileSettingsActionsController";
import type { useActiveMobileConnectionIdentity } from "./useActiveMobileConnectionIdentity";
import type { useAgentTickAppState } from "./useAgentTickAppState";
import type { useMobileApiClient } from "./useMobileApiClient";
import type { useMobileBillingAccessState } from "./useMobileBillingAccessState";
import type { useMobileBillingController } from "./useMobileBillingController";
import type { useMobileConnectionManagement } from "./useMobileConnectionManagement";
import type { useMobileRealtimeActivityController } from "./useMobileRealtimeActivityController";
import type { useMobileSelectionState } from "./useMobileSelectionState";

type AgentTickAppState = ReturnType<typeof useAgentTickAppState>;

type UseAgentTickSettingsActionsInput = {
  activeConnectionIdentity: ReturnType<typeof useActiveMobileConnectionIdentity>;
  activityState: AgentTickAppState["activityState"];
  appStatusState: AgentTickAppState["appStatusState"];
  billingAccessState: ReturnType<typeof useMobileBillingAccessState>;
  billingController: ReturnType<typeof useMobileBillingController>;
  billingState: AgentTickAppState["billingState"];
  clerkControls: Pick<AgentTickAppClerkControls, "onForgetClerkSession">;
  clerkSessionToken: AgentTickAppProps["clerkSessionToken"];
  clerkSignedIn: AgentTickAppProps["clerkSignedIn"];
  connectionAccountState: AgentTickAppState["connectionAccountState"];
  connectionManagement: ReturnType<typeof useMobileConnectionManagement>;
  currentAuthToken: ReturnType<typeof useMobileApiClient>["currentAuthToken"];
  navigationState: AgentTickAppState["navigationState"];
  notificationTargetState: AgentTickAppState["notificationTargetState"];
  onRuntimeAuthConfig: AgentTickAppProps["onRuntimeAuthConfig"];
  realtimeActivityController: ReturnType<typeof useMobileRealtimeActivityController>;
  runtimeRefs: AgentTickAppState["runtimeRefs"];
  sdk: ReturnType<typeof useMobileApiClient>["sdk"];
  selectionState: ReturnType<typeof useMobileSelectionState>;
};

export function useAgentTickSettingsActions({
  activeConnectionIdentity,
  activityState,
  appStatusState,
  billingAccessState,
  billingController,
  billingState,
  clerkControls,
  clerkSessionToken,
  clerkSignedIn,
  connectionAccountState,
  connectionManagement,
  currentAuthToken,
  navigationState,
  notificationTargetState,
  onRuntimeAuthConfig,
  realtimeActivityController,
  runtimeRefs,
  sdk,
  selectionState,
}: UseAgentTickSettingsActionsInput) {
  return useMobileSettingsActionsController({
    activeClerkSessionID: activeConnectionIdentity.activeClerkSessionID,
    activeConnectionID: activeConnectionIdentity.activeConnectionID,
    bestEffortUnregisterSavedAccounts: connectionManagement.bestEffortUnregisterSavedAccounts,
    clerkSessionToken,
    clerkSignedIn,
    connectionStatus: appStatusState.connectionStatus,
    currentAccountProfile: connectionAccountState.currentAccountProfile,
    currentAuthToken,
    deviceID: connectionAccountState.deviceID,
    didPrimeNotifications: runtimeRefs.didPrimeNotifications,
    error: appStatusState.error,
    hasRequestAuth: selectionState.hasRequestAuth,
    interruptRealtime: realtimeActivityController.interruptRealtime,
    isHostedAccount: billingAccessState.isHostedAccount,
    lastClerkPushRegistrationKey: runtimeRefs.lastClerkPushRegistrationKey,
    load: realtimeActivityController.load,
    loadRef: realtimeActivityController.loadRef,
    notificationTargetID: notificationTargetState.notificationTargetID,
    notificationsEnabled: appStatusState.notificationsEnabled,
    notificationStatus: appStatusState.notificationStatus,
    onForgetClerkSession: clerkControls.onForgetClerkSession,
    onRuntimeAuthConfig,
    pairingCode: connectionAccountState.pairingCode,
    personalBillingStatus: billingState.personalBillingStatus,
    purchaseAccountReady: billingAccessState.purchaseAccountReady,
    purchaseInFlightRef: billingState.purchaseInFlightRef,
    pushStatus: appStatusState.pushStatus,
    refreshPersonalBilling: billingController.refreshPersonalBilling,
    refreshStoreEntitlements: billingController.refreshStoreEntitlements,
    runtimeAuthProvider: connectionAccountState.runtimeAuthConfig?.authProvider,
    savedAccounts: connectionAccountState.savedAccounts,
    seenRequestIDs: runtimeRefs.seenRequestIDs,
    screen: navigationState.screen,
    sdk,
    selectedWorkspace: selectionState.selectedWorkspace,
    selectedWorkspaceID: connectionAccountState.selectedWorkspaceID,
    serverURL: connectionAccountState.serverURL,
    settingsLoaded: appStatusState.settingsLoaded,
    setAccountPending: connectionManagement.setAccountPending,
    setAvailability: appStatusState.setAvailability,
    setConnectionStatus: appStatusState.setConnectionStatus,
    setConnectionTokens: connectionAccountState.setConnectionTokens,
    setCurrentAccountProfile: connectionAccountState.setCurrentAccountProfile,
    setDebugPaywallVisible: billingState.setDebugPaywallVisible,
    setDeviceID: connectionAccountState.setDeviceID,
    setDiagnosticsEnabled: appStatusState.setDiagnosticsEnabled,
    setDiagnosticsEventCount: appStatusState.setDiagnosticsEventCount,
    setDiagnosticsLastSentAt: appStatusState.setDiagnosticsLastSentAt,
    setError: appStatusState.setError,
    setHistory: activityState.setHistory,
    setLoadedSessionServerURL: appStatusState.setLoadedSessionServerURL,
    setLocalStoreHostedSubscriptionActive: billingState.setLocalStoreHostedSubscriptionActive,
    setLocalStoreLifetimeUnlocked: billingState.setLocalStoreLifetimeUnlocked,
    setLocalStoreTrialPurchased: billingState.setLocalStoreTrialPurchased,
    setLocalStoreTrialStartedAt: billingState.setLocalStoreTrialStartedAt,
    setLoading: appStatusState.setLoading,
    setNotificationStatus: appStatusState.setNotificationStatus,
    setNotificationsEnabled: appStatusState.setNotificationsEnabled,
    setNotificationTargetID: notificationTargetState.setNotificationTargetID,
    setNotificationTargetRequestID: notificationTargetState.setNotificationTargetRequestID,
    setNotificationTargetSessionID: notificationTargetState.setNotificationTargetSessionID,
    setNotificationTargetStatusUpdateID: notificationTargetState.setNotificationTargetStatusUpdateID,
    setPairingCode: connectionAccountState.setPairingCode,
    setPaywallConfig: billingState.setPaywallConfig,
    setPaywallDismissedKey: billingState.setPaywallDismissedKey,
    setPersonalBillingStatus: billingState.setPersonalBillingStatus,
    setPurchaseInFlightProductKey: billingState.setPurchaseInFlightProductKey,
    setPushStatus: appStatusState.setPushStatus,
    setRequests: activityState.setRequests,
    setRuntimeAuthConfig: connectionAccountState.setRuntimeAuthConfig,
    setSavedAccounts: connectionAccountState.setSavedAccounts,
    setSelectedID: activityState.setSelectedID,
    setSelectedSourceID: activityState.setSelectedSourceID,
    setSelectedWorkspaceID: connectionAccountState.setSelectedWorkspaceID,
    setServerURL: connectionAccountState.setServerURL,
    setScreen: navigationState.setScreen,
    setStatusUpdates: activityState.setStatusUpdates,
    setStoreEntitlementsSettled: billingState.setStoreEntitlementsSettled,
    setStoreProducts: billingState.setStoreProducts,
    setToken: connectionAccountState.setToken,
    setWorkspaces: connectionAccountState.setWorkspaces,
    token: connectionAccountState.token,
  });
}
