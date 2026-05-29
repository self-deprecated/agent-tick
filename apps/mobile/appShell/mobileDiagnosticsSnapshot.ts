import Constants from "expo-constants";
import { Platform } from "react-native";

import type { Screen } from "../AppLogic";
import type { ConnectionStatus, NotificationStatus, PushStatus } from "../SettingsScreen";

export function diagnosticsSnapshot(input: {
  serverURL: string;
  authMode?: string;
  connectionStatus: ConnectionStatus;
  pushStatus: PushStatus;
  notificationStatus: NotificationStatus;
  notificationsEnabled?: boolean;
  currentScreen?: Screen;
  lastErrorMessage?: string;
}) {
  return {
    appVersion: Constants.expoConfig?.version,
    platform: Platform.OS,
    serverURL: input.serverURL,
    authMode: input.authMode,
    connectionStatus: input.connectionStatus,
    pushStatus: input.pushStatus,
    notificationStatus: input.notificationStatus,
    notificationsEnabled: input.notificationsEnabled,
    currentScreen: input.currentScreen,
    ...(input.lastErrorMessage ? { lastErrorMessage: input.lastErrorMessage } : {}),
  };
}
