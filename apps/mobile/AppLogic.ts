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

export type EntitlementStatusCopy = {
  title: string;
  summary: string;
  appAccess: string;
  hostedAccess: string;
  paywall: string;
};

export function entitlementStatusCopy(state: Pick<NativeAppEntitlementState, "trialActive" | "lifetimeUnlocked" | "readOnly" | "hostedSubscriptionActive" | "includedHostedActive" | "trialRemainingMs">): EntitlementStatusCopy {
  const remaining = trialRemainingLabel(state.trialRemainingMs);
  if (state.hostedSubscriptionActive) {
    return {
      title: "Hosted personal active",
      summary: "Your Lifetime app unlock and hosted personal service are active.",
      appAccess: "You can respond to approvals from hosted or self-hosted Agent Tick servers.",
      hostedAccess: "agenttick.sh routing, push, updates, and uptime are covered by your hosted subscription.",
      paywall: "Manage or cancel the hosted subscription from the app store when needed.",
    };
  }
  if (state.includedHostedActive) {
    return {
      title: "Included hosted month active",
      summary: "Your Lifetime app unlock is active, and the included hosted month is running.",
      appAccess: "Self-hosted Agent Tick access stays unlocked forever on this app-store account.",
      hostedAccess: "agenttick.sh remains available until the included hosted month ends.",
      paywall: "Subscribe monthly or yearly to keep hosted personal service active after the included month.",
    };
  }
  if (state.lifetimeUnlocked) {
    return {
      title: "Lifetime unlock active",
      summary: "Self-hosted Agent Tick use is unlocked forever on this app-store account.",
      appAccess: "You can keep using the app with self-hosted servers without another app purchase.",
      hostedAccess: "Hosted personal service is optional for agenttick.sh routing, push, updates, and uptime.",
      paywall: "Activate the included hosted month or subscribe when you want first-party hosted service.",
    };
  }
  if (state.trialActive) {
    return {
      title: "Trial active",
      summary: remaining,
      appAccess: "Trial includes hosted and self-hosted app use.",
      hostedAccess: "The included hosted month does not start during Trial.",
      paywall: "Buy Lifetime app unlock before Trial ends to keep responding from this app.",
    };
  }
  return {
    title: "Read-only after Trial",
    summary: "Trial ended. Viewing, settings, purchase, and restore stay available.",
    appAccess: "Responses are disabled until Lifetime app unlock is purchased or restored.",
    hostedAccess: "Hosted personal service also requires an active Trial, included hosted month, or subscription.",
    paywall: "Buy Lifetime app unlock to respond again and use self-hosted Agent Tick forever.",
  };
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
