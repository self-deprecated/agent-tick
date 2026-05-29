import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect, type Dispatch, type SetStateAction } from "react";

import type { PushStatus } from "../SettingsScreen";
import {
  hostedServerURL,
  mobileSessionStorageKeys,
  normalizeServerURL,
  serverURLStorageKey,
  type RuntimeAuthConfig,
  type SavedMobileAccount,
} from "../mobileAuth";
import { loadStoredMobileConnections } from "../mobileConnections";
import { getStoredMobileSessionToken } from "./mobileSessionClientHelpers";
import { isPushStatus } from "./mobileNotificationHelpers";

type UseMobileSessionRestoreInput = {
  authProvider?: RuntimeAuthConfig["authProvider"];
  loadedSessionServerURL: string;
  serverURL: string;
  settingsLoaded: boolean;
  setDeviceID: Dispatch<SetStateAction<string>>;
  setLoadedSessionServerURL: Dispatch<SetStateAction<string>>;
  setNotificationsEnabled: Dispatch<SetStateAction<boolean>>;
  setPushStatus: Dispatch<SetStateAction<PushStatus>>;
  setSavedAccounts: Dispatch<SetStateAction<SavedMobileAccount[]>>;
  setSelectedWorkspaceID: Dispatch<SetStateAction<string>>;
  setServerURL: Dispatch<SetStateAction<string>>;
  setSettingsLoaded: Dispatch<SetStateAction<boolean>>;
  setToken: Dispatch<SetStateAction<string>>;
};

const defaultServer = hostedServerURL;

export function useMobileSessionRestore({
  authProvider,
  loadedSessionServerURL,
  serverURL,
  settingsLoaded,
  setDeviceID,
  setLoadedSessionServerURL,
  setNotificationsEnabled,
  setPushStatus,
  setSavedAccounts,
  setSelectedWorkspaceID,
  setServerURL,
  setSettingsLoaded,
  setToken,
}: UseMobileSessionRestoreInput) {
  useEffect(() => {
    let cancelled = false;

    const restoreSettings = async () => {
      try {
        const savedServerURL = (await AsyncStorage.getItem(serverURLStorageKey)) ?? defaultServer;
        const storedConnections = await loadStoredMobileConnections();
        if (!cancelled) {
          setSavedAccounts(storedConnections);
          setServerURL(savedServerURL);
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
    if (!settingsLoaded) {
      return;
    }

    let cancelled = false;
    const activeServerURL = normalizeServerURL(serverURL);
    const restoreSessionForServer = async () => {
      const scopedKeys = mobileSessionStorageKeys(activeServerURL);
      const [savedToken, entries] = await Promise.all([
        getStoredMobileSessionToken(scopedKeys.token),
        AsyncStorage.multiGet([
          scopedKeys.deviceID,
          scopedKeys.workspaceID,
          scopedKeys.pushStatus,
          scopedKeys.notificationsEnabled,
        ]),
      ]);
      if (cancelled || normalizeServerURL(serverURL) !== activeServerURL) {
        return;
      }
      const entryValue = (key: string) => entries.find(([entryKey]) => entryKey === key)?.[1];
      setToken(savedToken ?? "");
      setDeviceID(entryValue(scopedKeys.deviceID) ?? "");
      setSelectedWorkspaceID(authProvider === "clerk" ? "" : entryValue(scopedKeys.workspaceID) ?? "");
      const savedPushStatus = entryValue(scopedKeys.pushStatus);
      setPushStatus(isPushStatus(savedPushStatus) ? savedPushStatus : "idle");
      setNotificationsEnabled(entryValue(scopedKeys.notificationsEnabled) !== "false");
      setLoadedSessionServerURL(activeServerURL);
    };

    if (loadedSessionServerURL !== activeServerURL) {
      void restoreSessionForServer();
    }

    return () => {
      cancelled = true;
    };
  }, [loadedSessionServerURL, authProvider, serverURL, settingsLoaded]);
}
