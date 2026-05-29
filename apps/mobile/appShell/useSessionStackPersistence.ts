import { useEffect, useState, type Dispatch, type SetStateAction } from "react";
import type { MeResponse } from "@self-deprecated/agent-tick-sdk";

import {
  initialSessionStackLocalState,
  loadSessionStackLocalState,
  saveSessionStackLocalState,
  sessionStackStorageKey,
  type SessionStackLocalState,
} from "../sessionStackState";

export function useSessionStackPersistence({
  serverURL,
  activeConnectionID,
  currentAccountProfile,
  deviceID,
  selectedWorkspaceID,
  settingsLoaded,
}: {
  serverURL: string;
  activeConnectionID: string;
  currentAccountProfile: MeResponse | null;
  deviceID: string;
  selectedWorkspaceID: string;
  settingsLoaded: boolean;
}): {
  sessionStackLocalState: SessionStackLocalState;
  setSessionStackLocalState: Dispatch<SetStateAction<SessionStackLocalState>>;
  sessionStackKey: string;
} {
  const [sessionStackLocalState, setSessionStackLocalState] = useState<SessionStackLocalState>(() => initialSessionStackLocalState());
  const [loadedSessionStackStorageKey, setLoadedSessionStackStorageKey] = useState("");
  const sessionStackKey = sessionStackStorageKey({
    serverURL,
    accountID: activeConnectionID || currentAccountProfile?.userId || deviceID || "account",
    workspaceID: selectedWorkspaceID,
    approvalDeviceID: deviceID || activeConnectionID || "approval-device",
  });

  useEffect(() => {
    if (!settingsLoaded) return;
    let cancelled = false;
    void loadSessionStackLocalState(sessionStackKey).then((state) => {
      if (cancelled) return;
      setSessionStackLocalState(state);
      setLoadedSessionStackStorageKey(sessionStackKey);
    });
    return () => { cancelled = true; };
  }, [sessionStackKey, settingsLoaded]);

  useEffect(() => {
    if (!settingsLoaded || loadedSessionStackStorageKey !== sessionStackKey) return;
    void saveSessionStackLocalState(sessionStackKey, sessionStackLocalState);
  }, [loadedSessionStackStorageKey, sessionStackKey, sessionStackLocalState, settingsLoaded]);

  return { sessionStackLocalState, setSessionStackLocalState, sessionStackKey };
}
