import { useEffect, useRef, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
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
  const observedClerkSessionID = useRef<string | null>(null);

  useEffect(() => {
    if (runtimeAuthConfig?.authProvider !== "clerk") {
      observedClerkSessionID.current = null;
      return;
    }
    if (!activeClerkSessionID) return;

    const previousClerkSessionID = observedClerkSessionID.current;
    observedClerkSessionID.current = activeClerkSessionID;
    // A cold start also changes Clerk from "no session yet" to the restored
    // session. Do not treat that as an account switch: clearing deviceID here
    // makes the phone forget its Approval Device and locks private Activity.
    if (!previousClerkSessionID || previousClerkSessionID === activeClerkSessionID) return;

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
