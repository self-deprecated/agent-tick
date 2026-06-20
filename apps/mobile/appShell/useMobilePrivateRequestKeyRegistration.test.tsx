import React from "react";
import { act, render, waitFor } from "@testing-library/react-native";

import type { SavedMobileAccount } from "../mobileAuth";

const mockRegisterDevice = jest.fn(async () => ({ deviceId: "dev_created" }));
const mockAgentTickClient = jest.fn((options: unknown) => ({
  options,
  registerDevice: mockRegisterDevice,
}));
const mockEnsurePrivateRequestDeviceKeyRegistered = jest.fn(async () => ({ status: "registered", publicKey: "public-key" }));
const mockGetStoredConnectionToken = jest.fn(async () => "connection-token");
const mockSaveStoredMobileConnections = jest.fn(async () => undefined);
const mockMobileInstallationID = jest.fn(async () => "install_1");

jest.mock("@self-deprecated/agent-tick-sdk", () => ({
  AgentTickClient: mockAgentTickClient,
}));

jest.mock("../mobileConnections", () => ({
  saveStoredMobileConnections: mockSaveStoredMobileConnections,
}));

jest.mock("../mobilePrivateRequests", () => ({
  ensurePrivateRequestDeviceKeyRegistered: mockEnsurePrivateRequestDeviceKeyRegistered,
}));

jest.mock("./mobileNotificationHelpers", () => ({
  mobileInstallationID: mockMobileInstallationID,
}));

jest.mock("./mobileSessionClientHelpers", () => ({
  getStoredConnectionToken: mockGetStoredConnectionToken,
}));

const { useMobilePrivateRequestKeyRegistration } = require("./useMobilePrivateRequestKeyRegistration") as typeof import("./useMobilePrivateRequestKeyRegistration");

function RegistrationHarness(props: Parameters<typeof useMobilePrivateRequestKeyRegistration>[0]) {
  useMobilePrivateRequestKeyRegistration(props);
  return null;
}

function savedAccount(input: Partial<SavedMobileAccount> = {}): SavedMobileAccount {
  return {
    id: "conn_1",
    serverURL: "https://clippy.example.com",
    authProvider: "clerk",
    workspaceID: "wsp_1",
    label: "Clippy",
    updatedAt: "2026-06-12T00:00:00.000Z",
    ...input,
  };
}

type HarnessProps = Parameters<typeof useMobilePrivateRequestKeyRegistration>[0];
function props(input: Partial<HarnessProps> = {}): HarnessProps {
  return {
    activeConnectionID: "",
    connectionTokens: {},
    currentAuthToken: async () => "active-token",
    deviceID: "",
    savedAccounts: [],
    selectedWorkspaceID: "",
    serverURL: "https://unused.example.com",
    settingsLoaded: true,
    setDeviceID: jest.fn(),
    setDiagnosticsEventCount: jest.fn(),
    setSavedAccounts: jest.fn(),
    ...input,
  };
}

describe("useMobilePrivateRequestKeyRegistration", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRegisterDevice.mockResolvedValue({ deviceId: "dev_created" });
  });

  it("registers the shared install key for saved connection devices on different servers", async () => {
    await renderAndFlush(
      <RegistrationHarness
        {...props({
          savedAccounts: [
            savedAccount({ id: "conn_1", serverURL: "https://clippy.example.com", deviceID: "dev_clippy", workspaceID: "wsp_1", label: "Clippy" }),
            savedAccount({ id: "conn_2", serverURL: "https://tay.example.com", deviceID: "dev_tay", workspaceID: "wsp_2", label: "Tay" }),
          ],
        })}
      />,
    );

    await waitFor(() => expect(mockGetStoredConnectionToken).toHaveBeenCalledWith(expect.objectContaining({ id: "conn_1", deviceID: "dev_clippy" })));
    await waitFor(() => expect(mockGetStoredConnectionToken).toHaveBeenCalledWith(expect.objectContaining({ id: "conn_2", deviceID: "dev_tay" })));
    expect(mockAgentTickClient).toHaveBeenCalledWith({
      baseUrl: "https://clippy.example.com",
      tokenProvider: expect.any(Function),
      workspaceIdProvider: expect.any(Function),
    });
    expect(mockAgentTickClient).toHaveBeenCalledWith({
      baseUrl: "https://tay.example.com",
      tokenProvider: expect.any(Function),
      workspaceIdProvider: expect.any(Function),
    });
    expect(mockRegisterDevice).not.toHaveBeenCalled();
    expect(mockEnsurePrivateRequestDeviceKeyRegistered).toHaveBeenCalledWith(expect.objectContaining({ options: expect.objectContaining({ baseUrl: "https://clippy.example.com" }) }), "dev_clippy");
    expect(mockEnsurePrivateRequestDeviceKeyRegistered).toHaveBeenCalledWith(expect.objectContaining({ options: expect.objectContaining({ baseUrl: "https://tay.example.com" }) }), "dev_tay");
  });

  it("creates a missing saved connection Approval Device and registers the shared install key", async () => {
    let accounts = [savedAccount({ id: "conn_1" })];
    const setSavedAccounts = jest.fn((updater: React.SetStateAction<SavedMobileAccount[]>) => {
      accounts = typeof updater === "function" ? updater(accounts) : updater;
    });
    const setDeviceID = jest.fn();

    await renderAndFlush(
      <RegistrationHarness
        {...props({
          activeConnectionID: "conn_1",
          savedAccounts: accounts,
          setDeviceID,
          setSavedAccounts,
        })}
      />,
    );

    await waitFor(() => expect(mockRegisterDevice).toHaveBeenCalledWith(expect.objectContaining({ installationId: "install_1" })));
    expect(mockEnsurePrivateRequestDeviceKeyRegistered).toHaveBeenCalledWith(expect.any(Object), "dev_created");
    expect(setSavedAccounts).toHaveBeenCalled();
    expect(accounts[0]?.deviceID).toBe("dev_created");
    expect(mockSaveStoredMobileConnections).toHaveBeenCalledWith([expect.objectContaining({ deviceID: "dev_created" })]);
    expect(setDeviceID).toHaveBeenCalledWith("dev_created");
  });

  it("retries missing saved connection devices after a Clerk connection token arrives", async () => {
    mockGetStoredConnectionToken.mockResolvedValueOnce(null as unknown as string);
    let accounts = [savedAccount({ id: "conn_1" })];
    const setSavedAccounts = jest.fn((updater: React.SetStateAction<SavedMobileAccount[]>) => {
      accounts = typeof updater === "function" ? updater(accounts) : updater;
    });
    const setDeviceID = jest.fn();
    const { rerender } = render(
      <RegistrationHarness
        {...props({
          activeConnectionID: "conn_1",
          connectionTokens: {},
          savedAccounts: accounts,
          setDeviceID,
          setSavedAccounts,
        })}
      />,
    );

    await waitFor(() => expect(mockGetStoredConnectionToken).toHaveBeenCalledWith(expect.objectContaining({ id: "conn_1" })));
    expect(mockRegisterDevice).not.toHaveBeenCalled();

    rerender(
      <RegistrationHarness
        {...props({
          activeConnectionID: "conn_1",
          connectionTokens: { conn_1: "fresh-connection-token" },
          savedAccounts: accounts,
          setDeviceID,
          setSavedAccounts,
        })}
      />,
    );

    await waitFor(() => expect(mockRegisterDevice).toHaveBeenCalledWith(expect.objectContaining({ installationId: "install_1" })));
    expect(mockEnsurePrivateRequestDeviceKeyRegistered).toHaveBeenCalledWith(expect.any(Object), "dev_created");
    expect(accounts[0]?.deviceID).toBe("dev_created");
    expect(setDeviceID).toHaveBeenCalledWith("dev_created");
  });

  it("retries missing saved connection devices after a cancelled registration attempt", async () => {
    let resolveFirstRegister: (value: { deviceId: string }) => void = () => undefined;
    mockRegisterDevice.mockImplementationOnce(() => new Promise((resolve) => {
      resolveFirstRegister = resolve;
    }));
    const accounts = [savedAccount({ id: "conn_1" })];
    const setSavedAccounts = jest.fn();
    const setDeviceID = jest.fn();
    const { rerender } = render(
      <RegistrationHarness
        {...props({
          activeConnectionID: "conn_1",
          connectionTokens: { conn_1: "first-connection-token" },
          savedAccounts: accounts,
          setDeviceID,
          setSavedAccounts,
        })}
      />,
    );

    await waitFor(() => expect(mockRegisterDevice).toHaveBeenCalledTimes(1));

    rerender(
      <RegistrationHarness
        {...props({
          activeConnectionID: "conn_1",
          connectionTokens: { conn_1: "second-connection-token" },
          savedAccounts: accounts,
          setDeviceID,
          setSavedAccounts,
        })}
      />,
    );
    expect(mockRegisterDevice).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveFirstRegister({ deviceId: "dev_cancelled" });
      await Promise.resolve();
      await Promise.resolve();
    });

    rerender(
      <RegistrationHarness
        {...props({
          activeConnectionID: "conn_1",
          connectionTokens: { conn_1: "third-connection-token" },
          savedAccounts: accounts,
          setDeviceID,
          setSavedAccounts,
        })}
      />,
    );

    await waitFor(() => expect(mockRegisterDevice).toHaveBeenCalledTimes(2));
    expect(mockEnsurePrivateRequestDeviceKeyRegistered).toHaveBeenCalledWith(expect.any(Object), "dev_created");
    expect(setSavedAccounts).toHaveBeenCalled();
    expect(setDeviceID).toHaveBeenCalledWith("dev_created");
  });

  it("creates the active session Approval Device when there are no saved accounts", async () => {
    const currentAuthToken = jest.fn(async () => "active-token");
    const setDeviceID = jest.fn();

    await renderAndFlush(
      <RegistrationHarness
        {...props({
          currentAuthToken,
          deviceID: "",
          savedAccounts: [],
          selectedWorkspaceID: "wsp_active",
          serverURL: "https://active.example.com/",
          setDeviceID,
        })}
      />,
    );

    await waitFor(() => expect(currentAuthToken).toHaveBeenCalled());
    expect(mockAgentTickClient).toHaveBeenCalledWith({
      baseUrl: "https://active.example.com",
      tokenProvider: expect.any(Function),
      workspaceIdProvider: expect.any(Function),
    });
    expect(mockRegisterDevice).toHaveBeenCalledWith(expect.objectContaining({ installationId: "install_1" }));
    expect(mockEnsurePrivateRequestDeviceKeyRegistered).toHaveBeenCalledWith(expect.objectContaining({ options: expect.objectContaining({ baseUrl: "https://active.example.com" }) }), "dev_created");
    expect(setDeviceID).toHaveBeenCalledWith("dev_created");
  });

  it("registers the active session device when there are no saved accounts and a device already exists", async () => {
    const currentAuthToken = jest.fn(async () => "active-token");

    await renderAndFlush(
      <RegistrationHarness
        {...props({
          currentAuthToken,
          deviceID: "dev_active",
          savedAccounts: [],
          selectedWorkspaceID: "wsp_active",
          serverURL: "https://active.example.com/",
        })}
      />,
    );

    await waitFor(() => expect(currentAuthToken).toHaveBeenCalled());
    expect(mockRegisterDevice).not.toHaveBeenCalled();
    expect(mockEnsurePrivateRequestDeviceKeyRegistered).toHaveBeenCalledWith(expect.objectContaining({ options: expect.objectContaining({ baseUrl: "https://active.example.com" }) }), "dev_active");
  });

  it("waits for settings before registering or creating devices", async () => {
    await renderAndFlush(
      <RegistrationHarness
        {...props({
          deviceID: "",
          savedAccounts: [],
          selectedWorkspaceID: "wsp_active",
          serverURL: "https://active.example.com",
          settingsLoaded: false,
        })}
      />,
    );

    expect(mockRegisterDevice).not.toHaveBeenCalled();
    expect(mockEnsurePrivateRequestDeviceKeyRegistered).not.toHaveBeenCalled();
  });
});

async function renderAndFlush(element: React.ReactElement) {
  render(element);
}
