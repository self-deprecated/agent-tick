import { useState } from "react";
import type { MeResponse, WorkspaceMemberRecord } from "@self-deprecated/agent-tick-sdk";

import type { RuntimeAuthConfig, SavedMobileAccount } from "../mobileAuth";

type UseMobileConnectionAccountStateInput = {
  defaultServer: string;
  initialAuthConfig?: RuntimeAuthConfig | null;
  initialServerURL?: string;
};

export function useMobileConnectionAccountState({
  defaultServer,
  initialAuthConfig,
  initialServerURL,
}: UseMobileConnectionAccountStateInput) {
  const [serverURL, setServerURL] = useState(initialServerURL ?? defaultServer);
  const [runtimeAuthConfig, setRuntimeAuthConfig] = useState<RuntimeAuthConfig | null>(initialAuthConfig ?? null);
  const [token, setToken] = useState("");
  const [connectionTokens, setConnectionTokens] = useState<Record<string, string>>({});
  const [deviceID, setDeviceID] = useState("");
  const [pairingCode, setPairingCode] = useState("");
  const [workspaces, setWorkspaces] = useState<WorkspaceMemberRecord[]>([]);
  const [currentAccountProfile, setCurrentAccountProfile] = useState<MeResponse | null>(null);
  const [selectedWorkspaceID, setSelectedWorkspaceID] = useState("");
  const [savedAccounts, setSavedAccounts] = useState<SavedMobileAccount[]>([]);

  return {
    serverURL,
    setServerURL,
    runtimeAuthConfig,
    setRuntimeAuthConfig,
    token,
    setToken,
    connectionTokens,
    setConnectionTokens,
    deviceID,
    setDeviceID,
    pairingCode,
    setPairingCode,
    workspaces,
    setWorkspaces,
    currentAccountProfile,
    setCurrentAccountProfile,
    selectedWorkspaceID,
    setSelectedWorkspaceID,
    savedAccounts,
    setSavedAccounts,
  };
}
