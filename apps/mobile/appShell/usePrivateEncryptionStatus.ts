import { useCallback, useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { Platform } from "react-native";
import { AgentTickApiError, AgentTickClient } from "@self-deprecated/agent-tick-sdk";

import { recordDiagnostic } from "../diagnostics";
import { saveStoredMobileConnections } from "../mobileConnections";
import { ensurePrivateRequestDeviceKeyRegistered, privateRequestLocalInstallKeyStatus } from "../mobilePrivateRequests";
import { normalizeServerURL, type SavedMobileAccount } from "../mobileAuth";
import type { PrivateEncryptionConnectionStatus, PrivateEncryptionStatus } from "../SettingsScreen";
import { mobileInstallationID } from "./mobileNotificationHelpers";
import { getStoredConnectionToken } from "./mobileSessionClientHelpers";

type PrivateEncryptionTarget = {
  id: string;
  label: string;
  serverURL: string;
  workspaceID?: string;
  deviceID?: string;
  tokenProvider: () => Promise<string | null>;
  savedAccountID?: string;
  repairError?: string;
};

type UsePrivateEncryptionStatusOptions = {
  currentAuthToken: () => Promise<string>;
  deviceID: string;
  savedAccounts: SavedMobileAccount[];
  selectedWorkspaceID: string;
  serverURL: string;
  settingsLoaded: boolean;
  setDeviceID?: Dispatch<SetStateAction<string>>;
  setSavedAccounts?: Dispatch<SetStateAction<SavedMobileAccount[]>>;
};

export function usePrivateEncryptionStatus({
  currentAuthToken,
  deviceID,
  savedAccounts,
  selectedWorkspaceID,
  serverURL,
  settingsLoaded,
  setDeviceID,
  setSavedAccounts,
}: UsePrivateEncryptionStatusOptions) {
  const [status, setStatus] = useState<PrivateEncryptionStatus>(() => ({
    state: "idle",
    summary: "Private encryption status has not been checked yet.",
    detail: "Open General settings or refresh to check this phone's install-key registration.",
    connections: [],
  }));
  const [refreshing, setRefreshing] = useState(false);
  const [repairing, setRepairing] = useState(false);

  const targets = useMemo(() => privateEncryptionTargets({
    currentAuthToken,
    deviceID,
    savedAccounts,
    selectedWorkspaceID,
    serverURL,
  }), [currentAuthToken, deviceID, savedAccounts, selectedWorkspaceID, serverURL]);

  const targetFingerprint = useMemo(() => JSON.stringify(targets.map((target) => ({
    id: target.id,
    serverURL: normalizeServerURL(target.serverURL),
    workspaceID: target.workspaceID ?? "",
    deviceID: target.deviceID ?? "",
  }))), [targets]);

  const refresh = useCallback(async (mode: "check" | "repair" = "check") => {
    if (!settingsLoaded) return;
    const isRepair = mode === "repair";
    if (isRepair) setRepairing(true);
    setRefreshing(true);
    setStatus((previous) => ({ ...previous, state: previous.state === "idle" ? "checking" : previous.state, refreshing: true, repairing: isRepair || previous.repairing }));
    try {
      const preparedTargets = isRepair ? await repairMissingPrivateEncryptionDevices(targets) : targets;
      const registeredDevices = preparedTargets.filter((target) => target.deviceID && !targets.some((original) => original.id === target.id && original.deviceID === target.deviceID));
      if (registeredDevices.length > 0) {
        const activeRegistration = registeredDevices.find((target) => target.savedAccountID === undefined) ?? registeredDevices[0];
        if (activeRegistration?.deviceID && !deviceID) setDeviceID?.(activeRegistration.deviceID);
        setSavedAccounts?.((current) => {
          const deviceByAccountID = new Map(registeredDevices.flatMap((target) => target.savedAccountID && target.deviceID ? [[target.savedAccountID, target.deviceID] as const] : []));
          if (deviceByAccountID.size === 0) return current;
          const next = current.map((account) => {
            const registeredDeviceID = deviceByAccountID.get(account.id);
            return registeredDeviceID && account.deviceID !== registeredDeviceID ? { ...account, deviceID: registeredDeviceID } : account;
          });
          void saveStoredMobileConnections(next);
          return next;
        });
      }
      const activeLocal = await privateRequestLocalInstallKeyStatus();
      const connections = await Promise.all(preparedTargets.map((target) => checkPrivateEncryptionTarget(target, isRepair, activeLocal)));
      setStatus(summarizePrivateEncryptionStatus(activeLocal, connections, { repairing: false, refreshing: false }));
    } catch (error) {
      recordDiagnostic("warn", "private_requests", "private_encryption_status_failed", { message: error instanceof Error ? error.message : String(error) });
      setStatus({
        state: "error",
        summary: "Could not check private encryption.",
        detail: error instanceof Error ? error.message : "The app could not check private encryption status.",
        connections: [],
        checkedAt: new Date().toISOString(),
        refreshing: false,
        repairing: false,
      });
    } finally {
      setRefreshing(false);
      setRepairing(false);
    }
  }, [deviceID, settingsLoaded, targets, setDeviceID, setSavedAccounts]);

  useEffect(() => {
    if (!settingsLoaded) return;
    void refresh("check");
    // targetFingerprint deliberately tracks the connection identity fields without
    // retriggering on token-provider function identity changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settingsLoaded, targetFingerprint]);

  return {
    privateEncryptionStatus: { ...status, refreshing, repairing },
    refreshPrivateEncryptionStatus: () => refresh("check"),
    repairPrivateEncryptionRegistration: () => refresh("repair"),
  };
}

function privateEncryptionTargets({
  currentAuthToken,
  deviceID,
  savedAccounts,
  selectedWorkspaceID,
  serverURL,
}: Omit<UsePrivateEncryptionStatusOptions, "settingsLoaded">): PrivateEncryptionTarget[] {
  if (savedAccounts.length > 0) {
    return savedAccounts.map((account) => ({
      id: account.id,
      label: account.label || account.displayName || account.serverURL,
      serverURL: account.serverURL,
      ...(account.workspaceID ? { workspaceID: account.workspaceID } : {}),
      ...(account.deviceID ? { deviceID: account.deviceID } : {}),
      savedAccountID: account.id,
      tokenProvider: () => getStoredConnectionToken(account),
    }));
  }
  return [{
    id: `current:${normalizeServerURL(serverURL)}:${deviceID || "no-device"}`,
    label: "Current connection",
    serverURL,
    ...(selectedWorkspaceID ? { workspaceID: selectedWorkspaceID } : {}),
    ...(deviceID ? { deviceID } : {}),
    tokenProvider: async () => {
      const token = await currentAuthToken();
      return token || null;
    },
  }];
}

async function repairMissingPrivateEncryptionDevices(targets: PrivateEncryptionTarget[]): Promise<PrivateEncryptionTarget[]> {
  return Promise.all(targets.map(async (target) => {
    if (target.deviceID) return target;
    try {
      const token = await target.tokenProvider();
      if (!token) return { ...target, repairError: "This connection has no saved credential, so the app cannot create an Approval Device." };
      const client = new AgentTickClient({
        baseUrl: target.serverURL,
        tokenProvider: () => token,
        workspaceIdProvider: () => target.workspaceID || null,
      });
      const response = await client.registerDevice({
        deviceName: `${Platform.OS} phone`,
        platform: Platform.OS,
        installationId: await mobileInstallationID(),
      });
      return { ...target, deviceID: response.deviceId };
    } catch (error) {
      return { ...target, repairError: error instanceof Error ? error.message : "Could not create an Approval Device for this connection." };
    }
  }));
}

async function checkPrivateEncryptionTarget(
  target: PrivateEncryptionTarget,
  repair: boolean,
  localKey: Awaited<ReturnType<typeof privateRequestLocalInstallKeyStatus>>,
): Promise<PrivateEncryptionConnectionStatus> {
  const base = {
    id: target.id,
    label: target.label,
    serverURL: normalizeServerURL(target.serverURL),
    ...(target.workspaceID ? { workspaceID: target.workspaceID } : {}),
    ...(target.deviceID ? { deviceID: target.deviceID } : {}),
  };
  if (!target.deviceID) {
    return {
      ...base,
      status: target.repairError ? "error" : "missing_device",
      statusLabel: target.repairError ? "Could not check" : "No device",
      message: target.repairError ?? "This connection does not have an Approval Device ID saved on this phone.",
    };
  }

  if (localKey.status !== "ready") {
    return {
      ...base,
      status: localKey.status,
      statusLabel: localKey.status === "unsupported" ? "Unsupported" : "Local key error",
      message: localKey.message,
    };
  }

  const token = await target.tokenProvider();
  if (!token) {
    return {
      ...base,
      status: "missing_credential",
      statusLabel: "Missing token",
      message: "This connection has no saved credential, so the app cannot check server registration.",
    };
  }

  const client = new AgentTickClient({
    baseUrl: target.serverURL,
    tokenProvider: () => token,
    workspaceIdProvider: () => target.workspaceID || null,
  });

  try {
    if (repair) await ensurePrivateRequestDeviceKeyRegistered(client, target.deviceID);
    const serverKeys = await client.listDevicePublicKeys(target.deviceID);
    const activeKeys = serverKeys.filter((key) => !key.revokedAt && key.algorithm === localKey.algorithm);
    const matchingKey = activeKeys.find((key) => key.publicKey === localKey.publicKey);
    if (matchingKey) {
      return {
        ...base,
        status: "registered",
        statusLabel: "Registered",
        message: "This phone's install key is registered on this server for future private Activity.",
        publicKeyFingerprint: matchingKey.publicKeyFingerprint,
        updatedAt: matchingKey.updatedAt,
      };
    }
    if (activeKeys.length > 0) {
      const firstKey = activeKeys[0];
      return {
        ...base,
        status: "different_key",
        statusLabel: "Different key",
        message: "This server has public key records for the remote Approval Device, but none match this phone's install key.",
        ...(firstKey ? { publicKeyFingerprint: firstKey.publicKeyFingerprint, updatedAt: firstKey.updatedAt } : {}),
      };
    }
    return {
      ...base,
      status: "not_registered",
      statusLabel: "Not registered",
      message: "This phone has an install key, but this server does not have a matching active public key for this connection yet.",
    };
  } catch (error) {
    return {
      ...base,
      status: isDeviceNotFound(error) ? "device_not_found" : "error",
      statusLabel: isDeviceNotFound(error) ? "Device not found" : "Could not check",
      message: error instanceof Error ? error.message : "The app could not check this server's key registration.",
    };
  }
}

function summarizePrivateEncryptionStatus(
  activeLocal: Awaited<ReturnType<typeof privateRequestLocalInstallKeyStatus>>,
  connections: PrivateEncryptionConnectionStatus[],
  flags: Pick<PrivateEncryptionStatus, "refreshing" | "repairing">,
): PrivateEncryptionStatus {
  const checkedAt = new Date().toISOString();
  if (activeLocal.status === "unsupported") {
    return {
      state: "unsupported",
      summary: "Native private encryption is unavailable in this build.",
      detail: activeLocal.message,
      connections,
      checkedAt,
      ...flags,
    };
  }
  if (activeLocal.status === "error") {
    return {
      state: "error",
      summary: "Could not prepare this phone's private encryption key.",
      detail: activeLocal.message,
      connections,
      checkedAt,
      ...flags,
    };
  }

  if (connections.length === 0) {
    return {
      state: "ready",
      summary: "This phone's private encryption install key is ready.",
      detail: "No saved server connections were available to check whether this phone's public key is registered there.",
      connections,
      checkedAt,
      ...flags,
    };
  }

  const registeredCount = connections.filter((connection) => connection.status === "registered").length;
  if (registeredCount === connections.length) {
    return {
      state: "ready",
      summary: "This phone's private encryption key is registered on every saved connection.",
      detail: "Future private Requests and private Status Updates from those connections should be decryptable on this phone.",
      connections,
      checkedAt,
      ...flags,
    };
  }
  if (registeredCount > 0) {
    return {
      state: "warning",
      summary: "This phone's private encryption key is only registered on some connections.",
      detail: "Repair registration to sync this phone's install public key with the remaining servers.",
      connections,
      checkedAt,
      ...flags,
    };
  }
  return {
    state: "warning",
    summary: "This phone's private encryption key is not registered with a saved server yet.",
    detail: "Repair registration so future private Activity can be encrypted for this phone on each connection.",
    connections,
    checkedAt,
    ...flags,
  };
}

function isDeviceNotFound(error: unknown): boolean {
  return error instanceof AgentTickApiError && error.status === 404;
}
