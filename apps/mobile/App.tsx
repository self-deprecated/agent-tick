import AsyncStorage from "@react-native-async-storage/async-storage";
import { BarcodeScanningResult, CameraView, useCameraPermissions } from "expo-camera";
import Constants from "expo-constants";
import { StatusBar } from "expo-status-bar";
import * as Notifications from "expo-notifications";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

type Screen = "approvals" | "history" | "settings" | "scanner";
type ConnectionStatus = "checking" | "connected" | "disconnected";
type NotificationStatus = "checking" | "granted" | "denied" | "undetermined";
type PushStatus = "idle" | "registered" | "unsupported" | "failed";

type Requester = {
  name: string;
  agentId: string;
  host?: string;
  workingDirectory?: string;
};

type Choice = {
  id: string;
  label: string;
  kind: "approve" | "deny" | "custom" | string;
};

type ApprovalResponse = {
  choiceId: string;
  message?: string;
};

type ApprovalRequest = {
  id: string;
  requester: Requester;
  title: string;
  body?: string;
  command?: string;
  choices: Choice[];
  allowFreeformReply: boolean;
  risk?: string;
  expiresAt?: string;
  status: "pending" | "responded" | string;
  createdAt: string;
  response?: ApprovalResponse;
  metadata?: Record<string, string>;
};

type DeviceCredential = {
  deviceId: string;
  token: string;
};

type PairingPayload = {
  serverURL?: string;
  pairingCode?: string;
};

const defaultServer = "http://localhost:8787";
const serverURLKey = "agent-tick.serverURL";
const tokenKey = "agent-tick.token";
const deviceIDKey = "agent-tick.deviceID";
const approvalCategoryID = "approval-request";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

export default function App() {
  const [screen, setScreen] = useState<Screen>("approvals");
  const [serverURL, setServerURL] = useState(defaultServer);
  const [token, setToken] = useState("");
  const [deviceID, setDeviceID] = useState("");
  const [pairingCode, setPairingCode] = useState("");
  const [requests, setRequests] = useState<ApprovalRequest[]>([]);
  const [history, setHistory] = useState<ApprovalRequest[]>([]);
  const [selectedID, setSelectedID] = useState<string | null>(null);
  const [notificationTargetID, setNotificationTargetID] = useState<string | null>(
    null,
  );
  const [reply, setReply] = useState("");
  const [loading, setLoading] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [connectionStatus, setConnectionStatus] =
    useState<ConnectionStatus>("checking");
  const [notificationStatus, setNotificationStatus] =
    useState<NotificationStatus>("checking");
  const [pushStatus, setPushStatus] = useState<PushStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const seenRequestIDs = useRef<Set<string>>(new Set());
  const didPrimeNotifications = useRef(false);
  const pairingInFlight = useRef(false);

  const selected = useMemo(
    () => requests.find((request) => request.id === selectedID) ?? requests[0],
    [requests, selectedID],
  );

  const api = useCallback(
    async <T,>(path: string, init?: RequestInit): Promise<T> => {
      const trimmed = serverURL.replace(/\/$/, "");
      const response = await fetch(`${trimmed}${path}`, {
        ...init,
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...init?.headers,
        },
      });

      if (!response.ok) {
        throw new Error(`Server returned ${response.status}`);
      }
      return (await response.json()) as T;
    },
    [serverURL, token],
  );

  useEffect(() => {
    let cancelled = false;

    const restoreSettings = async () => {
      try {
        const entries = await AsyncStorage.multiGet([
          serverURLKey,
          tokenKey,
          deviceIDKey,
        ]);
        const savedServerURL = entries.find(([key]) => key === serverURLKey)?.[1];
        const savedToken = entries.find(([key]) => key === tokenKey)?.[1];
        const savedDeviceID = entries.find(([key]) => key === deviceIDKey)?.[1];

        if (!cancelled) {
          if (savedServerURL) {
            setServerURL(savedServerURL);
          }
          if (savedToken) {
            setToken(savedToken);
          }
          if (savedDeviceID) {
            setDeviceID(savedDeviceID);
          }
        }
      } finally {
        if (!cancelled) {
          setSettingsLoaded(true);
        }
      }
    };

    void restoreSettings();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    void refreshNotificationStatus(setNotificationStatus);
    void Notifications.setNotificationCategoryAsync(approvalCategoryID, [
      {
        identifier: "approve",
        buttonTitle: "Approve",
        options: { opensAppToForeground: false },
      },
      {
        identifier: "deny",
        buttonTitle: "Deny",
        options: { opensAppToForeground: false, isDestructive: true },
      },
    ]);
  }, []);

  useEffect(() => {
    if (!settingsLoaded) {
      return;
    }

    void AsyncStorage.multiSet([
      [serverURLKey, serverURL],
      [tokenKey, token],
      [deviceIDKey, deviceID],
    ]);
  }, [deviceID, serverURL, settingsLoaded, token]);

  const load = useCallback(async (options?: { visible?: boolean }) => {
    const visible = options?.visible ?? false;
    if (visible) {
      setLoading(true);
    }
    setError(null);
    try {
      const pending = await api<ApprovalRequest[]>(
        "/v1/approval-requests?status=pending",
      );
      const pendingRequests = normalizeApprovals(pending);
      await notifyForNewRequests(
        pendingRequests,
        seenRequestIDs,
        didPrimeNotifications,
      );
      setRequests(pendingRequests);
      setConnectionStatus("connected");
      setSelectedID((current) =>
        selectApprovalID(pendingRequests, notificationTargetID, current),
      );
      if (
        notificationTargetID &&
        pendingRequests.some((request) => request.id === notificationTargetID)
      ) {
        setNotificationTargetID(null);
      }
    } catch (err) {
      setConnectionStatus("disconnected");
      setError(err instanceof Error ? err.message : "Failed to load requests");
    } finally {
      if (visible) {
        setLoading(false);
      }
    }
  }, [api, notificationTargetID]);

  useEffect(() => {
    if (!settingsLoaded) {
      return;
    }

    void load({ visible: false });
    const timer = setInterval(() => void load({ visible: false }), 5000);
    return () => clearInterval(timer);
  }, [load, settingsLoaded]);

  useEffect(() => {
    if (!settingsLoaded || !token) {
      return;
    }

    const wsURL = serverURL
      .replace(/^http:\/\//, "ws://")
      .replace(/^https:\/\//, "wss://")
      .replace(/\/$/, "");
    const socket = new WebSocket(
      `${wsURL}/v1/events?token=${encodeURIComponent(token)}`,
    );
    socket.onmessage = () => void load({ visible: false });
    return () => socket.close();
  }, [load, serverURL, settingsLoaded, token]);

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    setError(null);
    try {
      const allRequests = await api<ApprovalRequest[]>("/v1/approval-requests");
      setHistory(normalizeApprovals(allRequests));
      setConnectionStatus("connected");
    } catch (err) {
      setConnectionStatus("disconnected");
      setError(err instanceof Error ? err.message : "Failed to load history");
    } finally {
      setHistoryLoading(false);
    }
  }, [api]);

  useEffect(() => {
    if (screen === "history") {
      void loadHistory();
    }
  }, [loadHistory, screen]);

  const respond = async (request: ApprovalRequest, choice: Choice) => {
    try {
      const response = await fetch(
        `${serverURL.replace(/\/$/, "")}/v1/approval-requests/${request.id}/responses`,
        {
          method: "POST",
          headers: {
            Authorization: token ? `Bearer ${token}` : "",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ choiceId: choice.id, message: reply }),
        },
      );
      if (response.status === 409) {
        removePendingRequest(request.id);
        return;
      }
      if (!response.ok) {
        throw new Error(`Server returned ${response.status}`);
      }
      await response.json();
      removePendingRequest(request.id);
      setReply("");
      void load({ visible: false });
    } catch (err) {
      Alert.alert(
        "Response failed",
        err instanceof Error ? err.message : "Could not send response",
      );
    }
  };

  const removePendingRequest = (requestID: string) => {
    setRequests((current) => {
      const next = current.filter((request) => request.id !== requestID);
      setSelectedID(next[0]?.id ?? null);
      return next;
    });
  };

  const respondByID = useCallback(
    async (requestID: string, choiceID: string) => {
      try {
        const response = await fetch(
          `${serverURL.replace(/\/$/, "")}/v1/approval-requests/${requestID}/responses`,
          {
            method: "POST",
            headers: {
              Authorization: token ? `Bearer ${token}` : "",
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ choiceId: choiceID }),
          },
        );
        if (response.status === 409) {
          removePendingRequest(requestID);
          return;
        }
        if (!response.ok) {
          throw new Error(`Server returned ${response.status}`);
        }
        await response.json();
        removePendingRequest(requestID);
        void load({ visible: false });
      } catch {
        setNotificationTargetID(requestID);
        setSelectedID(requestID);
        setScreen("approvals");
      }
    },
    [load, serverURL, token],
  );

  useEffect(() => {
    const subscription = Notifications.addNotificationResponseReceivedListener(
      (response) => {
        const id = response.notification.request.content.data
          .approvalRequestID;
        const action = response.actionIdentifier;
        if (typeof id === "string") {
          if (action === "approve" || action === "deny") {
            void respondByID(id, action);
            return;
          }
          setNotificationTargetID(id);
          setSelectedID(id);
          setScreen("approvals");
        }
      },
    );

    void Notifications.getLastNotificationResponseAsync().then((response) => {
      const id = response?.notification.request.content.data.approvalRequestID;
      if (typeof id === "string") {
        setNotificationTargetID(id);
        setSelectedID(id);
        setScreen("approvals");
      }
    });

    return () => subscription.remove();
  }, [respondByID]);

  const checkConnection = async () => {
    setConnectionStatus("checking");
    await load({ visible: true });
  };

  const requestNotifications = async () => {
    setNotificationStatus("checking");
    const permissions = await Notifications.requestPermissionsAsync({
      ios: {
        allowAlert: true,
        allowBadge: false,
        allowSound: true,
      },
    });
    setNotificationStatus(toNotificationStatus(permissions));
  };

  const sendTestNotification = async () => {
    const permissions = await Notifications.getPermissionsAsync();
    setNotificationStatus(toNotificationStatus(permissions));
    if (!permissions.granted) {
      Alert.alert("Notifications are off", "Enable notifications first.");
      return;
    }

    await Notifications.scheduleNotificationAsync({
      content: {
        title: "Agent Tick",
        body: "Notifications are working.",
        sound: true,
      },
      trigger: null,
    });
  };

  const pairDevice = async () => {
    await pairWithCode(pairingCode.trim());
  };

  const pairWithCode = async (code: string, serverOverride?: string) => {
    if (!code) {
      Alert.alert("Pairing code required", "Enter the code from agent-tick pair.");
      return;
    }
    if (pairingInFlight.current) {
      return;
    }

    pairingInFlight.current = true;
    const activeServerURL = (serverOverride || serverURL).replace(/\/$/, "");

    try {
      const response = await fetch(`${activeServerURL}/v1/devices/pair`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token: code,
          deviceName: `${Platform.OS} phone`,
        }),
      });
      if (!response.ok) {
        throw new Error(`Server returned ${response.status}`);
      }
      const credential = (await response.json()) as DeviceCredential;

      if (serverOverride) {
        setServerURL(serverOverride);
      }
      setDeviceID(credential.deviceId);
      setToken(credential.token);
      setPairingCode("");
      await loadWithCredentials(activeServerURL, credential.token);
      Alert.alert("Paired", "This device can now receive approval requests.");
      setScreen("approvals");
    } catch (err) {
      Alert.alert(
        "Pairing failed",
        err instanceof Error ? err.message : "Could not pair this device",
      );
    } finally {
      pairingInFlight.current = false;
    }
  };

  const loadWithCredentials = async (activeServerURL: string, activeToken: string) => {
    const response = await fetch(
      `${activeServerURL}/v1/approval-requests?status=pending`,
      {
        headers: {
          Authorization: `Bearer ${activeToken}`,
          "Content-Type": "application/json",
        },
      },
    );
    if (!response.ok) {
      throw new Error(`Server returned ${response.status}`);
    }
    const pending = normalizeApprovals(await response.json());
    await notifyForNewRequests(pending, seenRequestIDs, didPrimeNotifications);
    setRequests(pending);
    setConnectionStatus("connected");
    setSelectedID((current) =>
      selectApprovalID(pending, notificationTargetID, current),
    );
  };

  const registerPushToken = async (
    overrideDeviceID?: string,
    overrideToken?: string,
    overrideServerURL?: string,
  ) => {
    const activeDeviceID = overrideDeviceID ?? deviceID;
    const activeToken = overrideToken ?? token;
    if (!activeDeviceID || !activeToken) {
      Alert.alert("Pair first", "Pair this device before registering push notifications.");
      return;
    }

    try {
      const permissions = await Notifications.requestPermissionsAsync({
        ios: {
          allowAlert: true,
          allowBadge: false,
          allowSound: true,
        },
      });
      setNotificationStatus(toNotificationStatus(permissions));
      if (!permissions.granted) {
        setPushStatus("failed");
        return;
      }

      const projectId = Constants.expoConfig?.extra?.eas?.projectId;
      if (!isUsableProjectID(projectId)) {
        setPushStatus("unsupported");
        Alert.alert(
          "Development build required",
          "Remote push needs a real EAS project id. Pairing still works; use local notifications until an EAS development build is configured.",
        );
        return;
      }
      const pushToken = await Notifications.getExpoPushTokenAsync(
        { projectId },
      );
      const trimmed = (overrideServerURL || serverURL).replace(/\/$/, "");
      const response = await fetch(
        `${trimmed}/v1/devices/${activeDeviceID}/push-token`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${activeToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ token: pushToken.data }),
        },
      );
      if (!response.ok) {
        throw new Error(`Server returned ${response.status}`);
      }
      setPushStatus("registered");
    } catch (err) {
      setPushStatus("failed");
      Alert.alert(
        "Push registration failed",
        err instanceof Error ? err.message : "Could not register push notifications",
      );
    }
  };

  const handlePairingScan = async (result: BarcodeScanningResult) => {
    if (pairingInFlight.current) {
      return;
    }
    const payload = parsePairingPayload(result.data);
    if (payload.serverURL) {
      setServerURL(payload.serverURL);
    }
    if (payload.pairingCode) {
      setPairingCode(payload.pairingCode);
      await pairWithCode(payload.pairingCode, payload.serverURL);
      return;
    }
    Alert.alert("Invalid QR code", "This does not look like an Agent Tick pairing code.");
  };

  return (
    <SafeAreaView style={styles.shell}>
      <StatusBar style="dark" />
      <View style={styles.header}>
        <View>
          <Text style={styles.brand}>Agent Tick</Text>
          <ConnectionBadge status={connectionStatus} />
        </View>
        <View style={styles.headerActions}>
          <Pressable
            accessibilityLabel={screen === "history" ? "Approvals" : "History"}
            onPress={() =>
              setScreen((current) =>
                current === "history" ? "approvals" : "history",
              )
            }
            style={styles.iconButton}
          >
            <Text style={styles.iconButtonText}>
              {screen === "history" ? "Tick" : "Hist"}
            </Text>
          </Pressable>
          <Pressable
            accessibilityLabel={screen === "settings" ? "Approvals" : "Settings"}
            onPress={() =>
              setScreen((current) =>
                current === "settings" ? "approvals" : "settings",
              )
            }
            style={styles.iconButton}
          >
            <Text style={styles.iconButtonText}>
              {screen === "settings" ? "Tick" : "Set"}
            </Text>
          </Pressable>
        </View>
      </View>

      {screen === "settings" ? (
        <SettingsScreen
          connectionStatus={connectionStatus}
          error={error}
          loading={loading}
          notificationStatus={notificationStatus}
          onCheck={() => void checkConnection()}
          onForgetDevice={() => {
            setDeviceID("");
            setToken("");
            setPushStatus("idle");
            setConnectionStatus("disconnected");
          }}
          onPairDevice={() => void pairDevice()}
          onRegisterPush={() => void registerPushToken()}
          onRequestNotifications={() => void requestNotifications()}
          onSendTestNotification={() => void sendTestNotification()}
          onScanPairing={() => setScreen("scanner")}
          pairingCode={pairingCode}
          pushStatus={pushStatus}
          deviceID={deviceID}
          serverURL={serverURL}
          setPairingCode={setPairingCode}
          setServerURL={setServerURL}
          setToken={setToken}
          token={token}
        />
      ) : screen === "scanner" ? (
        <ScannerScreen
          cameraPermission={cameraPermission}
          onCancel={() => setScreen("settings")}
          onRequestPermission={() => void requestCameraPermission()}
          onScan={(result) => void handlePairingScan(result)}
        />
      ) : screen === "history" ? (
        <HistoryScreen
          error={error}
          history={history}
          loading={historyLoading}
          onRefresh={() => void loadHistory()}
        />
      ) : (
        <ApprovalsScreen
          error={error}
          loading={loading}
          onRefresh={() => void load({ visible: true })}
          onRespond={(request, choice) => void respond(request, choice)}
          reply={reply}
          requests={requests}
          selected={selected}
          selectedID={selectedID}
          setReply={setReply}
          setSelectedID={setSelectedID}
        />
      )}
    </SafeAreaView>
  );
}

function parsePairingPayload(value: string): PairingPayload {
  try {
    const parsed = JSON.parse(value) as PairingPayload;
    return {
      serverURL: parsed.serverURL,
      pairingCode: parsed.pairingCode,
    };
  } catch {
    return value.startsWith("pair_") ? { pairingCode: value } : {};
  }
}

function selectApprovalID(
  requests: ApprovalRequest[],
  notificationTargetID: string | null,
  currentID: string | null,
) {
  if (
    notificationTargetID &&
    requests.some((request) => request.id === notificationTargetID)
  ) {
    return notificationTargetID;
  }
  if (currentID && requests.some((request) => request.id === currentID)) {
    return currentID;
  }
  return requests[0]?.id ?? null;
}

function normalizeApprovals(value: unknown): ApprovalRequest[] {
  return Array.isArray(value) ? value : [];
}

function isUsableProjectID(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value !== "00000000-0000-0000-0000-000000000000" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  );
}

function ConnectionBadge({ status }: { status: ConnectionStatus }) {
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

async function refreshNotificationStatus(
  setNotificationStatus: (status: NotificationStatus) => void,
) {
  const permissions = await Notifications.getPermissionsAsync();
  setNotificationStatus(toNotificationStatus(permissions));
}

function toNotificationStatus(
  permissions: Notifications.NotificationPermissionsStatus,
): NotificationStatus {
  if (permissions.granted) {
    return "granted";
  }
  if (permissions.status === "denied") {
    return "denied";
  }
  return "undetermined";
}

async function notifyForNewRequests(
  pending: ApprovalRequest[],
  seenRequestIDs: React.MutableRefObject<Set<string>>,
  didPrimeNotifications: React.MutableRefObject<boolean>,
) {
  const pendingIDs = new Set(pending.map((request) => request.id));

  if (!didPrimeNotifications.current) {
    seenRequestIDs.current = pendingIDs;
    didPrimeNotifications.current = true;
    return;
  }

  const newRequests = pending.filter(
    (request) => !seenRequestIDs.current.has(request.id),
  );
  seenRequestIDs.current = pendingIDs;

  const permissions = await Notifications.getPermissionsAsync();
  if (!permissions.granted) {
    return;
  }

  for (const request of newRequests) {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: request.command ? "Run Command?" : request.title,
        body: notificationBody(request),
        categoryIdentifier: approvalCategoryID,
        data: { approvalRequestID: request.id },
        sound: true,
      },
      trigger: null,
    });
  }
}

function notificationBody(request: ApprovalRequest) {
  if (request.command) {
    const host = request.requester.host || request.requester.name || "Agent";
    return `${host}: ${request.command}`;
  }
  return request.body || "Approval requested";
}

function formatRequestTime(value?: string) {
  if (!value) {
    return "";
  }
  return new Date(value).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function ApprovalsScreen({
  error,
  loading,
  onRefresh,
  onRespond,
  reply,
  requests,
  selected,
  selectedID,
  setReply,
  setSelectedID,
}: {
  error: string | null;
  loading: boolean;
  onRefresh: () => void;
  onRespond: (request: ApprovalRequest, choice: Choice) => void;
  reply: string;
  requests: ApprovalRequest[];
  selected?: ApprovalRequest;
  selectedID: string | null;
  setReply: (value: string) => void;
  setSelectedID: (value: string) => void;
}) {
  if (!selected) {
    return (
      <View style={styles.waitingPane}>
        {loading ? <ActivityIndicator color="#202124" /> : null}
        <Text style={styles.waitingTitle}>Waiting</Text>
        {error ? <Text style={styles.errorText}>{error}</Text> : null}
        <Pressable onPress={onRefresh} style={styles.secondaryButton}>
          <Text style={styles.secondaryButtonText}>Refresh</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.approvalsPane}>
      {requests.length > 1 ? (
        <View style={styles.requestStrip}>
          {requests.map((request) => (
            <Pressable
              key={request.id}
              onPress={() => setSelectedID(request.id)}
              style={[
                styles.requestPill,
                selectedID === request.id ? styles.requestPillActive : null,
              ]}
            >
              <Text numberOfLines={1} style={styles.requestPillText}>
                {request.title}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      <ScrollView
        contentContainerStyle={styles.approvalContent}
        style={styles.approvalScroll}
      >
        <Text style={styles.detailTitle}>{selected.title}</Text>
        <Text style={styles.detailMeta}>
          {selected.requester.name || selected.requester.agentId}
          {selected.requester.host ? ` on ${selected.requester.host}` : ""}
        </Text>
        <View style={styles.detailFacts}>
          {selected.risk ? (
            <Text
              style={[
                styles.riskBadge,
                selected.risk === "high" ? styles.riskHigh : null,
                selected.risk === "medium" ? styles.riskMedium : null,
                selected.risk === "low" ? styles.riskLow : null,
              ]}
            >
              {selected.risk}
            </Text>
          ) : null}
          {selected.expiresAt ? (
            <Text style={styles.factText}>
              Expires {formatRequestTime(selected.expiresAt)}
            </Text>
          ) : null}
        </View>
        {selected.requester.workingDirectory ? (
          <Text selectable numberOfLines={2} style={styles.cwdText}>
            {selected.requester.workingDirectory}
          </Text>
        ) : null}
        {selected.body ? <Text style={styles.bodyText}>{selected.body}</Text> : null}
        {selected.command ? (
          <Text selectable style={styles.commandText}>
            {selected.command}
          </Text>
        ) : null}
        {selected.metadata?.context ? (
          <View style={styles.contextPanel}>
            <Text style={styles.contextTitle}>
              {selected.metadata.contextFile || "Context"}
            </Text>
            <Text selectable style={styles.contextText}>
              {selected.metadata.context}
            </Text>
          </View>
        ) : null}
        {selected.allowFreeformReply ? (
          <TextInput
            multiline
            onChangeText={setReply}
            placeholder="Optional message"
            style={styles.reply}
            value={reply}
          />
        ) : null}
      </ScrollView>

      <View style={styles.actions}>
        {(selected.choices ?? []).map((choice) => (
          <Pressable
            key={choice.id}
            onPress={() => onRespond(selected, choice)}
            style={[
              styles.choiceButton,
              choice.kind === "approve" ? styles.approveButton : null,
              choice.kind === "deny" ? styles.denyButton : null,
            ]}
          >
            <Text style={styles.choiceText}>{choice.label}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

function HistoryScreen({
  error,
  history,
  loading,
  onRefresh,
}: {
  error: string | null;
  history: ApprovalRequest[];
  loading: boolean;
  onRefresh: () => void;
}) {
  return (
    <View style={styles.historyPane}>
      <View style={styles.historyHeader}>
        <Text style={styles.sectionHeading}>History</Text>
        <Pressable onPress={onRefresh} style={styles.smallButton}>
          <Text style={styles.smallButtonText}>{loading ? "..." : "Refresh"}</Text>
        </Pressable>
      </View>
      {error ? <Text style={styles.errorText}>{error}</Text> : null}
      <ScrollView contentContainerStyle={styles.historyList}>
        {history.length === 0 ? (
          <Text style={styles.emptyText}>No approval history yet.</Text>
        ) : (
          history.map((request) => (
            <View key={request.id} style={styles.historyRow}>
              <View style={styles.historyRowTop}>
                <Text numberOfLines={2} style={styles.historyTitle}>
                  {request.title}
                </Text>
                <Text
                  style={[
                    styles.historyStatus,
                    request.response?.choiceId === "approve"
                      ? styles.historyStatusApprove
                      : null,
                    request.response?.choiceId === "deny"
                      ? styles.historyStatusDeny
                      : null,
                  ]}
                >
                  {request.response?.choiceId ?? request.status}
                </Text>
              </View>
              <Text numberOfLines={1} style={styles.historyMeta}>
                {request.requester.host || request.requester.name || "Agent"}
              </Text>
              {request.command ? (
                <Text numberOfLines={2} style={styles.historyCommand}>
                  {request.command}
                </Text>
              ) : null}
            </View>
          ))
        )}
      </ScrollView>
    </View>
  );
}

function ScannerScreen({
  cameraPermission,
  onCancel,
  onRequestPermission,
  onScan,
}: {
  cameraPermission: ReturnType<typeof useCameraPermissions>[0];
  onCancel: () => void;
  onRequestPermission: () => void;
  onScan: (result: BarcodeScanningResult) => void;
}) {
  if (!cameraPermission?.granted) {
    return (
      <View style={styles.waitingPane}>
        <Text style={styles.waitingTitle}>Camera Access</Text>
        <Pressable onPress={onRequestPermission} style={styles.primaryButton}>
          <Text style={styles.primaryButtonText}>Enable Camera</Text>
        </Pressable>
        <Pressable onPress={onCancel} style={styles.secondaryButton}>
          <Text style={styles.secondaryButtonText}>Cancel</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.scannerPane}>
      <CameraView
        barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
        onBarcodeScanned={onScan}
        style={styles.scanner}
      />
      <View style={styles.scannerFooter}>
        <Pressable onPress={onCancel} style={styles.secondaryButton}>
          <Text style={styles.secondaryButtonText}>Cancel</Text>
        </Pressable>
      </View>
    </View>
  );
}

function SettingsScreen({
  connectionStatus,
  error,
  loading,
  notificationStatus,
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
  connectionStatus: ConnectionStatus;
  error: string | null;
  loading: boolean;
  notificationStatus: NotificationStatus;
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
  return (
    <ScrollView
      contentContainerStyle={styles.settingsContent}
      style={styles.settingsPane}
    >
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
        <Text style={styles.sectionHeading}>Device</Text>
        <Text style={styles.deviceStatus}>
          {deviceID ? `Paired as ${deviceID}` : "Not paired"}
        </Text>
        <Pressable onPress={onScanPairing} style={styles.primaryButton}>
          <Text style={styles.primaryButtonText}>Scan Pairing QR</Text>
        </Pressable>
        {deviceID ? (
          <Pressable onPress={onForgetDevice} style={styles.secondaryActionButton}>
            <Text style={styles.secondaryActionText}>Forget Device</Text>
          </Pressable>
        ) : null}
      </View>

      <View style={styles.settingsSection}>
        <Text style={styles.sectionHeading}>Advanced</Text>
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
      </View>

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
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  shell: {
    flex: 1,
    backgroundColor: "#f7f2e8",
  },
  header: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 14,
  },
  brand: {
    color: "#202124",
    fontSize: 28,
    fontWeight: "800",
  },
  iconButton: {
    alignItems: "center",
    backgroundColor: "#202124",
    borderRadius: 8,
    height: 46,
    justifyContent: "center",
    minWidth: 64,
    paddingHorizontal: 12,
  },
  headerActions: {
    flexDirection: "row",
    gap: 8,
  },
  scannerPane: {
    flex: 1,
  },
  scanner: {
    flex: 1,
  },
  scannerFooter: {
    backgroundColor: "#f7f2e8",
    padding: 20,
  },
  iconButtonText: {
    color: "#ffffff",
    fontSize: 14,
    fontWeight: "800",
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
  waitingPane: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center",
    padding: 24,
  },
  waitingTitle: {
    color: "#202124",
    fontSize: 28,
    fontWeight: "800",
    marginTop: 12,
  },
  approvalsPane: {
    flex: 1,
  },
  historyPane: {
    flex: 1,
    paddingHorizontal: 20,
  },
  historyHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  sectionHeading: {
    color: "#202124",
    fontSize: 24,
    fontWeight: "900",
  },
  smallButton: {
    alignItems: "center",
    borderColor: "#202124",
    borderRadius: 8,
    borderWidth: 1,
    minHeight: 40,
    justifyContent: "center",
    minWidth: 88,
    paddingHorizontal: 12,
  },
  smallButtonText: {
    color: "#202124",
    fontSize: 14,
    fontWeight: "900",
  },
  historyList: {
    gap: 10,
    paddingBottom: 22,
  },
  historyRow: {
    backgroundColor: "#ffffff",
    borderColor: "#ded6c6",
    borderRadius: 8,
    borderWidth: 1,
    gap: 6,
    padding: 12,
  },
  historyRowTop: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: 10,
    justifyContent: "space-between",
  },
  historyTitle: {
    color: "#202124",
    flex: 1,
    fontSize: 16,
    fontWeight: "900",
  },
  historyStatus: {
    color: "#5f5a4f",
    fontSize: 13,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  historyStatusApprove: {
    color: "#1f6f5b",
  },
  historyStatusDeny: {
    color: "#a33b2f",
  },
  historyMeta: {
    color: "#6d6657",
    fontSize: 13,
    fontWeight: "700",
  },
  historyCommand: {
    color: "#202124",
    fontFamily: "monospace",
    fontSize: 13,
    lineHeight: 19,
  },
  emptyText: {
    color: "#6d6657",
    paddingVertical: 16,
    textAlign: "center",
  },
  requestStrip: {
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 20,
    paddingBottom: 10,
  },
  requestPill: {
    backgroundColor: "#ffffff",
    borderColor: "#ded6c6",
    borderRadius: 8,
    borderWidth: 1,
    maxWidth: 160,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  requestPillActive: {
    borderColor: "#1f6f5b",
  },
  requestPillText: {
    color: "#202124",
    fontSize: 13,
    fontWeight: "800",
  },
  approvalScroll: {
    flex: 1,
  },
  approvalContent: {
    paddingHorizontal: 20,
    paddingBottom: 22,
  },
  detailTitle: {
    color: "#202124",
    fontSize: 30,
    fontWeight: "900",
    lineHeight: 36,
  },
  detailMeta: {
    color: "#6d6657",
    fontSize: 15,
    fontWeight: "700",
    marginTop: 8,
  },
  detailFacts: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 12,
  },
  riskBadge: {
    borderRadius: 8,
    color: "#ffffff",
    fontSize: 13,
    fontWeight: "900",
    overflow: "hidden",
    paddingHorizontal: 10,
    paddingVertical: 6,
    textTransform: "uppercase",
  },
  riskHigh: {
    backgroundColor: "#a33b2f",
  },
  riskMedium: {
    backgroundColor: "#8a681f",
  },
  riskLow: {
    backgroundColor: "#1f6f5b",
  },
  factText: {
    color: "#5f5a4f",
    fontSize: 14,
    fontWeight: "800",
  },
  cwdText: {
    color: "#6d6657",
    fontFamily: "monospace",
    fontSize: 13,
    lineHeight: 18,
    marginTop: 12,
  },
  bodyText: {
    color: "#202124",
    fontSize: 17,
    lineHeight: 25,
    marginTop: 22,
  },
  commandText: {
    backgroundColor: "#202124",
    borderRadius: 8,
    color: "#f8f5ed",
    fontFamily: "monospace",
    fontSize: 14,
    lineHeight: 20,
    marginTop: 18,
    padding: 14,
  },
  contextPanel: {
    backgroundColor: "#ffffff",
    borderColor: "#ded6c6",
    borderRadius: 8,
    borderWidth: 1,
    marginTop: 18,
    padding: 12,
  },
  contextTitle: {
    color: "#545044",
    fontSize: 13,
    fontWeight: "900",
    marginBottom: 8,
  },
  contextText: {
    color: "#202124",
    fontFamily: "monospace",
    fontSize: 13,
    lineHeight: 19,
  },
  reply: {
    backgroundColor: "#ffffff",
    borderColor: "#ded6c6",
    borderRadius: 8,
    borderWidth: 1,
    color: "#202124",
    fontSize: 16,
    marginTop: 18,
    minHeight: 92,
    padding: 12,
    textAlignVertical: "top",
  },
  actions: {
    backgroundColor: "#f7f2e8",
    borderTopColor: "#e3dbc9",
    borderTopWidth: 1,
    gap: 10,
    padding: 20,
  },
  choiceButton: {
    alignItems: "center",
    backgroundColor: "#3c4043",
    borderRadius: 8,
    minHeight: 52,
    justifyContent: "center",
    paddingHorizontal: 14,
  },
  approveButton: {
    backgroundColor: "#1f6f5b",
  },
  denyButton: {
    backgroundColor: "#a33b2f",
  },
  choiceText: {
    color: "#ffffff",
    fontSize: 17,
    fontWeight: "900",
  },
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
  deviceStatus: {
    color: "#202124",
    fontSize: 16,
    fontWeight: "900",
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
  statusRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 12,
    minHeight: 28,
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
  notificationPanel: {
    backgroundColor: "#ffffff",
    borderColor: "#ded6c6",
    borderRadius: 8,
    borderWidth: 1,
    gap: 10,
    padding: 14,
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
  secondaryButton: {
    alignItems: "center",
    borderColor: "#202124",
    borderRadius: 8,
    borderWidth: 1,
    marginTop: 20,
    minHeight: 46,
    justifyContent: "center",
    minWidth: 120,
    paddingHorizontal: 14,
  },
  secondaryButtonText: {
    color: "#202124",
    fontSize: 15,
    fontWeight: "900",
  },
  errorText: {
    color: "#9b1c1c",
    fontSize: 14,
    lineHeight: 20,
    marginTop: 8,
    textAlign: "center",
  },
});
