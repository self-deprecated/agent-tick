import type { ActivityItem } from "@self-deprecated/agent-tick-shared";
import {
  groupSessionTimelineItems,
  sessionTimelineRenderWindow,
  shouldAutoFocusSessionTimelineNewActivity,
  toolActivityCallCountLabel,
  toolActivityCountsLabel,
  toolActivityGroupInProgress,
  toolActivityGroupOutcomeLabel,
} from "./sessions/sessionTimelineLogic";

describe("Session timeline logic", () => {
  it("auto-focuses new Activity when the user is idle or already at the timeline end", () => {
    expect(shouldAutoFocusSessionTimelineNewActivity({ userIdle: false, userAtTimelineEnd: false })).toBe(false);
    expect(shouldAutoFocusSessionTimelineNewActivity({ userIdle: true, userAtTimelineEnd: false })).toBe(true);
    expect(shouldAutoFocusSessionTimelineNewActivity({ userIdle: false, userAtTimelineEnd: true })).toBe(true);
  });

  it("counts a large contiguous Tool Activity group as one render window item", () => {
    const timeline: ActivityItem[] = [
      statusUpdate("status_1"),
      ...Array.from({ length: 31 }, (_, index) => toolActivity(`tool_${index + 1}`, index % 2 === 0 ? "bash" : "read", "finished", {
        toolCallId: `call_${index + 1}`,
        outcome: index === 30 ? "failed" : "success",
        createdAt: `2026-05-08T00:00:${String(index + 1).padStart(2, "0")}.000Z`,
      })),
    ];

    expect(sessionTimelineRenderWindow(timeline, null)).toEqual({ start: 0, end: timeline.length });
  });

  it("groups contiguous Tool Activity into compact blocks", () => {
    const timeline: ActivityItem[] = [
      toolActivity("tool_1", "bash", "started", { toolCallId: "call_1", createdAt: "2026-05-08T00:00:00.000Z" }),
      toolActivity("tool_2", "bash", "finished", { toolCallId: "call_1", outcome: "success", createdAt: "2026-05-08T00:00:01.000Z" }),
      toolActivity("tool_3", "read", "finished", { toolCallId: "call_2", outcome: "success", createdAt: "2026-05-08T00:00:02.000Z" }),
    ];

    const grouped = groupSessionTimelineItems(timeline);

    expect(grouped).toHaveLength(1);
    expect(grouped[0]?.kind).toBe("tool_activity_group");
    if (grouped[0]?.kind !== "tool_activity_group") throw new Error("expected tool group");
    expect(toolActivityCountsLabel(grouped[0].group.toolActivities)).toBe("bash ×1, read ×1");
    expect(toolActivityCallCountLabel(grouped[0].group.toolActivities)).toBe("2 tool calls");
    expect(toolActivityGroupInProgress(grouped[0].group.toolActivities)).toBe(false);
    expect(toolActivityGroupOutcomeLabel(grouped[0].group.toolActivities)).toBe("2 completed");
  });

  it("keeps failed, cancelled, and running Tool Activity group state visible", () => {
    const failed = [toolActivity("tool_1", "bash", "finished", { outcome: "failed" }).toolActivity];
    const cancelled = [toolActivity("tool_2", "edit", "finished", { outcome: "cancelled" }).toolActivity];
    const running = [toolActivity("tool_3", "read", "started", { toolCallId: "call_3" }).toolActivity];

    expect(toolActivityGroupOutcomeLabel(failed)).toBe("1 failed");
    expect(toolActivityGroupOutcomeLabel(cancelled)).toBe("1 cancelled");
    expect(toolActivityGroupInProgress(running)).toBe(true);
    expect(toolActivityGroupOutcomeLabel(running)).toBe("1 running");
  });

  it("summarizes mixed Tool Activity outcomes without implying the whole group failed", () => {
    const mixed = [
      toolActivity("tool_1", "bash", "started", { toolCallId: "call_1", createdAt: "2026-05-08T00:00:00.000Z" }).toolActivity,
      toolActivity("tool_2", "bash", "finished", { toolCallId: "call_1", outcome: "success", createdAt: "2026-05-08T00:00:01.000Z" }).toolActivity,
      toolActivity("tool_3", "read", "finished", { toolCallId: "call_2", outcome: "failed", createdAt: "2026-05-08T00:00:02.000Z" }).toolActivity,
      toolActivity("tool_4", "edit", "started", { toolCallId: "call_3", createdAt: "2026-05-08T00:00:03.000Z" }).toolActivity,
    ];

    expect(toolActivityCallCountLabel(mixed)).toBe("3 tool calls");
    expect(toolActivityGroupInProgress(mixed)).toBe(true);
    expect(toolActivityGroupOutcomeLabel(mixed)).toBe("1 running, 1 failed, 1 completed");
  });
});

function statusUpdate(id: string, overrides: Partial<Extract<ActivityItem, { kind: "status_update" }>["statusUpdate"]> = {}): Extract<ActivityItem, { kind: "status_update" }> {
  const createdAt = overrides.createdAt ?? "2026-05-08T00:00:00.000Z";
  return {
    kind: "status_update",
    id,
    workspaceId: "wsp_1",
    createdAt,
    statusUpdate: {
      statusId: id,
      workspaceId: "wsp_1",
      agentTokenId: "agt_1",
      state: "working",
      message: "continue",
      createdAt,
      ...overrides,
    },
  } as Extract<ActivityItem, { kind: "status_update" }>;
}


function toolActivity(id: string, toolName: string, state: "started" | "finished", overrides: Partial<Extract<ActivityItem, { kind: "tool_activity" }>["toolActivity"]> = {}): Extract<ActivityItem, { kind: "tool_activity" }> {
  return {
    kind: "tool_activity",
    id,
    workspaceId: "wsp_1",
    createdAt: overrides.createdAt ?? "2026-05-08T00:00:00.000Z",
    toolActivity: {
      toolActivityId: id,
      workspaceId: "wsp_1",
      sessionId: "run_1",
      toolName,
      state,
      contentMode: "plain",
      createdAt: overrides.createdAt ?? "2026-05-08T00:00:00.000Z",
      ...overrides,
    },
  };
}
