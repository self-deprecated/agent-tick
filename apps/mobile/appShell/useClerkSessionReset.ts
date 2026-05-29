import { useEffect, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import type { MeResponse } from "@self-deprecated/agent-tick-sdk";

import type { RuntimeAuthConfig } from "../mobileAuth";
import type { MobileRequest } from "../requests";
import type { ConnectionStatus, PushStatus } from "../SettingsScreen";

export function useClerkSessionReset({
  activeClerkSessionID,
  runtimeAuthConfig,
  serverURL,
  lastClerkPushRegistrationKey,
  setCurrentAccountProfile,
  setSelectedWorkspaceID,
  setDeviceID,
  setPushStatus,
  setRequests,
  setHistory,
  setSelectedID,
  setConnectionStatus,
}: {
  activeClerkSessionID: string | null;
  runtimeAuthConfig: RuntimeAuthConfig | null;
  serverURL: string;
  lastClerkPushRegistrationKey: MutableRefObject<string>;
  setCurrentAccountProfile: Dispatch<SetStateAction<MeResponse | null>>;
  setSelectedWorkspaceID: Dispatch<SetStateAction<string>>;
  setDeviceID: Dispatch<SetStateAction<string>>;
  setPushStatus: Dispatch<SetStateAction<PushStatus>>;
  setRequests: Dispatch<SetStateAction<MobileRequest[]>>;
  setHistory: Dispatch<SetStateAction<MobileRequest[]>>;
  setSelectedID: Dispatch<SetStateAction<string | null>>;
  setConnectionStatus: Dispatch<SetStateAction<ConnectionStatus>>;
}) {
  useEffect(() => {
    if (runtimeAuthConfig?.authProvider !== "clerk" || !activeClerkSessionID) return;
    setCurrentAccountProfile((current) => (current?.source === "mobile-saved-account" ? current : null));
    setSelectedWorkspaceID("");
    setDeviceID("");
    setPushStatus("idle");
    lastClerkPushRegistrationKey.current = "";
    setRequests([]);
    setHistory([]);
    setSelectedID(null);
    setConnectionStatus("checking");
  }, [activeClerkSessionID, runtimeAuthConfig?.authProvider, serverURL]);
}
