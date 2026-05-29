import * as Notifications from "expo-notifications";
import { useCallback, useEffect, type Dispatch, type MutableRefObject, type SetStateAction } from "react";

import {
  notificationDecision,
  notificationFallbackState,
  type Screen,
} from "../AppLogic";
import { diagnosticEvents, recordDiagnostic } from "../diagnostics";
import { mobileRequestSelectionKey } from "../requests";
import { hashDiagnosticID } from "./clerkSessionHelpers";

type LoadActivity = (options?: { visible?: boolean }) => Promise<void>;

type NotificationOpenDecision = NonNullable<ReturnType<typeof notificationDecision>>;

type UseNotificationOpenRoutingOptions = {
  interruptRealtime: () => void;
  loadRef: MutableRefObject<LoadActivity | null>;
  setDiagnosticsEventCount: Dispatch<SetStateAction<number>>;
  setNotificationTargetID: Dispatch<SetStateAction<string | null>>;
  setNotificationTargetRequestID: Dispatch<SetStateAction<string | null>>;
  setNotificationTargetSessionID: Dispatch<SetStateAction<string | null>>;
  setNotificationTargetStatusUpdateID: Dispatch<SetStateAction<string | null>>;
  setScreen: Dispatch<SetStateAction<Screen>>;
  setSelectedID: Dispatch<SetStateAction<string | null>>;
};

export function useNotificationOpenRouting({
  interruptRealtime,
  loadRef,
  setDiagnosticsEventCount,
  setNotificationTargetID,
  setNotificationTargetRequestID,
  setNotificationTargetSessionID,
  setNotificationTargetStatusUpdateID,
  setScreen,
  setSelectedID,
}: UseNotificationOpenRoutingOptions) {
  const openNotificationDecision = useCallback((decision: NotificationOpenDecision, source: "opened" | "opened_from_last_response") => {
    const requestID = decision.kind === "open-session" ? decision.requestID : decision.requestID;
    const targetID = requestID ? mobileRequestSelectionKey(requestID, decision.connectionID, decision.workspaceID) : "";
    recordDiagnostic("info", "notifications", source, {
      requestId: requestID,
      sessionIDHash: hashDiagnosticID(decision.kind === "open-session" ? decision.sessionID : undefined),
      statusUpdateIDHash: hashDiagnosticID(decision.kind === "open-session" ? decision.statusUpdateID : undefined),
      connectionIDHash: hashDiagnosticID(decision.connectionID),
    });
    setDiagnosticsEventCount(diagnosticEvents().length);
    const fallback = notificationFallbackState(targetID || requestID || "", decision.kind === "open-session" ? {
      sessionID: decision.sessionID,
      ...(decision.requestID ? { requestID: decision.requestID } : {}),
      ...(decision.statusUpdateID ? { statusUpdateID: decision.statusUpdateID } : {}),
      ...(decision.workspaceID ? { workspaceID: decision.workspaceID } : {}),
    } : undefined);
    setNotificationTargetID(fallback.notificationTargetID || null);
    setSelectedID(fallback.selectedID || null);
    if (decision.kind === "open-session") {
      setNotificationTargetSessionID(decision.sessionID);
      setNotificationTargetRequestID(decision.requestID ?? null);
      setNotificationTargetStatusUpdateID(decision.statusUpdateID ?? null);
    } else {
      setNotificationTargetSessionID(null);
      setNotificationTargetRequestID(decision.requestID);
      setNotificationTargetStatusUpdateID(null);
    }
    setScreen(fallback.screen);
    interruptRealtime();
    void loadRef.current?.({ visible: false });
  }, [
    interruptRealtime,
    loadRef,
    setDiagnosticsEventCount,
    setNotificationTargetID,
    setNotificationTargetRequestID,
    setNotificationTargetSessionID,
    setNotificationTargetStatusUpdateID,
    setScreen,
    setSelectedID,
  ]);

  useEffect(() => {
    const subscription = Notifications.addNotificationResponseReceivedListener(
      (response) => {
        const decision = notificationDecision(response);
        if (!decision) return;
        openNotificationDecision(decision, "opened");
      },
    );

    void Notifications.getLastNotificationResponseAsync()
      .then((response) => {
        const decision = response ? notificationDecision(response) : null;
        if (decision) openNotificationDecision(decision, "opened_from_last_response");
      })
      .catch(() => undefined);

    return () => subscription.remove();
  }, [openNotificationDecision]);
}
