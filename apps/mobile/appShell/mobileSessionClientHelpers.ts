import AsyncStorage from "@react-native-async-storage/async-storage";
import { AgentTickClient } from "@self-deprecated/agent-tick-sdk";

import { getStoredConnectionCredential } from "../mobileConnections";
import { mobileSessionStorageKeys, type SavedMobileAccount } from "../mobileAuth";
import { getSecretValue } from "../mobileSecretStorage";

export async function hasSavedLocalSession(serverURL: string) {
  const keys = mobileSessionStorageKeys(serverURL);
  const [token, deviceID] = await Promise.all([
    getStoredMobileSessionToken(keys.token),
    AsyncStorage.getItem(keys.deviceID),
  ]);
  return Boolean(token || deviceID);
}

export async function getStoredMobileSessionToken(key: string): Promise<string | null> {
  return getSecretValue(key);
}

export async function getStoredConnectionToken(account: SavedMobileAccount): Promise<string | null> {
  const credential = await getStoredConnectionCredential(account);
  if (credential) return credential;
  if (account.authProvider !== "clerk") return getSecretValue(mobileSessionStorageKeys(account.serverURL).token);
  return null;
}

export async function diagnosticClientsForConnections(accounts: SavedMobileAccount[]): Promise<AgentTickClient[]> {
  const clients = await Promise.all(accounts.map(async (account) => {
    const connectionToken = await getStoredConnectionToken(account);
    if (!connectionToken) return null;
    return new AgentTickClient({
      baseUrl: account.serverURL,
      tokenProvider: () => connectionToken,
      workspaceIdProvider: () => account.workspaceID || null,
    });
  }));
  return clients.filter((client): client is AgentTickClient => Boolean(client));
}
