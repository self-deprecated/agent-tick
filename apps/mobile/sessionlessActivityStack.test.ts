import { synthesizeSessionlessActivityStack } from "./sessions/sessionlessActivityStack";
import { normalizeRequest } from "./requests";

function request(overrides: Record<string, unknown> = {}) {
  return normalizeRequest({
    id: "req_1",
    workspaceId: "wsp_personal",
    requester: {
      name: "Codex",
      agentTokenId: "agent_platform",
      host: "workstation",
      clientName: "Agent Tick",
      clientId: "prj_agent_tick",
      workingDirectory: "/tmp/agent-tick-demo",
    },
    requestType: "sanction",
    title: "Deploy?",
    body: "Ship the release",
    choices: [
      { id: "approve", label: "Approve", kind: "approve" },
      { id: "deny", label: "Deny", kind: "deny" },
    ],
    allowFreeformReply: false,
    status: "pending",
    createdAt: "2026-04-19T12:00:00Z",
    metadata: { routingRuleName: "Backend", ownerUserId: "usr_owner", routingRuleSummary: "Requires 2 responses from Backend" },
    ...overrides,
  });
}

function statusUpdate(overrides: Record<string, unknown> = {}) {
  return {
    statusId: "st_1",
    workspaceId: "wsp_personal",
    agentTokenId: "agent_platform",
    message: "Working on it",
    state: "working",
    createdAt: "2026-04-19T12:00:00Z",
    ...overrides,
  };
}

describe("sessionless activity stack", () => {
  it("turns session-less pending Requests into Session summaries with response Activity", () => {
    const stack = synthesizeSessionlessActivityStack([
      request({ id: "sessionless_req", title: "Approve session-less deploy" }),
    ], []);

    expect(stack.summaries).toHaveLength(1);
    expect(stack.summaries[0]).toEqual(expect.objectContaining({
      title: "agent-tick-demo",
      state: "needs-input",
      pendingRequestCount: 1,
      latestActivity: expect.objectContaining({ kind: "request", id: "sessionless_req", preview: "Approve session-less deploy" }),
      sourceLabels: ["Agent Tick", "Codex", "workstation"],
      workspaceID: "wsp_personal",
    }));
    const sessionKey = stack.summaries[0]?.mobileSessionKey ?? stack.summaries[0]?.sessionId ?? "";
    expect(stack.details[sessionKey]?.timeline).toEqual([
      expect.objectContaining({ kind: "request", id: "sessionless_req" }),
    ]);
  });

  it("turns session-less Status Updates into status-only Session summaries", () => {
    const stack = synthesizeSessionlessActivityStack([], [
      statusUpdate({ statusId: "sessionless_status", message: "Finished validating mobile screenshots", clientName: "Pi", workingDirectory: "/tmp/agent-tick-demo", semanticState: "done" }),
    ] as any);

    expect(stack.summaries).toHaveLength(1);
    expect(stack.summaries[0]).toEqual(expect.objectContaining({
      title: "agent-tick-demo",
      state: "complete",
      pendingRequestCount: 0,
      latestActivity: expect.objectContaining({ kind: "status_update", id: "sessionless_status", preview: "Finished validating mobile screenshots" }),
      sourceLabels: ["Pi"],
      workspaceID: "wsp_personal",
    }));
  });
});
