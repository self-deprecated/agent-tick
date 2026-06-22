import { initialSessionStackLocalState, setSessionPresentationOverride } from "../sessionStackState";
import { sessionLaneDisplayTitle } from "./sessionDisplayHelpers";

function sessionSummary(overrides: Record<string, unknown> = {}): any {
  return {
    sessionId: "session_1",
    title: "Server Session",
    state: "waiting",
    latestActivity: { kind: "status_update", id: "status_1", createdAt: "2026-04-19T12:03:00Z", preview: "Waiting", state: "waiting" },
    pendingRequestCount: 0,
    sourceLabels: ["Pi"],
    startedAt: "2026-04-19T12:00:00Z",
    updatedAt: "2026-04-19T12:03:00Z",
    ...overrides,
  };
}

describe("sessionLaneDisplayTitle", () => {
  it("prefers project/client source labels over generic Agent on host labels", () => {
    const state = initialSessionStackLocalState();
    const summaries = [
      sessionSummary({ sessionId: "session_pi", sourceLabels: ["Agent on lattice", "pi-questions", "lattice"] }),
      sessionSummary({ sessionId: "session_switchyard", sourceLabels: ["Agent on lattice", "switchyard-tracer-mono", "lattice"] }),
    ];

    expect(sessionLaneDisplayTitle(state, summaries, summaries[0])).toBe("pi-questions");
    expect(sessionLaneDisplayTitle(state, summaries, summaries[1])).toBe("switchyard-tracer-mono");
  });

  it("uses time instead of repeated generic host labels when preferred titles collide", () => {
    const state = initialSessionStackLocalState();
    const summaries = [
      sessionSummary({ sessionId: "session_first", sourceLabels: ["Agent on lattice", "pi-questions", "lattice"], startedAt: "2026-04-19T12:00:00Z" }),
      sessionSummary({ sessionId: "session_second", sourceLabels: ["Agent on lattice", "pi-questions", "lattice"], startedAt: "2026-04-19T12:05:00Z" }),
    ];

    const firstTitle = sessionLaneDisplayTitle(state, summaries, summaries[0]);
    const secondTitle = sessionLaneDisplayTitle(state, summaries, summaries[1]);

    expect(firstTitle).toMatch(/^pi-questions · \d{1,2}:\d{2}/);
    expect(secondTitle).toMatch(/^pi-questions · \d{1,2}:\d{2}/);
    expect(firstTitle).not.toContain("Agent on lattice");
    expect(secondTitle).not.toContain("Agent on lattice");
    expect(firstTitle).not.toBe(secondTitle);
  });

  it("uses a tools title instead of single Tool Activity lifecycle summaries", () => {
    const state = initialSessionStackLocalState();
    const summary = sessionSummary({ sessionId: "session_tools", title: "bash finished", sourceLabels: [] });

    expect(sessionLaneDisplayTitle(state, [summary], summary)).toBe("Tools");
  });

  it("does not fall back to generic Agent on host summary titles", () => {
    const state = initialSessionStackLocalState();
    const summary = sessionSummary({ sessionId: "session_agent", title: "Agent on lattice", sourceLabels: ["Agent on lattice", "lattice"] });

    expect(sessionLaneDisplayTitle(state, [summary], summary)).toMatch(/^\d{1,2}:\d{2}/);
  });

  it("keeps explicit local presentation overrides first", () => {
    const state = setSessionPresentationOverride(initialSessionStackLocalState(), "session_pi", { title: "Local title" });
    const summary = sessionSummary({ sessionId: "session_pi", sourceLabels: ["Agent on lattice", "pi-questions", "lattice"] });

    expect(sessionLaneDisplayTitle(state, [summary], summary)).toBe("Local title");
  });
});
