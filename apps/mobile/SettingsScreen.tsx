import { useEffect, useRef, useState, type ReactNode } from "react";
import type { MeResponse } from "@self-deprecated/agent-tick-sdk";
import { localeName, supportedLocales, translateSource, type LocalePreference, type SupportedLocale } from "@agent-tick/i18n";
import type { PersonalBillingStatus } from "@self-deprecated/agent-tick-shared";
import type { StoreProduct } from "./purchases";
import { entitlementStatusCopy, formatHostedDate, hostedUsageExpiry, type HostedUsageExpiry } from "./AppLogic";
import type { SavedMobileAccount } from "./mobileAuth";
import {
  ActivityIndicator,
  Alert,
  Linking,
  Platform,
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
type SettingsView = "home" | "account" | "accounts" | "access" | "general" | "developer" | "notifications" | "self-hosted";

const AVAILABILITY_SETTINGS_ENABLED = false;
const LEGAL_LINKS = {
  privacy: "https://agenttick.sh/privacy",
  terms: "https://agenttick.sh/terms",
  support: "https://agenttick.sh/support",
} as const;

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
  error,
  loading,
  activeLocale = "en",
  localePreference = "system",
  onLocalePreferenceChange = () => {},
  notificationStatus,
  notificationsEnabled = true,
  onAvailabilityChange,
  onCheck,
  onForgetDevice,
  onClearHostedLoginSession,
  onResetLocalTestState,
  onDeleteAccount,
  onPairDevice,
  onDiagnosticsEnabledChange,
  onDiagnosticEvent,
  onSignInAnotherClerkAccount,
  onNotificationsEnabledChange,
  onRegisterPush,
  onRequestNotifications,
  onSavedAccountRemove,
  onSendDiagnosticSnapshot,
  onSendTestNotification,
  onShowHostedExpiryWarning,
  onShowNativePaywall,
  nativeAppEntitlement,
  personalBillingStatus,
  entitlementSourceDiagnostics = [],
  storeProducts = [],
  trialRemainingLabel = "",
  hostedPersonalActive = false,
  onPurchaseLifetimeUnlock,
  onRestorePurchases,
  onLinkPurchasesToHostedAccount,
  onSubscribeHostedPersonal,
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
  setServerURL,
  setToken,
  settingsViewTarget = "home",
  settingsViewSignal = 0,
  token,
}: {
  accounts?: SavedMobileAccount[];
  availability?: AvailabilityState;
  authProvider?: string;
  connectionStatus: ConnectionStatus;
  currentAccountProfile?: Pick<MeResponse, "userId" | "email" | "name" | "signInMethod" | "source" | "authProvider"> | null;
  error: string | null;
  loading: boolean;
  activeLocale?: SupportedLocale;
  localePreference?: LocalePreference;
  onLocalePreferenceChange?: (preference: LocalePreference) => void;
  notificationStatus: NotificationStatus;
  onAvailabilityChange?: (state: AvailabilityState) => void;
  onCheck: () => void;
  onForgetDevice: () => void;
  onClearHostedLoginSession?: () => void;
  onResetLocalTestState?: () => void;
  onDeleteAccount?: () => void;
  onPairDevice: () => void;
  onDiagnosticsEnabledChange?: (enabled: boolean) => void;
  onDiagnosticEvent?: (area: string, message: string, metadata?: Record<string, unknown>) => void;
  notificationsEnabled?: boolean;
  onNotificationsEnabledChange?: (enabled: boolean) => void;
  onRegisterPush: () => void;
  onRequestNotifications: () => void;
  onSavedAccountRemove?: (account: SavedMobileAccount) => void;
  onSendDiagnosticSnapshot?: () => void;
  onSendTestNotification: () => void;
  onShowHostedExpiryWarning?: () => void;
  onShowNativePaywall?: () => void;
  nativeAppEntitlement?: { trialActive: boolean; trialPurchased: boolean; lifetimeUnlocked: boolean; readOnly: boolean; hostedSubscriptionActive: boolean; trialRemainingMs?: number };
  personalBillingStatus?: PersonalBillingStatus | null;
  entitlementSourceDiagnostics?: string[];
  storeProducts?: StoreProduct[];
  trialRemainingLabel?: string;
  hostedPersonalActive?: boolean;
  onPurchaseLifetimeUnlock?: () => void;
  onRestorePurchases?: () => void;
  onLinkPurchasesToHostedAccount?: () => void;
  onSubscribeHostedPersonal?: (period: "monthly" | "yearly") => void;
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
  settingsViewTarget?: "home" | "notifications";
  settingsViewSignal?: number;
  setServerURL: (value: string) => void;
  setToken: (value: string) => void;
  token: string;
}) {
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [settingsView, setSettingsView] = useState<SettingsView>("home");
  const [languageOpen, setLanguageOpen] = useState(false);
  const [entitlementDiagnosticsOpen, setEntitlementDiagnosticsOpen] = useState(false);
  const [diagnosticLogsOpen, setDiagnosticLogsOpen] = useState(false);
  const scrollRef = useRef<ScrollView | null>(null);
  const isClerkMode = authProvider === "clerk";
  const isPaired = isClerkMode || !!deviceID;
  const isPushRegistered = pushStatus === "registered";
  const isPushRegistrationDisabled = !notificationsEnabled || isPushRegistered;
  const shouldRemindNotifications = notificationsEnabled && isPaired && (notificationStatus === "denied" || notificationStatus === "undetermined");
  const trackButton = (button: string, metadata?: Record<string, unknown>) => {
    onDiagnosticEvent?.("button", button, { settingsView, ...metadata });
  };

  useEffect(() => {
    setSettingsView(settingsViewTarget);
  }, [settingsViewSignal, settingsViewTarget]);

  const tr = translateSource;
  const openSettingsView = (nextView: SettingsView, button: string, metadata?: Record<string, unknown>) => {
    trackButton(button, metadata);
    setSettingsView(nextView);
  };

  const currentAccountTitle = currentAccountLabel({ authProvider, currentAccountProfile, deviceID, serverURL });
  const currentAccountMeta = currentAccountDetails({ authProvider, currentAccountProfile, selectedWorkspaceID, serverURL });
  const connectionSummaryTitle = accounts.length === 1 ? tr("1 connection") : `${accounts.length} ${tr("connections")}`;
  const connectionSummaryMeta = accounts.length > 0
    ? tr("This phone receives Requests from all saved connections.")
    : tr("No saved connections yet.");

  const selectedLanguageLabel = localePreference === "system"
    ? `${tr("System")} (${localeName(activeLocale)})`
    : localeName(localePreference);
  const languageOptions: Array<{ code: LocalePreference; label: string; diagnostic: string }> = [
    { code: "system", label: `${tr("System")} (${localeName(activeLocale)})`, diagnostic: "language_system" },
    ...supportedLocales.map((locale) => ({ code: locale.code, label: locale.nativeLabel, diagnostic: "language_select" })),
  ];

  const entitlementCopy = nativeAppEntitlement ? entitlementStatusCopy({ trialRemainingMs: 0, ...nativeAppEntitlement }) : null;
  const entitlementSummary = entitlementCopy?.summary;
  const lifetimeAvailability = personalBillingStatus?.purchaseAvailability.lifetime_unlock;
  const monthlyAvailability = personalBillingStatus?.purchaseAvailability.hosted_personal_monthly;
  const yearlyAvailability = personalBillingStatus?.purchaseAvailability.hosted_personal_yearly;
  const billingStatusLoaded = Boolean(personalBillingStatus);
  const trialAvailability = personalBillingStatus?.purchaseAvailability.trial_7_day;
  const hasAnyAppAccessEntitlement = Boolean(nativeAppEntitlement?.trialPurchased || nativeAppEntitlement?.lifetimeUnlocked || nativeAppEntitlement?.hostedSubscriptionActive);
  const showTrialOffer = !hasAnyAppAccessEntitlement;
  const lifetimeBlocked = Boolean(nativeAppEntitlement?.lifetimeUnlocked || lifetimeAvailability?.allowed === false);
  const trialBlocked = Boolean(nativeAppEntitlement?.trialPurchased || trialAvailability?.allowed === false);
  const monthlyBlocked = Boolean(hostedPersonalActive || monthlyAvailability?.allowed === false);
  const yearlyBlocked = Boolean(hostedPersonalActive || yearlyAvailability?.allowed === false);
  const showHostedSubscriptionActions = Boolean(onSubscribeHostedPersonal && !hostedPersonalActive);
  const hostedStoreActive = Boolean(nativeAppEntitlement?.hostedSubscriptionActive || personalBillingStatus?.activeEntitlements.hostedPersonal.active);
  const localStoreLifetimeActive = Boolean(nativeAppEntitlement?.lifetimeUnlocked && !personalBillingStatus?.activeEntitlements.lifetimeUnlock.active);
  const lifetimeDescription = hostedPersonalActive && !nativeAppEntitlement?.lifetimeUnlocked
    ? tr("Optional: buy Self-hosted Lifetime only if you want self-hosted responses after your hosted subscription ends.")
    : tr("Use the Agent Tick app with self-hosted servers forever.");
  const hostedAccountCopy = billingStatusLoaded && !hostedPersonalActive
    ? tr("Hosted account: fresh. No Hosted subscription is linked to this Agent Tick account.")
    : null;
  const hostedStatusCopy = hostedPersonalActive
    ? tr("Hosted service is active. Hosted subscriptions also unlock self-hosted responses while active.")
    : tr("Subscribe monthly or yearly to use first-party hosted routing, push, updates, uptime, and hosted plus self-hosted responses while active.");
  const hostedLinkCopy = !billingStatusLoaded
    ? hostedStoreActive
      ? tr("Hosted subscription is active for this app-store account. Sign in to hosted Agent Tick to link routing, push, history, and billing.")
      : tr("You can subscribe now with your app-store account. Sign in later to link hosted routing, push, history, and billing.")
    : null;
  const hostedMonthlyPrice = priceForProduct(storeProducts, "hosted_personal_monthly") ?? tr("Monthly");
  const hostedYearlyPrice = priceForProduct(storeProducts, "hosted_personal_yearly") ?? tr("Yearly");
  const hostedExpiry = personalBillingStatus ? hostedUsageExpiry(personalBillingStatus) : null;
  const hostedOriginPlatform = personalBillingStatus?.activeEntitlements.hostedPersonal.originPlatform;
  const crossPlatformHostedCopy = hostedOriginPlatformCopy(hostedOriginPlatform, Platform.OS, tr);
  const appAccessSection = nativeAppEntitlement && entitlementCopy ? (
    <View style={styles.settingsSection}>
      <Text style={styles.sectionHeading}>{tr("App access")}</Text>
      <View style={styles.purchaseCard}>
        <Text style={styles.workspaceName}>{tr(entitlementCopy.title)}</Text>
        <Text style={styles.workspaceMeta}>{entitlementSummary ? tr(entitlementSummary) : tr("Trial status unavailable")}</Text>
        <Text style={styles.pairingHint}>{tr(entitlementCopy.appAccess)}</Text>
        <Text style={styles.pairingHint}>{tr(entitlementCopy.hostedAccess)}</Text>
        <Text style={nativeAppEntitlement.readOnly ? styles.errorText : styles.pairingHint}>{tr(entitlementCopy.paywall)}</Text>
      </View>
      {showTrialOffer ? (
        <View style={styles.purchaseCard}>
          <Text style={styles.workspaceName}>{tr("7-day Trial")}</Text>
          <Text style={styles.workspaceMeta}>{tr("Start with a free App Store purchase. No subscription starts.")}</Text>
          <Text style={styles.priceText}>{priceForProduct(storeProducts, "trial_7_day") ?? tr("Free")}</Text>
          {trialAvailability?.reason && !nativeAppEntitlement.trialPurchased ? <Text style={styles.pairingHint}>{purchaseAvailabilityCopy(trialAvailability.reason)}</Text> : null}
          <Pressable disabled={trialBlocked} onPress={() => onShowNativePaywall?.()} style={[styles.primaryButton, trialBlocked ? styles.disabledButton : null]}>
            <Text style={styles.primaryButtonText}>{nativeAppEntitlement.trialPurchased ? tr("Trial started") : tr("Start 7-day Trial")}</Text>
          </Pressable>
        </View>
      ) : null}
      <View style={styles.purchaseCard}>
        <Text style={styles.workspaceName}>{tr("Self-hosted Lifetime")}</Text>
        {nativeAppEntitlement.lifetimeUnlocked ? (
          <>
            <Text style={styles.workspaceMeta}>{localStoreLifetimeActive ? tr("Active on this App Store account, independent of your hosted Agent Tick account.") : tr("You own this app. Use it as much as you want with self-hosted Agent Tick servers.")}</Text>
            {localStoreLifetimeActive ? <Text style={styles.pairingHint}>{tr("Deleting or recreating a hosted account does not remove Self-hosted Lifetime from the same App Store account.")}</Text> : null}
          </>
        ) : (
          <>
            <Text style={styles.workspaceMeta}>{lifetimeDescription}</Text>
            <Text style={styles.priceText}>{priceForProduct(storeProducts, "lifetime_unlock") ?? tr("One-time purchase")}</Text>
            {lifetimeAvailability?.reason ? <Text style={styles.pairingHint}>{purchaseAvailabilityCopy(lifetimeAvailability.reason)}</Text> : null}
            <Pressable disabled={lifetimeBlocked} onPress={() => onPurchaseLifetimeUnlock?.()} style={[styles.primaryButton, lifetimeBlocked ? styles.disabledButton : null]}>
              <Text style={styles.primaryButtonText}>{tr("Buy Self-hosted Lifetime")}</Text>
            </Pressable>
          </>
        )}
      </View>
      <View style={styles.purchaseCard}>
        <Text style={styles.workspaceName}>{tr("Hosted service")}</Text>
        <Text style={styles.workspaceMeta}>{tr("Let us run Request routing, push, updates, uptime, and hosted plus self-hosted responses while active.")}</Text>
        {hostedAccountCopy ? <Text style={styles.pairingHint}>{hostedAccountCopy}</Text> : null}
        <Text style={styles.pairingHint}>{hostedStatusCopy}</Text>
        {hostedLinkCopy ? <Text style={styles.pairingHint}>{hostedLinkCopy}</Text> : null}
        {hostedExpiry ? <Text style={styles.pairingHint}>{hostedExpiryCopy(hostedExpiry, tr)}</Text> : null}
        {crossPlatformHostedCopy ? <Text style={styles.pairingHint}>{crossPlatformHostedCopy}</Text> : null}
        {monthlyAvailability?.reason || yearlyAvailability?.reason ? <Text style={styles.pairingHint}>{purchaseAvailabilityCopy(monthlyAvailability?.reason ?? yearlyAvailability?.reason)}</Text> : null}
        {showHostedSubscriptionActions ? (
          <View style={styles.subscriptionDisclosure}>
            <Text style={styles.label}>{tr("Hosted personal service")}</Text>
            <Text style={styles.pairingHint}>{tr("Includes hosted personal routing, push notifications, updates, uptime, and responses for your Agent Tick account.")}</Text>
            <Text style={styles.pairingHint}>{`${tr("Monthly")}: ${hostedMonthlyPrice}. ${tr("Yearly")}: ${hostedYearlyPrice}.`}</Text>
            <Text style={styles.pairingHint}>{tr("Subscriptions auto-renew until canceled. Manage or cancel in your App Store account settings.")}</Text>
            <View style={styles.notificationActions}>
              <Pressable onPress={() => { void openLegalLink("Terms", LEGAL_LINKS.terms); }} style={styles.secondaryActionButton}>
                <Text style={styles.secondaryActionText}>{tr("Terms")}</Text>
              </Pressable>
              <Pressable onPress={() => { void openLegalLink("Privacy Policy", LEGAL_LINKS.privacy); }} style={styles.secondaryActionButton}>
                <Text style={styles.secondaryActionText}>{tr("Privacy Policy")}</Text>
              </Pressable>
            </View>
            <View style={styles.notificationActions}>
              <Pressable disabled={monthlyBlocked} onPress={() => onSubscribeHostedPersonal?.("monthly")} style={[styles.secondaryActionButton, monthlyBlocked ? styles.secondaryActionButtonDisabled : null]}>
                <Text style={[styles.secondaryActionText, monthlyBlocked ? styles.secondaryActionTextDisabled : null]}>{hostedMonthlyPrice}</Text>
              </Pressable>
              <Pressable disabled={yearlyBlocked} onPress={() => onSubscribeHostedPersonal?.("yearly")} style={[styles.secondaryActionButton, yearlyBlocked ? styles.secondaryActionButtonDisabled : null]}>
                <Text style={[styles.secondaryActionText, yearlyBlocked ? styles.secondaryActionTextDisabled : null]}>{hostedYearlyPrice}</Text>
              </Pressable>
            </View>
          </View>
        ) : null}
        {hostedStoreActive || !showHostedSubscriptionActions ? (
          <Pressable onPress={() => onManageSubscription?.()} style={styles.secondaryActionButton}>
            <Text style={styles.secondaryActionText}>{tr("Manage subscription")}</Text>
          </Pressable>
        ) : null}
      </View>
      <Pressable onPress={() => onRestorePurchases?.()} style={styles.secondaryActionButton}>
        <Text style={styles.secondaryActionText}>{tr("Restore purchases")}</Text>
      </Pressable>
      {billingStatusLoaded && onLinkPurchasesToHostedAccount ? (
        <Pressable onPress={() => onLinkPurchasesToHostedAccount()} style={styles.secondaryActionButton}>
          <Text style={styles.secondaryActionText}>{tr("Link purchases to hosted account")}</Text>
        </Pressable>
      ) : null}
    </View>
  ) : null;

  const openLegalLink = async (label: string, url: string) => {
    trackButton("open_legal_link", { label, url });
    try {
      await Linking.openURL(url);
    } catch {
      Alert.alert(tr("Could not open link"), `${tr("Open this URL in your browser:")} ${url}`);
    }
  };

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

  const renderAccordion = ({
    title,
    summary,
    open,
    onToggle,
    children,
  }: {
    title: string;
    summary: string;
    open: boolean;
    onToggle: () => void;
    children: ReactNode;
  }) => (
    <View style={styles.accordionCard}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={onToggle}
        style={styles.accordionHeader}
      >
        <View style={styles.accordionHeaderText}>
          <Text style={styles.accordionTitle}>{tr(title)}</Text>
          <Text style={styles.accordionSummary}>{summary}</Text>
        </View>
        <Text style={styles.advancedChevron}>{open ? "▲" : "▼"}</Text>
      </Pressable>
      {open ? <View style={styles.accordionBody}>{children}</View> : null}
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

  const developerSection = (
    <View style={styles.settingsSection}>
      <Text style={styles.sectionHeading}>{tr("Developer")}</Text>
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
      {onResetLocalTestState ? (
        <>
          <Text style={styles.label}>{tr("Local test reset")}</Text>
          <Text style={styles.pairingHint}>{tr("Clears this app install's Agent Tick storage, saved connections, Clerk login cache, and local purchase cache. It does not erase App Store purchase history or hosted server entitlements.")}</Text>
          <Pressable onPress={() => { trackButton("debug_reset_local_test_state"); onResetLocalTestState(); }} style={styles.secondaryActionButton}>
            <Text style={styles.secondaryActionText}>{tr("Reset local test state")}</Text>
          </Pressable>
        </>
      ) : null}
      {isClerkMode ? (
        <>
          <Text style={styles.label}>{tr("Hosted login session")}</Text>
          <Text style={styles.pairingHint}>{tr("Signs out of the current hosted login and removes that hosted connection from this phone. Other saved connections stay available.")}</Text>
          <Pressable onPress={() => { trackButton("debug_clear_hosted_login_session"); onClearHostedLoginSession?.(); }} style={styles.secondaryActionButton}>
            <Text style={styles.secondaryActionText}>{tr("Sign out of hosted login")}</Text>
          </Pressable>
        </>
      ) : null}
      {renderAccordion({
        title: "Entitlement source",
        summary: tr(entitlementSummary ?? "App access status unavailable"),
        open: entitlementDiagnosticsOpen,
        onToggle: () => {
          trackButton("toggle_entitlement_diagnostics", { nextOpen: !entitlementDiagnosticsOpen });
          setEntitlementDiagnosticsOpen((open) => !open);
        },
        children: (
          <View style={styles.diagnosticDetails}>
            <Text style={styles.pairingHint}>{tr("Shows which account, store identity, server entitlement, and final decision are currently driving access.")}</Text>
            {entitlementSourceDiagnostics.map((line) => (
              <Text key={line} style={styles.diagnosticLine}>{line}</Text>
            ))}
            {personalBillingStatus?.billingConflicts?.length ? (
              <Text style={styles.pairingHint}>{tr("Store subscription found, but it is linked to another Agent Tick account.")}</Text>
            ) : null}
          </View>
        ),
      })}
      {renderAccordion({
        title: "Diagnostic logs",
        summary: `${diagnosticsEnabled ? tr("Enabled") : tr("Disabled")} · ${tr("Buffered events:")} ${diagnosticsEventCount}`,
        open: diagnosticLogsOpen,
        onToggle: () => {
          trackButton("toggle_diagnostic_logs", { nextOpen: !diagnosticLogsOpen });
          setDiagnosticLogsOpen((open) => !open);
        },
        children: (
          <View style={styles.diagnosticDetails}>
            <Text style={styles.diagnosticLine}>{tr("Status:")} {diagnosticsEnabled ? tr("Enabled") : tr("Disabled")}</Text>
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
        ),
      })}
    </View>
  );

  const legalSection = (
    <View style={styles.settingsSection}>
      <Text style={styles.sectionHeading}>{tr("Legal & support")}</Text>
      <Text style={styles.pairingHint}>{tr("Review Agent Tick's policies or contact support before or after signing in.")}</Text>
      <View style={styles.notificationActions}>
        <Pressable onPress={() => { void openLegalLink("Privacy Policy", LEGAL_LINKS.privacy); }} style={styles.secondaryActionButton}>
          <Text style={styles.secondaryActionText}>{tr("Privacy Policy")}</Text>
        </Pressable>
        <Pressable onPress={() => { void openLegalLink("Terms", LEGAL_LINKS.terms); }} style={styles.secondaryActionButton}>
          <Text style={styles.secondaryActionText}>{tr("Terms")}</Text>
        </Pressable>
        <Pressable onPress={() => { void openLegalLink("Support", LEGAL_LINKS.support); }} style={styles.secondaryActionButton}>
          <Text style={styles.secondaryActionText}>{tr("Support")}</Text>
        </Pressable>
      </View>
    </View>
  );

  const generalSections = (
    <>
      {languageSection}
      {legalSection}

    </>
  );

  const renderBackButton = (backView: SettingsView = "home", label = "‹ Settings") => (
    <View style={styles.settingsSection}>
      <Pressable accessibilityLabel={tr(label)} accessibilityRole="button" onPress={() => { trackButton("settings_back", { to: backView }); setSettingsView(backView); }} style={styles.backButton}>
        <Text style={styles.secondaryActionText}>{tr(label)}</Text>
      </Pressable>
    </View>
  );

  const renderNavItem = (title: string, subtitle: string, view: SettingsView, diagnostic: string) => (
    <Pressable onPress={() => openSettingsView(view, diagnostic)} style={styles.navRow}>
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

  const selfHostedSetupSections = (
    <>
      <View style={styles.settingsSection}>
        <Text style={styles.sectionHeading}>{tr("Pairing")}</Text>
        <Text style={styles.pairingHint}>
          {tr("Scan a pairing QR from your self-hosted Agent Tick server, or open Advanced to enter a pairing code manually.")}
        </Text>
        <Pressable onPress={() => { trackButton("scan_pairing_qr"); onScanPairing(); }} style={styles.primaryButton}>
          <Text style={styles.primaryButtonText}>{tr("Scan Pairing QR")}</Text>
        </Pressable>
      </View>

      <View style={styles.settingsSection}>
        <Text style={styles.sectionHeading}>{tr("Connection")}</Text>
        <Text style={styles.pairingHint}>{tr("Self-hosted server data is controlled by that server's operator, not hosted Agent Tick or Self-Deprecated ApS.")}</Text>
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
          <Pressable accessibilityLabel={tr("‹ Connections")} accessibilityRole="button" onPress={() => { trackButton("accounts_back"); setSettingsView("account"); }} style={styles.backButton}>
            <Text style={styles.secondaryActionText}>{tr("‹ Connections")}</Text>
          </Pressable>
          <Text style={styles.sectionHeading}>{tr("Connected accounts")}</Text>
          <Text style={styles.pairingHint}>{tr("Manage the accounts and servers this phone can receive Requests from. The inbox shows Requests from all connections together.")}</Text>
        </View>
        <View style={styles.settingsSection}>
          <View style={styles.workspaceList}>
            {accounts.length === 0 ? (
              <View style={styles.workspaceButton}>
                {isClerkMode ? (
                  <>
                    <Text style={styles.workspaceName}>{tr("No saved hosted connections")}</Text>
                    <Text style={styles.workspaceMeta}>{tr("Add a hosted connection to receive Requests from agenttick.sh on this phone.")}</Text>
                  </>
                ) : (
                  <>
                    <Text style={styles.workspaceName}>{currentAccountTitle}</Text>
                    <Text style={styles.workspaceMeta}>{currentAccountMeta}</Text>
                  </>
                )}
              </View>
            ) : null}
            {accounts.map((account) => (
              <View key={account.id} style={styles.workspaceButton}>
                <View style={styles.accountSelectArea}>
                  <Text style={styles.workspaceName}>{account.label}</Text>
                  <Text style={styles.workspaceMeta}>{savedAccountDetails(account)}</Text>
                </View>
                {onSavedAccountRemove ? (
                  <Pressable onPress={() => { trackButton("saved_connection_remove", { targetAccountID: account.id, targetAuthProvider: account.authProvider, targetUserID: account.userID, targetEmail: account.email, targetSignInMethod: account.signInMethod }); onSavedAccountRemove(account); }} style={styles.removeAccountButton}>
                    <Text style={styles.removeAccountText}>{tr("Remove")}</Text>
                  </Pressable>
                ) : null}
              </View>
            ))}
          </View>
          {isClerkMode && onSignInAnotherClerkAccount ? (
            <Pressable onPress={() => { trackButton("add_another_clerk_account"); onSignInAnotherClerkAccount(); }} style={styles.primaryButton}>
              <Text style={styles.primaryButtonText}>{tr("Add hosted connection")}</Text>
            </Pressable>
          ) : onUseHosted ? (
            <Pressable onPress={() => { trackButton("add_hosted_connection"); onUseHosted(); }} style={styles.primaryButton}>
              <Text style={styles.primaryButtonText}>{tr("Add agenttick.sh connection")}</Text>
            </Pressable>
          ) : null}
          <Pressable onPress={() => openSettingsView("self-hosted", "add_self_hosted_connection")} style={styles.secondaryActionButton}>
            <Text style={styles.secondaryActionText}>{tr("Add self-hosted connection")}</Text>
          </Pressable>
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

  if (settingsView === "developer") {
    return (
      <ScrollView ref={scrollRef} contentContainerStyle={styles.settingsContent} style={styles.settingsPane}>
        {renderBackButton()}
        {developerSection}
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

  if (isPaired && settingsView === "account") {
    return (
      <ScrollView ref={scrollRef} contentContainerStyle={styles.settingsContent} style={styles.settingsPane}>
        <View style={styles.settingsSection}>
          <Pressable accessibilityLabel={tr("‹ Settings")} accessibilityRole="button" onPress={() => { trackButton("account_back"); setSettingsView("home"); }} style={styles.backButton}>
            <Text style={styles.secondaryActionText}>{tr("‹ Settings")}</Text>
          </Pressable>
          <Text style={styles.sectionHeading}>{tr("Connections")}</Text>
          {error ? <Text style={styles.errorText}>{error}</Text> : null}
          <View style={styles.accountSummaryButton}>
            <Text style={styles.label}>{tr("Connection inbox")}</Text>
            <Text style={styles.accountSummaryName}>{connectionSummaryTitle}</Text>
            <Text style={styles.accountSummaryMeta}>{connectionSummaryMeta}</Text>
            <View style={styles.statusRow}>
              <ConnectionBadge status={connectionStatus} />
              {loading ? <ActivityIndicator color="#202124" /> : null}
            </View>
          </View>
          <Pressable onPress={() => openSettingsView("accounts", "open_connections")} style={styles.secondaryActionButton}>
            <Text style={styles.secondaryActionText}>{tr("Manage connections")}</Text>
          </Pressable>
          <Pressable onPress={() => { trackButton("check_connection"); onCheck(); }} style={styles.primaryButton}>
            <Text style={styles.primaryButtonText}>{tr("Check Connection")}</Text>
          </Pressable>
          {!isClerkMode ? (
            <Pressable onPress={() => { trackButton("forget_device"); onForgetDevice(); }} style={styles.secondaryActionButton}>
              <Text style={styles.secondaryActionText}>{tr("Forget Device")}</Text>
            </Pressable>
          ) : null}
          {isClerkMode && onDeleteAccount ? (
            <View style={styles.dangerZone}>
              <Text style={styles.label}>{tr("Danger zone")}</Text>
              <Text style={styles.pairingHint}>{tr("Delete your hosted Agent Tick account, hosted personal Requests and Activity, devices, and Agent Tick tokens. Shared Workspace content may remain.")}</Text>
              <Pressable onPress={() => { trackButton("delete_account"); onDeleteAccount(); }} style={styles.destructiveActionButton}>
                <Text style={styles.destructiveActionText}>{tr("Delete account")}</Text>
              </Pressable>
            </View>
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

  if (settingsView === "self-hosted") {
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
          {error ? <Text style={styles.errorText}>{error}</Text> : null}
          <Pressable onPress={() => openSettingsView("account", "open_account_settings")} style={styles.accountSummaryButton}>
            <Text style={styles.label}>{tr("Connections")}</Text>
            <Text style={styles.accountSummaryName}>{connectionSummaryTitle}</Text>
            <Text style={styles.accountSummaryMeta}>{connectionSummaryMeta}</Text>
            <Text style={styles.accountSummaryAction}>{tr("Manage connections ›")}</Text>
          </Pressable>
        </View>
        <View style={styles.settingsSection}>
          {renderNavItem("General", selectedLanguageLabel, "general", "open_general_settings")}
          {appAccessSection ? renderNavItem("App access", entitlementSummary || "Trial, purchases, and hosted service", "access", "open_app_access") : null}
          {renderNavItem("Notifications", notificationsEnabled ? "Request alerts and push status" : "Request alerts are off in Agent Tick", "notifications", "open_notifications_settings")}
          {renderNavItem("Developer", "Debug tools and diagnostics", "developer", "open_developer_settings")}
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
        {renderNavItem("General", selectedLanguageLabel, "general", "open_general_settings")}
        {appAccessSection ? renderNavItem("App access", entitlementSummary || "Trial, purchases, and hosted service", "access", "open_app_access") : null}
        {renderNavItem("Notifications", notificationsEnabled ? "Request alerts and push status" : "Request alerts are off in Agent Tick", "notifications", "open_notifications_settings")}
        {renderNavItem("Developer", "Debug tools and diagnostics", "developer", "open_developer_settings")}
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
  if (expiry.source === "read_only_grace") return `${tr("Hosted read-only grace ends on")} ${date}.`;
  return `${tr("Hosted Trial ends on")} ${date}.`;
}

function hostedOriginPlatformCopy(originPlatform: string | undefined, currentPlatform: string, tr: (message: string) => string): string {
  if (originPlatform === "ios") return tr("Active via Apple. Manage on iOS or the App Store.");
  if (originPlatform === "android") {
    return currentPlatform === "ios"
      ? tr("Hosted service is active on another platform. Manage it on the platform where it was purchased.")
      : tr("Active via Google. Manage on Android or Google Play.");
  }
  return "";
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
      return translateSource("A qualifying app access purchase is required before this action.");
    case "trial_active":
      return translateSource("Hosted service is included during Trial.");
    case "trial_already_started":
      return translateSource("The 7-day Trial has already been started for this account.");
    case "billing_disabled":
      return translateSource("Purchases are not enabled on this server.");
    default:
      return translateSource("Purchase is not available right now.");
  }
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
  accordionCard: {
    borderColor: "#ded6c6",
    borderRadius: 8,
    borderWidth: 1,
    overflow: "hidden",
  },
  accordionHeader: {
    alignItems: "center",
    flexDirection: "row",
    gap: 12,
    justifyContent: "space-between",
    minHeight: 58,
    padding: 12,
  },
  accordionHeaderText: {
    flex: 1,
    gap: 4,
  },
  accordionTitle: {
    color: "#202124",
    fontSize: 15,
    fontWeight: "900",
  },
  accordionSummary: {
    color: "#5f5a4f",
    fontSize: 13,
    fontWeight: "700",
  },
  accordionBody: {
    borderTopColor: "#f1ede4",
    borderTopWidth: 1,
    padding: 12,
  },
  diagnosticDetails: {
    gap: 8,
  },
  diagnosticLine: {
    color: "#202124",
    fontFamily: "monospace",
    fontSize: 12,
    lineHeight: 18,
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
  subscriptionDisclosure: {
    gap: 8,
  },
  dangerZone: {
    borderColor: "#9b1c1c",
    borderRadius: 8,
    borderWidth: 1,
    gap: 8,
    padding: 12,
  },
  destructiveActionButton: {
    alignItems: "center",
    borderColor: "#9b1c1c",
    borderRadius: 8,
    borderWidth: 1,
    minHeight: 46,
    justifyContent: "center",
    paddingHorizontal: 12,
  },
  destructiveActionText: {
    color: "#9b1c1c",
    fontSize: 15,
    fontWeight: "900",
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
