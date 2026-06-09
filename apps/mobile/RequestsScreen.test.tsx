import AsyncStorage from "@react-native-async-storage/async-storage";
import React from "react";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { Alert, ScrollView, Text } from "react-native";

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

import { RequestsScreen, SessionApprovalFlow, SessionDetailTimeline, SessionStackEmptyState, SessionStackScreen, cachedRuntimeAuthConfig, fetchRuntimeAuthConfigIfAvailable, synthesizeSessionlessActivityStack } from "./App";
import { groupRequestsBySource, mobileRequestKey, normalizeRequest, type MobileRequest } from "./requests";
import { archiveSession, initialSessionStackLocalState, isSessionArchivedInStack, setSessionLaneSize, setSessionPresentationOverride, setSessionStackPreferences } from "./sessionStackState";

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

function renderRequest(request: MobileRequest, onRespond = jest.fn(), options: { onOpenSettings?: () => void; statusUpdates?: any[]; dismissedStatusID?: string | null; onDismissStatus?: (statusID: string) => void; choiceInteractionMode?: "click-to-submit" | "select-then-submit"; optionPlacement?: "sticky-bottom" | "inline-after-content"; confirmBeforeSubmit?: boolean; readOnly?: boolean; readOnlyReason?: string; unlockResponsesLabel?: string; onUnlockResponses?: () => void } = {}) {
  render(
    <RequestsScreen
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
      selectedID={mobileRequestKey(request)}
      selectedSourceID={null}
      statusUpdates={options.statusUpdates ?? []}
      readOnly={options.readOnly}
      readOnlyReason={options.readOnlyReason}
      unlockResponsesLabel={options.unlockResponsesLabel}
      onUnlockResponses={options.onUnlockResponses}
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

describe("runtime auth config resilience", () => {
  const originalFetch = global.fetch;

  afterEach(async () => {
    global.fetch = originalFetch;
    await AsyncStorage.clear();
  });

  it("keeps the cached hosted Clerk config when server discovery is temporarily unreachable", async () => {
    const serverURL = "https://app.agenttick.sh";
    const config = { mode: "clerk" as const, authProvider: "clerk" as const, clerkPublishableKey: "pk_test_cached" };
    global.fetch = jest.fn(async () => ({ ok: true, text: async () => JSON.stringify(config) })) as any;

    await expect(fetchRuntimeAuthConfigIfAvailable(serverURL)).resolves.toEqual(config);
    await expect(cachedRuntimeAuthConfig(serverURL)).resolves.toEqual(config);

    global.fetch = jest.fn(async () => { throw new Error("deploy restart"); }) as any;

    await expect(fetchRuntimeAuthConfigIfAvailable(serverURL)).resolves.toEqual(config);
  });
});

describe("Session Stack dashboard fallback", () => {
  it("uses a Session Stack empty state instead of the old latest-status dashboard", () => {
    render(<SessionStackEmptyState loading={false} onRefresh={jest.fn()} />);

    expect(screen.getByText("Waiting for Agent Activity")).toBeTruthy();
    expect(screen.getByText("New Session Lanes will appear here when an agent sends a Request or Status Update.")).toBeTruthy();
    expect(screen.queryByText("Latest agent status")).toBeNull();
  });

  it("turns session-less pending Requests into Session Lanes with response actions", () => {
    const sessionless = request({ id: "sessionless_req", title: "Approve session-less deploy", requester: { name: "Codex", clientName: "Pi", host: "demo-mac", workingDirectory: "/tmp/agent-tick-demo" } });
    const stack = synthesizeSessionlessActivityStack([sessionless], []);
    const onRespond = jest.fn();

    renderSessionApprovalFlow({ summaries: stack.summaries, details: stack.details, selectedSessionID: stack.summaries[0]?.mobileSessionKey, onRespond });

    expect(screen.getAllByText("Approve session-less deploy").length).toBeGreaterThan(0);
    expect(screen.queryByText("Latest agent status")).toBeNull();
    fireEvent.press(screen.getByText("Approve"));
    expect(onRespond).toHaveBeenCalledWith(expect.objectContaining({ id: "sessionless_req" }), expect.objectContaining({ id: "approve" }));
  });

  it("turns session-less status-only Activity into a Session Lane", () => {
    const stack = synthesizeSessionlessActivityStack([], [statusUpdate({ statusId: "sessionless_status", message: "Finished validating mobile screenshots", clientName: "Pi", workingDirectory: "/tmp/agent-tick-demo" })]);

    renderSessionApprovalFlow({ summaries: stack.summaries, details: stack.details, selectedSessionID: stack.summaries[0]?.mobileSessionKey });

    expect(screen.getByText("Finished validating mobile screenshots")).toBeTruthy();
    expect(screen.queryByText("Latest agent status")).toBeNull();
  });
});

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

function renderSessionApprovalFlow(props: { summaries: any[]; details?: Record<string, any>; selectedSessionID?: string | null; onSelectSession?: jest.Mock; onExitSessionDetail?: jest.Mock; onRespond?: jest.Mock; localState?: any; onToggleLaneSize?: jest.Mock; onReorderSession?: jest.Mock } ) {
  const onSelectSession = props.onSelectSession ?? jest.fn();
  const onExitSessionDetail = props.onExitSessionDetail ?? jest.fn();
  const onRespond = props.onRespond ?? jest.fn();
  const onToggleLaneSize = props.onToggleLaneSize ?? jest.fn();
  const onReorderSession = props.onReorderSession ?? jest.fn();
  render(
    <SessionApprovalFlow
      summaries={props.summaries}
      selectedSessionID={props.selectedSessionID ?? null}
      details={props.details ?? {}}
      localState={props.localState}
      onSelectSession={onSelectSession}
      onExitSessionDetail={onExitSessionDetail}
      onToggleLaneSize={onToggleLaneSize}
      onReorderSession={onReorderSession}
      onRespond={onRespond}
      onSubmitQuestionnaire={jest.fn()}
      questionnaireAnswers={{}}
      setQuestionnaireAnswer={jest.fn()}
      reply=""
      setReply={jest.fn()}
      confirmBeforeSubmit={false}
    />,
  );
  return { onSelectSession, onExitSessionDetail, onRespond, onToggleLaneSize, onReorderSession };
}

function renderSessionDetail(detail: any, options: { onRespond?: jest.Mock; onSubmitQuestionnaire?: jest.Mock; setQuestionnaireAnswer?: jest.Mock; questionnaireAnswers?: Record<string, string[]>; readOnly?: boolean; readOnlyReason?: string; onUnlockResponses?: jest.Mock; confirmBeforeSubmit?: boolean; userIdle?: boolean; userAtTimelineEnd?: boolean } = {}) {
  const onRespond = options.onRespond ?? jest.fn();
  render(
    <SessionDetailTimeline
      detail={detail}
      onRespond={onRespond}
      onSubmitQuestionnaire={options.onSubmitQuestionnaire ?? jest.fn()}
      questionnaireAnswers={options.questionnaireAnswers ?? {}}
      setQuestionnaireAnswer={options.setQuestionnaireAnswer ?? jest.fn()}
      reply=""
      setReply={jest.fn()}
      readOnly={options.readOnly}
      readOnlyReason={options.readOnlyReason}
      unlockResponsesLabel="Start Trial"
      onUnlockResponses={options.onUnlockResponses}
      confirmBeforeSubmit={options.confirmBeforeSubmit ?? false}
      userIdle={options.userIdle}
      userAtTimelineEnd={options.userAtTimelineEnd}
    />,
  );
  return onRespond;
}


describe("SessionApprovalFlow", () => {
  it("shows a single unarchived Session as full detail without global selector strips or latest-status banner", () => {
    const summary = sessionSummary({ sessionId: "session_one", title: "One Session" });
    renderSessionApprovalFlow({
      summaries: [summary],
      details: { session_one: sessionDetail([{ kind: "request", request: request({ id: "req_one", title: "Approve one", choices: [{ id: "approve", label: "Approve one", kind: "approve" }] }) }], { sessionId: "session_one", title: "One Session" }) },
    });

    expect(screen.getByText("> One Session")).toBeTruthy();
    expect(screen.getAllByText("Approve one").length).toBeGreaterThan(0);
    expect(screen.queryByText("Latest agent status")).toBeNull();
    expect(screen.queryByText(/^All \(/)).toBeNull();
  });

  it("does not control Stack scroll offset during live scroll", () => {
    const { UNSAFE_getAllByType } = render(
      <SessionStackScreen
        summaries={[sessionSummary({ sessionId: "session_a" }), sessionSummary({ sessionId: "session_b" })]}
        initialScrollY={120}
        onSelectSession={jest.fn()}
      />,
    );

    const stackScroll = UNSAFE_getAllByType(ScrollView).find((node) => node.props.nestedScrollEnabled);
    expect(stackScroll?.props.contentOffset).toBeUndefined();
  });

  it("shows a nudge when an offscreen Session Lane has a request to answer", () => {
    renderSessionApprovalFlow({
      summaries: [
        sessionSummary({ sessionId: "session_a", title: "A", state: "recent", pendingRequestCount: 0 }),
        sessionSummary({ sessionId: "session_b", title: "B", state: "recent", pendingRequestCount: 0 }),
        sessionSummary({ sessionId: "session_c", title: "C", state: "recent", pendingRequestCount: 0 }),
        sessionSummary({ sessionId: "session_d", title: "D", state: "needs-input", pendingRequestCount: 1 }),
      ],
      details: {
        session_d: sessionDetail([{ kind: "request", request: request({ id: "req_d", title: "Approve D", createdAt: "2026-04-19T12:03:00Z" }) }], { sessionId: "session_d" }),
      },
    });

    expect(screen.getByText("↓ 1")).toBeTruthy();
  });

  it("shows a multi-Session Stack with clipped folder-named Session Lanes", () => {
    renderSessionApprovalFlow({
      summaries: [
        sessionSummary({ sessionId: "session_a", title: "Deploy Session", sourceLabels: ["deploy-folder", "Pi"], latestActivity: { kind: "request", id: "req_a", createdAt: "2026-04-19T12:03:00Z", preview: "Approve deploy", requestStatus: "pending" } }),
        sessionSummary({ sessionId: "session_b", title: "Test Session", sourceLabels: ["test-folder", "Pi"], latestActivity: { kind: "status_update", id: "st_b", createdAt: "2026-04-19T12:04:00Z", preview: "Tests are running", state: "working" }, pendingRequestCount: 0 }),
      ],
      details: {
        session_a: sessionDetail([{ kind: "request", request: request({ id: "req_a", title: "Approve deploy", createdAt: "2026-04-19T12:03:00Z" }) }], { sessionId: "session_a", sourceLabels: ["deploy-folder", "Pi"] }),
        session_b: sessionDetail([{ kind: "status_update", statusUpdate: statusUpdate({ statusId: "st_b", message: "Tests are running", state: "working", createdAt: "2026-04-19T12:04:00Z" }) }], { sessionId: "session_b", sourceLabels: ["test-folder", "Pi"], pendingRequestCount: 0 }),
      },
    });

    expect(screen.queryByText("Session Stack")).toBeNull();
    expect(screen.queryByText("Tap a Session Lane to open full Session detail.")).toBeNull();
    expect(screen.getByText("> deploy-folder")).toBeTruthy();
    expect(screen.getByText("> test-folder")).toBeTruthy();
    expect(screen.queryByText("Deploy Session")).toBeNull();
    expect(screen.getByText("Approve deploy")).toBeTruthy();
    expect(screen.queryByText("Latest agent status")).toBeNull();
    expect(screen.queryByText(/^All \(/)).toBeNull();
  });

  it("opens full Session detail from a lane tap", () => {
    const { onSelectSession } = renderSessionApprovalFlow({
      summaries: [sessionSummary({ sessionId: "session_a", title: "Deploy Session", sourceLabels: ["deploy-folder"] }), sessionSummary({ sessionId: "session_b", title: "Test Session", sourceLabels: ["test-folder"] })],
    });

    fireEvent.press(screen.getByLabelText("Open Session test-folder"));
    expect(onSelectSession).toHaveBeenCalledWith("session_b");
  });

  it("does not allow direct responses from the Session Stack lane preview", () => {
    const onRespond = jest.fn();
    renderSessionApprovalFlow({
      summaries: [sessionSummary({ sessionId: "session_a", title: "Deploy Session" }), sessionSummary({ sessionId: "session_b", title: "Test Session" })],
      details: {
        session_a: sessionDetail([{ kind: "request", request: request({ id: "req_a", title: "Approve deploy", createdAt: "2026-04-19T12:03:00Z" }) }], { sessionId: "session_a" }),
        session_b: sessionDetail([{ kind: "request", request: request({ id: "req_b", title: "Approve deploy", createdAt: "2026-04-19T12:03:00Z" }) }], { sessionId: "session_b" }),
      },
      onRespond,
    });

    fireEvent.press(screen.getAllByText("Approve deploy")[0]);
    expect(onRespond).not.toHaveBeenCalled();
  });

  it("lets Overview Mode interactions fall through to lane Session controls", () => {
    const onRespond = jest.fn();
    const onSelectSession = jest.fn();
    const localState = setSessionStackPreferences(initialSessionStackLocalState(), { interactionMode: "overview" });
    renderSessionApprovalFlow({
      summaries: [sessionSummary({ sessionId: "session_a", title: "Deploy Session" }), sessionSummary({ sessionId: "session_b", title: "Test Session" })],
      details: {
        session_a: sessionDetail([{ kind: "request", request: request({ id: "req_a", title: "Approve deploy", choices: [{ id: "approve", label: "Approve", kind: "approve" }], createdAt: "2026-04-19T12:03:00Z" }) }], { sessionId: "session_a" }),
        session_b: sessionDetail([{ kind: "status_update", statusUpdate: statusUpdate({ statusId: "st_b", message: "Watching", createdAt: "2026-04-19T12:04:00Z" }) }], { sessionId: "session_b" }),
      },
      localState,
      onRespond,
      onSelectSession,
    });

    expect(screen.queryByLabelText("Open Session Pi · 14:03")).toBeNull();
    fireEvent.press(screen.getByText("Approve"));
    expect(onRespond).toHaveBeenCalledWith(expect.objectContaining({ id: "req_a" }), expect.objectContaining({ id: "approve" }));
    expect(onSelectSession).not.toHaveBeenCalled();
  });

  it("returns from a selected full Session detail to the Session Stack", () => {
    const onExitSessionDetail = jest.fn();
    const detail = sessionDetail([{ kind: "request", request: request({ id: "req_a", title: "Current Session Request" }) }], { sessionId: "session_a", title: "Current Session" });
    renderSessionApprovalFlow({
      summaries: [sessionSummary({ sessionId: "session_a", title: "Current Session" }), sessionSummary({ sessionId: "session_b", title: "Other Session" })],
      selectedSessionID: "session_a",
      details: { session_a: detail },
      onExitSessionDetail,
    });

    expect(screen.getAllByText("Current Session Request").length).toBeGreaterThan(0);
    expect(screen.getByText("< Stack")).toBeTruthy();
    expect(screen.getByText("Pi · 14:00")).toBeTruthy();
    fireEvent.press(screen.getByLabelText("Back to Session Stack"));
    expect(onExitSessionDetail).toHaveBeenCalled();
  });

  it("does not show destructive archive controls inside Session Lanes", () => {
    renderSessionApprovalFlow({ summaries: [sessionSummary({ sessionId: "session_a", title: "Deploy Session" }), sessionSummary({ sessionId: "session_b", title: "Other Session" })] });

    expect(screen.queryByText("Hide Session")).toBeNull();
    expect(screen.queryByText("Archive Session")).toBeNull();
  });

  it("does not expose local Session presentation editing in full Session detail", () => {
    const summary = sessionSummary({ sessionId: "session_one", title: "Server title" });
    const detail = sessionDetail([{ kind: "request", request: request({ id: "req_one", title: "Server Request" }) }], { sessionId: "session_one", title: "Server title" });
    renderSessionApprovalFlow({ summaries: [summary], details: { session_one: detail } });

    expect(screen.getByText("Server Request")).toBeTruthy();
    expect(screen.getByText("> Server title")).toBeTruthy();
    expect(screen.queryByText("Local Session presentation")).toBeNull();
    expect(screen.queryByText("Save presentation")).toBeNull();
  });

  it("shows local Session presentation overrides in Session Lanes", () => {
    const summary = sessionSummary({ sessionId: "session_a", title: "Server title" });
    const localState = setSessionPresentationOverride(initialSessionStackLocalState(), "session_a", { title: "Local title", color: "#ffcc00" });
    renderSessionApprovalFlow({ summaries: [summary, sessionSummary({ sessionId: "session_b", title: "Other" })], localState });

    expect(screen.getByText("> Local title")).toBeTruthy();
    expect(screen.queryByText("Server title")).toBeNull();
  });

  it("collapses a Session Lane to just the title and exposes a size toggle", () => {
    const summary = sessionSummary({ sessionId: "session_a", title: "Server title", sourceLabels: ["Collapsed"] });
    const localState = setSessionLaneSize(initialSessionStackLocalState(), "session_a", "collapsed");
    const onToggleLaneSize = jest.fn();
    renderSessionApprovalFlow({ summaries: [summary, sessionSummary({ sessionId: "session_b", title: "Other", sourceLabels: ["Other"] })], details: { session_a: sessionDetail([{ kind: "request", request: request({ id: "req_a", title: "Hidden request content" }) }], { sessionId: "session_a", title: "Server title" }) }, localState, onToggleLaneSize });

    expect(screen.getByText("> Collapsed")).toBeTruthy();
    expect(screen.queryByText("Hidden request content")).toBeNull();
    fireEvent.press(screen.getAllByLabelText("Change Session Lane size")[0]);
    expect(onToggleLaneSize).toHaveBeenCalledWith(expect.objectContaining({ sessionId: "session_a" }), "collapsed", "press");
  });

  it("keeps a long-pressed Session Lane in place until the finger actually moves across collapsed rows", () => {
    const onReorderSession = jest.fn();
    const localState = setSessionStackPreferences(initialSessionStackLocalState(), { autoExpansion: "none" });
    renderSessionApprovalFlow({
      summaries: [
        sessionSummary({ sessionId: "session_a", title: "A", sourceLabels: ["A"], state: "recent", pendingRequestCount: 0 }),
        sessionSummary({ sessionId: "session_b", title: "B", sourceLabels: ["B"], state: "recent", pendingRequestCount: 0 }),
        sessionSummary({ sessionId: "session_c", title: "C", sourceLabels: ["C"], state: "recent", pendingRequestCount: 0 }),
        sessionSummary({ sessionId: "session_d", title: "D", sourceLabels: ["D"], state: "recent", pendingRequestCount: 0 }),
      ],
      localState,
      onReorderSession,
    });

    fireEvent(screen.getByText("> C"), "longPress", { nativeEvent: { pageY: 470, locationY: 26 } });
    fireEvent(screen.getByText("> C"), "touchMove", { nativeEvent: { pageY: 484, locationY: 40 } });
    fireEvent(screen.getByText("> C"), "pressOut", { nativeEvent: { pageY: 484, locationY: 40 } });
    expect(onReorderSession).not.toHaveBeenCalled();

    fireEvent(screen.getByText("> C"), "touchEnd", { nativeEvent: { pageY: 484, locationY: 40 } });
    expect(onReorderSession).toHaveBeenCalledWith("session_c", 2);
  });

  it("previews the Session Lane order while dragging", () => {
    const localState = setSessionStackPreferences(initialSessionStackLocalState(), { autoExpansion: "none" });
    const { UNSAFE_getAllByType } = render(
      <SessionStackScreen
        summaries={[
          sessionSummary({ sessionId: "session_a", title: "A", sourceLabels: ["A"], state: "recent", pendingRequestCount: 0 }),
          sessionSummary({ sessionId: "session_b", title: "B", sourceLabels: ["B"], state: "recent", pendingRequestCount: 0 }),
          sessionSummary({ sessionId: "session_c", title: "C", sourceLabels: ["C"], state: "recent", pendingRequestCount: 0 }),
          sessionSummary({ sessionId: "session_d", title: "D", sourceLabels: ["D"], state: "recent", pendingRequestCount: 0 }),
        ]}
        localState={localState}
        onSelectSession={jest.fn()}
        onReorderSession={jest.fn()}
      />,
    );
    const nodeText = (children: unknown): string => Array.isArray(children) ? children.map(nodeText).join("") : typeof children === "string" || typeof children === "number" ? String(children) : "";
    const laneTitleOrder = () => UNSAFE_getAllByType(Text)
      .map((node) => nodeText(node.props.children))
      .filter((children) => children.startsWith("> "));

    expect(laneTitleOrder()).toEqual(["> A", "> B", "> C", "> D"]);
    fireEvent(screen.getByText("> A"), "longPress", { nativeEvent: { pageY: 120, locationY: 26 } });
    fireEvent(screen.getByText("> A"), "touchMove", { nativeEvent: { pageY: 235, locationY: 26 } });

    expect(laneTitleOrder()).toEqual(["> B", "> C", "> A", "> D"]);
  });

  it("keeps Session actions out of full Session detail", () => {
    const summary = sessionSummary({ sessionId: "session_one", title: "One Session" });
    renderSessionApprovalFlow({
      summaries: [summary],
      details: { session_one: sessionDetail([{ kind: "request", request: request({ id: "req_one", title: "Approve one" }) }], { sessionId: "session_one", title: "One Session" }) },
    });

    expect(screen.queryByText("Session actions")).toBeNull();
    expect(screen.queryByText("Archive Session")).toBeNull();
  });

  it("keeps terminal Sessions in the stack until archived and resurrects them on new Activity", () => {
    const terminal = sessionSummary({ sessionId: "done", title: "Done Session", state: "complete", pendingRequestCount: 0, latestActivity: { kind: "status_update", id: "st_done", createdAt: "2026-04-19T12:00:00Z", preview: "Done", state: "done" } });
    const archived = archiveSession(initialSessionStackLocalState(), terminal);
    const resurrected = sessionSummary({ ...terminal, latestActivity: { kind: "status_update", id: "st_new", createdAt: "2026-04-19T12:05:00Z", preview: "New", state: "working" } });

    renderSessionApprovalFlow({ summaries: [terminal] });
    expect(screen.getByText("Done Session")).toBeTruthy();
    expect(isSessionArchivedInStack(initialSessionStackLocalState(), terminal)).toBe(false);
    expect(isSessionArchivedInStack(archived, terminal)).toBe(true);
    expect(isSessionArchivedInStack(archived, resurrected)).toBe(false);
  });

  it("keeps the selected full Session stable when another Session updates", () => {
    const detail = sessionDetail([{ kind: "request", request: request({ id: "req_a", title: "Current Session Request" }) }], { sessionId: "session_a", title: "Current Session" });
    const { rerender } = render(
      <SessionApprovalFlow
        summaries={[sessionSummary({ sessionId: "session_a", title: "Current Session" }), sessionSummary({ sessionId: "session_b", title: "Other Session", latestActivity: { kind: "status_update", id: "st_old", createdAt: "2026-04-19T12:01:00Z", preview: "Waiting", state: "waiting" } })]}
        selectedSessionID="session_a"
        details={{ session_a: detail }}
        onSelectSession={jest.fn()}
        onRespond={jest.fn()}
        onSubmitQuestionnaire={jest.fn()}
        questionnaireAnswers={{}}
        setQuestionnaireAnswer={jest.fn()}
        reply=""
        setReply={jest.fn()}
        confirmBeforeSubmit={false}
      />,
    );

    rerender(
      <SessionApprovalFlow
        summaries={[sessionSummary({ sessionId: "session_a", title: "Current Session" }), sessionSummary({ sessionId: "session_b", title: "Other Session", latestActivity: { kind: "status_update", id: "st_new", createdAt: "2026-04-19T12:05:00Z", preview: "New update", state: "working" } })]}
        selectedSessionID="session_a"
        details={{ session_a: detail }}
        onSelectSession={jest.fn()}
        onRespond={jest.fn()}
        onSubmitQuestionnaire={jest.fn()}
        questionnaireAnswers={{}}
        setQuestionnaireAnswer={jest.fn()}
        reply=""
        setReply={jest.fn()}
        confirmBeforeSubmit={false}
      />,
    );

    expect(screen.getAllByText("Current Session Request").length).toBeGreaterThan(0);
    expect(screen.getByLabelText("Back to Session Stack")).toBeTruthy();
  });
});

describe("SessionDetailTimeline", () => {
  it("renders Status Updates, normal Steering Requests, and focused response controls in chronological context", () => {
    const onRespond = renderSessionDetail(sessionDetail([
      { kind: "status_update", statusUpdate: statusUpdate({ message: "Investigating rollout options", createdAt: "2026-04-19T12:00:00Z" }) },
      { kind: "request", request: request({ id: "req_steer", requestType: "steering", title: "Choose rollout plan", body: "Should we canary first?", choices: [{ id: "keep", label: "Keep canary", kind: "approve" }] }) },
    ]));

    expect(screen.getByText("Investigating rollout options")).toBeTruthy();
    expect(screen.getByText("Steering Request")).toBeTruthy();
    const alertSpy = jest.spyOn(Alert, "alert").mockImplementation((() => undefined) as any);
    fireEvent.press(screen.getByText("Keep canary"));
    expect(alertSpy).not.toHaveBeenCalled();
    expect(onRespond).toHaveBeenCalledWith(expect.objectContaining({ id: "req_steer" }), expect.objectContaining({ id: "keep" }));
    alertSpy.mockRestore();
  });

  it("collapses fulfilled Session Requests to the title and answer, then expands context and options", () => {
    renderSessionDetail(sessionDetail([
      { kind: "request", request: request({
        id: "req_done",
        title: "Deploy release",
        command: "./deploy production",
        status: "responded",
        response: { choiceId: "approve" },
        quorum: { requiredResponseCount: 1, receivedResponseCount: 1, waitingFor: 0, currentUserEligible: true, currentUserResponded: true, recipients: [], responses: [{ responseId: "resp_a", requestId: "req_done", userId: "usr_a", source: "mobile", choiceId: "approve", final: true, createdAt: "2026-04-19T12:01:00Z" }] },
      }) },
      { kind: "status_update", statusUpdate: statusUpdate({ statusId: "st_done", state: "done", message: "Release completed", createdAt: "2026-04-19T12:02:00Z" }) },
    ]));

    expect(screen.getByText("Deploy release")).toBeTruthy();
    expect(screen.getByText(/Answer: Approve/)).toBeTruthy();
    expect(screen.queryByText("Response progress")).toBeNull();
    expect(screen.queryByText("./deploy production")).toBeNull();

    fireEvent.press(screen.getByLabelText("Expand past Request Deploy release"));
    expect(screen.getByText("Sanction Request")).toBeTruthy();
    expect(screen.getByText("./deploy production")).toBeTruthy();
    expect(screen.getByText("Approve")).toBeTruthy();
    expect(screen.queryByText(/Member response approved via mobile/)).toBeNull();
    expect(screen.getByText("Release completed")).toBeTruthy();
    expect(screen.getByText("done")).toBeTruthy();
  });

  it("forces high-risk Sanction confirmation before responding", () => {
    const alertSpy = jest.spyOn(Alert, "alert").mockImplementation((() => undefined) as any);
    const onRespond = renderSessionDetail(sessionDetail([
      { kind: "request", request: request({ id: "req_high", title: "Run production migration", risk: "high", choices: [{ id: "approve", label: "Approve migration", kind: "approve" }, { id: "deny", label: "Deny", kind: "deny" }] }) },
    ]));

    fireEvent.press(screen.getByText("Approve migration"));
    expect(alertSpy).toHaveBeenCalledWith("Approve high-risk Sanction?", "Approve migration", expect.any(Array));
    const actions = alertSpy.mock.calls[0]?.[2] as Array<{ onPress?: () => void }> | undefined;
    actions?.[1]?.onPress?.();
    expect(onRespond).toHaveBeenCalledWith(expect.objectContaining({ id: "req_high" }), expect.objectContaining({ id: "approve" }));
    alertSpy.mockRestore();
  });

  it("shows questionnaire-shaped Requests as Steering and hides solo response progress in Session detail", () => {
    renderSessionDetail(sessionDetail([
      { kind: "request", request: request({
        id: "req_questionnaire",
        requestType: "questionnaire",
        title: "Choose focus areas",
        choices: [{ id: "cancel", label: "Cancel", kind: "deny" }],
        questions: [{ header: "Pi needs your input", question: "Choose focus areas", multiSelect: true, options: [{ label: "Correctness" }] }],
        quorum: {
          requiredResponseCount: 1,
          receivedResponseCount: 0,
          currentUserResponded: false,
          currentUserEligible: true,
          waitingFor: 1,
          recipients: [{ userId: "usr_owner", hasActiveDevice: true }],
          responses: [],
        },
      }) },
    ]));

    expect(screen.getByText("Steering Request")).toBeTruthy();
    expect(screen.queryByText("Sanction Request")).toBeNull();
    expect(screen.queryByText("Response progress")).toBeNull();
  });

  it("submits single-select questionnaire Steering choices immediately in Session detail", () => {
    const setQuestionnaireAnswer = jest.fn();
    const onSubmitQuestionnaire = jest.fn();
    const detail = sessionDetail([
      { kind: "request", request: request({
        id: "req_single_question",
        requestType: "questionnaire",
        title: "Which testing framework should the agent use?",
        choices: [{ id: "cancel", label: "Cancel", kind: "deny" }],
        questions: [{
          question: "Which testing framework should the agent use?",
          multiSelect: false,
          options: [{ label: "Vitest" }, { label: "Playwright" }, { label: "Node test runner" }],
        }],
      }) },
    ]);

    renderSessionDetail(detail, { setQuestionnaireAnswer, onSubmitQuestionnaire });

    fireEvent.press(screen.getByText("Vitest"));
    expect(setQuestionnaireAnswer).toHaveBeenCalledWith("Which testing framework should the agent use?", "Vitest", false);
    expect(onSubmitQuestionnaire).toHaveBeenCalledWith(
      expect.objectContaining({ id: "req_single_question" }),
      { "Which testing framework should the agent use?": ["Vitest"] },
    );
  });

  it("renders true multi-select Steering as compact cards with shared detail expansion", () => {
    const setQuestionnaireAnswer = jest.fn();
    renderSessionDetail(sessionDetail([
      { kind: "request", request: request({
        id: "req_multi",
        requestType: "questionnaire",
        title: "Which areas?",
        choices: [{ id: "cancel", label: "Cancel", kind: "deny" }],
        questions: [{
          header: "Pi needs your input",
          question: "Which areas?",
          multiSelect: true,
          options: [
            { label: "Correctness", description: "Look for logic bugs" },
            { label: "Tests", description: "Check missing coverage" },
          ],
        }],
      }) },
    ]), { setQuestionnaireAnswer, questionnaireAnswers: { "Which areas?": ["Correctness"] } });

    expect(screen.getAllByText("Which areas?")).toHaveLength(1);
    expect(screen.queryByText("Pi needs your input")).toBeNull();
    expect(screen.getByText("Select one or more")).toBeTruthy();
    expect(screen.getByText("Cancel")).toBeTruthy();
    expect(screen.getByLabelText("Correctness selected")).toBeTruthy();
    expect(screen.getByLabelText("Tests not selected")).toBeTruthy();
    expect(screen.getByText("Look for logic bugs")).toBeTruthy();
    expect(screen.getByText("Check missing coverage")).toBeTruthy();
    fireEvent.press(screen.getByText("Tests"));
    expect(setQuestionnaireAnswer).toHaveBeenCalledWith("Which areas?", "Tests", true);
  });

  it("moves mirrored-prompt Cancel beside compact Agent waiting copy instead of next to Submit", () => {
    const nowSpy = jest.spyOn(Date, "now").mockReturnValue(new Date("2026-04-19T12:00:45Z").getTime());
    const alertSpy = jest.spyOn(Alert, "alert").mockImplementation((() => undefined) as any);
    try {
      const onRespond = renderSessionDetail(sessionDetail([
        { kind: "request", request: request({
          id: "req_multi_waiting",
          requestType: "questionnaire",
          title: "Which areas?",
          agentWaiter: { waiterId: "waiter_multi", state: "waiting", lastSeenAt: "2026-04-19T12:00:00Z" },
          choices: [{ id: "cancel", label: "Cancel", kind: "deny" }],
          questions: [{
            header: "Pi needs your input",
            question: "Which areas?",
            multiSelect: true,
            options: [{ label: "Correctness", description: "Look for logic bugs" }],
          }],
        }) },
      ]), { questionnaireAnswers: { "Which areas?": ["Correctness"] } });

      expect(screen.getByText("Submit Answers")).toBeTruthy();
      expect(screen.getByText("Agent waiting")).toBeTruthy();
      expect(screen.getByText("45s ago")).toBeTruthy();
      expect(screen.queryByText("Agent is waiting")).toBeNull();
      expect(screen.getByLabelText("Cancel Request")).toBeTruthy();
      fireEvent.press(screen.getByLabelText("Cancel Request"));
      expect(alertSpy).toHaveBeenCalledWith("Send this decision?", "Cancel", expect.any(Array));
      const actions = alertSpy.mock.calls[0]?.[2] as Array<{ onPress?: () => void }> | undefined;
      actions?.[1]?.onPress?.();
      expect(onRespond).toHaveBeenCalledWith(expect.objectContaining({ id: "req_multi_waiting" }), expect.objectContaining({ id: "cancel" }));
    } finally {
      alertSpy.mockRestore();
      nowSpy.mockRestore();
    }
  });

  it("shows Test Request labels and stale Request warnings inside Session detail", () => {
    renderSessionDetail(sessionDetail([
      { kind: "request", request: request({ id: "req_test", title: "Test routing", isTest: true, testLabel: "Test Request", deadline: "2026-01-01T00:00:00Z" }) },
    ]));

    expect(screen.getByText("Test Request")).toBeTruthy();
    expect(screen.getByText("This Request may be stale. Refresh the Session before responding.")).toBeTruthy();
  });

  it.each([
    ["waiting", "Agent waiting", "Agent is waiting", "Last checked in 45 seconds ago"],
    ["stale", "Wait stale", "Agent wait is stale", "Last checked in 45 seconds ago · Refresh before responding if possible."],
    ["expired", "Wait expired", "Agent wait expired", "Last checked in 45 seconds ago · The answer may not reach the original agent."],
    ["stopped", "Wait stopped", "Agent stopped waiting", "Last checked in 45 seconds ago"],
    ["errored", "Wait failed", "Agent wait failed", "Last checked in 45 seconds ago · The answer may not reach the original agent."],
  ])("renders %s Request waiter liveness in Request detail", (state, label, title, detailCopy) => {
    const nowSpy = jest.spyOn(Date, "now").mockReturnValue(new Date("2026-04-19T12:00:45Z").getTime());
    try {
      renderRequest(request({ agentWaiter: { waiterId: `waiter_${state}`, state, lastSeenAt: "2026-04-19T12:00:00Z" } }));

      expect(label).toBeTruthy();
      expect(screen.getByText(title)).toBeTruthy();
      expect(screen.getByText(detailCopy)).toBeTruthy();
      if (state === "waiting") expect(screen.getByText("...")).toBeTruthy();
      expect(screen.queryByText("Still working")).toBeNull();
    } finally {
      nowSpy.mockRestore();
    }
  });

  it.each([
    ["waiting", "Agent waiting", "Agent is waiting", "Last checked in 45 seconds ago"],
    ["stale", "Wait stale", "Agent wait is stale", "Last checked in 45 seconds ago · Refresh before responding if possible."],
    ["expired", "Wait expired", "Agent wait expired", "Last checked in 45 seconds ago · The answer may not reach the original agent."],
    ["stopped", "Wait stopped", "Agent stopped waiting", "Last checked in 45 seconds ago"],
    ["errored", "Wait failed", "Agent wait failed", "Last checked in 45 seconds ago · The answer may not reach the original agent."],
  ])("renders %s Request waiter liveness in Session Lanes without compact title-bar waiter labels", (state, label, title, detailCopy) => {
    const nowSpy = jest.spyOn(Date, "now").mockReturnValue(new Date("2026-04-19T12:00:45Z").getTime());
    try {
      const agentWaiter = { waiterId: `waiter_${state}`, state, lastSeenAt: "2026-04-19T12:00:00Z" };
      const detail = sessionDetail([
        { kind: "request", request: request({ id: `req_${state}`, title: `${state} wait`, agentWaiter }) },
      ], { pendingRequests: [{ id: `req_${state}`, title: `${state} wait`, createdAt: "2026-04-19T12:00:00Z", status: "pending", agentWaiter }], latestActivity: { kind: "request", id: `req_${state}`, createdAt: "2026-04-19T12:00:00Z", preview: `${state} wait`, requestStatus: "pending", agentWaiter } });
      renderSessionApprovalFlow({ summaries: [detail.summary, sessionSummary({ sessionId: "session_other", state: "recent", pendingRequestCount: 0, title: "Other", latestActivity: { kind: "status_update", id: "st_other", createdAt: "2026-04-19T12:01:00Z", preview: "Idle", state: "done" } })], details: { session_1: detail } });

      expect(screen.queryByText(new RegExp(label))).toBeNull();
      expect(screen.getByText(title)).toBeTruthy();
      expect(screen.getByText(detailCopy)).toBeTruthy();
      expect(screen.queryByText("Still working")).toBeNull();
    } finally {
      nowSpy.mockRestore();
    }
  });

  it("renders entitlement-gated response controls with an unlock action", () => {
    const onUnlockResponses = jest.fn();
    renderSessionDetail(sessionDetail([
      { kind: "request", request: request({ id: "req_paid", title: "Paid response" }) },
    ]), { readOnly: true, readOnlyReason: "Start a Trial to respond.", onUnlockResponses });

    expect(screen.getByText("Start a Trial to respond.")).toBeTruthy();
    fireEvent.press(screen.getByText("Start Trial"));
    expect(onUnlockResponses).toHaveBeenCalled();
  });

  it("lets setup Test Requests respond while non-test Requests are entitlement gated", () => {
    const onTestRespond = renderSessionDetail(sessionDetail([
      { kind: "request", request: request({ id: "req_setup", title: "Setup proof", isTest: true, testLabel: "Agent Tick setup test", choices: [{ id: "option_a", label: "Option A", kind: "approve" }, { id: "cancel", label: "Cancel", kind: "deny" }] }) },
    ]), { readOnly: true, readOnlyReason: "Start a Trial to respond." });

    expect(screen.getByText("Agent Tick setup test")).toBeTruthy();
    fireEvent.press(screen.getByText("Option A"));
    expect(onTestRespond).toHaveBeenCalledWith(expect.objectContaining({ id: "req_setup", isTest: true }), expect.objectContaining({ id: "option_a" }));
  });

  it("shows multiple pending Requests and focuses the newest actionable Request by default", () => {
    renderSessionDetail(sessionDetail([
      { kind: "request", request: request({ id: "req_first", title: "First decision", createdAt: "2026-04-19T12:01:00Z", choices: [{ id: "first", label: "First approve", kind: "approve" }] }) },
      { kind: "request", request: request({ id: "req_second", title: "Second decision", createdAt: "2026-04-19T12:03:00Z", choices: [{ id: "second", label: "Second approve", kind: "approve" }] }) },
    ]));

    expect(screen.getByText("First decision")).toBeTruthy();
    expect(screen.getByText("Second decision")).toBeTruthy();
    expect(screen.getByText("Focus Request")).toBeTruthy();
    expect(screen.queryByText("First approve")).toBeNull();
    expect(screen.getByText("Second approve")).toBeTruthy();
  });

  it("loads earlier Session history only from an explicit button", () => {
    renderSessionDetail(sessionDetail(Array.from({ length: 35 }, (_, index) => ({
      kind: "status_update" as const,
      statusUpdate: statusUpdate({ statusId: `st_${index}`, message: `Status ${index}`, createdAt: `2026-04-19T12:${String(index).padStart(2, "0")}:00Z` }),
    }))));

    expect(screen.queryByText("Status 0")).toBeNull();
    expect(screen.getByText("Status 34")).toBeTruthy();
    fireEvent.press(screen.getByText("Load earlier Session history"));
    expect(screen.getByText("Status 0")).toBeTruthy();
  });

  it("SessionApprovalFlow does not auto-focus new Activity without production idle/end signals", () => {
    const firstDetail = sessionDetail([{ kind: "request", request: request({ id: "req_a", title: "Existing decision" }) }], { sessionId: "session_a", title: "Current Session" });
    const nextDetail = sessionDetail([
      { kind: "request", request: request({ id: "req_a", title: "Existing decision" }) },
      { kind: "status_update", statusUpdate: statusUpdate({ statusId: "st_new", message: "New Activity arrived", createdAt: "2026-04-19T12:05:00Z" }) },
    ], { sessionId: "session_a", title: "Current Session" });
    const { rerender } = render(
      <SessionApprovalFlow
        summaries={[sessionSummary({ sessionId: "session_a", title: "Current Session" })]}
        selectedSessionID={null}
        details={{ session_a: firstDetail }}
        onSelectSession={jest.fn()}
        onRespond={jest.fn()}
        onSubmitQuestionnaire={jest.fn()}
        questionnaireAnswers={{}}
        setQuestionnaireAnswer={jest.fn()}
        reply=""
        setReply={jest.fn()}
        confirmBeforeSubmit={false}
      />,
    );

    rerender(
      <SessionApprovalFlow
        summaries={[sessionSummary({ sessionId: "session_a", title: "Current Session" })]}
        selectedSessionID={null}
        details={{ session_a: nextDetail }}
        onSelectSession={jest.fn()}
        onRespond={jest.fn()}
        onSubmitQuestionnaire={jest.fn()}
        questionnaireAnswers={{}}
        setQuestionnaireAnswer={jest.fn()}
        reply=""
        setReply={jest.fn()}
        confirmBeforeSubmit={false}
      />,
    );

    expect(screen.getByLabelText("Jump to new Session Activity")).toBeTruthy();
  });

  it("keeps the view stable on new Activity while not idle and away from the end", () => {
    const { rerender } = render(
      <SessionDetailTimeline
        detail={sessionDetail([{ kind: "request", request: request({ id: "req_a", title: "Existing decision" }) }])}
        onRespond={jest.fn()}
        onSubmitQuestionnaire={jest.fn()}
        questionnaireAnswers={{}}
        setQuestionnaireAnswer={jest.fn()}
        reply=""
        setReply={jest.fn()}
        confirmBeforeSubmit={false}
        userIdle={false}
        userAtTimelineEnd={false}
      />,
    );

    rerender(
      <SessionDetailTimeline
        detail={sessionDetail([
          { kind: "request", request: request({ id: "req_a", title: "Existing decision" }) },
          { kind: "status_update", statusUpdate: statusUpdate({ statusId: "st_new", message: "New Activity arrived", createdAt: "2026-04-19T12:05:00Z" }) },
        ])}
        onRespond={jest.fn()}
        onSubmitQuestionnaire={jest.fn()}
        questionnaireAnswers={{}}
        setQuestionnaireAnswer={jest.fn()}
        reply=""
        setReply={jest.fn()}
        confirmBeforeSubmit={false}
        userIdle={false}
        userAtTimelineEnd={false}
      />,
    );

    expect(screen.getByLabelText("Jump to new Session Activity")).toBeTruthy();
  });
});


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
    expect(screen.getByText("Send a test Request from the web app.")).toBeTruthy();
    expect(screen.queryByText(/duplicate choice id/)).toBeNull();
  });

  it("shows choice flags and tags on action buttons", () => {
    renderRequest(request({
      choices: [
        { id: "small", label: "Small fix", kind: "approve", flags: ["favorite", "reversible"], tags: ["quick"] },
        { id: "reject", label: "Reject", kind: "deny" },
      ],
    }));

    expect(screen.getByText("Small fix")).toBeTruthy();
    expect(screen.getByLabelText("Hide option details")).toBeTruthy();
    expect(screen.getByLabelText("Favorite choice")).toBeTruthy();
    expect(screen.getByText("reversible")).toBeTruthy();
    expect(screen.getByText("quick")).toBeTruthy();
  });

  it("renders audience vote deadline and aggregate results", () => {
    renderRequest(request({
      requestType: "steering",
      deliveryKind: "audience_channel",
      responsePolicy: "deadline_plurality",
      closesAt: "2026-04-19T12:10:00Z",
      aggregateResult: { choices: { approve: 3, deny: 1 } },
    }));

    expect(screen.getByText("Community vote")).toBeTruthy();
    expect(screen.getByText("Voting closes at the deadline. The agent will receive the winning choice.")).toBeTruthy();
    expect(screen.getByText("Approve: 3")).toBeTruthy();
    expect(screen.getByText("Deny: 1")).toBeTruthy();
  });

  it("renders request bodies and actions directly", () => {
    const onRespond = jest.fn();
    renderRequest(request({ title: "Private Request", body: "Review the deployment." }), onRespond);

    expect(screen.getByText("Private Request")).toBeTruthy();
    expect(screen.getByText("Review the deployment.")).toBeTruthy();
    expect(screen.getByText("Approve")).toBeTruthy();
    expect(screen.getByText("Deny")).toBeTruthy();
  });

  it("hides the single-account connection label on the request detail", () => {
    renderRequest(request({ connectionID: "acct_apple", connectionLabel: "Apple account" }));

    expect(screen.queryByText("Apple account")).toBeNull();
  });

  it("keeps the connection label when multiple accounts are represented", () => {
    const first = request({ id: "req_a", title: "First", connectionID: "acct_apple", connectionLabel: "Apple account" });
    const second = request({ id: "req_b", title: "Second", connectionID: "acct_work", connectionLabel: "Work account" });

    render(
      <RequestsScreen
        error={null}
        loading={false}
        onRefresh={jest.fn()}
        onRespond={jest.fn()}
        onSubmitQuestionnaire={jest.fn()}
        sourceGroups={groupRequestsBySource([first, second])}
        questionnaireAnswers={{}}
        reply=""
        requests={[first, second]}
        selected={first}
        selectedID={mobileRequestKey(first)}
        selectedSourceID={null}
        statusUpdates={[]}
        setSourceID={jest.fn()}
        setQuestionnaireAnswer={jest.fn()}
        setReply={jest.fn()}
        setSelectedID={jest.fn()}
      />,
    );

    expect(screen.getByText("Apple account")).toBeTruthy();
  });


  it("keeps same request IDs from different connections selectable", () => {
    const first = request({ id: "req_same", title: "First connection", connectionID: "conn_1", connectionLabel: "Apple account" });
    const second = request({ id: "req_same", title: "Second connection", connectionID: "conn_2", connectionLabel: "Email account" });
    const setSelectedID = jest.fn();

    render(
      <RequestsScreen
        error={null}
        loading={false}
        onRefresh={jest.fn()}
        onRespond={jest.fn()}
        onSubmitQuestionnaire={jest.fn()}
        sourceGroups={groupRequestsBySource([first, second])}
        questionnaireAnswers={{}}
        reply=""
        requests={[first, second]}
        selected={first}
        selectedID={mobileRequestKey(first)}
        selectedSourceID={null}
        statusUpdates={[]}
        setSourceID={jest.fn()}
        setQuestionnaireAnswer={jest.fn()}
        setReply={jest.fn()}
        setSelectedID={setSelectedID}
      />,
    );

    fireEvent.press(screen.getByText("Second connection"));

    expect(setSelectedID).toHaveBeenCalledWith("conn_2:wsp_personal:req_same");
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

  it("can keep the fast single-recipient approve flow when confirmation is off", () => {
    const onRespond = renderRequest(request(), jest.fn(), { confirmBeforeSubmit: false });

    expect(screen.getByText("Approve")).toBeTruthy();
    fireEvent.press(screen.getByText("Approve"));
    expect(onRespond).toHaveBeenCalledWith(expect.objectContaining({ id: "req_1" }), expect.objectContaining({ id: "approve" }));
  });

  it("submits click-to-submit Steering choices immediately without confirmation", () => {
    const alertSpy = jest.spyOn(Alert, "alert").mockImplementation((() => undefined) as any);
    const onRespond = renderRequest(request({ requestType: "steering", choices: [
      { id: "vitest", label: "Vitest BABY", kind: "option" },
      { id: "playwright", label: "Playwright", kind: "option" },
    ] }), jest.fn(), { choiceInteractionMode: "click-to-submit", confirmBeforeSubmit: true });

    fireEvent.press(screen.getByText("Vitest BABY"));
    expect(alertSpy).not.toHaveBeenCalled();
    expect(onRespond).toHaveBeenCalledWith(expect.objectContaining({ id: "req_1" }), expect.objectContaining({ id: "vitest" }));
    alertSpy.mockRestore();
  });

  it("keeps single-select Steering as direct choice cards even when select-then-submit is requested", () => {
    const alertSpy = jest.spyOn(Alert, "alert").mockImplementation((() => undefined) as any);
    const onRespond = renderRequest(request({ requestType: "steering", choices: [
      { id: "plan", label: "Plan", kind: "option" },
      { id: "cancel", label: "Cancel", kind: "deny" },
    ] }), jest.fn(), { choiceInteractionMode: "select-then-submit", confirmBeforeSubmit: false });

    expect(screen.queryByText("Send decision")).toBeNull();
    fireEvent.press(screen.getByText("Plan"));
    expect(onRespond).not.toHaveBeenCalled();
    expect(alertSpy).toHaveBeenCalledWith("Send this decision?", "Plan", expect.any(Array));
    const actions = alertSpy.mock.calls[0]?.[2] as Array<{ onPress?: () => void }> | undefined;
    actions?.[1]?.onPress?.();
    expect(onRespond).toHaveBeenCalledWith(expect.objectContaining({ id: "req_1" }), expect.objectContaining({ id: "plan" }));
    alertSpy.mockRestore();
  });

  it("keeps Steering option details compact but expands all details from one disclosure", () => {
    renderRequest(request({ requestType: "steering", choices: [
      { id: "review", label: "Review", description: "Inspect existing code", flags: ["favorite"], kind: "option" },
      { id: "build", label: "Build", description: "Implement the feature", kind: "option" },
      { id: "cancel", label: "Cancel", kind: "deny" },
    ] }));

    expect(screen.getByText("Inspect existing code")).toBeTruthy();
    expect(screen.getByText("Implement the feature")).toBeTruthy();
    expect(screen.getByText("Cancel")).toBeTruthy();
    fireEvent.press(screen.getByLabelText("Hide option details"));
    expect(screen.queryByText("Inspect existing code")).toBeNull();
    expect(screen.queryByText("Implement the feature")).toBeNull();
    expect(screen.queryByText("★")).toBeNull();
  });

  it("hides response progress and redundant responsibility copy for one-user workspaces", () => {
    renderRequest(request({
      workspaceMemberCount: 1,
      metadata: { routingRuleName: "Personal", ownerUserId: "usr_owner" },
      quorum: {
        requiredResponseCount: 1,
        receivedResponseCount: 0,
        currentUserResponded: false,
        currentUserEligible: true,
        waitingFor: 1,
        recipients: [{ userId: "usr_owner", hasActiveDevice: true }],
        responses: [],
      },
    }));

    expect(screen.queryByText("Response progress")).toBeNull();
    expect(screen.queryByText("Your response is needed")).toBeNull();
    expect(screen.queryByText(/Your response is needed\. Waiting/)).toBeNull();
    expect(screen.getByText("Approve")).toBeTruthy();
  });

  it("collapses request details, excludes agent token, and expands directory context", () => {
    renderRequest(request({
      requester: {
        name: "lattice",
        agentTokenId: "agt_secretish",
        host: "laptop",
        clientName: "Pi demo session",
        workingDirectory: "/home/jmo/Development/worktrees/mono-sd/bravo",
      },
    }));

    expect(screen.getByLabelText("Expand request details")).toBeTruthy();
    expect(screen.queryByText("Request details")).toBeNull();
    expect(screen.getByText(/lattice · Pi demo session/)).toBeTruthy();
    expect(screen.queryByText("Agent token")).toBeNull();
    expect(screen.queryByText("agt_secretish")).toBeNull();
    expect(screen.queryByText("Directory")).toBeNull();

    fireEvent.press(screen.getByLabelText("Expand request details"));

    expect(screen.getByText("Directory")).toBeTruthy();
    expect(screen.getByText("/home/jmo/Development/worktrees/mono-sd/bravo")).toBeTruthy();
    expect(screen.queryByText("Agent token")).toBeNull();
    expect(screen.queryByText("agt_secretish")).toBeNull();
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

  it("shows hosted App access CTA instead of active choices when responses are locked", () => {
    const onRespond = jest.fn();
    const onUnlockResponses = jest.fn();
    renderRequest(request(), onRespond, {
      readOnly: true,
      readOnlyReason: "Hosted service is inactive.",
      unlockResponsesLabel: "View App access",
      onUnlockResponses,
    });

    expect(screen.getByText("Hosted service is inactive.")).toBeTruthy();
    expect(screen.getByText("View App access")).toBeTruthy();
    fireEvent.press(screen.getByText("Approve"));
    fireEvent.press(screen.getByText("View App access"));
    expect(onRespond).not.toHaveBeenCalled();
    expect(onUnlockResponses).toHaveBeenCalledTimes(1);
  });

  it("allows setup Test Request responses even while native app responses are locked", () => {
    const onRespond = jest.fn();
    renderRequest(request({ isTest: true, testLabel: "Agent Tick setup test", title: "Test phone delivery" }), onRespond, {
      readOnly: true,
      readOnlyReason: "Start free Trial to respond.",
      confirmBeforeSubmit: false,
    });

    expect(screen.getByText("Agent Tick setup test")).toBeTruthy();
    expect(screen.queryByText("Start free Trial to respond.")).toBeNull();
    fireEvent.press(screen.getByText("Approve"));
    expect(onRespond).toHaveBeenCalledWith(expect.objectContaining({ isTest: true }), expect.objectContaining({ id: "approve" }));
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


});
