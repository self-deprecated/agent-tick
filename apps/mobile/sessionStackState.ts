import AsyncStorage from "@react-native-async-storage/async-storage";
import type { SessionSummary } from "@self-deprecated/agent-tick-sdk";
import { normalizeServerURL } from "./mobileAuth";

export type SessionStackOrderingPreference = "priority" | "stable";
export type SessionStackAutoExpansionPreference = "needs-input" | "none";
export type SessionStackInteractionMode = "stack" | "overview";
export type SessionLaneSize = "large" | "normal" | "collapsed";

export type SessionSeenPosition = {
  activityId: string;
  activityCreatedAt: string;
  seenAt: string;
};

export type ArchivedSessionState = {
  archivedAt: string;
  latestActivityId: string;
  latestActivityCreatedAt: string;
};

export type SessionPresentationOverride = {
  title?: string;
  color?: string;
};

export type SessionStackPreferences = {
  ordering: SessionStackOrderingPreference;
  autoExpansion: SessionStackAutoExpansionPreference;
  interactionMode: SessionStackInteractionMode;
};

type SessionStackIdentity = { sessionId: string; mobileSessionKey?: string };

export type SessionStackLocalState = {
  seenPositions: Record<string, SessionSeenPosition | undefined>;
  archivedSessions: Record<string, ArchivedSessionState | undefined>;
  presentationOverrides: Record<string, SessionPresentationOverride | undefined>;
  laneSizes: Record<string, SessionLaneSize | undefined>;
  preferences: SessionStackPreferences;
  stableOrder: string[];
};

export const defaultSessionStackPreferences: SessionStackPreferences = {
  ordering: "priority",
  autoExpansion: "needs-input",
  interactionMode: "stack",
};

export function initialSessionStackLocalState(input: Partial<SessionStackLocalState> = {}): SessionStackLocalState {
  return {
    seenPositions: { ...(input.seenPositions ?? {}) },
    archivedSessions: { ...(input.archivedSessions ?? {}) },
    presentationOverrides: { ...(input.presentationOverrides ?? {}) },
    laneSizes: { ...(input.laneSizes ?? {}) },
    preferences: { ...defaultSessionStackPreferences, ...(input.preferences ?? {}) },
    stableOrder: [...(input.stableOrder ?? [])],
  };
}

export function sessionStackStorageKey(input: {
  serverURL: string;
  accountID?: string | null;
  workspaceID?: string | null;
  approvalDeviceID?: string | null;
}): string {
  const server = encodeURIComponent(normalizeServerURL(input.serverURL));
  const account = encodeURIComponent(input.accountID?.trim() || "account");
  const workspace = encodeURIComponent(input.workspaceID?.trim() || "workspace");
  const device = encodeURIComponent(input.approvalDeviceID?.trim() || "approval-device");
  return `agent-tick.sessionStack.${server}.${account}.${workspace}.${device}`;
}

export async function loadSessionStackLocalState(storageKey: string): Promise<SessionStackLocalState> {
  const value = await AsyncStorage.getItem(storageKey);
  if (!value) return initialSessionStackLocalState();
  try {
    return normalizeSessionStackLocalState(JSON.parse(value));
  } catch {
    return initialSessionStackLocalState();
  }
}

export async function saveSessionStackLocalState(storageKey: string, state: SessionStackLocalState): Promise<void> {
  await AsyncStorage.setItem(storageKey, JSON.stringify(normalizeSessionStackLocalState(state)));
}

export function markSessionSeen(state: SessionStackLocalState, session: SessionStackIdentity & Pick<SessionSummary, "latestActivity">, seenAt = new Date().toISOString()): SessionStackLocalState {
  const sessionKey = sessionStackSessionKey(session);
  return initialSessionStackLocalState({
    ...state,
    seenPositions: {
      ...state.seenPositions,
      [sessionKey]: {
        activityId: session.latestActivity.id,
        activityCreatedAt: session.latestActivity.createdAt,
        seenAt,
      },
    },
  });
}

export function hasUnreadSessionActivity(state: SessionStackLocalState, session: SessionStackIdentity & Pick<SessionSummary, "latestActivity">): boolean {
  const seen = state.seenPositions[sessionStackSessionKey(session)];
  if (!seen) return true;
  return compareActivityPosition(session.latestActivity, { id: seen.activityId, createdAt: seen.activityCreatedAt }) > 0;
}

export function archiveSession(state: SessionStackLocalState, session: SessionStackIdentity & Pick<SessionSummary, "latestActivity">, archivedAt = new Date().toISOString()): SessionStackLocalState {
  const sessionKey = sessionStackSessionKey(session);
  return initialSessionStackLocalState({
    ...state,
    archivedSessions: {
      ...state.archivedSessions,
      [sessionKey]: {
        archivedAt,
        latestActivityId: session.latestActivity.id,
        latestActivityCreatedAt: session.latestActivity.createdAt,
      },
    },
  });
}

export function unarchiveSession(state: SessionStackLocalState, sessionId: string): SessionStackLocalState {
  const { [sessionId]: _removed, ...archivedSessions } = state.archivedSessions;
  return initialSessionStackLocalState({ ...state, archivedSessions });
}

export function isSessionArchivedInStack(state: SessionStackLocalState, session: SessionStackIdentity & Pick<SessionSummary, "latestActivity">): boolean {
  const archived = state.archivedSessions[sessionStackSessionKey(session)];
  if (!archived) return false;
  return compareActivityPosition(session.latestActivity, { id: archived.latestActivityId, createdAt: archived.latestActivityCreatedAt }) <= 0;
}

export function visibleSessionStackSummaries<T extends SessionStackIdentity & Pick<SessionSummary, "latestActivity">>(state: SessionStackLocalState, sessions: T[]): T[] {
  return sessions.filter((session) => !isSessionArchivedInStack(state, session));
}

export function setSessionPresentationOverride(state: SessionStackLocalState, sessionId: string, override: SessionPresentationOverride): SessionStackLocalState {
  const clean = normalizePresentationOverride(override);
  const presentationOverrides = { ...state.presentationOverrides };
  if (Object.keys(clean).length === 0) delete presentationOverrides[sessionId];
  else presentationOverrides[sessionId] = clean;
  return initialSessionStackLocalState({ ...state, presentationOverrides });
}

export function sessionPresentation(state: SessionStackLocalState, session: SessionStackIdentity & Pick<SessionSummary, "title">): { title: string; color?: string } {
  const override = state.presentationOverrides[sessionStackSessionKey(session)];
  return {
    title: override?.title?.trim() || session.title,
    ...(override?.color?.trim() ? { color: override.color.trim() } : {}),
  };
}

export function setSessionStackPreferences(state: SessionStackLocalState, preferences: Partial<SessionStackPreferences>): SessionStackLocalState {
  return initialSessionStackLocalState({
    ...state,
    preferences: { ...state.preferences, ...preferences },
  });
}

export function setSessionLaneSize(state: SessionStackLocalState, sessionId: string, size?: SessionLaneSize): SessionStackLocalState {
  const laneSizes = { ...state.laneSizes };
  if (size === "large") {
    for (const key of Object.keys(laneSizes)) {
      if (laneSizes[key] === "large") delete laneSizes[key];
    }
  }
  if (size) laneSizes[sessionId] = size;
  else delete laneSizes[sessionId];
  return initialSessionStackLocalState({ ...state, laneSizes });
}

export function setVisibleSessionLaneSizes(state: SessionStackLocalState, sessions: Array<SessionStackIdentity>, size?: SessionLaneSize): SessionStackLocalState {
  const laneSizes = { ...state.laneSizes };
  if (size === "large") {
    for (const key of Object.keys(laneSizes)) {
      if (laneSizes[key] === "large") delete laneSizes[key];
    }
  }
  let largeSet = false;
  for (const session of sessions) {
    const sessionId = sessionStackSessionKey(session);
    if (size === "large") {
      if (!largeSet) {
        laneSizes[sessionId] = "large";
        largeSet = true;
      } else {
        laneSizes[sessionId] = "normal";
      }
    } else if (size) laneSizes[sessionId] = size;
    else delete laneSizes[sessionId];
  }
  return initialSessionStackLocalState({ ...state, laneSizes });
}

export function orderSessionStackSummaries<T extends SessionStackIdentity & Pick<SessionSummary, "state" | "pendingRequestCount" | "updatedAt">>(state: SessionStackLocalState, sessions: T[]): T[] {
  return orderStable(state.stableOrder, sessions);
}

export function updateStableSessionOrder(state: SessionStackLocalState, sessions: Array<SessionStackIdentity>): SessionStackLocalState {
  const sessionKeys = sessions.map(sessionStackSessionKey);
  const liveSessionIds = new Set(sessionKeys);
  const previous = state.stableOrder.filter((sessionId) => liveSessionIds.has(sessionId));
  const previousSet = new Set(previous);
  const appended = sessionKeys.filter((sessionId) => !previousSet.has(sessionId));
  return initialSessionStackLocalState({ ...state, stableOrder: [...previous, ...appended] });
}

export function moveSessionInStableOrder(state: SessionStackLocalState, sessionId: string, targetIndex: number): SessionStackLocalState {
  const current = state.stableOrder.filter((entry) => entry !== sessionId);
  const index = Math.max(0, Math.min(targetIndex, current.length));
  return initialSessionStackLocalState({ ...state, stableOrder: [...current.slice(0, index), sessionId, ...current.slice(index)] });
}

export function shouldAutoExpandSessionLane(state: SessionStackLocalState, session: Pick<SessionSummary, "state" | "pendingRequestCount">): boolean {
  return state.preferences.autoExpansion === "needs-input" && (session.state === "needs-input" || session.pendingRequestCount > 0);
}

function normalizeSessionStackLocalState(value: unknown): SessionStackLocalState {
  const record = value && typeof value === "object" ? value as Partial<SessionStackLocalState> : {};
  return initialSessionStackLocalState({
    seenPositions: normalizeRecord(record.seenPositions, normalizeSeenPosition),
    archivedSessions: normalizeRecord(record.archivedSessions, normalizeArchivedSession),
    presentationOverrides: normalizeRecord(record.presentationOverrides, normalizePresentationOverride),
    laneSizes: normalizeRecord(record.laneSizes, normalizeLaneSize),
    preferences: normalizePreferences(record.preferences),
    stableOrder: Array.isArray(record.stableOrder) ? record.stableOrder.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0) : [],
  });
}

function normalizePreferences(value: unknown): SessionStackPreferences {
  const preferences = value && typeof value === "object" ? value as Partial<SessionStackPreferences> : {};
  return {
    ordering: preferences.ordering === "stable" ? "stable" : "priority",
    autoExpansion: preferences.autoExpansion === "none" ? "none" : "needs-input",
    interactionMode: preferences.interactionMode === "overview" ? "overview" : "stack",
  };
}

function normalizeRecord<T>(value: unknown, normalize: (entry: unknown) => T | undefined): Record<string, T | undefined> {
  if (!value || typeof value !== "object") return {};
  return Object.fromEntries(Object.entries(value).flatMap(([key, entry]) => {
    const normalized = normalize(entry);
    return normalized ? [[key, normalized]] : [];
  }));
}

function normalizeSeenPosition(value: unknown): SessionSeenPosition | undefined {
  if (!value || typeof value !== "object") return undefined;
  const entry = value as Partial<SessionSeenPosition>;
  if (!entry.activityId || !entry.activityCreatedAt || !entry.seenAt) return undefined;
  return { activityId: entry.activityId, activityCreatedAt: entry.activityCreatedAt, seenAt: entry.seenAt };
}

function normalizeArchivedSession(value: unknown): ArchivedSessionState | undefined {
  if (!value || typeof value !== "object") return undefined;
  const entry = value as Partial<ArchivedSessionState>;
  if (!entry.archivedAt || !entry.latestActivityId || !entry.latestActivityCreatedAt) return undefined;
  return { archivedAt: entry.archivedAt, latestActivityId: entry.latestActivityId, latestActivityCreatedAt: entry.latestActivityCreatedAt };
}

function normalizeLaneSize(value: unknown): SessionLaneSize | undefined {
  return value === "large" || value === "normal" || value === "collapsed" ? value : undefined;
}

function normalizePresentationOverride(value: unknown): SessionPresentationOverride {
  if (!value || typeof value !== "object") return {};
  const entry = value as Partial<SessionPresentationOverride>;
  return {
    ...(entry.title?.trim() ? { title: entry.title.trim() } : {}),
    ...(entry.color?.trim() ? { color: entry.color.trim() } : {}),
  };
}

export function sessionStackSessionKey(session: SessionStackIdentity): string {
  return session.mobileSessionKey?.trim() || session.sessionId;
}

function compareActivityPosition(left: { id: string; createdAt: string }, right: { id: string; createdAt: string }): number {
  const leftTime = new Date(left.createdAt).getTime();
  const rightTime = new Date(right.createdAt).getTime();
  if (leftTime !== rightTime) return leftTime > rightTime ? 1 : -1;
  if (left.id === right.id) return 0;
  return left.id > right.id ? 1 : -1;
}

function compareSessionPriority<T extends Pick<SessionSummary, "state" | "pendingRequestCount" | "updatedAt">>(left: T, right: T): number {
  const leftPriority = sessionPriority(left);
  const rightPriority = sessionPriority(right);
  if (leftPriority !== rightPriority) return leftPriority - rightPriority;
  return new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime();
}

function sessionPriority(session: Pick<SessionSummary, "state" | "pendingRequestCount">): number {
  if (session.state === "needs-input" || session.pendingRequestCount > 0) return 0;
  if (session.state === "failed") return 1;
  if (session.state === "active") return 2;
  if (session.state === "recent") return 3;
  return 4;
}

function orderStable<T extends SessionStackIdentity>(stableOrder: string[], sessions: T[]): T[] {
  const order = new Map(stableOrder.map((sessionId, index) => [sessionId, index]));
  return [...sessions].sort((left, right) => (order.get(sessionStackSessionKey(left)) ?? Number.MAX_SAFE_INTEGER) - (order.get(sessionStackSessionKey(right)) ?? Number.MAX_SAFE_INTEGER));
}
