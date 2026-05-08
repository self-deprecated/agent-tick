export type Screen = "approvals" | "history" | "settings" | "scanner";

export type PairingPayload = {
  serverURL?: string;
  pairingCode?: string;
  mode?: "single" | "clerk" | string;
  authProvider?: "local" | "clerk" | string;
  organizationId?: string;
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
    return compactPairingPayload({
      serverURL: parsed.serverURL,
      pairingCode: parsed.pairingCode,
      mode: parsed.mode,
      authProvider: parsed.authProvider,
      organizationId: parsed.organizationId,
    });
  } catch {
    return value.startsWith("pair_") ? { pairingCode: value } : {};
  }
}

function compactPairingPayload(payload: PairingPayload): PairingPayload {
  return Object.fromEntries(
    Object.entries(payload).filter(([, field]) => typeof field === "string" && field.trim()),
  ) as PairingPayload;
}

export function notificationDecision(
  response: NotificationResponseLike,
): NotificationDecision | null {
  const id = notificationRequestID(response.notification.request.content.data);
  if (!id) {
    return null;
  }
  const action = response.actionIdentifier;
  if (action === "approve" || action === "deny") {
    return { kind: "respond", requestID: id, choiceID: action };
  }
  return { kind: "open", requestID: id };
}

export function notificationRequestID(data: Record<string, unknown>) {
  for (const key of ["approvalRequestID", "approvalRequestId", "requestId"]) {
    const value = data[key];
    if (typeof value === "string" && value.trim()) {
      return value;
    }
  }
  return "";
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
