import React from "react";
import { render, waitFor } from "@testing-library/react-native";

import type { MeResponse } from "@self-deprecated/agent-tick-sdk";
import type { RuntimeAuthConfig } from "../mobileAuth";
import type { MobileRequest } from "../requests";
import type { ConnectionStatus, PushStatus } from "../SettingsScreen";
import { useClerkSessionReset } from "./useClerkSessionReset";

function ResetHarness(props: Parameters<typeof useClerkSessionReset>[0]) {
  useClerkSessionReset(props);
  return null;
}

function baseProps(overrides: Partial<Parameters<typeof useClerkSessionReset>[0]> = {}): Parameters<typeof useClerkSessionReset>[0] {
  return {
    activeClerkSessionID: null,
    runtimeAuthConfig: { mode: "clerk", authProvider: "clerk", clerkPublishableKey: "pk_test" } satisfies RuntimeAuthConfig,
    serverURL: "https://app.agenttick.sh",
    lastClerkPushRegistrationKey: { current: "https://app.agenttick.sh:usr_1" },
    setCurrentAccountProfile: jest.fn<ReturnType<React.Dispatch<React.SetStateAction<MeResponse | null>>>, Parameters<React.Dispatch<React.SetStateAction<MeResponse | null>>>>(),
    setSelectedWorkspaceID: jest.fn<ReturnType<React.Dispatch<React.SetStateAction<string>>>, Parameters<React.Dispatch<React.SetStateAction<string>>>>(),
    setDeviceID: jest.fn<ReturnType<React.Dispatch<React.SetStateAction<string>>>, Parameters<React.Dispatch<React.SetStateAction<string>>>>(),
    setPushStatus: jest.fn<ReturnType<React.Dispatch<React.SetStateAction<PushStatus>>>, Parameters<React.Dispatch<React.SetStateAction<PushStatus>>>>(),
    setRequests: jest.fn<ReturnType<React.Dispatch<React.SetStateAction<MobileRequest[]>>>, Parameters<React.Dispatch<React.SetStateAction<MobileRequest[]>>>>(),
    setHistory: jest.fn<ReturnType<React.Dispatch<React.SetStateAction<MobileRequest[]>>>, Parameters<React.Dispatch<React.SetStateAction<MobileRequest[]>>>>(),
    setSelectedID: jest.fn<ReturnType<React.Dispatch<React.SetStateAction<string | null>>>, Parameters<React.Dispatch<React.SetStateAction<string | null>>>>(),
    setConnectionStatus: jest.fn<ReturnType<React.Dispatch<React.SetStateAction<ConnectionStatus>>>, Parameters<React.Dispatch<React.SetStateAction<ConnectionStatus>>>>(),
    ...overrides,
  };
}

describe("useClerkSessionReset", () => {
  it("does not clear the device id when the existing Clerk session is first observed after app start", () => {
    const props = baseProps();
    const { rerender } = render(<ResetHarness {...props} />);

    rerender(<ResetHarness {...props} activeClerkSessionID="sess_existing" />);

    expect(props.setDeviceID).not.toHaveBeenCalled();
    expect(props.setPushStatus).not.toHaveBeenCalled();
    expect(props.setRequests).not.toHaveBeenCalled();
    expect(props.lastClerkPushRegistrationKey.current).toBe("https://app.agenttick.sh:usr_1");
  });

  it("resets session-scoped state when the Clerk session changes in-process", async () => {
    const props = baseProps({ activeClerkSessionID: "sess_1" });
    const { rerender } = render(<ResetHarness {...props} />);

    expect(props.setDeviceID).not.toHaveBeenCalled();

    rerender(<ResetHarness {...props} activeClerkSessionID="sess_2" />);

    await waitFor(() => expect(props.setDeviceID).toHaveBeenCalledWith(""));
    expect(props.setSelectedWorkspaceID).toHaveBeenCalledWith("");
    expect(props.setPushStatus).toHaveBeenCalledWith("idle");
    expect(props.setRequests).toHaveBeenCalledWith([]);
    expect(props.setHistory).toHaveBeenCalledWith([]);
    expect(props.setSelectedID).toHaveBeenCalledWith(null);
    expect(props.setConnectionStatus).toHaveBeenCalledWith("checking");
    expect(props.setCurrentAccountProfile).toHaveBeenCalledWith(expect.any(Function));
    expect(props.lastClerkPushRegistrationKey.current).toBe("");
  });
});
