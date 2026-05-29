import { useCallback, useMemo } from "react";
import { AgentTickClient } from "@self-deprecated/agent-tick-sdk";

import { mobileConnectionCredentialKey, normalizeServerURL, type RuntimeAuthConfig, type SavedMobileAccount } from "../mobileAuth";
import { getSecretValue } from "../mobileSecretStorage";
import type { ClerkTokenProvider } from "./AgentTickAppProps";
import { getStoredConnectionToken } from "./mobileSessionClientHelpers";

type UseMobileApiClientInput = {
  activeConnectionID: string;
  clerkTokenProvider?: ClerkTokenProvider;
  connectionTokens: Record<string, string>;
  runtimeAuthConfig: RuntimeAuthConfig | null;
  savedAccounts: SavedMobileAccount[];
  selectedWorkspaceID: string;
  serverURL: string;
  token: string;
};

export function useMobileApiClient({
  activeConnectionID,
  clerkTokenProvider,
  connectionTokens,
  runtimeAuthConfig,
  savedAccounts,
  selectedWorkspaceID,
  serverURL,
  token,
}: UseMobileApiClientInput) {
  const currentAuthToken = useCallback(async () => {
    if (runtimeAuthConfig?.authProvider === "clerk") {
      if (activeConnectionID) {
        const inMemoryToken = connectionTokens[activeConnectionID];
        if (inMemoryToken) return inMemoryToken;
        const activeAccount = savedAccounts.find((account) => account.id === activeConnectionID);
        const storedToken = activeAccount
          ? await getStoredConnectionToken(activeAccount)
          : await getSecretValue(mobileConnectionCredentialKey(activeConnectionID));
        if (storedToken) return storedToken;
      }

      const sameServerAccounts = savedAccounts.filter((account) => account.authProvider === "clerk" && normalizeServerURL(account.serverURL) === normalizeServerURL(serverURL));
      const sameServerAccount = sameServerAccounts.length === 1 ? sameServerAccounts[0] : undefined;
      if (sameServerAccount) {
        const storedToken = await getStoredConnectionToken(sameServerAccount);
        if (storedToken) return storedToken;
      }

      return (await clerkTokenProvider?.()) ?? "";
    }
    return token;
  }, [activeConnectionID, clerkTokenProvider, connectionTokens, runtimeAuthConfig?.authProvider, savedAccounts, serverURL, token]);

  const sdk = useMemo(
    () =>
      new AgentTickClient({
        baseUrl: serverURL,
        tokenProvider: async () => (await currentAuthToken()) || null,
        workspaceIdProvider: () => selectedWorkspaceID || null,
      }),
    [currentAuthToken, selectedWorkspaceID, serverURL],
  );

  return { currentAuthToken, sdk };
}
