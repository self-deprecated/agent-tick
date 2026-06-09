import AsyncStorage from "@react-native-async-storage/async-storage";
import { Alert } from "react-native";

import {
  maybeShowNotificationSettingsReminder,
  notificationSettingsReminderStorageKey,
  shouldRemindForRequestNotifications,
} from "./appShell/mobileNotificationHelpers";
import type { MobileRequest } from "./requests";

jest.mock("expo-notifications", () => ({
  AndroidImportance: { HIGH: "high" },
  getPermissionsAsync: jest.fn(async () => ({ granted: true, status: "granted" })),
  scheduleNotificationAsync: jest.fn(async () => "notification-id"),
  setNotificationCategoryAsync: jest.fn(async () => undefined),
  setNotificationChannelAsync: jest.fn(async () => undefined),
}));

const request = { id: "req_1", workspaceId: "wsp_1" } as MobileRequest;

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.restoreAllMocks();
});

describe("notification settings reminder", () => {
  it("only reminds when request notifications are not enabled", () => {
    expect(shouldRemindForRequestNotifications({ notificationsEnabled: true, notificationStatus: "granted" })).toBe(false);
    expect(shouldRemindForRequestNotifications({ notificationsEnabled: true, notificationStatus: "checking" })).toBe(false);
    expect(shouldRemindForRequestNotifications({ notificationsEnabled: true, notificationStatus: "undetermined" })).toBe(true);
    expect(shouldRemindForRequestNotifications({ notificationsEnabled: true, notificationStatus: "denied" })).toBe(true);
    expect(shouldRemindForRequestNotifications({ notificationsEnabled: false, notificationStatus: "granted" })).toBe(true);
  });

  it("shows the request notification settings reminder once and persists the dismissal", async () => {
    const alert = jest.spyOn(Alert, "alert").mockImplementation(() => undefined);
    const onOpenNotificationSettings = jest.fn();
    const reminderSeen = { current: false };

    await maybeShowNotificationSettingsReminder({
      newRequests: [request],
      notificationsEnabled: false,
      notificationStatus: "granted",
      reminderSeen,
      onOpenNotificationSettings,
    });

    expect(alert).toHaveBeenCalledTimes(1);
    expect(await AsyncStorage.getItem(notificationSettingsReminderStorageKey)).toBe("true");

    await maybeShowNotificationSettingsReminder({
      newRequests: [request],
      notificationsEnabled: false,
      notificationStatus: "granted",
      reminderSeen: { current: false },
      onOpenNotificationSettings,
    });

    expect(alert).toHaveBeenCalledTimes(1);
  });

  it("opens Notifications settings from the reminder action", async () => {
    const alert = jest.spyOn(Alert, "alert").mockImplementation(() => undefined);
    const onOpenNotificationSettings = jest.fn();

    await maybeShowNotificationSettingsReminder({
      newRequests: [request],
      notificationsEnabled: true,
      notificationStatus: "undetermined",
      reminderSeen: { current: false },
      onOpenNotificationSettings,
    });

    const buttons = alert.mock.calls[0]?.[2];
    buttons?.[1]?.onPress?.();

    expect(onOpenNotificationSettings).toHaveBeenCalledTimes(1);
  });
});
