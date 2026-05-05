import { useState } from "react";
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
  availability,
  connectionStatus,
  error,
  loading,
  notificationStatus,
  onAvailabilityChange,
  onCheck,
  onForgetDevice,
  onPairDevice,
  onRegisterPush,
  onRequestNotifications,
  onSendTestNotification,
  onScanPairing,
  pairingCode,
  pushStatus,
  deviceID,
  serverURL,
  setPairingCode,
  setServerURL,
  setToken,
  token,
}: {
  availability?: AvailabilityState;
  connectionStatus: ConnectionStatus;
  error: string | null;
  loading: boolean;
  notificationStatus: NotificationStatus;
  onAvailabilityChange?: (state: AvailabilityState) => void;
  onCheck: () => void;
  onForgetDevice: () => void;
  onPairDevice: () => void;
  onRegisterPush: () => void;
  onRequestNotifications: () => void;
  onSendTestNotification: () => void;
  onScanPairing: () => void;
  pairingCode: string;
  pushStatus: PushStatus;
  deviceID: string;
  serverURL: string;
  setPairingCode: (value: string) => void;
  setServerURL: (value: string) => void;
  setToken: (value: string) => void;
  token: string;
}) {
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const isPaired = !!deviceID;

  const notificationsSection = (
    <View style={styles.settingsSection}>
      <Text style={styles.label}>Notifications</Text>
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
    </View>
  );

  if (isPaired) {
    return (
      <ScrollView
        contentContainerStyle={styles.settingsContent}
        style={styles.settingsPane}
      >
        <View style={styles.settingsSection}>
          <View style={styles.statusRow}>
            <ConnectionBadge status={connectionStatus} />
            {loading ? <ActivityIndicator color="#202124" /> : null}
          </View>
          {error ? <Text style={styles.errorText}>{error}</Text> : null}
          <Text style={styles.deviceStatus}>Paired as {deviceID}</Text>
          <Pressable onPress={onForgetDevice} style={styles.secondaryActionButton}>
            <Text style={styles.secondaryActionText}>Forget Device</Text>
          </Pressable>
        </View>
        <View style={styles.settingsSection}>
          <Text style={styles.sectionHeading}>Workspace</Text>
          <Text style={styles.pairingHint}>
            Team and organization access is managed on the Agent Tick dashboard. This phone will only receive requests where your account or team is eligible to approve.
          </Text>
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
            placeholder="http://192.168.1.20:8787"
            style={styles.input}
            value={serverURL}
          />
        </View>
        <Pressable onPress={onCheck} style={styles.primaryButton}>
          <Text style={styles.primaryButtonText}>Check Connection</Text>
        </Pressable>
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
