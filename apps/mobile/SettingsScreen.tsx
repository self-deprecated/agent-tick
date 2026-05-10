import { useEffect, useRef, useState } from "react";
import type { MeResponse } from "@agent-tick/sdk";
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

type OrganizationMembership = {
  organizationId: string;
  name: string;
  role?: string;
};

export function ConnectionBadge({ status }: { status: ConnectionStatus }) {
  const label =
    status === "connected"
      ? "Connected"
      : status === "checking"
        ? "Checking"
        : "Disconnected";

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
  notificationStatus,
  onAvailabilityChange,
  onCheck,
  onForgetDevice,
  onPairDevice,
  onDiagnosticsEnabledChange,
  onSignInAnotherClerkAccount,
  onRegisterPush,
  onRequestNotifications,
  onSavedAccountSelect,
  onSendDiagnosticSnapshot,
  onSendTestNotification,
  onScanPairing,
  onUseHosted,
  pairingCode,
  pushStatus,
  diagnosticsEnabled = false,
  diagnosticsEventCount = 0,
  diagnosticsLastSentAt,
  deviceID,
  organizations = [],
  selectedOrganizationID = "",
  serverURL,
  setPairingCode,
  setSelectedOrganizationID,
  setE2eeKey,
  setServerURL,
  setToken,
  token,
}: {
  accounts?: SavedMobileAccount[];
  availability?: AvailabilityState;
  authProvider?: string;
  connectionStatus: ConnectionStatus;
  currentAccountProfile?: Pick<MeResponse, "email" | "name" | "signInMethod" | "source" | "authProvider"> | null;
  e2eeFocusToken?: number;
  e2eeKey?: string;
  error: string | null;
  loading: boolean;
  notificationStatus: NotificationStatus;
  onAvailabilityChange?: (state: AvailabilityState) => void;
  onCheck: () => void;
  onForgetDevice: () => void;
  onPairDevice: () => void;
  onDiagnosticsEnabledChange?: (enabled: boolean) => void;
  onRegisterPush: () => void;
  onRequestNotifications: () => void;
  onSavedAccountSelect?: (account: SavedMobileAccount) => void;
  onSendDiagnosticSnapshot?: () => void;
  onSendTestNotification: () => void;
  onScanPairing: () => void;
  onSignInAnotherClerkAccount?: () => void;
  onUseHosted?: () => void;
  pairingCode: string;
  pushStatus: PushStatus;
  diagnosticsEnabled?: boolean;
  diagnosticsEventCount?: number;
  diagnosticsLastSentAt?: string;
  deviceID: string;
  organizations?: OrganizationMembership[];
  selectedOrganizationID?: string;
  serverURL: string;
  setPairingCode: (value: string) => void;
  setSelectedOrganizationID?: (value: string) => void;
  setE2eeKey?: (value: string) => void;
  setServerURL: (value: string) => void;
  setToken: (value: string) => void;
  token: string;
}) {
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [accountsOpen, setAccountsOpen] = useState(false);
  const [diagnosticsRevealed, setDiagnosticsRevealed] = useState(diagnosticsEnabled);
  const scrollRef = useRef<ScrollView | null>(null);
  const e2eeSectionY = useRef(0);

  useEffect(() => {
    if (!e2eeFocusToken) return;
    const timer = setTimeout(() => {
      scrollRef.current?.scrollTo({ y: Math.max(e2eeSectionY.current - 12, 0), animated: true });
    }, 80);
    return () => clearTimeout(timer);
  }, [e2eeFocusToken]);
  const isClerkMode = authProvider === "clerk";
  const isPaired = isClerkMode || !!deviceID;
  const shouldRemindNotifications = isPaired && (notificationStatus === "denied" || notificationStatus === "undetermined");

  const currentAccountTitle = currentAccountLabel({ authProvider, currentAccountProfile, deviceID, serverURL });
  const currentAccountMeta = currentAccountDetails({ authProvider, currentAccountProfile, selectedOrganizationID, serverURL });

  const notificationsSection = (
    <View style={styles.settingsSection}>
      <Pressable onLongPress={() => setDiagnosticsRevealed(true)}>
        <Text style={styles.label}>Notifications</Text>
      </Pressable>
      {shouldRemindNotifications ? (
        <View style={styles.notificationReminder}>
          <Text style={styles.notificationReminderTitle}>Enable approval alerts</Text>
          <Text style={styles.notificationReminderText}>
            Agent Tick works best when notifications are on, so urgent approval requests can reach you even when the app is closed.
          </Text>
          <Pressable onPress={onRequestNotifications} style={styles.primaryButton}>
            <Text style={styles.primaryButtonText}>Enable Notifications</Text>
          </Pressable>
        </View>
      ) : null}
      <Text style={styles.notificationStatus}>
        {notificationStatus === "granted"
          ? "On"
          : notificationStatus === "denied"
            ? "Off"
            : notificationStatus === "checking"
              ? "Checking"
              : "Not Asked"}
      </Text>
      <View style={styles.notificationActions}>
        <Pressable
          onPress={onRequestNotifications}
          style={styles.secondaryActionButton}
        >
          <Text style={styles.secondaryActionText}>Enable</Text>
        </Pressable>
        <Pressable
          onPress={onSendTestNotification}
          style={styles.secondaryActionButton}
        >
          <Text style={styles.secondaryActionText}>Test</Text>
        </Pressable>
      </View>
      <Text style={styles.notificationStatus}>
        Push: {pushStatus === "registered" ? "Registered" : pushStatus}
      </Text>
      <Pressable onPress={onRegisterPush} style={styles.secondaryActionButton}>
        <Text style={styles.secondaryActionText}>Register Push</Text>
      </Pressable>
      {diagnosticsRevealed ? (
        <View style={styles.diagnosticsPanel}>
          <Text style={styles.sectionHeading}>Diagnostics</Text>
          <Text style={styles.pairingHint}>
            Optional diagnostic logs help debug mobile auth, notification, and connection issues. Agent Tick avoids sending approval text, commands, bearer tokens, or Clerk secrets.
          </Text>
          <Text style={styles.notificationStatus}>Status: {diagnosticsEnabled ? "Enabled" : "Disabled"}</Text>
          <Text style={styles.pairingHint}>Buffered events: {diagnosticsEventCount}{diagnosticsLastSentAt ? ` · last sent ${diagnosticsLastSentAt}` : ""}</Text>
          <View style={styles.notificationActions}>
            <Pressable onPress={() => onDiagnosticsEnabledChange?.(!diagnosticsEnabled)} style={styles.secondaryActionButton}>
              <Text style={styles.secondaryActionText}>{diagnosticsEnabled ? "Disable" : "Enable"}</Text>
            </Pressable>
            <Pressable onPress={onSendDiagnosticSnapshot} style={styles.secondaryActionButton}>
              <Text style={styles.secondaryActionText}>Send Snapshot</Text>
            </Pressable>
          </View>
        </View>
      ) : null}
    </View>
  );

  if (accountsOpen) {
    return (
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={styles.settingsContent}
        style={styles.settingsPane}
      >
        <View style={styles.settingsSection}>
          <Pressable onPress={() => setAccountsOpen(false)} style={styles.backButton}>
            <Text style={styles.secondaryActionText}>‹ Settings</Text>
          </Pressable>
          <Text style={styles.sectionHeading}>Accounts</Text>
          <Text style={styles.pairingHint}>Choose a saved account or add another Agent Tick account on this device.</Text>
        </View>
        <View style={styles.settingsSection}>
          <Text style={styles.label}>Current account</Text>
          <View style={[styles.organizationButton, styles.organizationButtonActive]}>
            <Text style={[styles.organizationName, styles.organizationNameActive]}>{currentAccountTitle}</Text>
            <Text style={[styles.organizationMeta, styles.organizationNameActive]}>{currentAccountMeta}</Text>
          </View>
          {isClerkMode && onSignInAnotherClerkAccount ? (
            <Pressable onPress={onSignInAnotherClerkAccount} style={styles.primaryButton}>
              <Text style={styles.primaryButtonText}>Add another account</Text>
            </Pressable>
          ) : onUseHosted ? (
            <Pressable onPress={onUseHosted} style={styles.primaryButton}>
              <Text style={styles.primaryButtonText}>Add agenttick.sh account</Text>
            </Pressable>
          ) : null}
        </View>
        {accounts.length > 0 ? (
          <View style={styles.settingsSection}>
            <Text style={styles.sectionHeading}>Saved accounts</Text>
            <View style={styles.organizationList}>
              {accounts.map((account) => {
                const active = account.serverURL === serverURL && (!account.organizationID || account.organizationID === selectedOrganizationID);
                return (
                  <Pressable
                    key={account.id}
                    onPress={() => {
                      setAccountsOpen(false);
                      onSavedAccountSelect?.(account);
                    }}
                    style={[styles.organizationButton, active ? styles.organizationButtonActive : null]}
                  >
                    <Text style={[styles.organizationName, active ? styles.organizationNameActive : null]}>{account.label}</Text>
                    <Text style={[styles.organizationMeta, active ? styles.organizationNameActive : null]}>{savedAccountDetails(account)}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        ) : null}
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
          <View style={styles.statusRow}>
            <ConnectionBadge status={connectionStatus} />
            {loading ? <ActivityIndicator color="#202124" /> : null}
          </View>
          {error ? <Text style={styles.errorText}>{error}</Text> : null}
          <Pressable onPress={() => setAccountsOpen(true)} style={styles.accountSummaryButton}>
            <Text style={styles.label}>Current account</Text>
            <Text style={styles.accountSummaryName}>{currentAccountTitle}</Text>
            <Text style={styles.accountSummaryMeta}>{currentAccountMeta}</Text>
            <Text style={styles.accountSummaryAction}>Switch accounts ›</Text>
          </Pressable>
          <View style={styles.fieldGroup}>
            <Text style={styles.label}>Server URL</Text>
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
          <Pressable onPress={onCheck} style={styles.primaryButton}>
            <Text style={styles.primaryButtonText}>Check Connection</Text>
          </Pressable>
          <Pressable onPress={onForgetDevice} style={styles.secondaryActionButton}>
            <Text style={styles.secondaryActionText}>{isClerkMode ? "Sign Out" : "Forget Device"}</Text>
          </Pressable>
          {!isClerkMode && onUseHosted ? (
            <Pressable onPress={onUseHosted} style={styles.secondaryActionButton}>
              <Text style={styles.secondaryActionText}>Use agenttick.sh</Text>
            </Pressable>
          ) : null}
        </View>
        <View style={styles.settingsSection}>
          <Text style={styles.sectionHeading}>Workspace</Text>
          <Text style={styles.pairingHint}>
            Team and organization access is managed on the Agent Tick dashboard. This phone will only receive requests where your account or team is eligible to approve.
          </Text>
          {isClerkMode && organizations.length > 0 ? (
            <View style={styles.organizationList}>
              {organizations.map((membership) => {
                const active = membership.organizationId === selectedOrganizationID;
                return (
                  <Pressable
                    key={membership.organizationId}
                    onPress={() => setSelectedOrganizationID?.(membership.organizationId)}
                    style={[styles.organizationButton, active ? styles.organizationButtonActive : null]}
                  >
                    <Text style={[styles.organizationName, active ? styles.organizationNameActive : null]}>{membership.name}</Text>
                    <Text style={[styles.organizationMeta, active ? styles.organizationNameActive : null]}>{membership.role ?? "member"}</Text>
                  </Pressable>
                );
              })}
            </View>
          ) : isClerkMode ? (
            <Text style={styles.pairingHint}>No local Agent Tick organizations loaded yet.</Text>
          ) : null}
        </View>
        <View style={styles.settingsSection}>
          <Text style={styles.sectionHeading}>Availability</Text>
          <Text style={styles.pairingHint}>
            Agent Tick shares coarse last-seen and availability with your team so on-call and recently-active policies can route approvals. Use Do Not Disturb or Off-call when you should not be interrupted.
          </Text>
          <View style={styles.availabilityGrid}>
            {(["available", "busy", "do-not-disturb", "off-call"] as AvailabilityState[]).map((state) => (
              <Pressable
                key={state}
                onPress={() => onAvailabilityChange?.(state)}
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
        <View
          onLayout={(event) => {
            e2eeSectionY.current = event.nativeEvent.layout.y;
          }}
          style={[styles.settingsSection, e2eeFocusToken ? styles.focusedSettingsSection : null]}
        >
          <Text style={styles.sectionHeading}>End-to-end encryption</Text>
          <Text style={styles.pairingHint}>Paste the shared approval encryption key or passphrase for this device to decrypt encrypted request details locally.</Text>
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
        {notificationsSection}
      </ScrollView>
    );
  }

  return (
    <ScrollView
      contentContainerStyle={styles.settingsContent}
      style={styles.settingsPane}
    >
      <View style={styles.settingsSection}>
        <Text style={styles.sectionHeading}>Pairing</Text>
        <Text style={styles.pairingHint}>
          Scan the QR code from <Text style={styles.pairingCode}>agent-tick pair</Text> to connect.
        </Text>
        <Pressable onPress={onScanPairing} style={styles.primaryButton}>
          <Text style={styles.primaryButtonText}>Scan Pairing QR</Text>
        </Pressable>
      </View>

      <View style={styles.settingsSection}>
        <Text style={styles.sectionHeading}>Connection</Text>
        <View style={styles.statusRow}>
          <ConnectionBadge status={connectionStatus} />
          {loading ? <ActivityIndicator color="#202124" /> : null}
        </View>
        {error ? <Text style={styles.errorText}>{error}</Text> : null}
        <View style={styles.fieldGroup}>
          <Text style={styles.label}>Server URL</Text>
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
        <Pressable onPress={onCheck} style={styles.primaryButton}>
          <Text style={styles.primaryButtonText}>Check Connection</Text>
        </Pressable>
        {onUseHosted ? (
          <Pressable onPress={onUseHosted} style={styles.secondaryActionButton}>
            <Text style={styles.secondaryActionText}>Use agenttick.sh</Text>
          </Pressable>
        ) : null}
      </View>

      <View style={styles.settingsSection}>
        <Pressable
          onPress={() => setAdvancedOpen((v) => !v)}
          style={styles.advancedToggle}
        >
          <Text style={styles.sectionHeading}>Advanced</Text>
          <Text style={styles.advancedChevron}>{advancedOpen ? "▲" : "▼"}</Text>
        </Pressable>
        {advancedOpen && (
          <>
            <View style={styles.fieldGroup}>
              <Text style={styles.label}>Manual Pairing Code</Text>
              <TextInput
                autoCapitalize="none"
                autoCorrect={false}
                onChangeText={setPairingCode}
                placeholder="pair_..."
                style={styles.input}
                value={pairingCode}
              />
              <Pressable onPress={onPairDevice} style={styles.primaryButton}>
                <Text style={styles.primaryButtonText}>Pair Manually</Text>
              </Pressable>
            </View>
            <View style={styles.fieldGroup}>
              <Text style={styles.label}>Manual Bearer Token</Text>
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

      {notificationsSection}
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
  selectedOrganizationID?: string;
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
    return [account.email, account.signInMethod, serverHost].filter(Boolean).join(" · ");
  }
  return [`local device`, serverHost].filter(Boolean).join(" · ");
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
    case "do-not-disturb":
      return "Do Not Disturb";
    case "off-call":
      return "Off-call";
    default:
      return state.charAt(0).toUpperCase() + state.slice(1);
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
  backButton: {
    alignSelf: "flex-start",
    minHeight: 36,
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
  organizationList: {
    gap: 8,
  },
  organizationButton: {
    borderColor: "#ded6c6",
    borderRadius: 8,
    borderWidth: 1,
    gap: 3,
    padding: 12,
  },
  organizationButtonActive: {
    backgroundColor: "#202124",
    borderColor: "#202124",
  },
  organizationName: {
    color: "#202124",
    fontSize: 16,
    fontWeight: "900",
  },
  organizationMeta: {
    color: "#5f5a4f",
    fontSize: 13,
    fontWeight: "700",
  },
  organizationNameActive: {
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
  diagnosticsPanel: {
    borderTopColor: "#e3dbc9",
    borderTopWidth: 1,
    gap: 10,
    paddingTop: 12,
  },
  secondaryActionText: {
    color: "#202124",
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
