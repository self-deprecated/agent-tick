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

import { createEncryptedRequestPayload, generateRequestEncryptionKey } from "@agent-tick/shared";
import { RequestsScreen, HistoryScreen } from "./App";
import { groupRequestsBySource, normalizeRequest, type MobileRequest } from "./requests";

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

function renderRequest(request: MobileRequest, onRespond = jest.fn(), options: { e2eeKey?: string; onOpenSettings?: () => void; statusUpdates?: any[]; dismissedStatusID?: string | null; onDismissStatus?: (statusID: string) => void; choiceInteractionMode?: "click-to-submit" | "select-then-submit"; optionPlacement?: "sticky-bottom" | "inline-after-content"; confirmBeforeSubmit?: boolean } = {}) {
  render(
    <RequestsScreen
      e2eeKey={options.e2eeKey}
      error={null}
      onOpenSettings={options.onOpenSettings}
      loading={false}
      onRefresh={jest.fn()}
      onRespond={onRespond}
      onSubmitQuestionnaire={jest.fn()}
      choiceInteractionMode={options.choiceInteractionMode}
      optionPlacement={options.optionPlacement}
      confirmBeforeSubmit={options.confirmBeforeSubmit}
      sourceGroups={groupRequestsBySource([request])}
      questionnaireAnswers={{}}
      reply=""
      requests={[request]}
      selected={request}
      selectedID={request.id}
      selectedSourceID={null}
      statusUpdates={options.statusUpdates ?? []}
      dismissedStatusID={options.dismissedStatusID}
      onDismissStatus={options.onDismissStatus}
      setSourceID={jest.fn()}
      setQuestionnaireAnswer={jest.fn()}
      setReply={jest.fn()}
      setSelectedID={jest.fn()}
    />,
  );
  return onRespond;
}

describe("RequestsScreen quorum-aware Request UI", () => {
  it("does not render raw request-load errors over the waiting screen", () => {
    render(
      <RequestsScreen
        error={'[{"message":"duplicate choice id: id"}]'}
        loading={false}
        onRefresh={jest.fn()}
        onRespond={jest.fn()}
        onSubmitQuestionnaire={jest.fn()}
        sourceGroups={[]}
        questionnaireAnswers={{}}
        reply=""
        requests={[]}
        selected={undefined}
        selectedID={null}
        selectedSourceID={null}
        statusUpdates={[]}
        setSourceID={jest.fn()}
        setQuestionnaireAnswer={jest.fn()}
        setReply={jest.fn()}
        setSelectedID={jest.fn()}
      />,
    );
    expect(screen.getByText("Waiting")).toBeTruthy();
    expect(screen.queryByText(/duplicate choice id/)).toBeNull();
  });

  it("shows choice flags and tags on action buttons", () => {
    renderRequest(request({
      choices: [
        { id: "small", label: "Small fix", kind: "approve", flags: ["favorite", "reversible"], tags: ["quick"] },
        { id: "reject", label: "Reject", kind: "deny" },
      ],
    }));

    expect(screen.getByLabelText("Favorite choice")).toBeTruthy();
    expect(screen.getByText("Small fix")).toBeTruthy();
    expect(screen.getByText("reversible")).toBeTruthy();
    expect(screen.getByText("quick")).toBeTruthy();
  });

  it("requires decrypting encrypted requests before responding", () => {
    const key = generateRequestEncryptionKey();
    const onRespond = jest.fn();
    const onOpenSettings = jest.fn();
    renderRequest(request({
      title: "Encrypted Request",
      body: "Open Agent Tick to decrypt this request.",
      encryptedPayload: createEncryptedRequestPayload({ title: "Restart prod?", body: "Sensitive incident details", command: "kubectl rollout restart deploy/api" }, key),
    }), onRespond, { onOpenSettings });

    expect(screen.getByText("Encrypted Request")).toBeTruthy();
    expect(screen.getByText("Encrypted request. Add your E2EE key in Settings to decrypt.")).toBeTruthy();
    expect(screen.queryByText("Open Agent Tick to decrypt this request.")).toBeNull();
    expect(screen.queryByText("Restart prod?")).toBeNull();
    expect(screen.queryByText("Sensitive incident details")).toBeNull();
    expect(screen.queryByText("kubectl rollout restart deploy/api")).toBeNull();
    expect(screen.getByText("Decrypt this request before responding.")).toBeTruthy();
    expect(screen.queryByText("Approve")).toBeNull();
    expect(screen.queryByText("Deny")).toBeNull();
    fireEvent.press(screen.getByText("Dismiss encrypted request"));
    expect(onRespond).toHaveBeenCalledWith(expect.objectContaining({ id: "req_1" }), expect.objectContaining({ id: "deny" }));
    fireEvent.press(screen.getByText("Add E2EE Key in Settings"));
    expect(onOpenSettings).toHaveBeenCalled();
  });

  it("dismisses the latest agent status card", () => {
    const onDismissStatus = jest.fn();
    renderRequest(request(), jest.fn(), {
      statusUpdates: [{
        statusId: "stat_1",
        workspaceId: "org_1",
        agentTokenId: "agt_1",
        agentTokenLabel: "Agent",
        threadId: "thread",
        message: "Working",
        state: "working",
        createdAt: "2026-04-19T12:01:00Z",
      }],
      onDismissStatus,
    });

    expect(screen.getByText("Latest agent status")).toBeTruthy();
    fireEvent.press(screen.getByLabelText("Dismiss latest agent status"));
    expect(onDismissStatus).toHaveBeenCalledWith("stat_1");
  });

  it("hides a dismissed latest agent status card", () => {
    renderRequest(request(), jest.fn(), {
      statusUpdates: [{
        statusId: "stat_1",
        workspaceId: "org_1",
        agentTokenId: "agt_1",
        agentTokenLabel: "Agent",
        threadId: "thread",
        message: "Working",
        state: "working",
        createdAt: "2026-04-19T12:01:00Z",
      }],
      dismissedStatusID: "stat_1",
    });

    expect(screen.queryByText("Latest agent status")).toBeNull();
  });

  it("decrypts encrypted request contents locally when the E2EE key is configured", () => {
    const key = generateRequestEncryptionKey();
    renderRequest(request({
      title: "Encrypted Request",
      body: "Open Agent Tick to decrypt this request.",
      encryptedPayload: createEncryptedRequestPayload({ title: "Restart prod?", body: "Sensitive incident details", command: "kubectl rollout restart deploy/api" }, key),
    }), jest.fn(), { e2eeKey: key });

    expect(screen.getByText("Restart prod?")).toBeTruthy();
    expect(screen.getByText("Sensitive incident details")).toBeTruthy();
    expect(screen.getByText("kubectl rollout restart deploy/api")).toBeTruthy();
    expect(screen.queryByText("Encrypted request. Add your E2EE key in Settings to decrypt.")).toBeNull();
  });

  it("can keep the fast single-recipient approve flow when confirmation is off", () => {
    const onRespond = renderRequest(request(), jest.fn(), { confirmBeforeSubmit: false });

    expect(screen.getByText("Approve")).toBeTruthy();
    fireEvent.press(screen.getByText("Approve"));
    expect(onRespond).toHaveBeenCalledWith(expect.objectContaining({ id: "req_1" }), expect.objectContaining({ id: "approve" }));
  });

  it("can render choices as select then send rows", () => {
    const onRespond = renderRequest(request(), jest.fn(), { choiceInteractionMode: "select-then-submit", confirmBeforeSubmit: false });

    fireEvent.press(screen.getByText("Deny"));
    expect(onRespond).not.toHaveBeenCalled();
    fireEvent.press(screen.getByText("Send decision"));
    expect(onRespond).toHaveBeenCalledWith(expect.objectContaining({ id: "req_1" }), expect.objectContaining({ id: "deny" }));
  });

  it("shows quorum context and waiting copy after the current user responses", () => {
    renderRequest(request({
      quorum: {
        requiredResponseCount: 2,
        receivedResponseCount: 1,
        currentUserResponded: true,
        currentUserEligible: true,
        waitingFor: 1,
        responses: [
          {
            responseId: "resp_a",
            requestId: "req_1",
              userId: "usr_a",
            source: "device",
            choiceId: "approve",
            createdAt: "2026-04-19T12:01:00Z",
          },
        ],
      },
    }));

    expect(screen.getAllByText("Waiting for others").length).toBeGreaterThan(0);
    expect(screen.getAllByText("You responded. Waiting for 1 more response.").length).toBeGreaterThan(0);
    expect(screen.queryByText("Approve")).toBeNull();
  });

  it("renders ineligible requests as read-only", () => {
    renderRequest(request({
      quorum: {
        requiredResponseCount: 1,
        receivedResponseCount: 0,
        currentUserResponded: false,
        currentUserEligible: false,
        waitingFor: 1,
      },
    }));

    expect(screen.getAllByText("Read-only").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/not a routed recipient/).length).toBeGreaterThan(0);
    expect(screen.queryByText("Approve")).toBeNull();
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
    expect(screen.getByText("usr_a approved via device")).toBeTruthy();
    expect(screen.getByText("usr_c denied via device")).toBeTruthy();
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
