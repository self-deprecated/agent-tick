import { allocateSessionLaneLayouts } from "./sessions/sessionLaneLayout";

function sessionSummary(overrides: Record<string, unknown> = {}): any {
  return {
    sessionId: "session_1",
    title: "Deploy Session",
    state: "needs-input",
    latestActivity: { kind: "request", id: "req_latest", createdAt: "2026-04-19T12:03:00Z", preview: "Approve deploy", requestStatus: "pending" },
    pendingRequestCount: 1,
    sourceLabels: ["Pi"],
    startedAt: "2026-04-19T12:00:00Z",
    updatedAt: "2026-04-19T12:03:00Z",
    ...overrides,
  };
}

describe("Session Lane layout", () => {
  it("allocates lanes from an even viewport division and expands needs-input lanes", () => {
    const layouts = allocateSessionLaneLayouts([
      sessionSummary({ sessionId: "needs", state: "needs-input", pendingRequestCount: 1 }),
      sessionSummary({ sessionId: "recent", state: "recent", pendingRequestCount: 0 }),
    ], 600, { compactMinHeight: 140, expandedMinHeight: 240 });

    expect(layouts).toEqual([
      expect.objectContaining({ sessionId: "needs", height: 300, expanded: true, targetActivityId: "req_latest" }),
      expect.objectContaining({ sessionId: "recent", height: 300, expanded: false, targetActivityId: "req_latest" }),
    ]);
  });

  it("allows the stack to scroll when normal lane minimum heights exceed the viewport", () => {
    const layouts = allocateSessionLaneLayouts([
      sessionSummary({ sessionId: "a", state: "recent", pendingRequestCount: 0 }),
      sessionSummary({ sessionId: "b", state: "recent", pendingRequestCount: 0 }),
      sessionSummary({ sessionId: "c", state: "recent", pendingRequestCount: 0 }),
    ], 320, { compactMinHeight: 132, autoExpansion: "none" });

    expect(layouts.map((layout) => layout.height)).toEqual([132, 132, 132]);
    expect(layouts.reduce((total, layout) => total + layout.height, 0)).toBeGreaterThan(320);
  });

  it("keeps default Session Lanes tall enough and lets the stack overflow", () => {
    const layouts = allocateSessionLaneLayouts([
      sessionSummary({ sessionId: "a", state: "recent", pendingRequestCount: 0 }),
      sessionSummary({ sessionId: "b", state: "recent", pendingRequestCount: 0 }),
      sessionSummary({ sessionId: "c", state: "recent", pendingRequestCount: 0 }),
      sessionSummary({ sessionId: "d", state: "recent", pendingRequestCount: 0 }),
    ], 600, { autoExpansion: "none" });

    expect(layouts.map((layout) => layout.height)).toEqual([220, 220, 220, 220]);
    expect(layouts.reduce((total, layout) => total + layout.height, 0)).toBeGreaterThan(600);
  });

  it("retargets a Session Lane preview to new pending Activity without changing lane order", () => {
    const before = allocateSessionLaneLayouts([sessionSummary({ sessionId: "a", latestActivity: { kind: "request", id: "req_old", createdAt: "2026-04-19T12:00:00Z", preview: "Old", requestStatus: "pending" } })], 300);
    const after = allocateSessionLaneLayouts([sessionSummary({ sessionId: "a", latestActivity: { kind: "request", id: "req_new", createdAt: "2026-04-19T12:05:00Z", preview: "New", requestStatus: "pending" } })], 300);

    expect(before[0]?.sessionId).toBe("a");
    expect(after[0]?.sessionId).toBe("a");
    expect(before[0]?.targetActivityId).toBe("req_old");
    expect(after[0]?.targetActivityId).toBe("req_new");
  });

  it("gives the single large lane half the stack and lets normal lanes share the rest", () => {
    const layouts = allocateSessionLaneLayouts([
      sessionSummary({ sessionId: "large", state: "recent", pendingRequestCount: 0 }),
      sessionSummary({ sessionId: "normal_a", state: "needs-input", pendingRequestCount: 1 }),
      sessionSummary({ sessionId: "normal_b", state: "needs-input", pendingRequestCount: 1 }),
    ], 600, { compactMinHeight: 132, laneSizes: { large: "large" } });

    expect(layouts.map((layout) => ({ id: layout.sessionId, mode: layout.mode, height: layout.height }))).toEqual([
      { id: "large", mode: "large", height: 300 },
      { id: "normal_a", mode: "normal", height: 150 },
      { id: "normal_b", mode: "normal", height: 150 },
    ]);
  });

  it("supports manual large, normal, and collapsed lane sizes", () => {
    const layouts = allocateSessionLaneLayouts([
      sessionSummary({ sessionId: "large", state: "recent", pendingRequestCount: 0 }),
      sessionSummary({ sessionId: "normal", state: "needs-input", pendingRequestCount: 1 }),
      sessionSummary({ sessionId: "collapsed", state: "needs-input", pendingRequestCount: 1 }),
    ], 320, { collapsedHeight: 56, compactMinHeight: 132, laneSizes: { large: "large", normal: "normal", collapsed: "collapsed" } });

    expect(layouts.map((layout) => ({ id: layout.sessionId, mode: layout.mode, height: layout.height }))).toEqual([
      { id: "large", mode: "large", height: 132 },
      { id: "normal", mode: "normal", height: 132 },
      { id: "collapsed", mode: "collapsed", height: 56 },
    ]);
  });
});
