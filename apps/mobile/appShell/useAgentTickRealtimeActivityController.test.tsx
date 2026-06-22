import React from "react";
import { render } from "@testing-library/react-native";

const mockUseMobileRealtimeActivityController = jest.fn((_: unknown) => ({ load: jest.fn(), interruptRealtime: jest.fn(), loadRef: { current: null } }));

jest.mock("./useMobileRealtimeActivityController", () => ({
  useMobileRealtimeActivityController: (input: unknown) => mockUseMobileRealtimeActivityController(input),
}));

const { useAgentTickRealtimeActivityController } = require("./useAgentTickRealtimeActivityController") as typeof import("./useAgentTickRealtimeActivityController");

function Harness() {
  const setScreen = jest.fn();
  const setSettingsViewTarget = jest.fn((updater: (target: { view: "home" | "notifications"; signal: number }) => { view: "home" | "notifications"; signal: number }) => updater({ view: "home", signal: 2 }));

  useAgentTickRealtimeActivityController({
    activityState: {
      requests: [],
      selectedID: null,
      selectedSessionID: null,
      selectedSourceID: null,
      sessionDetails: {},
      sessionSummaries: [],
      setRequests: jest.fn(),
      setSelectedID: jest.fn(),
      setSelectedSourceID: jest.fn(),
      setSessionDetails: jest.fn(),
      setSessionSummaries: jest.fn(),
      setStatusUpdates: jest.fn(),
    },
    appStatusState: {
      notificationsEnabled: false,
      notificationStatus: "unknown",
      pushStatus: "idle",
      realtimeUnavailable: false,
      settingsLoaded: true,
      setConnectionStatus: jest.fn(),
      setDiagnosticsEventCount: jest.fn(),
      setError: jest.fn(),
      setLoading: jest.fn(),
      setRealtimeUnavailable: jest.fn(),
    },
    billingController: { refreshPersonalBilling: jest.fn() },
    connectionAccountState: {
      deviceID: "device_1",
      runtimeAuthConfig: null,
      savedAccounts: [],
      selectedWorkspaceID: "workspace_1",
      serverURL: "https://at.example.test",
      token: "agent_token",
    },
    navigationState: { setScreen, setSettingsViewTarget },
    notificationTargetState: {
      notificationTargetID: null,
      setNotificationTargetID: jest.fn(),
    },
    runtimeRefs: {
      didPrimeNotifications: { current: false },
      didShowNotificationSettingsReminder: { current: false },
      seenRequestIDs: { current: new Set<string>() },
    },
    sdk: {},
    selectionState: { hasRequestAuth: true },
    sessionStackDashboard: {
      dashboardSessionSummaries: [],
      visibleSessionSummaries: [],
    },
  } as unknown as Parameters<typeof useAgentTickRealtimeActivityController>[0]);

  const firstCall = mockUseMobileRealtimeActivityController.mock.calls[0];
  if (!firstCall) throw new Error("useMobileRealtimeActivityController was not called");
  const input = firstCall[0] as { onOpenNotificationSettings: () => void };
  input.onOpenNotificationSettings();

  expect(setScreen).toHaveBeenCalledWith("settings");
  expect(setSettingsViewTarget).toHaveBeenCalledWith(expect.any(Function));
  const firstSettingsResult = setSettingsViewTarget.mock.results[0];
  expect(firstSettingsResult?.value).toEqual({ view: "notifications", signal: 3 });
  return null;
}

describe("useAgentTickRealtimeActivityController", () => {
  beforeEach(() => {
    mockUseMobileRealtimeActivityController.mockClear();
  });

  it("keeps notification-settings navigation in the Agent Tick app-shell seam", () => {
    render(<Harness />);

    expect(mockUseMobileRealtimeActivityController).toHaveBeenCalledTimes(1);
  });
});
