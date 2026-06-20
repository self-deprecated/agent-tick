import { useEffect, useRef, type Dispatch, type SetStateAction } from "react";
import { Platform } from "react-native";
import { AgentTickClient } from "@self-deprecated/agent-tick-sdk";

import { diagnosticEvents, recordDiagnostic } from "../diagnostics";
import { saveStoredMobileConnections } from "../mobileConnections";
import { ensurePrivateRequestDeviceKeyRegistered } from "../mobilePrivateRequests";
import { normalizeServerURL, type SavedMobileAccount } from "../mobileAuth";
import { mobileInstallationID } from "./mobileNotificationHelpers";
import { getStoredConnectionToken } from "./mobileSessionClientHelpers";

type UseMobilePrivateRequestKeyRegistrationOptions = {
  activeConnectionID: string;
  connectionTokens: Record<string, string>;
  currentAuthToken: () => Promise<string>;
  deviceID: string;
  savedAccounts: SavedMobileAccount[];
  selectedWorkspaceID: string;
  serverURL: string;
  settingsLoaded: boolean;
  setDeviceID: Dispatch<SetStateAction<string>>;
  setDiagnosticsEventCount: (count: number) => void;
  setSavedAccounts: Dispatch<SetStateAction<SavedMobileAccount[]>>;
};

export function useMobilePrivateRequestKeyRegistration({
  activeConnectionID,
  connectionTokens,
  currentAuthToken,
  deviceID,
  savedAccounts,
  selectedWorkspaceID,
  serverURL,
  settingsLoaded,
  setDeviceID,
  setDiagnosticsEventCount,
  setSavedAccounts,
}: UseMobilePrivateRequestKeyRegistrationOptions) {
  const attemptedKeys = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!settingsLoaded) return;
    let cancelled = false;
    const register = async () => {
      const attempts: Array<Promise<void>> = [];
      const runKeys = new Set<string>();
      const deviceUpdates: Record<string, string> = {};
      for (const account of savedAccounts) {
        const key = `${normalizeServerURL(account.serverURL)}:${account.id}:${account.deviceID || "no-device"}`;
        if (attemptedKeys.current.has(key)) continue;
        attemptedKeys.current.add(key);
        runKeys.add(key);
        attempts.push((async () => {
          try {
            const token = connectionTokens[account.id] || await getStoredConnectionToken(account);
            if (!token || cancelled) {
              attemptedKeys.current.delete(key);
              return;
            }
            const client = new AgentTickClient({
              baseUrl: account.serverURL,
              tokenProvider: () => token,
              workspaceIdProvider: () => account.workspaceID || null,
            });
            const registeredDeviceID = account.deviceID || (await client.registerDevice({
              deviceName: `${Platform.OS} phone`,
              platform: Platform.OS,
              installationId: await mobileInstallationID(),
            })).deviceId;
            if (cancelled) return;
            await ensurePrivateRequestDeviceKeyRegistered(client, registeredDeviceID);
            if (!account.deviceID) deviceUpdates[account.id] = registeredDeviceID;
          } catch (error) {
            attemptedKeys.current.delete(key);
            throw error;
          }
        })());
      }

      if (savedAccounts.length === 0) {
        const normalizedServerURL = normalizeServerURL(serverURL);
        const key = `${normalizedServerURL}:current:${deviceID || "no-device"}`;
        if (!attemptedKeys.current.has(key)) {
          attemptedKeys.current.add(key);
          runKeys.add(key);
          attempts.push((async () => {
            try {
              const token = await currentAuthToken();
              if (!token || cancelled) {
                attemptedKeys.current.delete(key);
                return;
              }
              const client = new AgentTickClient({
                baseUrl: normalizedServerURL,
                tokenProvider: () => token,
                workspaceIdProvider: () => selectedWorkspaceID || null,
              });
              const registeredDeviceID = deviceID || (await client.registerDevice({
                deviceName: `${Platform.OS} phone`,
                platform: Platform.OS,
                installationId: await mobileInstallationID(),
              })).deviceId;
              if (cancelled) return;
              await ensurePrivateRequestDeviceKeyRegistered(client, registeredDeviceID);
              if (!deviceID) setDeviceID(registeredDeviceID);
            } catch (error) {
              attemptedKeys.current.delete(key);
              throw error;
            }
          })());
        }
      }

      const results = await Promise.allSettled(attempts);
      if (cancelled) {
        for (const key of runKeys) attemptedKeys.current.delete(key);
        return;
      }
      if (Object.keys(deviceUpdates).length > 0) {
        setSavedAccounts((current) => {
          const next = current.map((account) => deviceUpdates[account.id] ? { ...account, deviceID: deviceUpdates[account.id] } : account);
          void saveStoredMobileConnections(next);
          return next;
        });
        if (activeConnectionID && deviceUpdates[activeConnectionID]) setDeviceID(deviceUpdates[activeConnectionID]);
      }
      const failedCount = results.filter((result) => result.status === "rejected").length;
      if (failedCount > 0) {
        recordDiagnostic("warn", "private_requests", "device_key_registration_failed", { failedCount });
        setDiagnosticsEventCount(diagnosticEvents().length);
      }
    };

    void register();
    return () => {
      cancelled = true;
    };
  }, [activeConnectionID, connectionTokens, currentAuthToken, deviceID, savedAccounts, selectedWorkspaceID, serverURL, settingsLoaded, setDeviceID, setDiagnosticsEventCount, setSavedAccounts]);
}
