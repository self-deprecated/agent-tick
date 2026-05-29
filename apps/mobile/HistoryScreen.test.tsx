import React from "react";
import { fireEvent, render, screen } from "@testing-library/react-native";

jest.mock("@clerk/expo", () => ({
  ClerkProvider: ({ children }: { children: React.ReactNode }) => children,
  useAuth: () => ({ getToken: jest.fn(), isSignedIn: false, signOut: jest.fn() }),
  useSignIn: () => ({ fetchStatus: "idle", signIn: { create: jest.fn(), finalize: jest.fn(), status: "needs_identifier" } }),
}));

jest.mock("expo-camera", () => ({
  CameraView: "CameraView",
  useCameraPermissions: () => [null, jest.fn()],
}));
jest.mock("expo-constants", () => ({ expoConfig: { extra: { eas: {} } } }));
jest.mock("expo-notifications", () => ({
  addNotificationReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
  addNotificationResponseReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
  getLastNotificationResponseAsync: jest.fn(async () => null),
  getPermissionsAsync: jest.fn(async () => ({ granted: true, status: "granted" })),
  requestPermissionsAsync: jest.fn(async () => ({ granted: true, status: "granted" })),
  scheduleNotificationAsync: jest.fn(async () => "notification-id"),
  setNotificationCategoryAsync: jest.fn(async () => null),
  setNotificationHandler: jest.fn(),
}));
jest.mock("expo-status-bar", () => ({ StatusBar: () => null }));

import { HistoryScreen } from "./App";
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

function sessionDetail(items: any[], overrides: Record<string, unknown> = {}): any {
  return {
    summary: {
      sessionId: "session_1",
      title: "Deploy Session",
      state: "needs-input",
      latestActivity: { kind: "request", id: "req_latest", createdAt: "2026-04-19T12:03:00Z", preview: "Approve?", requestStatus: "pending" },
      pendingRequestCount: items.filter((item) => item.kind === "request" && item.request.status === "pending").length,
      sourceLabels: ["Pi"],
      startedAt: "2026-04-19T12:00:00Z",
      updatedAt: "2026-04-19T12:03:00Z",
      ...overrides,
    },
    timeline: items,
  };
}

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

describe("HistoryScreen", () => {
  it("shows archived Sessions instead of request-only history when Session archive data is available", () => {
    const archiveSummary = sessionSummary({ sessionId: "session_archive", title: "Archived rollout", state: "complete", pendingRequestCount: 0, latestActivity: { kind: "status_update", id: "st_done", createdAt: "2026-04-19T12:05:00Z", preview: "Rollout finished", state: "done" } });
    render(<HistoryScreen error={null} history={[]} sessionArchives={[archiveSummary]} sessionDetails={{}} loading={false} onRefresh={jest.fn()} />);

    expect(screen.getByText("Session Archive")).toBeTruthy();
    expect(screen.getByText("Archived rollout")).toBeTruthy();
    expect(screen.queryByText("No request history yet.")).toBeNull();
  });

  it("opens archived Session detail with interleaved Status Updates and Requests", () => {
    const archiveSummary = sessionSummary({ sessionId: "session_archive", title: "Archived rollout", state: "complete", pendingRequestCount: 0 });
    const detail = sessionDetail([
      { kind: "status_update", statusUpdate: statusUpdate({ statusId: "st_start", message: "Starting rollout", state: "working", createdAt: "2026-04-19T12:00:00Z" }) },
      { kind: "request", request: request({ id: "req_archive", title: "Approve archived rollout", status: "responded", response: { choiceId: "approve" }, createdAt: "2026-04-19T12:01:00Z" }) },
      { kind: "status_update", statusUpdate: statusUpdate({ statusId: "st_done", message: "Rollout finished", state: "done", createdAt: "2026-04-19T12:02:00Z" }) },
    ], { sessionId: "session_archive", title: "Archived rollout" });
    render(<HistoryScreen error={null} history={[]} sessionArchives={[archiveSummary]} sessionDetails={{ session_archive: detail }} loading={false} onRefresh={jest.fn()} />);

    fireEvent.press(screen.getByLabelText("Open archived Session Archived rollout"));
    expect(screen.getByText("Starting rollout")).toBeTruthy();
    expect(screen.getByText("Approve archived rollout")).toBeTruthy();
    expect(screen.getByText("Rollout finished")).toBeTruthy();
    fireEvent.press(screen.getByLabelText("Back to history"));
    expect(screen.getByText("Archived rollout")).toBeTruthy();
  });

  it("shows final quorum request and denial history", () => {
    const responded = request({
      id: "req_done",
      status: "responded",
      response: { choiceId: "approve" },
      quorum: {
        requiredResponseCount: 2,
        receivedResponseCount: 2,
        currentUserResponded: false,
        waitingFor: 0,
        responses: [
          { responseId: "resp_a", requestId: "req_done", step: 1, userId: "usr_a", source: "device", choiceId: "approve", createdAt: "2026-04-19T12:01:00Z" },
          { responseId: "resp_b", requestId: "req_done", step: 1, userId: "usr_b", source: "session", choiceId: "approve", createdAt: "2026-04-19T12:02:00Z" },
        ],
      },
    });
    const denied = request({
      id: "req_denied",
      title: "Drop database?",
      status: "responded",
      response: { choiceId: "deny" },
      quorum: {
        requiredResponseCount: 2,
        receivedResponseCount: 0,
        currentUserResponded: false,
        waitingFor: 0,
        responses: [
          { responseId: "resp_no", requestId: "req_denied", step: 1, userId: "usr_c", source: "device", choiceId: "deny", createdAt: "2026-04-19T12:03:00Z" },
        ],
      },
    });

    render(<HistoryScreen error={null} history={[responded, denied]} loading={false} onRefresh={jest.fn()} />);

    expect(screen.getByText("Approved")).toBeTruthy();
    expect(screen.getByText("Denied")).toBeTruthy();
    expect(screen.getByText("Member response approved via device")).toBeTruthy();
    expect(screen.getByText("Member response denied via device")).toBeTruthy();
  });

  it("opens a history item detail with the original questionnaire and answer", () => {
    render(<HistoryScreen error={null} history={[request({
      requestType: "questionnaire",
      title: "Choose rollout plan",
      status: "responded",
      questions: [{
        header: "Rollout",
        question: "Which deployment window should we use?",
        options: [{ label: "Now" }, { label: "Tonight" }],
        multiSelect: false,
      }],
      response: { answers: { "Which deployment window should we use?": ["Tonight"] } },
    })]} loading={false} onRefresh={jest.fn()} />);

    fireEvent.press(screen.getByLabelText("Open history item Choose rollout plan"));

    expect(screen.getByText("Question")).toBeTruthy();
    expect(screen.getByText("Which deployment window should we use?")).toBeTruthy();
    expect(screen.getByText("Answer: Tonight")).toBeTruthy();
    fireEvent.press(screen.getByLabelText("Back to history"));
    expect(screen.getByText("History")).toBeTruthy();
  });

  it("opens a steering history detail with the full steering body", () => {
    render(<HistoryScreen error={null} history={[request({
      requestType: "steering",
      title: "Refocus the implementation",
      body: "Please stop changing the API and only polish the mobile history view.",
      command: undefined,
      status: "responded",
      response: { choiceId: "acknowledge" },
    })]} loading={false} onRefresh={jest.fn()} />);

    fireEvent.press(screen.getByLabelText("Open history item Refocus the implementation"));

    expect(screen.getByText("Steering")).toBeTruthy();
    expect(screen.getByText("Please stop changing the API and only polish the mobile history view.")).toBeTruthy();
  });

  it("navigates to previous and next history items from the detail view", () => {
    render(<HistoryScreen error={null} history={[
      request({ id: "req_first", title: "First request" }),
      request({ id: "req_second", title: "Second request" }),
      request({ id: "req_third", title: "Third request" }),
    ]} loading={false} onRefresh={jest.fn()} />);

    fireEvent.press(screen.getByLabelText("Open history item Second request"));
    expect(screen.getByText("Second request")).toBeTruthy();

    fireEvent.press(screen.getByLabelText("Previous history item"));
    expect(screen.getByText("First request")).toBeTruthy();

    fireEvent.press(screen.getByLabelText("Next history item"));
    expect(screen.getByText("Second request")).toBeTruthy();
    fireEvent.press(screen.getByLabelText("Next history item"));
    expect(screen.getByText("Third request")).toBeTruthy();
  });
});
