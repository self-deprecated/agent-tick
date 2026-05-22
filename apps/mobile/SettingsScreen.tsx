import { useEffect, useRef, useState } from "react";
import type { MeResponse } from "@agent-tick/sdk";
import { localeName, supportedLocales, translateSource, type LocalePreference, type SupportedLocale } from "@agent-tick/i18n";
import type { PersonalBillingStatus } from "@agent-tick/shared";
import type { StoreProduct } from "./purchases";
import { entitlementStatusCopy, formatHostedDate, hostedUsageExpiry, type HostedUsageExpiry } from "./AppLogic";
import type { SavedMobileAccount } from "./mobileAuth";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

export type ConnectionStatus = "checking" | "connected" | "disconnected";
export type NotificationStatus = "checking" | "granted" | "denied" | "undetermined";
export type PushStatus = "idle" | "registered" | "unsupported" | "failed";
export type AvailabilityState = "available" | "busy" | "do-not-disturb" | "off-call";
export type ChoiceInteractionMode = "click-to-submit" | "select-then-submit";
export type OptionPlacement = "sticky-bottom" | "inline-after-content";

type SettingsView = "home" | "account" | "accounts" | "access" | "general" | "notifications" | "request-display" | "security" | "self-hosted";

const AVAILABILITY_SETTINGS_ENABLED = false;

type WorkspaceMembership = {
  workspaceId: string;
  name: string;
  role?: string;
};

export function ConnectionBadge({ status }: { status: ConnectionStatus }) {
  const label =
    status === "connected"
      ? translateSource("Connected")
      : status === "checking"
        ? translateSource("Checking")
        : translateSource("Disconnected");

  return (
    <View style={styles.connectionBadge}>
      <View
        style={[
          styles.connectionDot,
          status === "connected" ? styles.connectionDotOk : null,
          status === "disconnected" ? styles.connectionDotBad : null,
        ]}
      />
      <Text style={styles.connectionText}>{label}</Text>
    </View>
  );
}

export function SettingsScreen({
  accounts = [],
  availability,
  authProvider,
  connectionStatus,
  currentAccountProfile,
  e2eeFocusToken = 0,
  e2eeKey = "",
  error,
  loading,
  activeLocale = "en",
  localePreference = "system",
  onLocalePreferenceChange = () => {},
  notificationStatus,
  notificationsEnabled = true,
  choiceInteractionMode = "click-to-submit",
  optionPlacement = "inline-after-content",
  confirmBeforeSubmit = true,
  onAvailabilityChange,
  onCheck,
  onForgetDevice,
  onPairDevice,
  onDiagnosticsEnabledChange,
  onDiagnosticEvent,
  onSignInAnotherClerkAccount,
  onNotificationsEnabledChange,
  onChoiceInteractionModeChange,
  onOptionPlacementChange,
  onConfirmBeforeSubmitChange,
  onRegisterPush,
  onRequestNotifications,
  onSavedAccountRemove,
  onSavedAccountSelect,
  onSendDiagnosticSnapshot,
  onSendTestNotification,
  onShowHostedExpiryWarning,
  onShowNativePaywall,
  nativeAppEntitlement,
  personalBillingStatus,
  storeProducts = [],
  trialRemainingLabel = "",
  hostedPersonalActive = false,
  onPurchaseLifetimeUnlock,
  onRestorePurchases,
  onSubscribeHostedPersonal,
  onActivateIncludedHostedMonth,
  onManageSubscription,
  onScanPairing,
  onUseHosted,
  pairingCode,
  pushStatus,
  diagnosticsEnabled = false,
  diagnosticsEventCount = 0,
  diagnosticsLastSentAt,
  deviceID,
  workspaces = [],
  selectedWorkspaceID = "",
  serverURL,
  setPairingCode,
  setSelectedWorkspaceID,
  setE2eeKey,
  setServerURL,
  setToken,
  token,
}: {
  accounts?: SavedMobileAccount[];
  availability?: AvailabilityState;
  authProvider?: string;
  connectionStatus: ConnectionStatus;
  currentAccountProfile?: Pick<MeResponse, "userId" | "email" | "name" | "signInMethod" | "source" | "authProvider"> | null;
  e2eeFocusToken?: number;
  e2eeKey?: string;
  error: string | null;
  loading: boolean;
  activeLocale?: SupportedLocale;
  localePreference?: LocalePreference;
  onLocalePreferenceChange?: (preference: LocalePreference) => void;
  notificationStatus: NotificationStatus;
  onAvailabilityChange?: (state: AvailabilityState) => void;
  onCheck: () => void;
  onForgetDevice: () => void;
  onPairDevice: () => void;
  onDiagnosticsEnabledChange?: (enabled: boolean) => void;
  onDiagnosticEvent?: (area: string, message: string, metadata?: Record<string, unknown>) => void;
  notificationsEnabled?: boolean;
  choiceInteractionMode?: ChoiceInteractionMode;
  optionPlacement?: OptionPlacement;
  confirmBeforeSubmit?: boolean;
  onNotificationsEnabledChange?: (enabled: boolean) => void;
  onChoiceInteractionModeChange?: (mode: ChoiceInteractionMode) => void;
  onOptionPlacementChange?: (placement: OptionPlacement) => void;
  onConfirmBeforeSubmitChange?: (enabled: boolean) => void;
  onRegisterPush: () => void;
  onRequestNotifications: () => void;
  onSavedAccountRemove?: (account: SavedMobileAccount) => void;
  onSavedAccountSelect?: (account: SavedMobileAccount) => void;
  onSendDiagnosticSnapshot?: () => void;
  onSendTestNotification: () => void;
  onShowHostedExpiryWarning?: () => void;
  onShowNativePaywall?: () => void;
  nativeAppEntitlement?: { trialActive: boolean; lifetimeUnlocked: boolean; readOnly: boolean; hostedSubscriptionActive: boolean; includedHostedActive: boolean; trialRemainingMs?: number };
  personalBillingStatus?: PersonalBillingStatus | null;
  storeProducts?: StoreProduct[];
  trialRemainingLabel?: string;
  hostedPersonalActive?: boolean;
  onPurchaseLifetimeUnlock?: () => void;
  onRestorePurchases?: () => void;
  onSubscribeHostedPersonal?: (period: "monthly" | "yearly") => void;
  onActivateIncludedHostedMonth?: () => void;
  onManageSubscription?: () => void;
  onScanPairing: () => void;
  onSignInAnotherClerkAccount?: () => void;
  onUseHosted?: () => void;
  pairingCode: string;
  pushStatus: PushStatus;
  diagnosticsEnabled?: boolean;
  diagnosticsEventCount?: number;
  diagnosticsLastSentAt?: string;
  deviceID: string;
  workspaces?: WorkspaceMembership[];
  selectedWorkspaceID?: string;
  serverURL: string;
  setPairingCode: (value: string) => void;
  setSelectedWorkspaceID?: (value: string) => void;
  setE2eeKey?: (value: string) => void;
  setServerURL: (value: string) => void;
  setToken: (value: string) => void;
  token: string;
}) {
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [settingsView, setSettingsView] = useState<SettingsView>("home");
  const [languageOpen, setLanguageOpen] = useState(false);
  const [diagnosticsRevealed, setDiagnosticsRevealed] = useState(false);
  const scrollRef = useRef<ScrollView | null>(null);
  const e2eeSectionY = useRef(0);

  useEffect(() => {
    if (!e2eeFocusToken) return;
    setSettingsView("security");
    const timer = setTimeout(() => {
      scrollRef.current?.scrollTo({ y: Math.max(e2eeSectionY.current - 12, 0), animated: true });
    }, 80);
    return () => clearTimeout(timer);
  }, [e2eeFocusToken]);

  const isClerkMode = authProvider === "clerk";
  const hasMultipleAccounts = isClerkMode && accounts.length > 1;
  const isPaired = isClerkMode || !!deviceID;
  const isPushRegistered = pushStatus === "registered";
  const isPushRegistrationDisabled = !notificationsEnabled || isPushRegistered;
  const shouldRemindNotifications = notificationsEnabled && isPaired && (notificationStatus === "denied" || notificationStatus === "undetermined");
  const trackButton = (button: string, metadata?: Record<string, unknown>) => {
    onDiagnosticEvent?.("button", button, { settingsView, ...metadata });
  };

  const tr = translateSource;
  const openSettingsView = (nextView: SettingsView, button: string, metadata?: Record<string, unknown>) => {
    trackButton(button, metadata);
    setSettingsView(nextView);
  };

  const currentAccountTitle = currentAccountLabel({ authProvider, currentAccountProfile, deviceID, serverURL });
  const currentAccountMeta = currentAccountDetails({ authProvider, currentAccountProfile, selectedWorkspaceID, serverURL });

  const selectedLanguageLabel = localePreference === "system"
    ? `${tr("System")} (${localeName(activeLocale)})`
    : localeName(localePreference);
  const languageOptions: Array<{ code: LocalePreference; label: string; diagnostic: string }> = [
    { code: "system", label: `${tr("System")} (${localeName(activeLocale)})`, diagnostic: "language_system" },
    ...supportedLocales.map((locale) => ({ code: locale.code, label: locale.nativeLabel, diagnostic: "language_select" })),
  ];

  const entitlementCopy = nativeAppEntitlement ? entitlementStatusCopy({ trialRemainingMs: 0, ...nativeAppEntitlement }) : null;
  const entitlementSummary = nativeAppEntitlement?.trialActive && trialRemainingLabel ? trialRemainingLabel : entitlementCopy?.summary;
  const lifetimeAvailability = personalBillingStatus?.purchaseAvailability.lifetime_unlock;
  const monthlyAvailability = personalBillingStatus?.purchaseAvailability.hosted_personal_monthly;
  const yearlyAvailability = personalBillingStatus?.purchaseAvailability.hosted_personal_yearly;
  const billingStatusLoaded = Boolean(personalBillingStatus);
  const lifetimeBlocked = Boolean(!billingStatusLoaded || nativeAppEntitlement?.lifetimeUnlocked || lifetimeAvailability?.allowed === false);
  const monthlyBlocked = !billingStatusLoaded || monthlyAvailability?.allowed === false;
  const yearlyBlocked = !billingStatusLoaded || yearlyAvailability?.allowed === false;
  const includedHostedActivated = Boolean(personalBillingStatus?.entitlement.includedHostedActivatedAt);
  const hostedSubscriptionActive = Boolean(personalBillingStatus?.activeEntitlements.hostedPersonal.active);
  const canActivateIncludedHostedMonth = Boolean(billingStatusLoaded && nativeAppEntitlement?.lifetimeUnlocked && !nativeAppEntitlement.trialActive && !includedHostedActivated && !hostedSubscriptionActive);
  const includedHostedWaitsForTrialEnd = Boolean(billingStatusLoaded && nativeAppEntitlement?.lifetimeUnlocked && nativeAppEntitlement.trialActive && !includedHostedActivated && !hostedSubscriptionActive);
  const showHostedSubscriptionActions = billingStatusLoaded;
  const hostedExpiry = personalBillingStatus ? hostedUsageExpiry(personalBillingStatus) : null;
  const hostedOriginPlatform = personalBillingStatus?.activeEntitlements.hostedPersonal.originPlatform;
  const crossPlatformHostedCopy = hostedOriginPlatform === "ios"
    ? tr("Active via Apple. Manage on iOS or the App Store.")
    : hostedOriginPlatform === "android"
      ? tr("Active via Google. Manage on Android or Google Play.")
      : "";
  const appAccessSection = nativeAppEntitlement && entitlementCopy ? (
    <View style={styles.settingsSection}>
      <Text style={styles.sectionHeading}>{tr("App access")}</Text>
      <View style={styles.purchaseCard}>
        <Text style={styles.workspaceName}>{tr(entitlementCopy.title)}</Text>
        <Text style={styles.workspaceMeta}>{entitlementSummary ? tr(entitlementSummary) : tr("Trial status unavailable")}</Text>
        <Text style={styles.pairingHint}>{tr(entitlementCopy.appAccess)}</Text>
        <Text style={styles.pairingHint}>{tr(entitlementCopy.hostedAccess)}</Text>
        <Text style={nativeAppEntitlement.readOnly ? styles.errorText : styles.pairingHint}>{tr(entitlementCopy.paywall)}</Text>
        {!billingStatusLoaded ? <Text style={styles.pairingHint}>{tr("Sign in or connect to Agent Tick to load server purchase status before buying.")}</Text> : null}
      </View>
      <View style={styles.purchaseCard}>
        <Text style={styles.workspaceName}>{tr("Lifetime app unlock")}</Text>
        <Text style={styles.workspaceMeta}>{tr("Use the Agent Tick app with self-hosted servers forever.")}</Text>
        <Text style={styles.priceText}>{priceForProduct(storeProducts, "lifetime_unlock") ?? "$19.99"}</Text>
        {lifetimeAvailability?.reason && !nativeAppEntitlement.lifetimeUnlocked ? <Text style={styles.pairingHint}>{purchaseAvailabilityCopy(lifetimeAvailability.reason)}</Text> : null}
        <Pressable disabled={lifetimeBlocked} onPress={() => onPurchaseLifetimeUnlock?.()} style={[styles.primaryButton, lifetimeBlocked ? styles.disabledButton : null]}>
          <Text style={styles.primaryButtonText}>{nativeAppEntitlement.lifetimeUnlocked ? tr("Purchased") : tr("Buy lifetime unlock")}</Text>
        </Pressable>
      </View>
      <View style={styles.purchaseCard}>
        <Text style={styles.workspaceName}>{tr("Hosted service")}</Text>
        <Text style={styles.workspaceMeta}>{tr("Let us run Request routing, push, updates, and uptime for you.")}</Text>
        <Text style={styles.pairingHint}>{hostedPersonalActive ? tr("Hosted service is active.") : tr("The included hosted month starts when hosted service is first activated after purchase.")}</Text>
        {hostedExpiry ? <Text style={styles.pairingHint}>{hostedExpiryCopy(hostedExpiry, tr)}</Text> : null}
        {crossPlatformHostedCopy ? <Text style={styles.pairingHint}>{crossPlatformHostedCopy}</Text> : null}
        {includedHostedWaitsForTrialEnd ? <Text style={styles.pairingHint}>{tr("The included hosted month waits until Trial ends, then you can activate it before subscribing.")}</Text> : null}
        {canActivateIncludedHostedMonth ? (
          <Pressable onPress={() => onActivateIncludedHostedMonth?.()} style={styles.secondaryActionButton}>
            <Text style={styles.secondaryActionText}>{tr("Start included hosted month")}</Text>
          </Pressable>
        ) : null}
        {monthlyAvailability?.reason || yearlyAvailability?.reason ? <Text style={styles.pairingHint}>{purchaseAvailabilityCopy(monthlyAvailability?.reason ?? yearlyAvailability?.reason)}</Text> : null}
        {showHostedSubscriptionActions ? (
          <View style={styles.notificationActions}>
            <Pressable disabled={monthlyBlocked} onPress={() => onSubscribeHostedPersonal?.("monthly")} style={[styles.secondaryActionButton, monthlyBlocked ? styles.secondaryActionButtonDisabled : null]}>
              <Text style={[styles.secondaryActionText, monthlyBlocked ? styles.secondaryActionTextDisabled : null]}>{priceForProduct(storeProducts, "hosted_personal_monthly") ?? "$5/month"}</Text>
            </Pressable>
            <Pressable disabled={yearlyBlocked} onPress={() => onSubscribeHostedPersonal?.("yearly")} style={[styles.secondaryActionButton, yearlyBlocked ? styles.secondaryActionButtonDisabled : null]}>
              <Text style={[styles.secondaryActionText, yearlyBlocked ? styles.secondaryActionTextDisabled : null]}>{priceForProduct(storeProducts, "hosted_personal_yearly") ?? "$50/year"}</Text>
            </Pressable>
          </View>
        ) : null}
        <Pressable onPress={() => onManageSubscription?.()} style={styles.secondaryActionButton}>
          <Text style={styles.secondaryActionText}>{tr("Manage subscription")}</Text>
        </Pressable>
      </View>
      <Pressable onPress={() => onRestorePurchases?.()} style={styles.secondaryActionButton}>
        <Text style={styles.secondaryActionText}>{tr("Restore purchases")}</Text>
      </Pressable>
    </View>
  ) : null;

  const languageSection = (
    <View style={styles.settingsSection}>
      <Text style={styles.sectionHeading}>{tr("Language")}</Text>
      <Text style={styles.pairingHint}>
        {tr("Agent Tick can follow your device language or use a language you choose here.")}
      </Text>
      <View style={styles.dropdown}>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: languageOpen }}
          onPress={() => setLanguageOpen((open) => !open)}
          style={styles.dropdownButton}
        >
          <Text style={styles.dropdownButtonText}>{selectedLanguageLabel}</Text>
          <Text style={styles.dropdownChevron}>{languageOpen ? "⌃" : "⌄"}</Text>
        </Pressable>
        {languageOpen ? (
          <View style={styles.dropdownMenu}>
            {languageOptions.map((option) => {
              const active = localePreference === option.code;
              return (
                <Pressable
                  accessibilityRole="button"
                  key={option.code}
                  onPress={() => {
                    trackButton(option.diagnostic, option.code === "system" ? { activeLocale } : { locale: option.code });
                    onLocalePreferenceChange(option.code);
                    setLanguageOpen(false);
                  }}
                  style={[styles.dropdownItem, active ? styles.dropdownItemActive : null]}
                >
                  <Text style={[styles.dropdownItemText, active ? styles.dropdownItemTextActive : null]}>{option.label}</Text>
                </Pressable>
              );
            })}
          </View>
        ) : null}
      </View>
      <Text style={styles.pairingHint}>{tr("Active")}: {localeName(activeLocale)}</Text>
    </View>
  );

  const notificationsSection = (
    <View style={styles.settingsSection}>
      <Text style={styles.label}>{tr("Notifications")}</Text>
      {shouldRemindNotifications ? (
        <View style={styles.notificationReminder}>
          <Text style={styles.notificationReminderTitle}>{tr("Enable Request alerts")}</Text>
          <Text style={styles.notificationReminderText}>
            {tr("Agent Tick works best when notifications are on, so urgent Requests can reach you even when the app is closed.")}
          </Text>
          <Pressable onPress={() => { trackButton("enable_notifications_reminder"); onRequestNotifications(); }} style={styles.primaryButton}>
            <Text style={styles.primaryButtonText}>{tr("Enable Notifications")}</Text>
          </Pressable>
        </View>
      ) : null}
      <Text style={styles.notificationStatus}>
        {!notificationsEnabled
          ? tr("Off in Agent Tick")
          : notificationStatus === "granted"
            ? tr("On")
            : notificationStatus === "denied"
              ? tr("Off in system settings")
              : notificationStatus === "checking"
                ? tr("Checking")
                : tr("Not Asked")}
      </Text>
      <View style={styles.notificationActions}>
        <Pressable
          onPress={() => { trackButton(notificationsEnabled ? "disable_notifications" : "enable_notifications_toggle"); onNotificationsEnabledChange?.(!notificationsEnabled); }}
          style={styles.secondaryActionButton}
        >
          <Text style={styles.secondaryActionText}>{notificationsEnabled ? tr("Turn Off") : tr("Turn On")}</Text>
        </Pressable>
        <Pressable
          accessibilityState={{ disabled: !notificationsEnabled }}
          disabled={!notificationsEnabled}
          onPress={() => { trackButton("enable_notifications"); onRequestNotifications(); }}
          style={[styles.secondaryActionButton, !notificationsEnabled ? styles.secondaryActionButtonDisabled : null]}
        >
          <Text style={[styles.secondaryActionText, !notificationsEnabled ? styles.secondaryActionTextDisabled : null]}>{tr("Enable")}</Text>
        </Pressable>
        <Pressable
          accessibilityState={{ disabled: !notificationsEnabled }}
          disabled={!notificationsEnabled}
          onPress={() => { trackButton("send_test_notification"); onSendTestNotification(); }}
          style={[styles.secondaryActionButton, !notificationsEnabled ? styles.secondaryActionButtonDisabled : null]}
        >
          <Text style={[styles.secondaryActionText, !notificationsEnabled ? styles.secondaryActionTextDisabled : null]}>{tr("Test")}</Text>
        </Pressable>
      </View>
      <Text style={styles.notificationStatus}>
        {tr("Push:")} {pushStatus === "registered" ? tr("Registered") : pushStatus}
      </Text>
      <Pressable
        accessibilityState={{ disabled: isPushRegistrationDisabled }}
        disabled={isPushRegistrationDisabled}
        onPress={() => { trackButton("register_push"); onRegisterPush(); }}
        style={[styles.secondaryActionButton, isPushRegistrationDisabled ? styles.secondaryActionButtonDisabled : null]}
      >
        <Text style={[styles.secondaryActionText, isPushRegistrationDisabled ? styles.secondaryActionTextDisabled : null]}>
          {isPushRegistered ? tr("Push Registered") : tr("Register Push")}
        </Text>
      </Pressable>
    </View>
  );

  const diagnosticsSection = diagnosticsRevealed ? (
    <View style={styles.settingsSection}>
      <Text style={styles.sectionHeading}>{tr("Debug")}</Text>
      <Text style={styles.pairingHint}>
        {tr("Debug tools for testing paywalls, hosted expiry warnings, diagnostics, and mobile state. Agent Tick avoids sending Request text, commands, bearer tokens, or Clerk secrets.")}
      </Text>
      <View style={styles.notificationActions}>
        <Pressable onPress={() => { trackButton("debug_show_native_paywall"); onShowNativePaywall?.(); }} style={styles.secondaryActionButton}>
          <Text style={styles.secondaryActionText}>{tr("Show native paywall")}</Text>
        </Pressable>
        <Pressable onPress={() => { trackButton("debug_show_hosted_expiry_warning"); onShowHostedExpiryWarning?.(); }} style={styles.secondaryActionButton}>
          <Text style={styles.secondaryActionText}>{tr("Show hosted expiry warning")}</Text>
        </Pressable>
      </View>
      <Text style={styles.label}>{tr("Diagnostic logs")}</Text>
      <Text style={styles.notificationStatus}>{tr("Status:")} {diagnosticsEnabled ? tr("Enabled") : tr("Disabled")}</Text>
      <Text style={styles.pairingHint}>{tr("Buffered events:")} {diagnosticsEventCount}{diagnosticsLastSentAt ? ` · last sent ${diagnosticsLastSentAt}` : ""}</Text>
      <View style={styles.notificationActions}>
        <Pressable onPress={() => { trackButton("toggle_diagnostics", { nextEnabled: !diagnosticsEnabled }); onDiagnosticsEnabledChange?.(!diagnosticsEnabled); }} style={styles.secondaryActionButton}>
          <Text style={styles.secondaryActionText}>{diagnosticsEnabled ? tr("Disable") : tr("Enable")}</Text>
        </Pressable>
        <Pressable onPress={() => { trackButton("send_diagnostic_snapshot"); onSendDiagnosticSnapshot?.(); }} style={styles.secondaryActionButton}>
          <Text style={styles.secondaryActionText}>{tr("Send Snapshot")}</Text>
        </Pressable>
      </View>
    </View>
  ) : null;

  const generalSections = (
    <>
      {languageSection}
      {diagnosticsSection}
    </>
  );

  const renderBackButton = (backView: SettingsView = "home", label = "‹ Settings") => (
    <View style={styles.settingsSection}>
      <Pressable accessibilityLabel={tr(label)} accessibilityRole="button" onPress={() => { trackButton("settings_back", { to: backView }); setSettingsView(backView); }} style={styles.backButton}>
        <Text style={styles.secondaryActionText}>{tr(label)}</Text>
      </Pressable>
    </View>
  );

  const revealDiagnostics = () => {
    trackButton("reveal_diagnostics");
    setDiagnosticsRevealed(true);
    setSettingsView("general");
  };

  const renderNavItem = (title: string, subtitle: string, view: SettingsView, diagnostic: string, onLongPress?: () => void) => (
    <Pressable onLongPress={onLongPress} onPress={() => openSettingsView(view, diagnostic)} style={styles.navRow}>
      <View style={styles.navRowText}>
        <Text style={styles.navRowTitle}>{tr(title)}</Text>
        <Text style={styles.navRowSubtitle}>{tr(subtitle)}</Text>
      </View>
      <Text style={styles.navRowChevron}>›</Text>
    </Pressable>
  );

  const showWorkspaceSelector = isClerkMode && workspaces.length > 1;
  const workspaceSection = showWorkspaceSelector ? (
    <View style={styles.settingsSection}>
      <Text style={styles.sectionHeading}>{tr("Workspace")}</Text>
      <Text style={styles.pairingHint}>
        {tr("Choose which Workspace this phone should show Requests for. Routing Rule access is managed on the Agent Tick console.")}
      </Text>
      <View style={styles.workspaceList}>
        {workspaces.map((membership) => {
          const active = membership.workspaceId === selectedWorkspaceID;
          return (
            <Pressable
              key={membership.workspaceId}
              onPress={() => { trackButton("select_workspace", { workspaceID: membership.workspaceId, workspaceRole: membership.role }); setSelectedWorkspaceID?.(membership.workspaceId); }}
              style={[styles.workspaceButton, active ? styles.workspaceButtonActive : null]}
            >
              <Text style={[styles.workspaceName, active ? styles.workspaceNameActive : null]}>{membership.name}</Text>
              <Text style={[styles.workspaceMeta, active ? styles.workspaceNameActive : null]}>{membership.role ? translateSource(membership.role) : tr("member")}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  ) : null;

  const availabilitySection = AVAILABILITY_SETTINGS_ENABLED ? (
    <View style={styles.settingsSection}>
      <Text style={styles.sectionHeading}>{tr("Availability")}</Text>
      <Text style={styles.pairingHint}>
        {tr("Agent Tick shares coarse last-seen and availability with your Workspaces so Routing Rules can route Requests. Use Do Not Disturb or Off-call when you should not be interrupted.")}
      </Text>
      <View style={styles.availabilityGrid}>
        {(["available", "busy", "do-not-disturb", "off-call"] as AvailabilityState[]).map((state) => (
          <Pressable
            key={state}
            onPress={() => { trackButton("set_availability", { availability: state }); onAvailabilityChange?.(state); }}
            style={[
              styles.availabilityButton,
              availability === state ? styles.availabilityButtonActive : null,
            ]}
          >
            <Text
              style={[
                styles.availabilityButtonText,
                availability === state ? styles.availabilityButtonTextActive : null,
              ]}
            >
              {availabilityLabel(state)}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  ) : null;

  const securitySection = (
    <View
      onLayout={(event) => {
        e2eeSectionY.current = event.nativeEvent.layout.y;
      }}
      style={[styles.settingsSection, e2eeFocusToken ? styles.focusedSettingsSection : null]}
    >
      <Text style={styles.sectionHeading}>{tr("End-to-end encryption")}</Text>
      <Text style={styles.pairingHint}>{tr("Paste the shared Request encryption key or passphrase for this device to decrypt encrypted Request details locally.")}</Text>
      <TextInput
        autoCapitalize="none"
        autoCorrect={false}
        onChangeText={(value) => setE2eeKey?.(value.trim())}
        placeholder="key or passphrase"
        secureTextEntry
        style={styles.input}
        value={e2eeKey}
      />
    </View>
  );

  const requestDisplaySection = (
    <View style={styles.settingsSection}>
      <Text style={styles.sectionHeading}>{tr("Request display")}</Text>
      <Text style={styles.pairingHint}>{tr("Tune how long Requests present their choices. Inline actions appear after the message, so you can scroll through the full context before deciding.")}</Text>
      <View style={styles.fieldGroup}>
        <Text style={styles.label}>{tr("Choice behavior")}</Text>
        <View style={styles.segmentedControl}>
          {([
            ["click-to-submit", tr("Clickable")],
            ["select-then-submit", tr("Select + send")],
          ] as const).map(([mode, label]) => (
            <Pressable
              key={mode}
              onPress={() => { trackButton("request_choice_mode", { mode }); onChoiceInteractionModeChange?.(mode); }}
              style={[styles.segmentButton, choiceInteractionMode === mode ? styles.segmentButtonActive : null]}
            >
              <Text style={[styles.segmentButtonText, choiceInteractionMode === mode ? styles.segmentButtonTextActive : null]}>{label}</Text>
            </Pressable>
          ))}
        </View>
      </View>
      <View style={styles.fieldGroup}>
        <Text style={styles.label}>{tr("Action placement")}</Text>
        <View style={styles.segmentedControl}>
          {([
            ["inline-after-content", tr("After content")],
            ["sticky-bottom", tr("Sticky bottom")],
          ] as const).map(([placement, label]) => (
            <Pressable
              key={placement}
              onPress={() => { trackButton("request_option_placement", { placement }); onOptionPlacementChange?.(placement); }}
              style={[styles.segmentButton, optionPlacement === placement ? styles.segmentButtonActive : null]}
            >
              <Text style={[styles.segmentButtonText, optionPlacement === placement ? styles.segmentButtonTextActive : null]}>{label}</Text>
            </Pressable>
          ))}
        </View>
      </View>
      <Pressable
        onPress={() => { trackButton("request_confirm_before_submit", { enabled: !confirmBeforeSubmit }); onConfirmBeforeSubmitChange?.(!confirmBeforeSubmit); }}
        style={styles.toggleRow}
      >
        <Text style={styles.toggleLabel}>{tr("Confirm clickable submissions")}</Text>
        <Text style={styles.toggleValue}>{confirmBeforeSubmit ? tr("On") : "Off"}</Text>
      </Pressable>
    </View>
  );

  const selfHostedSetupSections = (
    <>
      <View style={styles.settingsSection}>
        <Text style={styles.sectionHeading}>{tr("Pairing")}</Text>
        <Text style={styles.pairingHint}>
          {tr("Scan the QR code from")} <Text style={styles.pairingCode}>agent-tick pair</Text> {tr("to connect.")}
        </Text>
        <Pressable onPress={() => { trackButton("scan_pairing_qr"); onScanPairing(); }} style={styles.primaryButton}>
          <Text style={styles.primaryButtonText}>{tr("Scan Pairing QR")}</Text>
        </Pressable>
      </View>

      <View style={styles.settingsSection}>
        <Text style={styles.sectionHeading}>{tr("Connection")}</Text>
        <View style={styles.statusRow}>
          <ConnectionBadge status={connectionStatus} />
          {loading ? <ActivityIndicator color="#202124" /> : null}
        </View>
        {error ? <Text style={styles.errorText}>{error}</Text> : null}
        <View style={styles.fieldGroup}>
          <Text style={styles.label}>{tr("Server URL")}</Text>
          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            inputMode="url"
            onChangeText={setServerURL}
            placeholder="https://tick.example.com"
            style={styles.input}
            value={serverURL}
          />
        </View>
        <Pressable onPress={() => { trackButton("check_connection_unpaired"); onCheck(); }} style={styles.primaryButton}>
          <Text style={styles.primaryButtonText}>{tr("Check Connection")}</Text>
        </Pressable>
      </View>

      <View style={styles.settingsSection}>
        <Pressable
          onPress={() => { trackButton("toggle_advanced", { nextOpen: !advancedOpen }); setAdvancedOpen((v) => !v); }}
          style={styles.advancedToggle}
        >
          <Text style={styles.sectionHeading}>{tr("Advanced")}</Text>
          <Text style={styles.advancedChevron}>{advancedOpen ? "▲" : "▼"}</Text>
        </Pressable>
        {advancedOpen && (
          <>
            <View style={styles.fieldGroup}>
              <Text style={styles.label}>{tr("Manual Pairing Code")}</Text>
              <TextInput
                autoCapitalize="none"
                autoCorrect={false}
                onChangeText={setPairingCode}
                placeholder="pair_..."
                style={styles.input}
                value={pairingCode}
              />
              <Pressable onPress={() => { trackButton("pair_manually", { hasPairingCode: Boolean(pairingCode) }); onPairDevice(); }} style={styles.primaryButton}>
                <Text style={styles.primaryButtonText}>{tr("Pair Manually")}</Text>
              </Pressable>
            </View>
            <View style={styles.fieldGroup}>
              <Text style={styles.label}>{tr("Manual Bearer Token")}</Text>
              <TextInput
                autoCapitalize="none"
                autoCorrect={false}
                onChangeText={setToken}
                placeholder="test-token"
                secureTextEntry
                style={styles.input}
                value={token}
              />
            </View>
          </>
        )}
      </View>
    </>
  );

  if (settingsView === "accounts") {
    return (
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={styles.settingsContent}
        style={styles.settingsPane}
      >
        <View style={styles.settingsSection}>
          <Pressable accessibilityLabel={tr("‹ Account")} accessibilityRole="button" onPress={() => { trackButton("accounts_back"); setSettingsView("account"); }} style={styles.backButton}>
            <Text style={styles.secondaryActionText}>{tr("‹ Account")}</Text>
          </Pressable>
          <Text style={styles.sectionHeading}>{tr("Accounts")}</Text>
          <Text style={styles.pairingHint}>{tr("Choose a saved account or add another Agent Tick account on this device.")}</Text>
        </View>
        <View style={styles.settingsSection}>
          <View style={styles.workspaceList}>
            <View style={[styles.workspaceButton, styles.workspaceButtonActive]}>
              <Pressable onPress={() => { trackButton("current_account_selected"); setSettingsView("account"); }} style={styles.accountSelectArea}>
                <Text style={[styles.label, styles.workspaceNameActive]}>{tr("Current")}</Text>
                <Text style={[styles.workspaceName, styles.workspaceNameActive]}>{currentAccountTitle}</Text>
                <Text style={[styles.workspaceMeta, styles.workspaceNameActive]}>{currentAccountMeta}</Text>
              </Pressable>
              <Pressable onPress={() => { trackButton(isClerkMode ? "sign_out_current_account" : "forget_current_device"); setSettingsView("home"); onForgetDevice(); }} style={styles.signOutAccountButton}>
                <Text style={styles.signOutAccountText}>{tr("Sign Out")}</Text>
              </Pressable>
            </View>
            {accounts.filter((account) => !isCurrentSavedAccount(account, { authProvider, currentAccountProfile, deviceID, selectedWorkspaceID, serverURL })).map((account) => (
              <View key={account.id} style={styles.workspaceButton}>
                <Pressable
                  onPress={() => {
                    trackButton("saved_account_select", { targetAccountID: account.id, targetAuthProvider: account.authProvider, targetUserID: account.userID, targetEmail: account.email, targetSignInMethod: account.signInMethod });
                    setSettingsView("home");
                    onSavedAccountSelect?.(account);
                  }}
                  style={styles.accountSelectArea}
                >
                  <Text style={styles.workspaceName}>{account.label}</Text>
                  <Text style={styles.workspaceMeta}>{savedAccountDetails(account)}</Text>
                </Pressable>
                {onSavedAccountRemove ? (
                  <Pressable onPress={() => { trackButton("saved_account_remove", { targetAccountID: account.id, targetAuthProvider: account.authProvider, targetUserID: account.userID, targetEmail: account.email, targetSignInMethod: account.signInMethod }); onSavedAccountRemove(account); }} style={styles.removeAccountButton}>
                    <Text style={styles.removeAccountText}>{tr("Sign Out")}</Text>
                  </Pressable>
                ) : null}
              </View>
            ))}
          </View>
          {isClerkMode && onSignInAnotherClerkAccount ? (
            <Pressable onPress={() => { trackButton("add_another_clerk_account"); onSignInAnotherClerkAccount(); }} style={styles.primaryButton}>
              <Text style={styles.primaryButtonText}>{tr("Add another account")}</Text>
            </Pressable>
          ) : onUseHosted ? (
            <Pressable onPress={() => { trackButton("add_hosted_account"); onUseHosted(); }} style={styles.primaryButton}>
              <Text style={styles.primaryButtonText}>{tr("Add agenttick.sh account")}</Text>
            </Pressable>
          ) : null}
        </View>
      </ScrollView>
    );
  }

  if (settingsView === "access") {
    return (
      <ScrollView ref={scrollRef} contentContainerStyle={styles.settingsContent} style={styles.settingsPane}>
        {renderBackButton()}
        {appAccessSection}
      </ScrollView>
    );
  }

  if (settingsView === "general") {
    return (
      <ScrollView ref={scrollRef} contentContainerStyle={styles.settingsContent} style={styles.settingsPane}>
        {renderBackButton()}
        {generalSections}
      </ScrollView>
    );
  }

  if (settingsView === "notifications") {
    return (
      <ScrollView ref={scrollRef} contentContainerStyle={styles.settingsContent} style={styles.settingsPane}>
        {renderBackButton()}
        {notificationsSection}
      </ScrollView>
    );
  }

  if (isPaired && settingsView === "security") {
    return (
      <ScrollView ref={scrollRef} contentContainerStyle={styles.settingsContent} style={styles.settingsPane}>
        {renderBackButton()}
        {securitySection}
      </ScrollView>
    );
  }

  if (isPaired && settingsView === "request-display") {
    return (
      <ScrollView ref={scrollRef} contentContainerStyle={styles.settingsContent} style={styles.settingsPane}>
        {renderBackButton()}
        {requestDisplaySection}
      </ScrollView>
    );
  }

  if (isPaired && settingsView === "account") {
    return (
      <ScrollView ref={scrollRef} contentContainerStyle={styles.settingsContent} style={styles.settingsPane}>
        <View style={styles.settingsSection}>
          <Pressable accessibilityLabel={tr("‹ Settings")} accessibilityRole="button" onPress={() => { trackButton("account_back"); setSettingsView("home"); }} style={styles.backButton}>
            <Text style={styles.secondaryActionText}>{tr("‹ Settings")}</Text>
          </Pressable>
          <Text style={styles.sectionHeading}>{tr("Account")}</Text>
          {error ? <Text style={styles.errorText}>{error}</Text> : null}
          <View style={styles.accountSummaryButton}>
            <Text style={styles.label}>{tr("Current account")}</Text>
            <Text style={styles.accountSummaryName}>{currentAccountTitle}</Text>
            <Text style={styles.accountSummaryMeta}>{currentAccountMeta}</Text>
            <View style={styles.statusRow}>
              <ConnectionBadge status={connectionStatus} />
              {loading ? <ActivityIndicator color="#202124" /> : null}
            </View>
          </View>
          <Pressable onPress={() => openSettingsView("accounts", "open_account_switcher")} style={styles.secondaryActionButton}>
            <Text style={styles.secondaryActionText}>{tr("Switch accounts")}</Text>
          </Pressable>
          <Pressable onPress={() => { trackButton("check_connection"); onCheck(); }} style={styles.primaryButton}>
            <Text style={styles.primaryButtonText}>{tr("Check Connection")}</Text>
          </Pressable>
          {!hasMultipleAccounts ? (
            <Pressable onPress={() => { trackButton(isClerkMode ? "sign_out" : "forget_device"); onForgetDevice(); }} style={styles.secondaryActionButton}>
              <Text style={styles.secondaryActionText}>{isClerkMode ? tr("Sign Out") : tr("Forget Device")}</Text>
            </Pressable>
          ) : null}
          {!isClerkMode && onUseHosted ? (
            <Pressable onPress={() => { trackButton("use_hosted"); onUseHosted(); }} style={styles.secondaryActionButton}>
              <Text style={styles.secondaryActionText}>{tr("Use Agent Tick Hosted")}</Text>
            </Pressable>
          ) : null}
        </View>
        {workspaceSection}
        {availabilitySection}
      </ScrollView>
    );
  }

  if (!isPaired && settingsView === "self-hosted") {
    return (
      <ScrollView ref={scrollRef} contentContainerStyle={styles.settingsContent} style={styles.settingsPane}>
        {renderBackButton()}
        {selfHostedSetupSections}
      </ScrollView>
    );
  }

  if (isPaired) {
    return (
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={styles.settingsContent}
        style={styles.settingsPane}
      >
        <View style={styles.settingsSection}>
          <Text style={styles.sectionHeading}>{tr("Settings")}</Text>
          <Text style={styles.pairingHint}>{tr("Choose what you want to change. Account, billing, security, and notification details now live on focused pages.")}</Text>
          {error ? <Text style={styles.errorText}>{error}</Text> : null}
          <Pressable onPress={() => openSettingsView("account", "open_account_settings")} style={styles.accountSummaryButton}>
            <Text style={styles.label}>{tr("Current account")}</Text>
            <Text style={styles.accountSummaryName}>{currentAccountTitle}</Text>
            <Text style={styles.accountSummaryMeta}>{currentAccountMeta}</Text>
            <Text style={styles.accountSummaryAction}>{tr("Manage account ›")}</Text>
          </Pressable>
        </View>
        <View style={styles.settingsSection}>
          {appAccessSection ? renderNavItem("App access", entitlementSummary || "Trial, purchases, and hosted service", "access", "open_app_access") : null}
          {renderNavItem("Notifications", notificationsEnabled ? "Request alerts and push status" : "Request alerts are off in Agent Tick", "notifications", "open_notifications_settings")}
          {renderNavItem("Security", "End-to-end Request decryption key", "security", "open_security_settings")}
          {renderNavItem("Request display", "Choice behavior, action placement, and confirmation", "request-display", "open_request_display_settings")}
          {renderNavItem("General", selectedLanguageLabel, "general", "open_general_settings", revealDiagnostics)}
        </View>
      </ScrollView>
    );
  }

  return (
    <ScrollView
      ref={scrollRef}
      contentContainerStyle={styles.settingsContent}
      style={styles.settingsPane}
    >
      <View style={styles.settingsSection}>
        <Text style={styles.sectionHeading}>{tr("Choose account type")}</Text>
        <Text style={styles.pairingHint}>{tr("Use the hosted Agent Tick service, or connect this app to your own self-hosted server.")}</Text>
      </View>

      <View style={styles.settingsSection}>
        {onUseHosted ? (
          <View style={styles.purchaseCard}>
            <Text style={styles.workspaceName}>{tr("Agent Tick Hosted")}</Text>
            <Text style={styles.workspaceMeta}>{tr("Sign in to agenttick.sh for hosted routing, push, updates, and uptime.")}</Text>
            <Pressable onPress={() => { trackButton("use_hosted_unpaired"); onUseHosted(); }} style={styles.primaryButton}>
              <Text style={styles.primaryButtonText}>{tr("Sign in to agenttick.sh")}</Text>
            </Pressable>
          </View>
        ) : null}
        <View style={styles.purchaseCard}>
          <Text style={styles.workspaceName}>{tr("Self-hosted server")}</Text>
          <Text style={styles.workspaceMeta}>{tr("Connect to an Agent Tick server that you or your Workspace runs.")}</Text>
          <Pressable onPress={() => { trackButton("scan_pairing_qr"); onScanPairing(); }} style={styles.primaryButton}>
            <Text style={styles.primaryButtonText}>{tr("Scan Pairing QR")}</Text>
          </Pressable>
          <Pressable onPress={() => openSettingsView("self-hosted", "open_self_hosted_setup")} style={styles.secondaryActionButton}>
            <Text style={styles.secondaryActionText}>{tr("Manual self-hosted setup")}</Text>
          </Pressable>
        </View>
      </View>

      <View style={styles.settingsSection}>
        {appAccessSection ? renderNavItem("App access", entitlementSummary || "Trial, purchases, and hosted service", "access", "open_app_access") : null}
        {renderNavItem("General", selectedLanguageLabel, "general", "open_general_settings", revealDiagnostics)}
        {renderNavItem("Notifications", notificationsEnabled ? "Request alerts and push status" : "Request alerts are off in Agent Tick", "notifications", "open_notifications_settings")}
      </View>
    </ScrollView>
  );
}

function currentAccountLabel({
  authProvider,
  currentAccountProfile,
  deviceID,
  serverURL,
}: {
  authProvider?: string;
  currentAccountProfile?: Pick<MeResponse, "email" | "name" | "signInMethod"> | null;
  deviceID: string;
  serverURL: string;
}) {
  if (authProvider === "clerk") return currentAccountProfile?.signInMethod ? `${currentAccountProfile.signInMethod} account` : "Account";
  return deviceID ? `Device ${deviceID}` : serverURL;
}

function currentAccountDetails({
  authProvider,
  currentAccountProfile,
  serverURL,
}: {
  authProvider?: string;
  currentAccountProfile?: Pick<MeResponse, "email" | "signInMethod"> | null;
  selectedWorkspaceID?: string;
  serverURL: string;
}) {
  const serverHost = hostLabel(serverURL);
  const parts = authProvider === "clerk"
    ? [currentAccountProfile?.email, currentAccountProfile?.signInMethod ? `Sign-in method: ${currentAccountProfile.signInMethod}` : undefined, `Server: ${serverHost}`]
    : ["Self-hosted", serverHost];
  return parts.filter(Boolean).join(" · ") || serverHost;
}

function savedAccountDetails(account: SavedMobileAccount) {
  const serverHost = hostLabel(account.serverURL);
  if (account.authProvider === "clerk") {
    return [account.email, account.signInMethod ? `Sign-in method: ${account.signInMethod}` : undefined, serverHost].filter(Boolean).join(" · ");
  }
  return [`local device`, serverHost].filter(Boolean).join(" · ");
}

function priceForProduct(products: StoreProduct[], productKey: StoreProduct["productKey"]): string | undefined {
  return products.find((product) => product.productKey === productKey)?.priceString;
}

function hostedExpiryCopy(expiry: HostedUsageExpiry, tr: (value: string) => string): string {
  const date = formatHostedDate(expiry.expiresAt);
  if (expiry.source === "subscription") {
    return expiry.renewable ? `${tr("Hosted subscription renews on")} ${date}.` : `${tr("Hosted subscription expires on")} ${date}.`;
  }
  if (expiry.source === "included_month") return `${tr("Included hosted month ends on")} ${date}.`;
  if (expiry.source === "read_only_grace") return `${tr("Hosted read-only grace ends on")} ${date}.`;
  return `${tr("Hosted Trial ends on")} ${date}.`;
}

function purchaseAvailabilityCopy(reason: string | undefined): string {
  switch (reason) {
    case "already_unlocked":
      return translateSource("Already purchased for this Agent Tick account.");
    case "already_subscribed":
      return translateSource("Hosted service is already active.");
    case "active_on_other_platform":
      return translateSource("Hosted service is active on another app-store platform.");
    case "purchase_in_progress":
      return translateSource("A purchase is already in progress. Try again in a few minutes.");
    case "app_purchase_required":
      return translateSource("Buy Lifetime app unlock before subscribing to hosted service.");
    case "trial_active":
      return translateSource("Hosted service is included during Trial.");
    case "included_hosted_month_active":
      return translateSource("The included hosted month is active. Subscribe after it ends.");
    case "billing_disabled":
      return translateSource("Purchases are not enabled on this server.");
    default:
      return translateSource("Purchase is not available right now.");
  }
}

function isCurrentSavedAccount(
  account: SavedMobileAccount,
  current: {
    authProvider?: string;
    currentAccountProfile?: Pick<MeResponse, "userId" | "email"> | null;
    deviceID: string;
    selectedWorkspaceID?: string;
    serverURL: string;
  },
) {
  if (account.authProvider !== current.authProvider || normalizeServerURL(account.serverURL) !== normalizeServerURL(current.serverURL)) return false;
  if (account.authProvider === "clerk") {
    if (account.userID && current.currentAccountProfile?.userId) return account.userID === current.currentAccountProfile.userId;
    if (account.email && current.currentAccountProfile?.email) return account.email.trim().toLowerCase() === current.currentAccountProfile.email.trim().toLowerCase();
    return false;
  }
  if (account.deviceID && current.deviceID) return account.deviceID === current.deviceID;
  return Boolean(account.workspaceID && account.workspaceID === current.selectedWorkspaceID);
}

function normalizeServerURL(serverURL: string) {
  return serverURL.trim().replace(/\/+$/, "");
}

function hostLabel(serverURL: string) {
  try {
    return new URL(serverURL).host;
  } catch {
    return serverURL;
  }
}

function availabilityLabel(state: AvailabilityState) {
  switch (state) {
    case "available":
      return translateSource("Available");
    case "busy":
      return translateSource("Busy");
    case "do-not-disturb":
      return translateSource("Do Not Disturb");
    case "off-call":
      return translateSource("Off-call");
  }
}

const styles = StyleSheet.create({
  settingsPane: {
    flex: 1,
  },
  settingsContent: {
    gap: 16,
    paddingHorizontal: 20,
    paddingBottom: 32,
  },
  settingsSection: {
    backgroundColor: "#ffffff",
    borderColor: "#ded6c6",
    borderRadius: 8,
    borderWidth: 1,
    gap: 12,
    padding: 14,
  },
  focusedSettingsSection: {
    borderColor: "#1f6f5b",
    borderWidth: 2,
  },
  sectionHeading: {
    color: "#202124",
    fontSize: 24,
    fontWeight: "900",
  },
  statusRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 12,
    minHeight: 28,
  },
  errorText: {
    color: "#9b1c1c",
    fontSize: 14,
    lineHeight: 20,
    marginTop: 8,
    textAlign: "center",
  },
  fieldGroup: {
    gap: 8,
  },
  label: {
    color: "#545044",
    fontSize: 13,
    fontWeight: "800",
    textTransform: "uppercase",
  },
  input: {
    backgroundColor: "#ffffff",
    borderColor: "#ded6c6",
    borderRadius: 8,
    borderWidth: 1,
    color: "#202124",
    fontSize: 16,
    minHeight: 50,
    padding: 12,
  },
  primaryButton: {
    alignItems: "center",
    backgroundColor: "#202124",
    borderRadius: 8,
    minHeight: 52,
    justifyContent: "center",
    paddingHorizontal: 14,
  },
  primaryButtonText: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "900",
  },
  disabledButton: {
    opacity: 0.55,
  },
  purchaseCard: {
    borderColor: "#ded6c6",
    borderRadius: 8,
    borderWidth: 1,
    gap: 8,
    padding: 12,
  },
  priceText: {
    color: "#202124",
    fontSize: 18,
    fontWeight: "900",
  },
  deviceStatus: {
    color: "#202124",
    fontSize: 16,
    fontWeight: "900",
  },
  accountSummaryButton: {
    borderColor: "#ded6c6",
    borderRadius: 8,
    borderWidth: 1,
    gap: 5,
    padding: 12,
  },
  accountSummaryName: {
    color: "#202124",
    fontSize: 18,
    fontWeight: "900",
  },
  accountSummaryMeta: {
    color: "#5f5a4f",
    fontSize: 13,
    fontWeight: "700",
  },
  accountSummaryAction: {
    color: "#202124",
    fontSize: 14,
    fontWeight: "900",
    marginTop: 4,
  },
  navRow: {
    alignItems: "center",
    borderColor: "#ded6c6",
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    gap: 12,
    justifyContent: "space-between",
    minHeight: 68,
    padding: 12,
  },
  navRowText: {
    flex: 1,
    gap: 4,
  },
  navRowTitle: {
    color: "#202124",
    fontSize: 16,
    fontWeight: "900",
  },
  navRowSubtitle: {
    color: "#5f5a4f",
    fontSize: 13,
    fontWeight: "700",
  },
  navRowChevron: {
    color: "#202124",
    fontSize: 24,
    fontWeight: "900",
  },
  backButton: {
    alignSelf: "stretch",
    minHeight: 44,
    justifyContent: "center",
  },
  pairingHint: {
    color: "#5f5a4f",
    fontSize: 15,
  },
  pairingCode: {
    fontFamily: "monospace",
    fontWeight: "700",
  },
  advancedToggle: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  advancedChevron: {
    color: "#545044",
    fontSize: 14,
  },
  notificationStatus: {
    color: "#202124",
    fontSize: 18,
    fontWeight: "900",
  },
  notificationReminder: {
    backgroundColor: "#fff6d8",
    borderColor: "#e5c66a",
    borderRadius: 8,
    borderWidth: 1,
    gap: 10,
    padding: 12,
  },
  notificationReminderTitle: {
    color: "#202124",
    fontSize: 17,
    fontWeight: "900",
  },
  notificationReminderText: {
    color: "#5f5a4f",
    fontSize: 14,
    lineHeight: 20,
  },
  notificationActions: {
    flexDirection: "row",
    gap: 10,
  },
  availabilityGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 12,
  },
  availabilityButton: {
    borderColor: "#202124",
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  availabilityButtonActive: {
    backgroundColor: "#202124",
  },
  availabilityButtonText: {
    color: "#202124",
    fontSize: 13,
    fontWeight: "900",
  },
  availabilityButtonTextActive: {
    color: "#ffffff",
  },
  segmentedControl: {
    flexDirection: "row",
    gap: 8,
  },
  segmentButton: {
    alignItems: "center",
    borderColor: "#202124",
    borderRadius: 8,
    borderWidth: 1,
    flex: 1,
    minHeight: 44,
    justifyContent: "center",
    paddingHorizontal: 10,
  },
  segmentButtonActive: {
    backgroundColor: "#202124",
  },
  segmentButtonText: {
    color: "#202124",
    fontSize: 13,
    fontWeight: "900",
    textAlign: "center",
  },
  segmentButtonTextActive: {
    color: "#ffffff",
  },
  dropdown: {
    gap: 8,
  },
  dropdownButton: {
    alignItems: "center",
    borderColor: "#202124",
    borderRadius: 10,
    borderWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    minHeight: 48,
    paddingHorizontal: 12,
  },
  dropdownButtonText: {
    color: "#202124",
    fontSize: 14,
    fontWeight: "900",
  },
  dropdownChevron: {
    color: "#202124",
    fontSize: 18,
    fontWeight: "900",
  },
  dropdownMenu: {
    borderColor: "#ded6c6",
    borderRadius: 10,
    borderWidth: 1,
    overflow: "hidden",
  },
  dropdownItem: {
    backgroundColor: "#ffffff",
    borderBottomColor: "#f1ede4",
    borderBottomWidth: 1,
    minHeight: 44,
    justifyContent: "center",
    paddingHorizontal: 12,
  },
  dropdownItemActive: {
    backgroundColor: "#202124",
  },
  dropdownItemText: {
    color: "#202124",
    fontSize: 14,
    fontWeight: "800",
  },
  dropdownItemTextActive: {
    color: "#ffffff",
  },
  toggleRow: {
    alignItems: "center",
    borderColor: "#ded6c6",
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    minHeight: 48,
    paddingHorizontal: 12,
  },
  toggleLabel: {
    color: "#202124",
    flex: 1,
    fontSize: 15,
    fontWeight: "800",
  },
  toggleValue: {
    color: "#1f6f5b",
    fontSize: 15,
    fontWeight: "900",
  },
  workspaceList: {
    gap: 8,
  },
  workspaceButton: {
    borderColor: "#ded6c6",
    borderRadius: 8,
    borderWidth: 1,
    gap: 8,
    padding: 12,
  },
  accountSelectArea: {
    gap: 3,
  },
  removeAccountButton: {
    alignSelf: "flex-start",
    borderColor: "#9b1c1c",
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  removeAccountText: {
    color: "#9b1c1c",
    fontSize: 13,
    fontWeight: "900",
  },
  signOutAccountButton: {
    alignSelf: "flex-start",
    borderColor: "#ffffff",
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  signOutAccountText: {
    color: "#ffffff",
    fontSize: 13,
    fontWeight: "900",
  },
  workspaceButtonActive: {
    backgroundColor: "#202124",
    borderColor: "#202124",
  },
  workspaceName: {
    color: "#202124",
    fontSize: 16,
    fontWeight: "900",
  },
  workspaceMeta: {
    color: "#5f5a4f",
    fontSize: 13,
    fontWeight: "700",
  },
  workspaceNameActive: {
    color: "#ffffff",
  },
  secondaryActionButton: {
    alignItems: "center",
    borderColor: "#202124",
    borderRadius: 8,
    borderWidth: 1,
    flex: 1,
    minHeight: 46,
    justifyContent: "center",
    paddingHorizontal: 12,
  },
  secondaryActionButtonDisabled: {
    backgroundColor: "#f1ede4",
    borderColor: "#b9ad9b",
    opacity: 0.7,
  },
  secondaryActionText: {
    color: "#202124",
    fontSize: 15,
    fontWeight: "900",
  },
  secondaryActionTextDisabled: {
    color: "#5f5a4f",
  },
  connectionBadge: {
    alignItems: "center",
    flexDirection: "row",
    gap: 7,
    marginTop: 4,
  },
  connectionDot: {
    backgroundColor: "#8b8172",
    borderRadius: 5,
    height: 10,
    width: 10,
  },
  connectionDotOk: {
    backgroundColor: "#1f6f5b",
  },
  connectionDotBad: {
    backgroundColor: "#a33b2f",
  },
  connectionText: {
    color: "#5f5a4f",
    fontSize: 13,
    fontWeight: "700",
  },
});
