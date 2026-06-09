import type { MeResponse, WorkspaceMemberRecord } from "@self-deprecated/agent-tick-sdk";
import type { PersonalBillingStatus } from "@self-deprecated/agent-tick-shared";

import { trialRemainingLabel, type NativeAppEntitlementState } from "../AppLogic";
import type { RuntimeAuthConfig, SavedMobileAccount } from "../mobileAuth";
import type { StoreProduct } from "../purchases";
import { SettingsScreen, type AvailabilityState, type ConnectionStatus, type NotificationStatus, type PushStatus } from "../SettingsScreen";
import type { AgentTickAppProps } from "./AgentTickAppProps";
import { recordDiagnostic } from "../diagnostics";

type MaybePromise<T> = T | Promise<T>;
type VoidAction = () => MaybePromise<void>;

type AgentTickSettingsRouteProps = {
  accountServerProps: {
    accounts: SavedMobileAccount[];
    authProvider?: RuntimeAuthConfig["authProvider"];
    clearHostedLoginSession: VoidAction;
    currentAccountProfile: MeResponse | null;
    deleteAccount: VoidAction;
    deviceID: string;
    handleServerURLChange: (value: string) => void;
    onAddClerkAccount?: () => void;
    removeSavedAccount: (account: SavedMobileAccount) => MaybePromise<void>;
    resetLocalTestState: VoidAction;
    selectWorkspace: (value: string) => void;
    selectedWorkspaceID: string;
    serverURL: string;
    setToken: (value: string) => void;
    signOutFromSettings: VoidAction;
    token: string;
    useHostedSignIn: VoidAction;
    workspaces: WorkspaceMemberRecord[];
  };
  billingProps: {
    entitlementSourceDiagnostics: string[];
    hostedPersonalCurrentlyActive: boolean;
    linkPurchasesToHostedAccount: VoidAction;
    manageSubscription: VoidAction;
    nativeEntitlement: NativeAppEntitlementState;
    personalBillingStatus: PersonalBillingStatus | null;
    purchaseAccountReady: boolean;
    purchaseLifetimeUnlock: VoidAction;
    restorePurchases: VoidAction;
    showDebugHostedExpiryWarning: VoidAction;
    showNativePaywall: (placement: "settings_access") => void;
    storeProducts: StoreProduct[];
    subscribeHostedPersonal: (period: "monthly" | "yearly") => MaybePromise<void>;
  };
  connectionProps: {
    availability: AvailabilityState;
    checkConnection: VoidAction;
    connectionStatus: ConnectionStatus;
    error: string | null;
    loading: boolean;
    updateAvailability: (state: AvailabilityState) => MaybePromise<void>;
  };
  diagnosticsProps: {
    diagnosticsEnabled: boolean;
    diagnosticsEventCount: number;
    diagnosticsLastSentAt: string;
    sendDiagnostics: VoidAction;
    toggleDiagnostics: (enabled: boolean) => MaybePromise<void>;
  };
  localeProps: {
    activeLocale: AgentTickAppProps["activeLocale"];
    localePreference: AgentTickAppProps["localePreference"];
    onLocalePreferenceChange: AgentTickAppProps["onLocalePreferenceChange"];
  };
  notificationProps: {
    notificationStatus: NotificationStatus;
    notificationsEnabled: boolean;
    pushStatus: PushStatus;
    registerPushToken: VoidAction;
    requestNotifications: VoidAction;
    sendTestNotification: VoidAction;
    toggleNotifications: (enabled: boolean) => MaybePromise<void>;
  };
  pairingProps: {
    openScanner: VoidAction;
    pairingCode: string;
    pairDevice: VoidAction;
    setPairingCode: (value: string) => void;
  };
  settingsViewTarget: { view: "home" | "notifications"; signal: number };
};

export function AgentTickSettingsRoute({
  accountServerProps,
  billingProps,
  connectionProps,
  diagnosticsProps,
  localeProps,
  notificationProps,
  pairingProps,
  settingsViewTarget,
}: AgentTickSettingsRouteProps) {
  const {
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
    signOutFromSettings,
    token,
    useHostedSignIn,
    workspaces,
  } = accountServerProps;
  const {
    entitlementSourceDiagnostics,
    hostedPersonalCurrentlyActive,
    linkPurchasesToHostedAccount,
    manageSubscription,
    nativeEntitlement,
    personalBillingStatus,
    purchaseAccountReady,
    purchaseLifetimeUnlock,
    restorePurchases,
    showDebugHostedExpiryWarning,
    showNativePaywall,
    storeProducts,
    subscribeHostedPersonal,
  } = billingProps;
  const {
    availability,
    checkConnection,
    connectionStatus,
    error,
    loading,
    updateAvailability,
  } = connectionProps;
  const {
    diagnosticsEnabled,
    diagnosticsEventCount,
    diagnosticsLastSentAt,
    sendDiagnostics,
    toggleDiagnostics,
  } = diagnosticsProps;
  const {
    activeLocale,
    localePreference,
    onLocalePreferenceChange,
  } = localeProps;
  const {
    notificationStatus,
    notificationsEnabled,
    pushStatus,
    registerPushToken,
    requestNotifications,
    sendTestNotification,
    toggleNotifications,
  } = notificationProps;
  const {
    openScanner,
    pairingCode,
    pairDevice,
    setPairingCode,
  } = pairingProps;

  return (
    <SettingsScreen
      accounts={accounts}
      availability={availability}
      connectionStatus={connectionStatus}
      error={error}
      loading={loading}
      activeLocale={activeLocale}
      localePreference={localePreference}
      onLocalePreferenceChange={onLocalePreferenceChange}
      notificationStatus={notificationStatus}
      notificationsEnabled={notificationsEnabled}
      onAvailabilityChange={(state) => void updateAvailability(state as AvailabilityState)}
      onCheck={() => void checkConnection()}
      onDiagnosticsEnabledChange={(enabled) => void toggleDiagnostics(enabled)}
      onDiagnosticEvent={(area, message, metadata) => recordDiagnostic("info", area, message, metadata)}
      onForgetDevice={signOutFromSettings}
      onClearHostedLoginSession={clearHostedLoginSession}
      onResetLocalTestState={resetLocalTestState}
      onDeleteAccount={authProvider === "clerk" ? deleteAccount : undefined}
      onSignInAnotherClerkAccount={onAddClerkAccount}
      onPairDevice={() => void pairDevice()}
      onNotificationsEnabledChange={(enabled) => void toggleNotifications(enabled)}
      onRegisterPush={() => void registerPushToken()}
      onRequestNotifications={() => void requestNotifications()}
      onSavedAccountRemove={removeSavedAccount}
      onSendDiagnosticSnapshot={() => void sendDiagnostics()}
      onSendTestNotification={() => void sendTestNotification()}
      onShowHostedExpiryWarning={showDebugHostedExpiryWarning}
      onShowNativePaywall={() => showNativePaywall("settings_access")}
      nativeAppEntitlement={nativeEntitlement}
      personalBillingStatus={personalBillingStatus}
      entitlementSourceDiagnostics={entitlementSourceDiagnostics}
      storeProducts={storeProducts}
      trialRemainingLabel={trialRemainingLabel(nativeEntitlement.trialRemainingMs)}
      hostedPersonalActive={hostedPersonalCurrentlyActive}
      onPurchaseLifetimeUnlock={() => void purchaseLifetimeUnlock()}
      onRestorePurchases={() => void restorePurchases()}
      onLinkPurchasesToHostedAccount={purchaseAccountReady ? () => void linkPurchasesToHostedAccount() : undefined}
      onSubscribeHostedPersonal={(period) => void subscribeHostedPersonal(period)}
      onManageSubscription={manageSubscription}
      onScanPairing={openScanner}
      onUseHosted={() => void useHostedSignIn()}
      pairingCode={pairingCode}
      pushStatus={pushStatus}
      diagnosticsEnabled={diagnosticsEnabled}
      diagnosticsEventCount={diagnosticsEventCount}
      diagnosticsLastSentAt={diagnosticsLastSentAt}
      authProvider={authProvider}
      currentAccountProfile={currentAccountProfile}
      deviceID={deviceID}
      workspaces={workspaces}
      selectedWorkspaceID={selectedWorkspaceID}
      serverURL={serverURL}
      setPairingCode={setPairingCode}
      setSelectedWorkspaceID={selectWorkspace}
      settingsViewTarget={settingsViewTarget.view}
      settingsViewSignal={settingsViewTarget.signal}
      setServerURL={handleServerURLChange}
      setToken={setToken}
      token={token}
    />
  );
}
