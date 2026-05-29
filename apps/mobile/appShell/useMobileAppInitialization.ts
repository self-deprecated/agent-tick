import * as Notifications from "expo-notifications";
import { useEffect, type Dispatch, type SetStateAction } from "react";
import { Platform } from "react-native";

import { diagnosticEvents, initializeDiagnostics } from "../diagnostics";
import type { NotificationStatus } from "../SettingsScreen";
import { refreshNotificationStatus, requestCategoryID, requestChannelID } from "./mobileNotificationHelpers";

export function useMobileAppInitialization({
  setDiagnosticsEnabled,
  setDiagnosticsEventCount,
  setNotificationStatus,
}: {
  setDiagnosticsEnabled: Dispatch<SetStateAction<boolean>>;
  setDiagnosticsEventCount: Dispatch<SetStateAction<number>>;
  setNotificationStatus: Dispatch<SetStateAction<NotificationStatus>>;
}) {
  useEffect(() => {
    void initializeDiagnostics().then((enabled) => {
      setDiagnosticsEnabled(enabled);
      setDiagnosticsEventCount(diagnosticEvents().length);
    });
    void refreshNotificationStatus(setNotificationStatus);
    if (Platform.OS === "android") {
      void Notifications.setNotificationChannelAsync(requestChannelID, {
        name: "Requests",
        importance: Notifications.AndroidImportance.HIGH,
        sound: "default",
      }).catch(() => undefined);
    }
    void Notifications.setNotificationCategoryAsync(requestCategoryID, []).catch(() => undefined);
  }, []);
}
