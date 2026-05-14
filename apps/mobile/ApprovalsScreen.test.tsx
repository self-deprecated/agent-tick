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

import { createEncryptedApprovalPayload, generateApprovalEncryptionKey } from "@agent-tick/shared";
import { ApprovalsScreen, HistoryScreen } from "./App";
import { groupRequestsByProject, normalizeApproval, type ApprovalRequest } from "./approvalRequests";

function approval(overrides: Partial<ApprovalRequest> = {}) {
  return normalizeApproval({
    id: "req_1",
    requester: {
      name: "Codex",
      agentId: "agent_platform",
      host: "workstation",
      projectName: "Agent Tick",
      projectId: "prj_agent_tick",
    },
    requestType: "approval",
    title: "Deploy?",
    body: "Ship the release",
    choices: [
      { id: "approve", label: "Approve", kind: "approve" },
      { id: "deny", label: "Deny", kind: "deny" },
    ],
    allowFreeformReply: false,
    status: "pending",
    createdAt: "2026-04-19T12:00:00Z",
    metadata: { teamName: "Backend", ownerUserId: "usr_owner", approvalPolicySummary: "Requires 2 approvals from Backend" },
    ...overrides,
  });
}

function renderApproval(request: ApprovalRequest, onRespond = jest.fn(), options: { e2eeKey?: string; onOpenSettings?: () => void; statusUpdates?: any[]; dismissedStatusID?: string | null; onDismissStatus?: (statusID: string) => void } = {}) {
  render(
    <ApprovalsScreen
      e2eeKey={options.e2eeKey}
      error={null}
      onOpenSettings={options.onOpenSettings}
      loading={false}
      onRefresh={jest.fn()}
      onRespond={onRespond}
      onSubmitQuestionnaire={jest.fn()}
      projectGroups={groupRequestsByProject([request])}
      questionnaireAnswers={{}}
      reply=""
      requests={[request]}
      selected={request}
      selectedID={request.id}
      selectedProjectID={null}
      statusUpdates={options.statusUpdates ?? []}
      dismissedStatusID={options.dismissedStatusID}
      onDismissStatus={options.onDismissStatus}
      setProjectID={jest.fn()}
      setQuestionnaireAnswer={jest.fn()}
      setReply={jest.fn()}
      setSelectedID={jest.fn()}
    />,
  );
  return onRespond;
}

describe("ApprovalsScreen policy-aware approval UI", () => {
  it("does not render raw request-load errors over the waiting screen", () => {
    render(
      <ApprovalsScreen
        error={'[{"message":"duplicate choice id: id"}]'}
        loading={false}
        onRefresh={jest.fn()}
        onRespond={jest.fn()}
        onSubmitQuestionnaire={jest.fn()}
        projectGroups={[]}
        questionnaireAnswers={{}}
        reply=""
        requests={[]}
        selected={undefined}
        selectedID={null}
        selectedProjectID={null}
        statusUpdates={[]}
        setProjectID={jest.fn()}
        setQuestionnaireAnswer={jest.fn()}
        setReply={jest.fn()}
        setSelectedID={jest.fn()}
      />,
    );
    expect(screen.getByText("Waiting")).toBeTruthy();
    expect(screen.queryByText(/duplicate choice id/)).toBeNull();
  });

  it("requires decrypting encrypted requests before responding", () => {
    const key = generateApprovalEncryptionKey();
    const onRespond = jest.fn();
    const onOpenSettings = jest.fn();
    renderApproval(approval({
      title: "Encrypted approval request",
      body: "Open Agent Tick to decrypt this request.",
      encryptedPayload: createEncryptedApprovalPayload({ title: "Restart prod?", body: "Sensitive incident details", command: "kubectl rollout restart deploy/api" }, key),
    }), onRespond, { onOpenSettings });

    expect(screen.getByText("Encrypted approval request")).toBeTruthy();
    expect(screen.getByText("Encrypted request. Add your E2EE key in Settings to decrypt.")).toBeTruthy();
    expect(screen.queryByText("Open Agent Tick to decrypt this request.")).toBeNull();
    expect(screen.queryByText("Restart prod?")).toBeNull();
    expect(screen.queryByText("Sensitive incident details")).toBeNull();
    expect(screen.queryByText("kubectl rollout restart deploy/api")).toBeNull();
    expect(screen.getByText("Decrypt this request before approving or rejecting it.")).toBeTruthy();
    expect(screen.queryByText("Approve")).toBeNull();
    expect(screen.queryByText("Deny")).toBeNull();
    fireEvent.press(screen.getByText("Dismiss encrypted request"));
    expect(onRespond).toHaveBeenCalledWith(expect.objectContaining({ id: "req_1" }), expect.objectContaining({ id: "deny" }));
    fireEvent.press(screen.getByText("Add E2EE Key in Settings"));
    expect(onOpenSettings).toHaveBeenCalled();
  });

  it("dismisses the latest agent status card", () => {
    const onDismissStatus = jest.fn();
    renderApproval(approval(), jest.fn(), {
      statusUpdates: [{
        statusId: "stat_1",
        organizationId: "org_1",
        agentId: "agt_1",
        agentName: "Agent",
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
    renderApproval(approval(), jest.fn(), {
      statusUpdates: [{
        statusId: "stat_1",
        organizationId: "org_1",
        agentId: "agt_1",
        agentName: "Agent",
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
    const key = generateApprovalEncryptionKey();
    renderApproval(approval({
      title: "Encrypted approval request",
      body: "Open Agent Tick to decrypt this request.",
      encryptedPayload: createEncryptedApprovalPayload({ title: "Restart prod?", body: "Sensitive incident details", command: "kubectl rollout restart deploy/api" }, key),
    }), jest.fn(), { e2eeKey: key });

    expect(screen.getByText("Restart prod?")).toBeTruthy();
    expect(screen.getByText("Sensitive incident details")).toBeTruthy();
    expect(screen.getByText("kubectl rollout restart deploy/api")).toBeTruthy();
    expect(screen.queryByText("Encrypted request. Add your E2EE key in Settings to decrypt.")).toBeNull();
  });

  it("keeps the fast single-approver approve flow", () => {
    const onRespond = renderApproval(approval());

    expect(screen.getByText("Approve")).toBeTruthy();
    fireEvent.press(screen.getByText("Approve"));
    expect(onRespond).toHaveBeenCalledWith(expect.objectContaining({ id: "req_1" }), expect.objectContaining({ id: "approve" }));
  });

  it("shows quorum context and waiting copy after the current user votes", () => {
    renderApproval(approval({
      policyProgress: {
        policyId: "pol_backend",
        state: "pending",
        currentStep: 1,
        totalSteps: 1,
        requiredApprovals: 2,
        receivedApprovals: 1,
        currentUserHasVoted: true,
        currentUserEligible: true,
        currentUserVote: {
          voteId: "vote_a",
          requestId: "req_1",
          step: 1,
          approverUserId: "usr_a",
          source: "device",
          choiceId: "approve",
          createdAt: "2026-04-19T12:01:00Z",
        },
        waitingFor: 1,
        votes: [
          {
            voteId: "vote_a",
            requestId: "req_1",
            step: 1,
            approverUserId: "usr_a",
            source: "device",
            choiceId: "approve",
            createdAt: "2026-04-19T12:01:00Z",
          },
        ],
      },
    }));

    expect(screen.getAllByText("Waiting for others").length).toBeGreaterThan(0);
    expect(screen.getAllByText("You approved. Waiting for 1 more approval.").length).toBeGreaterThan(0);
    expect(screen.queryByText("Approve")).toBeNull();
  });

  it("renders ineligible requests as read-only", () => {
    renderApproval(approval({
      policyProgress: {
        policyId: "pol_backend",
        state: "pending",
        currentStep: 1,
        totalSteps: 1,
        requiredApprovals: 1,
        receivedApprovals: 0,
        currentUserHasVoted: false,
        currentUserEligible: false,
        waitingFor: 1,
      },
    }));

    expect(screen.getAllByText("Read-only").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/not an eligible approver/).length).toBeGreaterThan(0);
    expect(screen.queryByText("Approve")).toBeNull();
  });

  it("shows final quorum approval and denial history", () => {
    const approved = approval({
      id: "req_done",
      status: "responded",
      response: { choiceId: "approve" },
      policyProgress: {
        policyId: "pol_backend",
        state: "approved",
        currentStep: 1,
        totalSteps: 1,
        requiredApprovals: 2,
        receivedApprovals: 2,
        currentUserHasVoted: false,
        waitingFor: 0,
        votes: [
          { voteId: "vote_a", requestId: "req_done", step: 1, approverUserId: "usr_a", source: "device", choiceId: "approve", createdAt: "2026-04-19T12:01:00Z" },
          { voteId: "vote_b", requestId: "req_done", step: 1, approverUserId: "usr_b", source: "session", choiceId: "approve", createdAt: "2026-04-19T12:02:00Z" },
        ],
      },
    });
    const denied = approval({
      id: "req_denied",
      title: "Drop database?",
      status: "responded",
      response: { choiceId: "deny" },
      policyProgress: {
        policyId: "pol_backend",
        state: "denied",
        currentStep: 1,
        totalSteps: 1,
        requiredApprovals: 2,
        receivedApprovals: 0,
        currentUserHasVoted: false,
        waitingFor: 0,
        votes: [
          { voteId: "vote_no", requestId: "req_denied", step: 1, approverUserId: "usr_c", source: "device", choiceId: "deny", createdAt: "2026-04-19T12:03:00Z" },
        ],
      },
    });

    render(<HistoryScreen error={null} history={[approved, denied]} loading={false} onRefresh={jest.fn()} />);

    expect(screen.getByText("approve")).toBeTruthy();
    expect(screen.getByText("deny")).toBeTruthy();
    expect(screen.getByText("Step 1: usr_a approved via device")).toBeTruthy();
    expect(screen.getByText("Step 1: usr_c denied via device")).toBeTruthy();
  });

  it("opens a history item detail with the original questionnaire and answer", () => {
    render(<HistoryScreen error={null} history={[approval({
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
    render(<HistoryScreen error={null} history={[approval({
      requestType: "steer",
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
});
