import { useCallback } from "react";
import { Alert } from "react-native";
import { type AgentTickClient } from "@self-deprecated/agent-tick-sdk";
import { useMobileConnectionActions } from "./useMobileConnectionActions";
import { useMobilePushNotifications } from "./useMobilePushNotifications";
import { useMobilePurchaseActions } from "./useMobilePurchaseActions";
import { useMobileAccountSessionActions } from "./useMobileAccountSessionActions";
import { useMobileDiagnosticsActions } from "./useMobileDiagnosticsActions";
import { useMobilePairingAndDeepLinks } from "./useMobilePairingAndDeepLinks";

type HostedDevGrantClient = Pick<AgentTickClient, "updatePersonalBilling">;

export async function grantHostedDevResponseAccess(
  sdk: HostedDevGrantClient,
): Promise<void> {
  await sdk.updatePersonalBilling({ event: "subscribe_monthly" });
}

type UseMobileSettingsActionsControllerInput =
  Parameters<typeof useMobileConnectionActions>[0] &
  Parameters<typeof useMobilePushNotifications>[0] &
  Parameters<typeof useMobilePurchaseActions>[0] &
  Parameters<typeof useMobileAccountSessionActions>[0] &
  Parameters<typeof useMobileDiagnosticsActions>[0] &
  Omit<Parameters<typeof useMobilePairingAndDeepLinks>[0], "handleServerURLChange">;

export function useMobileSettingsActionsController({
  activeClerkSessionID,
  activeConnectionID,
  bestEffortUnregisterSavedAccounts,
  clerkSessionToken,
  clerkSignedIn,
  connectionStatus,
  currentAccountProfile,
  currentAuthToken,
  deviceID,
  didPrimeNotifications,
  error,
  hasRequestAuth,
  interruptRealtime,
  isHostedAccount,
  lastClerkPushRegistrationKey,
  load,
  loadRef,
  notificationTargetID,
  notificationsEnabled,
  notificationStatus,
  onForgetClerkSession,
  onRuntimeAuthConfig,
  pairingCode,
  personalBillingStatus,
  purchaseAccountReady,
  purchaseInFlightRef,
  pushStatus,
  refreshPersonalBilling,
  refreshStoreEntitlements,
  runtimeAuthProvider,
  savedAccounts,
  seenRequestIDs,
  screen,
  sdk,
  selectedWorkspace,
  selectedWorkspaceID,
  serverURL,
  settingsLoaded,
  setAccountPending,
  setAvailability,
  setConnectionStatus,
  setConnectionTokens,
  setCurrentAccountProfile,
  setDebugPaywallVisible,
  setDeviceID,
  setDiagnosticsEnabled,
  setDiagnosticsEventCount,
  setDiagnosticsLastSentAt,
  setError,
  setHistory,
  setLoadedSessionServerURL,
  setLocalDevAppAccessUnlocked,
  setLocalStoreHostedSubscriptionActive,
  setLocalStoreLifetimeUnlocked,
  setLocalStoreTrialPurchased,
  setLocalStoreTrialStartedAt,
  setLoading,
  setNotificationStatus,
  setNotificationsEnabled,
  setNotificationTargetID,
  setNotificationTargetRequestID,
  setNotificationTargetSessionID,
  setNotificationTargetStatusUpdateID,
  setPairingCode,
  setPaywallConfig,
  setPaywallDismissedKey,
  setPersonalBillingStatus,
  setPurchaseInFlightProductKey,
  setPushStatus,
  setRequests,
  setRuntimeAuthConfig,
  setSavedAccounts,
  setSelectedID,
  setSelectedSourceID,
  setSelectedWorkspaceID,
  setServerURL,
  setScreen,
  setStatusUpdates,
  setStoreEntitlementsSettled,
  setStoreProducts,
  setToken,
  setWorkspaces,
  token,
}: UseMobileSettingsActionsControllerInput) {
  const { checkConnection, updateAvailability } = useMobileConnectionActions({
    interruptRealtime,
    load,
    sdk,
    setAvailability,
    setConnectionStatus,
  });

  const {
    requestNotifications,
    toggleNotifications,
    sendTestNotification,
    registerPushToken,
  } = useMobilePushNotifications({
    activeConnectionID,
    currentAccountProfile,
    currentAuthToken,
    deviceID,
    isHostedAccount,
    lastClerkPushRegistrationKey,
    notificationsEnabled,
    notificationStatus,
    personalBillingStatus,
    pushStatus,
    runtimeAuthProvider,
    savedAccounts,
    sdk,
    selectedWorkspace,
    selectedWorkspaceID,
    serverURL,
    settingsLoaded,
    setDeviceID,
    setDiagnosticsEventCount,
    setNotificationStatus,
    setNotificationsEnabled,
    setPushStatus,
    setSavedAccounts,
    token,
  });

  const {
    startTrial,
    purchaseLifetimeUnlock,
    restorePurchases,
    linkPurchasesToHostedAccount,
    subscribeHostedPersonal,
    manageSubscription,
  } = useMobilePurchaseActions({
    currentAccountProfile,
    personalBillingStatus,
    purchaseAccountReady,
    purchaseInFlightRef,
    refreshPersonalBilling,
    refreshStoreEntitlements,
    runtimeAuthProvider,
    sdk,
    setPurchaseInFlightProductKey,
  });

  const {
    bestEffortUnregisterDevice,
    clearHostedLoginSession,
    clearStoredSessionForServer,
    deleteAccount,
    forgetDevice,
    handleServerURLChange,
    resetLocalTestState,
    selectWorkspace,
    signInToServer,
    signOutFromSettings,
    useHostedSignIn,
  } = useMobileAccountSessionActions({
    activeClerkSessionID,
    bestEffortUnregisterSavedAccounts,
    clerkSessionToken,
    clerkSignedIn,
    currentAccountProfile,
    currentAuthToken,
    deviceID,
    onForgetClerkSession,
    onRuntimeAuthConfig,
    runtimeAuthProvider,
    savedAccounts,
    sdk,
    selectedWorkspaceID,
    serverURL,
    setAccountPending,
    setConnectionStatus,
    setConnectionTokens,
    setCurrentAccountProfile,
    setDebugPaywallVisible,
    setDeviceID,
    setDiagnosticsEnabled,
    setDiagnosticsEventCount,
    setError,
    setHistory,
    setLoadedSessionServerURL,
    setLocalDevAppAccessUnlocked,
    setLocalStoreHostedSubscriptionActive,
    setLocalStoreLifetimeUnlocked,
    setLocalStoreTrialPurchased,
    setLocalStoreTrialStartedAt,
    setLoading,
    setNotificationTargetID,
    setNotificationsEnabled,
    setPaywallConfig,
    setPaywallDismissedKey,
    setPersonalBillingStatus,
    setPushStatus,
    setRequests,
    setSavedAccounts,
    setSelectedID,
    setSelectedSourceID,
    setSelectedWorkspaceID,
    setServerURL,
    setStatusUpdates,
    setStoreEntitlementsSettled,
    setStoreProducts,
    setToken,
    setWorkspaces,
    token,
  });

  const { toggleDiagnostics, sendDiagnostics } = useMobileDiagnosticsActions({
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
  });

  const setLocalDevAppAccess = useCallback(async (unlocked: boolean) => {
    if (!unlocked || !__DEV__) {
      setLocalDevAppAccessUnlocked(false);
      return;
    }
    setLocalDevAppAccessUnlocked(true);
    if (isHostedAccount && runtimeAuthProvider === "clerk") {
      try {
        await grantHostedDevResponseAccess(sdk);
        await refreshPersonalBilling({ configureStore: false });
        Alert.alert("Dev app access granted", "Local app access and hosted dev billing access are active.");
      } catch (err) {
        Alert.alert(
          "Hosted dev grant failed",
          err instanceof Error
            ? `${err.message}\n\nLocal app access is still active, but hosted responses require RevenueCat or server billing test mode.`
            : "Local app access is still active, but hosted responses require RevenueCat or server billing test mode.",
        );
      }
    }
  }, [isHostedAccount, refreshPersonalBilling, runtimeAuthProvider, sdk, setLocalDevAppAccessUnlocked]);

  const { handlePairingScan, openScanner, pairDevice, scannerLocked } = useMobilePairingAndDeepLinks({
    currentAuthToken,
    didPrimeNotifications,
    handleServerURLChange,
    interruptRealtime,
    load,
    loadRef,
    notificationTargetID,
    notificationsEnabled,
    onRuntimeAuthConfig,
    pairingCode,
    pushStatus,
    seenRequestIDs,
    serverURL,
    setConnectionStatus,
    setDeviceID,
    setNotificationTargetID,
    setNotificationTargetRequestID,
    setNotificationTargetSessionID,
    setNotificationTargetStatusUpdateID,
    setPairingCode,
    setPushStatus,
    setRequests,
    setRuntimeAuthConfig,
    setScreen,
    setSelectedID,
    setSelectedWorkspaceID,
    setServerURL,
    setToken,
    setWorkspaces,
  });

  return {
    checkConnection,
    updateAvailability,
    requestNotifications,
    toggleNotifications,
    sendTestNotification,
    registerPushToken,
    startTrial,
    purchaseLifetimeUnlock,
    restorePurchases,
    linkPurchasesToHostedAccount,
    setLocalDevAppAccessUnlocked: setLocalDevAppAccess,
    subscribeHostedPersonal,
    manageSubscription,
    bestEffortUnregisterDevice,
    clearHostedLoginSession,
    clearStoredSessionForServer,
    deleteAccount,
    forgetDevice,
    handleServerURLChange,
    resetLocalTestState,
    selectWorkspace,
    signInToServer,
    signOutFromSettings,
    useHostedSignIn,
    toggleDiagnostics,
    sendDiagnostics,
    handlePairingScan,
    openScanner,
    pairDevice,
    scannerLocked,
  };
}
