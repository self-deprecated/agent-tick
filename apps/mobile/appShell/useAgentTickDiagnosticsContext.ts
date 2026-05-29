import { useEffect, useRef, type Dispatch, type SetStateAction } from "react";
import type { MeResponse } from "@self-deprecated/agent-tick-sdk";
import type { PersonalBillingStatus } from "@self-deprecated/agent-tick-shared";

import type { NativeAppEntitlementGrant, Screen } from "../AppLogic";
import type { MobileRequest } from "../requests";
import type { ConnectionStatus, NotificationStatus, PushStatus } from "../SettingsScreen";
import type { RuntimeAuthConfig, SavedMobileAccount } from "../mobileAuth";
import { diagnosticEvents, recordDiagnostic, setDiagnosticContext } from "../diagnostics";
import { hashDiagnosticID, jwtStringClaim, savedAccountDiagnostics } from "./clerkSessionHelpers";

type DiagnosticsNativeEntitlement = {
  readOnly: boolean;
  trialActive: boolean;
  lifetimeUnlocked: boolean;
  hostedSubscriptionActive: boolean;
  hostedResponsesUnlocked: boolean;
};

type DiagnosticsResponseReadOnly = {
  workspaceReadOnly: boolean;
};

type UseAgentTickDiagnosticsContextInput = {
  activeClerkSessionID: string | null;
  appResponsesReadOnly: boolean;
  billingAccessGraceActive: boolean;
  choiceInteractionMode: string;
  clerkDebugState?: Record<string, unknown>;
  clerkSessionToken?: string | null;
  confirmBeforeSubmit: boolean;
  connectedBillingEntitlementGrant: NativeAppEntitlementGrant;
  connectedBillingSettled: boolean;
  connectionStatus: ConnectionStatus;
  currentAccountProfile: MeResponse | null;
  deviceID: string;
  error: string | null;
  hasRequestAuth: boolean;
  hostedReadOnly: boolean;
  menuOpen: boolean;
  nativeEntitlement: DiagnosticsNativeEntitlement;
  nativePaywallVisible: boolean;
  notificationStatus: NotificationStatus;
  notificationsEnabled: boolean;
  optionPlacement: string;
  paywallLoading: boolean;
  paywallVisible: boolean;
  personalBillingSettled: boolean;
  personalBillingStatus: PersonalBillingStatus | null;
  pushStatus: PushStatus;
  requests: MobileRequest[];
  responseReadOnly: DiagnosticsResponseReadOnly;
  runtimeAuthConfig: RuntimeAuthConfig | null;
  savedAccounts: SavedMobileAccount[];
  screen: Screen;
  selectedID: string | null;
  selectedRequestHosted: boolean;
  selectedRequestSharedWorkspace: boolean;
  selectedRequestWorkspaceResponsesEntitled: boolean;
  selectedSourceID: string | null;
  selectedWorkspaceID: string;
  setDiagnosticsEventCount: Dispatch<SetStateAction<number>>;
  settingsLoaded: boolean;
  storeEntitlementsSettled: boolean;
  token: string;
  workspacesLength: number;
};

export function useAgentTickDiagnosticsContext({
  activeClerkSessionID,
  appResponsesReadOnly,
  billingAccessGraceActive,
  choiceInteractionMode,
  clerkDebugState,
  clerkSessionToken,
  confirmBeforeSubmit,
  connectedBillingEntitlementGrant,
  connectedBillingSettled,
  connectionStatus,
  currentAccountProfile,
  deviceID,
  error,
  hasRequestAuth,
  hostedReadOnly,
  menuOpen,
  nativeEntitlement,
  nativePaywallVisible,
  notificationStatus,
  notificationsEnabled,
  optionPlacement,
  paywallLoading,
  paywallVisible,
  personalBillingSettled,
  personalBillingStatus,
  pushStatus,
  requests,
  responseReadOnly,
  runtimeAuthConfig,
  savedAccounts,
  screen,
  selectedID,
  selectedRequestHosted,
  selectedRequestSharedWorkspace,
  selectedRequestWorkspaceResponsesEntitled,
  selectedSourceID,
  selectedWorkspaceID,
  setDiagnosticsEventCount,
  settingsLoaded,
  storeEntitlementsSettled,
  token,
  workspacesLength,
}: UseAgentTickDiagnosticsContextInput) {
  const previousScreenRef = useRef<Screen>(screen);

  useEffect(() => {
    setDiagnosticContext({
      authProvider: runtimeAuthConfig?.authProvider,
      currentScreen: screen,
      connectionStatus,
      pushStatus,
      notificationStatus,
      notificationsEnabled,
      settingsLoaded,
      hasRequestAuth,
      hasToken: Boolean(token),
      hasDeviceID: Boolean(deviceID),
      deviceIDHash: hashDiagnosticID(deviceID),
      selectedWorkspaceIDHash: hashDiagnosticID(selectedWorkspaceID),
      currentUserIDHash: hashDiagnosticID(currentAccountProfile?.userId),
      hasCurrentUserEmail: Boolean(currentAccountProfile?.email),
      currentSignInMethod: currentAccountProfile?.signInMethod,
      currentAccountSource: currentAccountProfile?.source,
      savedAccountCount: savedAccounts.length,
      savedAccounts: savedAccountDiagnostics(savedAccounts),
      clerkTokenSidHash: hashDiagnosticID(clerkSessionToken ? jwtStringClaim(clerkSessionToken, "sid") : null),
      clerkTokenSubHash: hashDiagnosticID(clerkSessionToken ? jwtStringClaim(clerkSessionToken, "sub") : null),
      activeClerkSessionIDHash: hashDiagnosticID(activeClerkSessionID),
      ...(clerkDebugState ?? {}),
      workspaceCount: workspacesLength,
      requestCount: requests.length,
      pendingRequestCount: requests.filter((request) => request.status === "pending").length,
      selectedRequestID: selectedID || undefined,
      selectedSourceID: selectedSourceID || undefined,
      appResponsesReadOnly,
      hostedReadOnly,
      selectedRequestHosted,
      nativeEntitlementReadOnly: nativeEntitlement.readOnly,
      nativeEntitlementTrialActive: nativeEntitlement.trialActive,
      nativeEntitlementLifetimeUnlocked: nativeEntitlement.lifetimeUnlocked,
      nativeEntitlementHostedSubscriptionActive: nativeEntitlement.hostedSubscriptionActive,
      nativeEntitlementHostedResponsesUnlocked: nativeEntitlement.hostedResponsesUnlocked,
      selectedRequestSharedWorkspace,
      selectedRequestWorkspaceResponsesEntitled,
      workspaceReadOnly: responseReadOnly.workspaceReadOnly,
      connectedBillingTrialPurchased: Boolean(connectedBillingEntitlementGrant.trialPurchased),
      connectedBillingLifetimeUnlocked: Boolean(connectedBillingEntitlementGrant.lifetimeUnlocked),
      connectedBillingHostedSubscriptionActive: Boolean(connectedBillingEntitlementGrant.hostedSubscriptionActive),
      billingAccessGraceActive,
      personalBillingLoaded: Boolean(personalBillingStatus),
      personalBillingSettled,
      storeEntitlementsSettled,
      connectedBillingSettled,
      personalBillingTrialActive: Boolean(personalBillingStatus?.activeEntitlements.trial7Day.active),
      personalBillingLifetimeActive: Boolean(personalBillingStatus?.activeEntitlements.lifetimeUnlock.active),
      personalBillingHostedActive: Boolean(personalBillingStatus?.activeEntitlements.hostedPersonal.active),
      personalBillingHostedLifecycle: personalBillingStatus?.hostedPersonal.lifecycle,
      paywallVisible,
      nativePaywallVisible,
      paywallLoading,
      menuOpen,
      choiceInteractionMode,
      optionPlacement,
      confirmBeforeSubmit,
      errorMessage: error ?? undefined,
    });
  }, [activeClerkSessionID, appResponsesReadOnly, billingAccessGraceActive, choiceInteractionMode, clerkDebugState, clerkSessionToken, confirmBeforeSubmit, connectedBillingEntitlementGrant.hostedSubscriptionActive, connectedBillingEntitlementGrant.lifetimeUnlocked, connectedBillingEntitlementGrant.trialPurchased, connectedBillingSettled, connectionStatus, currentAccountProfile?.email, currentAccountProfile?.signInMethod, currentAccountProfile?.source, currentAccountProfile?.userId, deviceID, error, hasRequestAuth, hostedReadOnly, menuOpen, nativeEntitlement.hostedResponsesUnlocked, nativeEntitlement.hostedSubscriptionActive, nativeEntitlement.lifetimeUnlocked, nativeEntitlement.readOnly, nativeEntitlement.trialActive, nativePaywallVisible, notificationStatus, notificationsEnabled, optionPlacement, paywallLoading, paywallVisible, personalBillingSettled, personalBillingStatus, pushStatus, requests, runtimeAuthConfig?.authProvider, savedAccounts, screen, selectedID, selectedRequestHosted, selectedRequestSharedWorkspace, selectedRequestWorkspaceResponsesEntitled, selectedSourceID, selectedWorkspaceID, settingsLoaded, storeEntitlementsSettled, token, workspacesLength]);

  useEffect(() => {
    const previousScreen = previousScreenRef.current;
    if (previousScreen === screen) return;
    previousScreenRef.current = screen;
    recordDiagnostic("info", "navigation", "screen_changed", {
      from: previousScreen,
      to: screen,
      pendingRequestCount: requests.length,
      hasSelectedRequest: Boolean(selectedID),
      hasSelectedSource: Boolean(selectedSourceID),
      hasSelectedWorkspace: Boolean(selectedWorkspaceID),
      connectionStatus,
    });
    setDiagnosticsEventCount(diagnosticEvents().length);
  }, [connectionStatus, requests.length, screen, selectedID, selectedWorkspaceID, selectedSourceID]);
}
