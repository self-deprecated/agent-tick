export type Screen = "approvals" | "history" | "settings" | "scanner";

export const NATIVE_APP_TRIAL_DAYS = 7;
export const INCLUDED_HOSTED_MONTH_DAYS = 31;

export type NativeAppEntitlementInput = {
  now: Date;
  firstOpenedAt?: string | null;
  lifetimeUnlocked?: boolean;
  hostedSubscriptionActive?: boolean;
  includedHostedActivatedAt?: string | null;
};

export type NativeAppEntitlementState = {
  trialStartedAt: string;
  trialEndsAt: string;
  trialRemainingMs: number;
  trialActive: boolean;
  lifetimeUnlocked: boolean;
  hostedSubscriptionActive: boolean;
  includedHostedActive: boolean;
  readOnly: boolean;
};

const DAY_MS = 24 * 60 * 60 * 1000;

export function trialEndsAt(firstOpenedAt: string): string {
  return new Date(new Date(firstOpenedAt).getTime() + NATIVE_APP_TRIAL_DAYS * DAY_MS).toISOString();
}

export function includedHostedEndsAt(activatedAt: string): string {
  return new Date(new Date(activatedAt).getTime() + INCLUDED_HOSTED_MONTH_DAYS * DAY_MS).toISOString();
}

export function nativeAppEntitlement(input: NativeAppEntitlementInput): NativeAppEntitlementState {
  const trialStartedAt = input.firstOpenedAt || input.now.toISOString();
  const trialEnd = trialEndsAt(trialStartedAt);
  const trialRemainingMs = Math.max(0, new Date(trialEnd).getTime() - input.now.getTime());
  const trialActive = trialRemainingMs > 0;
  const includedHostedActive = Boolean(input.includedHostedActivatedAt && new Date(includedHostedEndsAt(input.includedHostedActivatedAt)).getTime() > input.now.getTime());
  const lifetimeUnlocked = input.lifetimeUnlocked === true;
  const hostedSubscriptionActive = input.hostedSubscriptionActive === true;
  return {
    trialStartedAt,
    trialEndsAt: trialEnd,
    trialRemainingMs,
    trialActive,
    lifetimeUnlocked,
    hostedSubscriptionActive,
    includedHostedActive,
    readOnly: !trialActive && !lifetimeUnlocked,
  };
}

export function trialRemainingLabel(remainingMs: number): string {
  if (remainingMs <= 0) return "Trial ended";
  const days = Math.ceil(remainingMs / DAY_MS);
  return `${days} ${days === 1 ? "day" : "days"} left in trial`;
}

export function hostedPersonalActive(state: NativeAppEntitlementState): boolean {
  return state.trialActive || state.includedHostedActive || state.hostedSubscriptionActive;
}

export type PairingPayload = {
  serverURL?: string;
  pairingCode?: string;
  mode?: "single" | "clerk" | string;
  authProvider?: "local" | "clerk" | string;
  organizationId?: string;
};

type NotificationResponseLike = {
  actionIdentifier?: string | null;
  notification?: {
    request?: {
      content?: {
        data?: unknown;
      } | null;
    } | null;
  } | null;
};

type NotificationDecision = { kind: "open"; requestID: string }; 

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
  const id = notificationRequestID(response.notification?.request?.content?.data);
  if (!id) {
    return null;
  }
  return { kind: "open", requestID: id };
}

export function notificationRequestID(data: unknown) {
  if (!data || typeof data !== "object") {
    return "";
  }
  const fields = data as Record<string, unknown>;
  for (const key of ["approvalRequestID", "approvalRequestId", "requestId"]) {
    const value = fields[key];
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
