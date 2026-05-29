import AsyncStorage from "@react-native-async-storage/async-storage";
import { AgentTickClient } from "@self-deprecated/agent-tick-sdk";
import { getSecretValue, setSecretValue } from "./mobileSecretStorage";
import { mobileConnectionCredentialKey, normalizeSavedMobileAccounts, normalizeServerURL, type SavedMobileAccount } from "./mobileAuth";

export const mobileConnectionsStorageKey = "agent-tick.mobileConnections.v1";
export const mobileConnectionOrderStorageKey = "agent-tick.mobileConnections.order.v1";

export async function loadStoredMobileConnections(): Promise<SavedMobileAccount[]> {
  const secureJSON = await getSecretValue(mobileConnectionsStorageKey);
  return normalizeSavedMobileAccounts(parseJSON(secureJSON));
}

export async function saveStoredMobileConnections(connections: SavedMobileAccount[]): Promise<void> {
  const normalized = normalizeSavedMobileAccounts(connections);
  await Promise.all([
    setSecretValue(mobileConnectionsStorageKey, JSON.stringify(normalized)),
    AsyncStorage.setItem(mobileConnectionOrderStorageKey, JSON.stringify(normalized.map((connection) => connection.id))),
  ]);
}

export async function clearStoredMobileConnections(): Promise<void> {
  await Promise.all([
    setSecretValue(mobileConnectionsStorageKey, ""),
    AsyncStorage.removeItem(mobileConnectionOrderStorageKey),
  ]);
}

export async function getStoredConnectionCredential(account: SavedMobileAccount): Promise<string | null> {
  return getSecretValue(account.credentialRef || mobileConnectionCredentialKey(account.id));
}

export async function persistSavedConnectionCredential(account: SavedMobileAccount, options: { isClerkMode: boolean; token?: string }): Promise<"cleared-clerk" | "saved-local" | "skipped"> {
  if (options.isClerkMode) {
    return "cleared-clerk";
  }
  if (!options.token) return "skipped";
  await setSecretValue(account.credentialRef || mobileConnectionCredentialKey(account.id), options.token);
  return "saved-local";
}

type UnregisterDeviceClient = { unregisterDevice(deviceId: string): Promise<unknown> };

export async function unregisterSavedConnectionDevice(account: SavedMobileAccount, options: {
  token?: string | null;
  clientFactory?: (input: { baseUrl: string; token: string; workspaceId: string | null }) => UnregisterDeviceClient;
} = {}): Promise<"unregistered" | "skipped"> {
  if (!account.deviceID) return "skipped";
  const token = options.token ?? await getStoredConnectionCredential(account);
  if (!token) return "skipped";
  const baseUrl = normalizeServerURL(account.serverURL);
  const workspaceId = account.workspaceID || null;
  const client = options.clientFactory?.({ baseUrl, token, workspaceId }) ?? new AgentTickClient({
    baseUrl,
    tokenProvider: () => token,
    workspaceIdProvider: () => workspaceId,
  });
  await client.unregisterDevice(account.deviceID);
  return "unregistered";
}

function parseJSON(value: string | null): unknown {
  if (!value) return [];
  try {
    return JSON.parse(value);
  } catch {
    return [];
  }
}
