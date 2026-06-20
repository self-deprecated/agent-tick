import type { ComponentProps } from "react";

import type { PaywallPlacement } from "../purchases";
import type { AgentTickSettingsRoute } from "./AgentTickSettingsRoute";
import type { useMobileSettingsActionsController } from "./useMobileSettingsActionsController";

type SettingsRouteProps = ComponentProps<typeof AgentTickSettingsRoute>;
type AccountServerProps = SettingsRouteProps["accountServerProps"];
type BillingProps = SettingsRouteProps["billingProps"];
type ConnectionProps = SettingsRouteProps["connectionProps"];
type DiagnosticsProps = SettingsRouteProps["diagnosticsProps"];
type LocaleProps = SettingsRouteProps["localeProps"];
type NotificationProps = SettingsRouteProps["notificationProps"];
type PairingProps = SettingsRouteProps["pairingProps"];
type PrivateEncryptionProps = SettingsRouteProps["privateEncryptionProps"];
type SettingsActions = Pick<
  ReturnType<typeof useMobileSettingsActionsController>,
  | "checkConnection"
  | "updateAvailability"
  | "requestNotifications"
  | "toggleNotifications"
  | "sendTestNotification"
  | "registerPushToken"
  | "startTrial"
  | "purchaseLifetimeUnlock"
  | "restorePurchases"
  | "linkPurchasesToHostedAccount"
  | "setLocalDevAppAccessUnlocked"
  | "subscribeHostedPersonal"
  | "manageSubscription"
  | "clearHostedLoginSession"
  | "deleteAccount"
  | "handleServerURLChange"
  | "resetLocalTestState"
  | "selectWorkspace"
  | "signInToServer"
  | "signOutFromSettings"
  | "useHostedSignIn"
  | "toggleDiagnostics"
  | "sendDiagnostics"
  | "handlePairingScan"
  | "openScanner"
  | "pairDevice"
  | "scannerLocked"
>;

export type BuildAgentTickSettingsRoutePropsInput = {
  accounts: AccountServerProps["accounts"];
  activeLocale: LocaleProps["activeLocale"];
  authProvider: AccountServerProps["authProvider"];
  availability: ConnectionProps["availability"];
  connectionStatus: ConnectionProps["connectionStatus"];
  currentAccountProfile: AccountServerProps["currentAccountProfile"];
  deviceID: AccountServerProps["deviceID"];
  diagnosticsEnabled: DiagnosticsProps["diagnosticsEnabled"];
  diagnosticsEventCount: DiagnosticsProps["diagnosticsEventCount"];
  diagnosticsLastSentAt: DiagnosticsProps["diagnosticsLastSentAt"];
  entitlementSourceDiagnostics: BillingProps["entitlementSourceDiagnostics"];
  error: ConnectionProps["error"];
  hostedPersonalCurrentlyActive: BillingProps["hostedPersonalCurrentlyActive"];
  loading: ConnectionProps["loading"];
  localePreference: LocaleProps["localePreference"];
  localDevAppAccessUnlocked: BillingProps["localDevAppAccessUnlocked"];
  nativeEntitlement: BillingProps["nativeEntitlement"];
  notificationStatus: NotificationProps["notificationStatus"];
  notificationsEnabled: NotificationProps["notificationsEnabled"];
  onAddClerkAccount: AccountServerProps["onAddClerkAccount"];
  onLocalePreferenceChange: LocaleProps["onLocalePreferenceChange"];
  pairingCode: PairingProps["pairingCode"];
  personalBillingStatus: BillingProps["personalBillingStatus"];
  privateEncryptionProps?: PrivateEncryptionProps;
  purchaseAccountReady: BillingProps["purchaseAccountReady"];
  pushStatus: NotificationProps["pushStatus"];
  removeSavedAccount: AccountServerProps["removeSavedAccount"];
  selectedWorkspaceID: AccountServerProps["selectedWorkspaceID"];
  serverURL: AccountServerProps["serverURL"];
  setPairingCode: PairingProps["setPairingCode"];
  setToken: AccountServerProps["setToken"];
  settingsActions: SettingsActions;
  settingsViewTarget: SettingsRouteProps["settingsViewTarget"];
  showDebugHostedExpiryWarning: BillingProps["showDebugHostedExpiryWarning"];
  showNativePaywall: (placement: PaywallPlacement) => void;
  storeProducts: BillingProps["storeProducts"];
  token: AccountServerProps["token"];
  workspaces: AccountServerProps["workspaces"];
};

export function buildAgentTickSettingsRouteProps({
  accounts,
  activeLocale,
  authProvider,
  availability,
  connectionStatus,
  currentAccountProfile,
  deviceID,
  diagnosticsEnabled,
  diagnosticsEventCount,
  diagnosticsLastSentAt,
  entitlementSourceDiagnostics,
  error,
  hostedPersonalCurrentlyActive,
  loading,
  localePreference,
  localDevAppAccessUnlocked,
  nativeEntitlement,
  notificationStatus,
  notificationsEnabled,
  onAddClerkAccount,
  onLocalePreferenceChange,
  pairingCode,
  personalBillingStatus,
  privateEncryptionProps,
  purchaseAccountReady,
  pushStatus,
  removeSavedAccount,
  selectedWorkspaceID,
  serverURL,
  setPairingCode,
  setToken,
  settingsActions,
  settingsViewTarget,
  showDebugHostedExpiryWarning,
  showNativePaywall,
  storeProducts,
  token,
  workspaces,
}: BuildAgentTickSettingsRoutePropsInput): SettingsRouteProps {
  const {
    checkConnection,
    updateAvailability,
    requestNotifications,
    toggleNotifications,
    sendTestNotification,
    registerPushToken,
    purchaseLifetimeUnlock,
    restorePurchases,
    linkPurchasesToHostedAccount,
    setLocalDevAppAccessUnlocked,
    subscribeHostedPersonal,
    manageSubscription,
    clearHostedLoginSession,
    deleteAccount,
    handleServerURLChange,
    resetLocalTestState,
    selectWorkspace,
    signInToServer,
    signOutFromSettings,
    useHostedSignIn,
    toggleDiagnostics,
    sendDiagnostics,
    openScanner,
    pairDevice,
  } = settingsActions;

  return {
    accountServerProps: {
      accounts,
      authProvider,
      clearHostedLoginSession,
      currentAccountProfile,
      deleteAccount,
      deviceID,
      handleServerURLChange,
      onAddClerkAccount,
      removeSavedAccount,
      resetLocalTestState,
      selectWorkspace,
      selectedWorkspaceID,
      serverURL,
      setToken,
      signInToServer,
      signOutFromSettings,
      token,
      useHostedSignIn,
      workspaces,
    },
    billingProps: {
      entitlementSourceDiagnostics,
      hostedPersonalCurrentlyActive,
      linkPurchasesToHostedAccount,
      localDevAppAccessUnlocked,
      manageSubscription,
      nativeEntitlement,
      personalBillingStatus,
      purchaseAccountReady,
      purchaseLifetimeUnlock,
      restorePurchases,
      setLocalDevAppAccessUnlocked,
      showDebugHostedExpiryWarning,
      showNativePaywall,
      storeProducts,
      subscribeHostedPersonal,
    },
    connectionProps: {
      availability,
      checkConnection,
      connectionStatus,
      error,
      loading,
      updateAvailability,
    },
    diagnosticsProps: {
      diagnosticsEnabled,
      diagnosticsEventCount,
      diagnosticsLastSentAt,
      sendDiagnostics,
      toggleDiagnostics,
    },
    localeProps: {
      activeLocale,
      localePreference,
      onLocalePreferenceChange,
    },
    notificationProps: {
      notificationStatus,
      notificationsEnabled,
      pushStatus,
      registerPushToken,
      requestNotifications,
      sendTestNotification,
      toggleNotifications,
    },
    pairingProps: {
      openScanner,
      pairingCode,
      pairDevice,
      setPairingCode,
    },
    ...(privateEncryptionProps ? { privateEncryptionProps } : {}),
    settingsViewTarget,
  };
}
