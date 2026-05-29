import * as SecureStore from "expo-secure-store";
import { TurboModuleRegistry, type TurboModule } from "react-native";

import type { SavedMobileAccount } from "../mobileAuth";
import { clearSecretValue } from "../mobileSecretStorage";

const clerkClientJwtKey = "__clerk_client_jwt";

type NativeClerkModule = TurboModule & {
  getClientToken?: () => Promise<string | null>;
  getSession?: () => Promise<unknown>;
  signOut?: () => Promise<void>;
};

function getNativeClerkModule(): NativeClerkModule | null {
  try {
    return TurboModuleRegistry.get<NativeClerkModule>("ClerkExpo");
  } catch {
    return null;
  }
}

export function signOutNativeClerk(): Promise<unknown> {
  return getNativeClerkModule()?.signOut?.() ?? Promise.resolve();
}

export function clearClerkClientSecret(): Promise<void> {
  return clearSecretValue(clerkClientJwtKey);
}

export function deleteClerkClientSecureStoreToken(): Promise<void> {
  return SecureStore.deleteItemAsync(clerkClientJwtKey, { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK });
}

export async function clearClerkBootstrapState(signOut: (options?: { sessionId?: string }) => Promise<void>, clerk?: unknown): Promise<void> {
  const sessions = clerkSessionResources(clerk);
  for (const session of sessions) {
    await session.remove?.().catch(() => undefined);
    await session.end?.().catch(() => undefined);
    if (session.id) await signOut({ sessionId: session.id }).catch(() => undefined);
  }
  await Promise.allSettled([
    signOutNativeClerk(),
    signOut(),
    clearClerkClientSecret(),
    deleteClerkClientSecureStoreToken(),
  ]);
  await (clerk as { __internal_reloadInitialResources?: () => Promise<unknown> } | undefined)?.__internal_reloadInitialResources?.().catch(() => undefined);
}

function clerkSessionResources(clerk: unknown): Array<{ id?: string; remove?: () => Promise<unknown>; end?: () => Promise<unknown> }> {
  const sessions = (clerk as { client?: { sessions?: unknown } }).client?.sessions;
  return Array.isArray(sessions)
    ? sessions.flatMap((session) => {
      const candidate = session as { id?: unknown; remove?: unknown; end?: unknown };
      return [{
        ...(typeof candidate.id === "string" ? { id: candidate.id } : {}),
        ...(typeof candidate.remove === "function" ? { remove: candidate.remove.bind(session) as () => Promise<unknown> } : {}),
        ...(typeof candidate.end === "function" ? { end: candidate.end.bind(session) as () => Promise<unknown> } : {}),
      }];
    })
    : [];
}

export function clerkSessionExists(clerk: unknown, sessionID: string): boolean {
  return clerkSessionResources(clerk).some((session) => session.id === sessionID);
}

export async function activateClerkSession(clerk: unknown, sessionID: string): Promise<void> {
  const setActive = (clerk as { setActive?: (input: { session: string }) => Promise<unknown> }).setActive;
  if (typeof setActive !== "function") throw new Error("Clerk session switching is unavailable");
  await setActive.call(clerk, { session: sessionID });
  await (clerk as { __internal_reloadInitialResources?: () => Promise<unknown> } | undefined)?.__internal_reloadInitialResources?.().catch(() => undefined);
}

export function clerkAuthDiagnostics(clerk: unknown, activeSessionID: string | null, token: string | null): Record<string, unknown> {
  const sessions = clerkSessionDiagnosticResources(clerk);
  const tokenSid = token ? jwtStringClaim(token, "sid") : null;
  const tokenSub = token ? jwtStringClaim(token, "sub") : null;
  return {
    clerkActiveSessionIDHash: hashDiagnosticID(activeSessionID),
    clerkTokenSidHash: hashDiagnosticID(tokenSid),
    clerkTokenSubHash: hashDiagnosticID(tokenSub),
    clerkSessionCount: sessions.length,
    clerkSessions: sessions.map((session, index) => ({
      index,
      sessionIDHash: hashDiagnosticID(session.id),
      userIDHash: hashDiagnosticID(session.userID),
      status: session.status,
      active: Boolean(activeSessionID && session.id === activeSessionID),
      tokenSession: Boolean(tokenSid && session.id === tokenSid),
      hasGetToken: session.hasGetToken,
    })),
  };
}

function clerkSessionDiagnosticResources(clerk: unknown): Array<{ id?: string; userID?: string; status?: string; hasGetToken: boolean }> {
  const sessions = (clerk as { client?: { sessions?: unknown } }).client?.sessions;
  return Array.isArray(sessions)
    ? sessions.flatMap((session) => {
      const candidate = session as { id?: unknown; status?: unknown; getToken?: unknown; user?: { id?: unknown } | null; publicUserData?: { userId?: unknown } | null };
      return [{
        ...(typeof candidate.id === "string" ? { id: candidate.id } : {}),
        ...(typeof candidate.user?.id === "string" ? { userID: candidate.user.id } : typeof candidate.publicUserData?.userId === "string" ? { userID: candidate.publicUserData.userId } : {}),
        ...(typeof candidate.status === "string" ? { status: candidate.status } : {}),
        hasGetToken: typeof candidate.getToken === "function",
      }];
    })
    : [];
}

export function savedAccountDiagnostics(accounts: SavedMobileAccount[]): Array<Record<string, unknown>> {
  return accounts.map((account, index) => ({
    index,
    idHash: hashDiagnosticID(account.id),
    authProvider: account.authProvider,
    userIDHash: hashDiagnosticID(account.userID),
    clerkSessionIDHash: hashDiagnosticID(account.clerkSessionID),
    workspaceIDHash: hashDiagnosticID(account.workspaceID),
    deviceIDHash: hashDiagnosticID(account.deviceID),
    hasEmail: Boolean(account.email),
    signInMethod: account.signInMethod,
  }));
}

export function hashDiagnosticID(value?: string | null): string | undefined {
  if (!value) return undefined;
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

export function jwtStringClaim(token: string, claim: string): string | null {
  const payload = token.split(".")[1];
  if (!payload) return null;
  const atobFn = (globalThis as { atob?: (value: string) => string }).atob;
  if (!atobFn) return null;
  try {
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), "=");
    const parsed = JSON.parse(atobFn(padded)) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const value = (parsed as Record<string, unknown>)[claim];
    return typeof value === "string" && value ? value : null;
  } catch {
    return null;
  }
}
