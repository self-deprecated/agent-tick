import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import { useEffect, useRef, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import { Alert, Platform } from "react-native";
import { AgentTickClient, type WorkspaceMemberRecord } from "@self-deprecated/agent-tick-sdk";
import type { PersonalBillingStatus } from "@self-deprecated/agent-tick-shared";

import { diagnosticEvents, recordDiagnostic } from "../diagnostics";
import { saveStoredMobileConnections } from "../mobileConnections";
import { normalizeServerURL, type RuntimeAuthConfig, type SavedMobileAccount } from "../mobileAuth";
import type { NotificationStatus, PushStatus } from "../SettingsScreen";
import { isUsableProjectID } from "./mobileActivityHelpers";
import { mobileInstallationID, requestChannelID, toNotificationStatus } from "./mobileNotificationHelpers";
import { getStoredConnectionToken } from "./mobileSessionClientHelpers";

type RegisterPushToken = (
  overrideDeviceID?: string,
  overrideToken?: string,
  overrideServerURL?: string,
  overrideNotificationsEnabled?: boolean,
  options?: { automatic?: boolean },
) => Promise<void>;

type UseMobilePushNotificationsOptions = {
  activeConnectionID: string;
  currentAccountProfile: { userId?: string } | null;
  currentAuthToken: () => Promise<string>;
  deviceID: string;
  isHostedAccount: boolean;
  lastClerkPushRegistrationKey: MutableRefObject<string>;
  notificationsEnabled: boolean;
  notificationStatus: NotificationStatus;
  personalBillingStatus: PersonalBillingStatus | null;
  pushStatus: PushStatus;
  runtimeAuthProvider?: RuntimeAuthConfig["authProvider"];
  savedAccounts: SavedMobileAccount[];
  sdk: AgentTickClient;
  selectedWorkspace?: WorkspaceMemberRecord;
  selectedWorkspaceID: string;
  serverURL: string;
  settingsLoaded: boolean;
  setDeviceID: Dispatch<SetStateAction<string>>;
  setDiagnosticsEventCount: Dispatch<SetStateAction<number>>;
  setNotificationStatus: Dispatch<SetStateAction<NotificationStatus>>;
  setNotificationsEnabled: Dispatch<SetStateAction<boolean>>;
  setPushStatus: Dispatch<SetStateAction<PushStatus>>;
  setSavedAccounts: Dispatch<SetStateAction<SavedMobileAccount[]>>;
  token: string;
};

export function useMobilePushNotifications({
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
}: UseMobilePushNotificationsOptions): {
  requestNotifications: () => Promise<void>;
  toggleNotifications: (enabled: boolean) => Promise<void>;
  sendTestNotification: () => Promise<void>;
  registerPushToken: RegisterPushToken;
} {
  const pushRegistrationInFlight = useRef(false);

  const requestNotifications = async () => {
    setNotificationsEnabled(true);
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

  const clearRemotePushToken = async () => {
    if (savedAccounts.length > 0) {
      await Promise.allSettled(savedAccounts.map(async (account) => {
        if (!account.deviceID) return;
        const connectionToken = await getStoredConnectionToken(account);
        if (!connectionToken) return;
        const pushClient = new AgentTickClient({
          baseUrl: account.serverURL,
          tokenProvider: () => connectionToken,
          workspaceIdProvider: () => account.workspaceID || null,
        });
        await pushClient.updateDevicePushToken(account.deviceID, { token: "" });
      }));
      return;
    }
    if (!deviceID) return;
    const activeToken = await currentAuthToken();
    if (!activeToken) return;
    const pushClient = runtimeAuthProvider === "clerk"
      ? sdk
      : new AgentTickClient({ baseUrl: normalizeServerURL(serverURL), tokenProvider: () => activeToken });
    await pushClient.updateDevicePushToken(deviceID, { token: "" });
  };

  const registerPushToken: RegisterPushToken = async (
    overrideDeviceID?: string,
    overrideToken?: string,
    overrideServerURL?: string,
    overrideNotificationsEnabled = notificationsEnabled,
    options: { automatic?: boolean } = {},
  ) => {
    if (!overrideNotificationsEnabled) {
      Alert.alert("Notifications are off", "Turn on notifications before registering push notifications.");
      return;
    }
    const activeDeviceID = overrideDeviceID ?? deviceID;
    const activeToken = overrideToken ?? token;
    if (savedAccounts.length === 0 && runtimeAuthProvider !== "clerk" && (!activeDeviceID || !activeToken)) {
      Alert.alert("Pair first", "Pair this device before registering push notifications.");
      return;
    }
    const hostedPersonalPushApplies = runtimeAuthProvider === "clerk" && isHostedAccount && selectedWorkspace?.type !== "shared";
    if (hostedPersonalPushApplies && !personalBillingStatus) {
      if (!options.automatic) {
        Alert.alert("App access still loading", "Open App access after billing status loads, then try again.");
      }
      return;
    }
    if (hostedPersonalPushApplies && personalBillingStatus && !personalBillingStatus.hostedPersonal.pushEnabled) {
      setPushStatus("idle");
      recordDiagnostic("info", "notifications", "push_registration_waiting_for_hosted_access", { hostedLifecycle: personalBillingStatus.hostedPersonal.lifecycle });
      setDiagnosticsEventCount(diagnosticEvents().length);
      if (!options.automatic) {
        Alert.alert("Hosted service required", "Start the 7-day Trial or subscribe to Hosted service before registering hosted push notifications.");
      }
      return;
    }
    if (pushRegistrationInFlight.current) {
      return;
    }
    pushRegistrationInFlight.current = true;

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
        recordDiagnostic("warn", "notifications", "push_permission_denied");
        setDiagnosticsEventCount(diagnosticEvents().length);
        return;
      }

      if (Platform.OS === "android") {
        await Notifications.setNotificationChannelAsync(requestChannelID, {
          name: "Requests",
          importance: Notifications.AndroidImportance.HIGH,
          vibrationPattern: [0, 250, 250, 250],
          sound: "default",
        });
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
      const installationId = await mobileInstallationID();
      if (savedAccounts.length > 0) {
        const deviceUpdates: Record<string, string> = {};
        const results = await Promise.allSettled(savedAccounts.map(async (account) => {
          const connectionToken = await getStoredConnectionToken(account);
          if (!connectionToken) return;
          const pushClient = new AgentTickClient({
            baseUrl: account.serverURL,
            tokenProvider: () => connectionToken,
            workspaceIdProvider: () => account.workspaceID || null,
          });
          if (account.deviceID) {
            await pushClient.updateDevicePushToken(account.deviceID, { token: pushToken.data });
            deviceUpdates[account.id] = account.deviceID;
            return;
          }
          const responseBody = await pushClient.registerDevice({
            deviceName: `${Platform.OS} phone`,
            platform: Platform.OS,
            installationId,
            expoPushToken: pushToken.data,
          });
          deviceUpdates[account.id] = responseBody.deviceId;
        }));
        const registeredCount = Object.keys(deviceUpdates).length;
        if (registeredCount === 0 && results.some((result) => result.status === "rejected")) {
          throw new Error("Could not register push for any connected account.");
        }
        if (registeredCount > 0) {
          setSavedAccounts((current) => {
            const next = current.map((account) => deviceUpdates[account.id] ? { ...account, deviceID: deviceUpdates[account.id] } : account);
            void saveStoredMobileConnections(next);
            return next;
          });
          if (activeConnectionID && deviceUpdates[activeConnectionID]) setDeviceID(deviceUpdates[activeConnectionID]);
        }
        setPushStatus("registered");
        recordDiagnostic("info", "notifications", "push_registered_for_connections", { connectionCount: savedAccounts.length, registeredCount });
        setDiagnosticsEventCount(diagnosticEvents().length);
        return;
      }
      const trimmed = (overrideServerURL || serverURL).replace(/\/$/, "");
      const pushClient = runtimeAuthProvider === "clerk"
        ? sdk
        : new AgentTickClient({ baseUrl: trimmed, tokenProvider: () => activeToken });
      if (runtimeAuthProvider === "clerk") {
        const responseBody = await pushClient.registerDevice({
          deviceName: `${Platform.OS} phone`,
          platform: Platform.OS,
          installationId,
          expoPushToken: pushToken.data,
        });
        setDeviceID(responseBody.deviceId);
      } else if (activeDeviceID) {
        await pushClient.updateDevicePushToken(activeDeviceID, { token: pushToken.data });
      } else {
        const responseBody = await pushClient.registerDevice({
          deviceName: `${Platform.OS} phone`,
          platform: Platform.OS,
          installationId,
          expoPushToken: pushToken.data,
        });
        setDeviceID(responseBody.deviceId);
      }
      setPushStatus("registered");
      recordDiagnostic("info", "notifications", "push_registered");
      setDiagnosticsEventCount(diagnosticEvents().length);
    } catch (err) {
      setPushStatus("failed");
      recordDiagnostic("error", "notifications", "push_registration_failed", { message: err instanceof Error ? err.message : String(err) });
      setDiagnosticsEventCount(diagnosticEvents().length);
      Alert.alert(
        "Push registration failed",
        err instanceof Error ? err.message : "Could not register push notifications",
      );
    } finally {
      pushRegistrationInFlight.current = false;
    }
  };

  const toggleNotifications = async (enabled: boolean) => {
    if (!enabled) {
      setNotificationsEnabled(false);
      lastClerkPushRegistrationKey.current = "";
      await Notifications.cancelAllScheduledNotificationsAsync().catch(() => undefined);
      if (pushStatus === "registered") {
        await clearRemotePushToken().catch((err) => {
          recordDiagnostic("warn", "notifications", "push_unregister_failed", { message: err instanceof Error ? err.message : String(err) });
          setDiagnosticsEventCount(diagnosticEvents().length);
        });
      }
      setPushStatus("idle");
      recordDiagnostic("info", "notifications", "disabled");
      setDiagnosticsEventCount(diagnosticEvents().length);
      return;
    }

    await requestNotifications();
    const permissions = await Notifications.getPermissionsAsync();
    if (!permissions.granted) return;
    await registerPushToken(undefined, undefined, undefined, true);
  };

  const sendTestNotification = async () => {
    if (!notificationsEnabled) {
      Alert.alert("Notifications are off", "Turn on notifications in Agent Tick first.");
      return;
    }
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

  useEffect(() => {
    if (runtimeAuthProvider !== "clerk") return;
    if (!settingsLoaded || !notificationsEnabled || !currentAccountProfile?.userId || !selectedWorkspaceID) return;
    if (isHostedAccount && selectedWorkspace?.type !== "shared" && personalBillingStatus?.hostedPersonal.pushEnabled !== true) return;
    if (notificationStatus !== "granted" && pushStatus !== "registered") return;
    if (pushStatus === "failed" || pushStatus === "unsupported") return;
    const registrationKey = `${normalizeServerURL(serverURL)}:${currentAccountProfile.userId}`;
    if (lastClerkPushRegistrationKey.current === registrationKey) return;
    lastClerkPushRegistrationKey.current = registrationKey;
    void registerPushToken(undefined, undefined, undefined, notificationsEnabled, { automatic: true }).catch(() => {
      lastClerkPushRegistrationKey.current = "";
    });
  }, [currentAccountProfile?.userId, isHostedAccount, notificationStatus, notificationsEnabled, personalBillingStatus?.hostedPersonal.pushEnabled, pushStatus, runtimeAuthProvider, selectedWorkspace?.type, selectedWorkspaceID, serverURL, settingsLoaded]);

  return {
    requestNotifications,
    toggleNotifications,
    sendTestNotification,
    registerPushToken,
  };
}
