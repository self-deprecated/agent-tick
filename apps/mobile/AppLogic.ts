export type Screen = "approvals" | "history" | "settings" | "scanner";

export type PairingPayload = {
  serverURL?: string;
  pairingCode?: string;
};

type NotificationResponseLike = {
  actionIdentifier: string;
  notification: {
    request: {
      content: {
        data: Record<string, unknown>;
      };
    };
  };
};

type NotificationDecision =
  | { kind: "respond"; requestID: string; choiceID: "approve" | "deny" }
  | { kind: "open"; requestID: string };

type NotificationFallbackState = {
  notificationTargetID: string;
  selectedID: string;
  screen: Screen;
};

export function parsePairingPayload(value: string): PairingPayload {
  try {
    const parsed = JSON.parse(value) as PairingPayload;
    return {
      serverURL: parsed.serverURL,
      pairingCode: parsed.pairingCode,
    };
  } catch {
    return value.startsWith("pair_") ? { pairingCode: value } : {};
  }
}

export function notificationDecision(
  response: NotificationResponseLike,
): NotificationDecision | null {
  const id = response.notification.request.content.data.approvalRequestID;
  if (typeof id !== "string") {
    return null;
  }
  const action = response.actionIdentifier;
  if (action === "approve" || action === "deny") {
    return { kind: "respond", requestID: id, choiceID: action };
  }
  return { kind: "open", requestID: id };
}

export function notificationFallbackState(
  requestID: string,
): NotificationFallbackState {
  return {
    notificationTargetID: requestID,
    selectedID: requestID,
    screen: "approvals",
  };
}
