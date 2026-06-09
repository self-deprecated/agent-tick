import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Notifications from "expo-notifications";
import { Alert, Platform } from "react-native";
import type { MutableRefObject } from "react";

import { localNotificationRequestData } from "../AppLogic";
import { mobileRequestKey, type MobileRequest } from "../requests";
import type { NotificationStatus, PushStatus } from "../SettingsScreen";

export const requestCategoryID = "agent-tick-request";
export const requestChannelID = "agent-tick-requests";
export const mobileInstallationIDStorageKey = "agent-tick.mobileInstallationID";
export const notificationSettingsReminderStorageKey = "agent-tick.notificationSettingsReminderSeen";

export async function mobileInstallationID(): Promise<string> {
  const existing = await AsyncStorage.getItem(mobileInstallationIDStorageKey);
  if (existing) return existing;
  const next = `install_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
  await AsyncStorage.setItem(mobileInstallationIDStorageKey, next);
  return next;
}

export async function refreshNotificationStatus(
  setNotificationStatus: (status: NotificationStatus) => void,
) {
  try {
    const permissions = await Notifications.getPermissionsAsync();
    setNotificationStatus(toNotificationStatus(permissions));
  } catch {
    setNotificationStatus("undetermined");
  }
}

export function toNotificationStatus(
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

export function isPushStatus(value: unknown): value is PushStatus {
  return (
    value === "idle" ||
    value === "registered" ||
    value === "unsupported" ||
    value === "failed"
  );
}

export async function notifyForNewRequests(
  pending: MobileRequest[],
  seenRequestIDs: MutableRefObject<Set<string>>,
  didPrimeNotifications: MutableRefObject<boolean>,
  useLocalNotifications: boolean,
): Promise<MobileRequest[]> {
  const pendingIDs = new Set(pending.map((request) => mobileRequestKey(request)));
  const seenRequest = (request: MobileRequest) => seenRequestIDs.current.has(mobileRequestKey(request));

  if (!didPrimeNotifications.current) {
    seenRequestIDs.current = pendingIDs;
    didPrimeNotifications.current = true;
    return [];
  }

  const newRequests = pending.filter((request) => !seenRequest(request));
  seenRequestIDs.current = pendingIDs;

  if (!useLocalNotifications) {
    return newRequests;
  }

  let permissions: Notifications.NotificationPermissionsStatus;
  try {
    permissions = await Notifications.getPermissionsAsync();
  } catch {
    return newRequests;
  }
  if (!permissions.granted) {
    return newRequests;
  }

  for (const request of newRequests) {
    try {
      await Notifications.scheduleNotificationAsync({
        content: {
          title: "Agent Tick",
          body: "Agent Tick needs your attention.",
          categoryIdentifier: undefined,
          data: localNotificationRequestData(request.id, request.connectionID, request.workspaceId, request.sessionId),
          sound: true,
        },
        ...(Platform.OS === "android" ? { channelId: requestChannelID } : {}),
        trigger: null,
      });
    } catch {
      // Local notifications are opportunistic; polling/event-stream refresh still shows the request.
    }
  }

  return newRequests;
}

export function shouldRemindForRequestNotifications({
  notificationsEnabled,
  notificationStatus,
}: {
  notificationsEnabled: boolean;
  notificationStatus: NotificationStatus;
}): boolean {
  return !notificationsEnabled || notificationStatus === "denied" || notificationStatus === "undetermined";
}

export async function maybeShowNotificationSettingsReminder({
  newRequests,
  notificationsEnabled,
  notificationStatus,
  reminderSeen,
  onOpenNotificationSettings,
}: {
  newRequests: MobileRequest[];
  notificationsEnabled: boolean;
  notificationStatus: NotificationStatus;
  reminderSeen: MutableRefObject<boolean>;
  onOpenNotificationSettings: () => void;
}) {
  if (newRequests.length === 0) return;
  if (!shouldRemindForRequestNotifications({ notificationsEnabled, notificationStatus })) return;
  if (reminderSeen.current) return;

  try {
    if (await AsyncStorage.getItem(notificationSettingsReminderStorageKey) === "true") {
      reminderSeen.current = true;
      return;
    }
  } catch {
    // Fall through and remind once in this app process even if persistence cannot be read.
  }

  reminderSeen.current = true;
  await AsyncStorage.setItem(notificationSettingsReminderStorageKey, "true").catch(() => undefined);
  Alert.alert(
    "Turn on Request notifications?",
    "A Request arrived while notifications are off. Enable notifications to get future Requests right away.",
    [
      { text: "Not now", style: "cancel" },
      { text: "Notifications settings", onPress: onOpenNotificationSettings },
    ],
  );
}
