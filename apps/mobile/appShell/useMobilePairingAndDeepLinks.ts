import { BarcodeScanningResult } from "expo-camera";
import { useEffect, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import { Alert, Linking, Platform } from "react-native";
import { AgentTickClient, type WorkspaceMemberRecord } from "@self-deprecated/agent-tick-sdk";

import {
  parsePairingPayload,
  parseSessionDeepLinkTarget,
  type PairingPayload,
  type Screen,
} from "../AppLogic";
import {
  mobileRequestSelectionKey,
  normalizeRequests,
  shouldScheduleLocalNotifications,
  type MobileRequest,
} from "../requests";
import type { ConnectionStatus, PushStatus } from "../SettingsScreen";
import { fetchRuntimeAuthConfig, type RuntimeAuthConfig } from "../mobileAuth";
import { notifyForNewRequests } from "./mobileNotificationHelpers";
import { selectRequestID } from "./mobileActivityHelpers";
import { writeRuntimeAuthConfigCache } from "./runtimeAuthConfigCache";

type LoadOptions = { visible?: boolean };

type UseMobilePairingAndDeepLinksOptions = {
  currentAuthToken: () => Promise<string>;
  didPrimeNotifications: MutableRefObject<boolean>;
  handleServerURLChange: (value: string) => void;
  interruptRealtime: () => void;
  load: (options?: LoadOptions) => Promise<void>;
  loadRef: MutableRefObject<((options?: LoadOptions) => Promise<void>) | null>;
  notificationTargetID: string | null;
  notificationsEnabled: boolean;
  onRuntimeAuthConfig?: (serverURL: string, authConfig: RuntimeAuthConfig | null) => void;
  pairingCode: string;
  pushStatus: PushStatus;
  seenRequestIDs: MutableRefObject<Set<string>>;
  serverURL: string;
  setConnectionStatus: Dispatch<SetStateAction<ConnectionStatus>>;
  setDeviceID: Dispatch<SetStateAction<string>>;
  setNotificationTargetID: Dispatch<SetStateAction<string | null>>;
  setNotificationTargetRequestID: Dispatch<SetStateAction<string | null>>;
  setNotificationTargetSessionID: Dispatch<SetStateAction<string | null>>;
  setNotificationTargetStatusUpdateID: Dispatch<SetStateAction<string | null>>;
  setPairingCode: Dispatch<SetStateAction<string>>;
  setPushStatus: Dispatch<SetStateAction<PushStatus>>;
  setRequests: Dispatch<SetStateAction<MobileRequest[]>>;
  setRuntimeAuthConfig: Dispatch<SetStateAction<RuntimeAuthConfig | null>>;
  setScreen: Dispatch<SetStateAction<Screen>>;
  setSelectedID: Dispatch<SetStateAction<string | null>>;
  setSelectedWorkspaceID: Dispatch<SetStateAction<string>>;
  setServerURL: Dispatch<SetStateAction<string>>;
  setToken: Dispatch<SetStateAction<string>>;
  setWorkspaces: Dispatch<SetStateAction<WorkspaceMemberRecord[]>>;
};

export function useMobilePairingAndDeepLinks({
  currentAuthToken,
  didPrimeNotifications,
  handleServerURLChange,
  interruptRealtime,
  load,
  loadRef,
  notificationTargetID,
  notificationsEnabled,
  onRuntimeAuthConfig,
  pairingCode,
  pushStatus,
  seenRequestIDs,
  serverURL,
  setConnectionStatus,
  setDeviceID,
  setNotificationTargetID,
  setNotificationTargetRequestID,
  setNotificationTargetSessionID,
  setNotificationTargetStatusUpdateID,
  setPairingCode,
  setPushStatus,
  setRequests,
  setRuntimeAuthConfig,
  setScreen,
  setSelectedID,
  setSelectedWorkspaceID,
  setServerURL,
  setToken,
  setWorkspaces,
}: UseMobilePairingAndDeepLinksOptions): {
  handlePairingScan: (result: BarcodeScanningResult) => Promise<void>;
  openScanner: () => void;
  pairDevice: () => Promise<void>;
  scannerLocked: boolean;
} {
  const [pendingDeepLinkPayload, setPendingDeepLinkPayload] = useState<PairingPayload | null>(null);
  const [scannerLocked, setScannerLocked] = useState(false);
  const pairingInFlight = useRef(false);
  const processedDeepLinkURLs = useRef<Set<string>>(new Set());

  const loadWithCredentials = async (activeServerURL: string, activeToken: string) => {
    const credentialClient = new AgentTickClient({
      baseUrl: activeServerURL,
      tokenProvider: () => activeToken,
    });
    const pending = normalizeRequests(await credentialClient.listRequests()).filter(
      (request) => request.status === "pending",
    );
    await notifyForNewRequests(
      pending,
      seenRequestIDs,
      didPrimeNotifications,
      shouldScheduleLocalNotifications(pushStatus, notificationsEnabled),
    );
    setRequests(pending);
    setConnectionStatus("connected");
    setSelectedID((current) =>
      selectRequestID(pending, notificationTargetID, current),
    );
  };

  const pairWithCode = async (
    code: string,
    serverOverride?: string,
    alreadyLocked = false,
  ) => {
    if (!code) {
      Alert.alert("Pairing code required", "Enter a pairing code from your self-hosted Agent Tick server.");
      return;
    }
    if (!alreadyLocked && pairingInFlight.current) {
      return;
    }

    if (!alreadyLocked) {
      pairingInFlight.current = true;
    }
    const activeServerURL = (serverOverride || serverURL).replace(/\/$/, "");

    try {
      const pairingClient = new AgentTickClient({ baseUrl: activeServerURL });
      const credential = await pairingClient.pairDevice({
        token: code,
        deviceName: `${Platform.OS} phone`,
      });

      if (serverOverride) {
        setServerURL(serverOverride);
      }
      setDeviceID(credential.deviceId);
      setToken(credential.token);
      setPushStatus("idle");
      setPairingCode("");
      await loadWithCredentials(activeServerURL, credential.token);
      Alert.alert("Paired", "This device can now receive Requests.");
      setScreen("requests");
    } catch (err) {
      Alert.alert(
        "Pairing failed",
        err instanceof Error ? err.message : "Could not pair this device",
      );
    } finally {
      pairingInFlight.current = false;
      setScannerLocked(false);
    }
  };

  const pairDevice = async () => {
    await pairWithCode(pairingCode.trim());
  };

  const acceptExternalApproverInvite = async (inviteToken: string, serverOverride?: string) => {
    const activeServerURL = (serverOverride || serverURL).replace(/\/$/, "");
    const authToken = await currentAuthToken();
    if (!authToken) {
      if (serverOverride) handleServerURLChange(serverOverride);
      setPendingDeepLinkPayload({ externalApproverInviteToken: inviteToken, ...(serverOverride ? { serverURL: serverOverride } : {}) });
      Alert.alert("Sign in required", "Sign in to Agent Tick, then scan this invite again to connect approval Requests.");
      setScreen("requests");
      return;
    }
    try {
      const inviteClient = new AgentTickClient({ baseUrl: activeServerURL, tokenProvider: () => authToken });
      const membership = await inviteClient.acceptExternalApproverInvite(inviteToken);
      if (serverOverride) setServerURL(activeServerURL);
      setSelectedWorkspaceID(membership.workspaceId);
      setWorkspaces((current) => current.some((workspace) => workspace.workspaceId === membership.workspaceId) ? current.map((workspace) => workspace.workspaceId === membership.workspaceId ? membership : workspace) : [membership, ...current]);
      await load({ visible: false });
      Alert.alert("Connected", `You can now receive approval Requests from ${membership.name}.`);
      setScreen("requests");
    } catch (err) {
      Alert.alert("Invite failed", err instanceof Error ? err.message : "Could not accept this invite");
    }
  };

  const processPairingPayload = async (payload: PairingPayload, options: { alreadyLocked?: boolean; showInvalidAlert?: boolean } = {}): Promise<boolean> => {
    if (payload.serverURL) {
      handleServerURLChange(payload.serverURL);
    }
    if (payload.workspaceId) {
      setSelectedWorkspaceID(payload.workspaceId);
    }
    if (payload.pairingCode) {
      setPairingCode(payload.pairingCode);
      await pairWithCode(payload.pairingCode, payload.serverURL, Boolean(options.alreadyLocked));
      return true;
    }
    if (payload.externalApproverInviteToken) {
      await acceptExternalApproverInvite(payload.externalApproverInviteToken, payload.serverURL);
      return true;
    }
    if (payload.serverURL && payload.authProvider === "clerk") {
      try {
        const config = await fetchRuntimeAuthConfig(payload.serverURL);
        await writeRuntimeAuthConfigCache(payload.serverURL, config);
        setRuntimeAuthConfig(config);
        onRuntimeAuthConfig?.(payload.serverURL, config);
        if (payload.workspaceId) setSelectedWorkspaceID(payload.workspaceId);
        Alert.alert("Server saved", "Sign in with Clerk to use this Agent Tick server.");
        setScreen("requests");
      } catch (err) {
        Alert.alert("Server discovery failed", err instanceof Error ? err.message : "Could not read server auth config");
      }
      return true;
    }
    if (options.showInvalidAlert) Alert.alert("Invalid QR code", "This does not look like an Agent Tick pairing code.");
    return false;
  };

  const handleDeepLinkURL = (url: string | null | undefined) => {
    if (!url || processedDeepLinkURLs.current.has(url)) return;
    const sessionTarget = parseSessionDeepLinkTarget(url);
    if (sessionTarget) {
      processedDeepLinkURLs.current.add(url);
      if (sessionTarget.serverURL) handleServerURLChange(sessionTarget.serverURL);
      if (sessionTarget.workspaceID) setSelectedWorkspaceID(sessionTarget.workspaceID);
      const requestTarget = sessionTarget.requestID ? mobileRequestSelectionKey(sessionTarget.requestID, undefined, sessionTarget.workspaceID) : "";
      setNotificationTargetSessionID(sessionTarget.sessionID);
      setNotificationTargetRequestID(sessionTarget.requestID ?? null);
      setNotificationTargetStatusUpdateID(sessionTarget.statusUpdateID ?? null);
      setNotificationTargetID(requestTarget || sessionTarget.sessionID);
      if (requestTarget) setSelectedID(requestTarget);
      setScreen("requests");
      interruptRealtime();
      void loadRef.current?.({ visible: false });
      return;
    }
    const payload = parsePairingPayload(url);
    if (!Object.keys(payload).length) return;
    processedDeepLinkURLs.current.add(url);
    setPendingDeepLinkPayload(payload);
    void processPairingPayload(payload);
  };

  useEffect(() => {
    void Linking.getInitialURL().then(handleDeepLinkURL).catch(() => undefined);
    const subscription = Linking.addEventListener("url", (event) => handleDeepLinkURL(event.url));
    return () => subscription.remove();
  });

  useEffect(() => {
    if (!pendingDeepLinkPayload?.externalApproverInviteToken) return;
    let cancelled = false;
    const acceptWhenSignedIn = async () => {
      const authToken = await currentAuthToken();
      if (cancelled || !authToken) return;
      const pending = pendingDeepLinkPayload;
      setPendingDeepLinkPayload(null);
      await acceptExternalApproverInvite(pending.externalApproverInviteToken!, pending.serverURL);
    };
    void acceptWhenSignedIn();
    return () => {
      cancelled = true;
    };
  }, [currentAuthToken, pendingDeepLinkPayload]);

  const handlePairingScan = async (result: BarcodeScanningResult) => {
    if (pairingInFlight.current) {
      return;
    }
    pairingInFlight.current = true;
    setScannerLocked(true);
    try {
      await processPairingPayload(parsePairingPayload(result.data), { alreadyLocked: true, showInvalidAlert: true });
    } finally {
      pairingInFlight.current = false;
      setScannerLocked(false);
    }
  };

  const openScanner = () => {
    pairingInFlight.current = false;
    setScannerLocked(false);
    setScreen("scanner");
  };

  return {
    handlePairingScan,
    openScanner,
    pairDevice,
    scannerLocked,
  };
}
