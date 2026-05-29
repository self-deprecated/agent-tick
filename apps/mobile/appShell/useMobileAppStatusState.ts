import { useCameraPermissions } from "expo-camera";
import { useState } from "react";

import type { AvailabilityState, ConnectionStatus, NotificationStatus, PushStatus } from "../SettingsScreen";

export function useMobileAppStatusState() {
  const [loading, setLoading] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [loadedSessionServerURL, setLoadedSessionServerURL] = useState("");
  const [connectionStatus, setConnectionStatus] =
    useState<ConnectionStatus>("checking");
  const [notificationStatus, setNotificationStatus] =
    useState<NotificationStatus>("checking");
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const [pushStatus, setPushStatus] = useState<PushStatus>("idle");
  const [diagnosticsEnabled, setDiagnosticsEnabled] = useState(false);
  const [diagnosticsEventCount, setDiagnosticsEventCount] = useState(0);
  const [diagnosticsLastSentAt, setDiagnosticsLastSentAt] = useState("");
  const [realtimeUnavailable, setRealtimeUnavailable] = useState(false);
  const [availability, setAvailability] = useState<AvailabilityState>("available");
  const [error, setError] = useState<string | null>(null);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();

  return {
    loading,
    setLoading,
    historyLoading,
    setHistoryLoading,
    settingsLoaded,
    setSettingsLoaded,
    loadedSessionServerURL,
    setLoadedSessionServerURL,
    connectionStatus,
    setConnectionStatus,
    notificationStatus,
    setNotificationStatus,
    notificationsEnabled,
    setNotificationsEnabled,
    pushStatus,
    setPushStatus,
    diagnosticsEnabled,
    setDiagnosticsEnabled,
    diagnosticsEventCount,
    setDiagnosticsEventCount,
    diagnosticsLastSentAt,
    setDiagnosticsLastSentAt,
    realtimeUnavailable,
    setRealtimeUnavailable,
    availability,
    setAvailability,
    error,
    setError,
    cameraPermission,
    requestCameraPermission,
  };
}
