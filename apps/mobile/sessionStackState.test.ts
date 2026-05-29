import AsyncStorage from "@react-native-async-storage/async-storage";
import type { SessionSummary } from "@self-deprecated/agent-tick-sdk";
import {
  archiveSession,
  defaultSessionStackPreferences,
  hasUnreadSessionActivity,
  initialSessionStackLocalState,
  isSessionArchivedInStack,
  loadSessionStackLocalState,
  markSessionSeen,
  moveSessionInStableOrder,
  orderSessionStackSummaries,
  saveSessionStackLocalState,
  sessionPresentation,
  sessionStackStorageKey,
  setSessionLaneSize,
  setSessionPresentationOverride,
  setSessionStackPreferences,
  setVisibleSessionLaneSizes,
  shouldAutoExpandSessionLane,
  unarchiveSession,
  updateStableSessionOrder,
  visibleSessionStackSummaries,
} from "./sessionStackState";

function session(overrides: Partial<SessionSummary> & { sessionId: string; updatedAt?: string; activityId?: string; activityCreatedAt?: string }): SessionSummary {
  const createdAt = overrides.activityCreatedAt ?? overrides.updatedAt ?? "2026-01-01T00:00:00.000Z";
  return {
    sessionId: overrides.sessionId,
    title: overrides.title ?? `Session ${overrides.sessionId}`,
    state: overrides.state ?? "recent",
    latestActivity: overrides.latestActivity ?? {
      kind: "status_update",
      id: overrides.activityId ?? `act_${overrides.sessionId}`,
      createdAt,
      preview: "Progress",
      state: "working",
    },
    pendingRequestCount: overrides.pendingRequestCount ?? 0,
    sourceLabels: overrides.sourceLabels ?? ["Pi"],
    startedAt: overrides.startedAt ?? "2026-01-01T00:00:00.000Z",
    updatedAt: overrides.updatedAt ?? createdAt,
  };
}

describe("Session Stack local state", () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  it("defaults to priority ordering and needs-input auto-expansion", () => {
    const state = initialSessionStackLocalState();
    expect(state.preferences).toEqual(defaultSessionStackPreferences);
    expect(shouldAutoExpandSessionLane(state, session({ sessionId: "needs", state: "needs-input" }))).toBe(true);
    expect(shouldAutoExpandSessionLane(state, session({ sessionId: "recent", state: "recent" }))).toBe(false);
  });

  it("stores unread last-seen positions per Approval Device scope", async () => {
    const summary = session({ sessionId: "s1", activityId: "a1", activityCreatedAt: "2026-01-01T00:00:00.000Z" });
    const key = sessionStackStorageKey({ serverURL: "https://app.agenttick.sh/", accountID: "acct_a", workspaceID: "wsp_a", approvalDeviceID: "dev_a" });
    const otherDeviceKey = sessionStackStorageKey({ serverURL: "https://app.agenttick.sh/", accountID: "acct_a", workspaceID: "wsp_a", approvalDeviceID: "dev_b" });
    const seen = markSessionSeen(initialSessionStackLocalState(), summary, "2026-01-01T00:05:00.000Z");

    expect(hasUnreadSessionActivity(seen, summary)).toBe(false);
    expect(hasUnreadSessionActivity(seen, session({ sessionId: "s1", activityId: "a2", activityCreatedAt: "2026-01-01T00:06:00.000Z" }))).toBe(true);

    await saveSessionStackLocalState(key, seen);
    await expect(loadSessionStackLocalState(key)).resolves.toMatchObject({ seenPositions: { s1: { activityId: "a1" } } });
    await expect(loadSessionStackLocalState(otherDeviceKey)).resolves.toMatchObject({ seenPositions: {} });
  });

  it("archives Sessions locally and returns them when new Activity arrives", () => {
    const base = session({ sessionId: "s1", activityId: "a1", activityCreatedAt: "2026-01-01T00:00:00.000Z" });
    const archived = archiveSession(initialSessionStackLocalState(), base, "2026-01-01T00:01:00.000Z");

    expect(isSessionArchivedInStack(archived, base)).toBe(true);
    expect(visibleSessionStackSummaries(archived, [base])).toEqual([]);
    expect(isSessionArchivedInStack(archived, session({ sessionId: "s1", activityId: "a2", activityCreatedAt: "2026-01-01T00:02:00.000Z" }))).toBe(false);
    const pendingAtArchivedPosition = session({ sessionId: "s1", activityId: "a1", activityCreatedAt: "2026-01-01T00:00:00.000Z", pendingRequestCount: 1, state: "needs-input" });
    expect(isSessionArchivedInStack(archived, pendingAtArchivedPosition)).toBe(true);
    expect(isSessionArchivedInStack(unarchiveSession(archived, "s1"), base)).toBe(false);
  });

  it("applies one-Session presentation overrides without mutating server summaries", () => {
    const summary = session({ sessionId: "s1", title: "Server title" });
    const state = setSessionPresentationOverride(initialSessionStackLocalState(), "s1", { title: "Deploy run", color: "#ffcc00" });

    expect(sessionPresentation(state, summary)).toEqual({ title: "Deploy run", color: "#ffcc00" });
    expect(summary.title).toBe("Server title");
    expect(sessionPresentation(state, session({ sessionId: "s2", title: "Other" }))).toEqual({ title: "Other" });
  });

  it("keys local state by composite mobile Session key when present", () => {
    const first = { ...session({ sessionId: "same", activityId: "a1" }), mobileSessionKey: "acct_a:wsp_1:same" };
    const second = { ...session({ sessionId: "same", activityId: "b1" }), mobileSessionKey: "acct_b:wsp_1:same" };
    const state = markSessionSeen(initialSessionStackLocalState(), first, "2026-01-01T00:05:00.000Z");

    expect(hasUnreadSessionActivity(state, first)).toBe(false);
    expect(hasUnreadSessionActivity(state, second)).toBe(true);
    expect(state.seenPositions).toHaveProperty("acct_a:wsp_1:same");
  });

  it("orders Session Stack manually and supports reordering", () => {
    const needs = session({ sessionId: "needs", state: "needs-input", pendingRequestCount: 1, updatedAt: "2026-01-01T00:00:00.000Z" });
    const recent = session({ sessionId: "recent", state: "recent", updatedAt: "2026-01-01T00:10:00.000Z" });
    const active = session({ sessionId: "active", state: "active", updatedAt: "2026-01-01T00:05:00.000Z" });

    const ordered = updateStableSessionOrder(initialSessionStackLocalState(), [recent, needs, active]);
    expect(orderSessionStackSummaries(ordered, [active, needs, recent]).map((item) => item.sessionId)).toEqual(["recent", "needs", "active"]);

    const moved = moveSessionInStableOrder(ordered, "active", 0);
    expect(orderSessionStackSummaries(moved, [active, needs, recent]).map((item) => item.sessionId)).toEqual(["active", "recent", "needs"]);
  });

  it("supports needs-input lane expansion preference", () => {
    const disabled = setSessionStackPreferences(initialSessionStackLocalState(), { autoExpansion: "none" });
    expect(shouldAutoExpandSessionLane(disabled, session({ sessionId: "needs", state: "needs-input", pendingRequestCount: 1 }))).toBe(false);
  });

  it("stores per-Session lane size overrides", () => {
    const one = session({ sessionId: "one" });
    const two = session({ sessionId: "two" });
    const sized = setVisibleSessionLaneSizes(initialSessionStackLocalState(), [one, two], "collapsed");
    expect(sized.laneSizes).toEqual({ one: "collapsed", two: "collapsed" });
    expect(setSessionLaneSize(sized, "one", "large").laneSizes).toEqual({ one: "large", two: "collapsed" });
    expect(setSessionLaneSize(setSessionLaneSize(sized, "one", "large"), "two", "large").laneSizes).toEqual({ two: "large" });
    expect(setSessionLaneSize(sized, "one", undefined).laneSizes).toEqual({ two: "collapsed" });
  });
});
