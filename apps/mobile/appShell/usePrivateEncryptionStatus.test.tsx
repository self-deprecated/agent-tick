import React, { useEffect } from "react";
import { render, waitFor, act } from "@testing-library/react-native";

import type { SavedMobileAccount } from "../mobileAuth";
import type { PrivateEncryptionStatus } from "../SettingsScreen";

type LocalInstallKeyStatus =
  | { status: "ready"; alias: string; algorithm: "p256-ecdh-hkdf-sha256"; publicKey: string }
  | { status: "unsupported"; message: string }
  | { status: "error"; message: string };

const mockListDevicePublicKeys = jest.fn();
const mockRegisterDevicePublicKey = jest.fn();
const mockRegisterDevice = jest.fn();
const mockAgentTickClient = jest.fn((options: unknown) => ({
  options,
  listDevicePublicKeys: mockListDevicePublicKeys,
  registerDevicePublicKey: mockRegisterDevicePublicKey,
  registerDevice: mockRegisterDevice,
}));
const mockPrivateRequestLocalInstallKeyStatus = jest.fn<Promise<LocalInstallKeyStatus>, []>(async () => ({
  status: "ready",
  alias: "agent-tick.private-request.installation.v1",
  algorithm: "p256-ecdh-hkdf-sha256",
  publicKey: "public:install",
}));
const mockEnsurePrivateRequestDeviceKeyRegistered = jest.fn<Promise<{ status: "registered"; publicKey: string }>, [unknown, string | null | undefined]>(async () => ({ status: "registered", publicKey: "public:install" }));
const mockGetStoredConnectionToken = jest.fn<Promise<string | null>, []>(async () => "connection-token");
const mockSaveStoredMobileConnections = jest.fn(async () => undefined);
const mockMobileInstallationID = jest.fn(async () => "install_1");

jest.mock("@self-deprecated/agent-tick-sdk", () => ({
  AgentTickClient: mockAgentTickClient,
  AgentTickApiError: class AgentTickApiError extends Error { status = 500; },
}));

jest.mock("../mobilePrivateRequests", () => ({
  privateRequestLocalInstallKeyStatus: mockPrivateRequestLocalInstallKeyStatus,
  ensurePrivateRequestDeviceKeyRegistered: mockEnsurePrivateRequestDeviceKeyRegistered,
}));

jest.mock("../mobileConnections", () => ({
  saveStoredMobileConnections: mockSaveStoredMobileConnections,
}));

jest.mock("./mobileNotificationHelpers", () => ({
  mobileInstallationID: mockMobileInstallationID,
}));

jest.mock("./mobileSessionClientHelpers", () => ({
  getStoredConnectionToken: mockGetStoredConnectionToken,
}));

const { usePrivateEncryptionStatus } = require("./usePrivateEncryptionStatus") as typeof import("./usePrivateEncryptionStatus");

type HarnessControls = ReturnType<typeof usePrivateEncryptionStatus>;

function StatusHarness(props: Parameters<typeof usePrivateEncryptionStatus>[0] & {
  onStatus: (status: PrivateEncryptionStatus) => void;
  onControls?: (controls: HarnessControls) => void;
}) {
  const { onStatus, onControls, ...hookProps } = props;
  const controls = usePrivateEncryptionStatus(hookProps);
  useEffect(() => { onStatus(controls.privateEncryptionStatus); }, [controls.privateEncryptionStatus, onStatus]);
  useEffect(() => { onControls?.(controls); }, [controls, onControls]);
  return null;
}

function savedAccount(input: Partial<SavedMobileAccount> = {}): SavedMobileAccount {
  return {
    id: "conn_1",
    serverURL: "https://at.example.com",
    authProvider: "clerk",
    label: "Clippy",
    updatedAt: "2026-06-14T00:00:00.000Z",
    ...input,
  };
}

describe("usePrivateEncryptionStatus", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPrivateRequestLocalInstallKeyStatus.mockResolvedValue({
      status: "ready",
      alias: "agent-tick.private-request.installation.v1",
      algorithm: "p256-ecdh-hkdf-sha256",
      publicKey: "public:install",
    });
    mockListDevicePublicKeys.mockImplementation(async (deviceId: string) => [{
      deviceKeyId: `key:${deviceId}`,
      deviceId,
      userId: "usr_1",
      algorithm: "p256-ecdh-hkdf-sha256",
      publicKey: "public:install",
      publicKeyFingerprint: `fingerprint:${deviceId}`,
      createdAt: "2026-06-14T00:00:00.000Z",
      updatedAt: "2026-06-14T00:00:00.000Z",
    }]);
    mockGetStoredConnectionToken.mockResolvedValue("connection-token");
    mockRegisterDevice.mockResolvedValue({ deviceId: "dev_created" });
  });

  it("checks a saved connection against the shared local install key", async () => {
    const statuses: PrivateEncryptionStatus[] = [];
    render(
      <StatusHarness
        currentAuthToken={async () => "active-token"}
        deviceID=""
        savedAccounts={[savedAccount({ deviceID: "dev_conn_1" })]}
        selectedWorkspaceID=""
        serverURL="https://at.example.com"
        settingsLoaded
        onStatus={(status) => statuses.push(status)}
      />,
    );

    await waitFor(() => expect(statuses.at(-1)?.state).toBe("ready"));
    expect(statuses.at(-1)?.summary).toBe("This phone's private encryption key is registered on every saved connection.");
    expect(mockPrivateRequestLocalInstallKeyStatus).toHaveBeenCalledWith();
    expect(mockListDevicePublicKeys).toHaveBeenCalledWith("dev_conn_1");
  });

  it("checks multiple remote Approval Devices against the same install public key", async () => {
    const statuses: PrivateEncryptionStatus[] = [];
    render(
      <StatusHarness
        currentAuthToken={async () => "active-token"}
        deviceID=""
        savedAccounts={[
          savedAccount({ id: "conn_1", serverURL: "https://clippy.example.com", deviceID: "dev_clippy" }),
          savedAccount({ id: "conn_2", serverURL: "https://tay.example.com", deviceID: "dev_tay", label: "Tay" }),
        ]}
        selectedWorkspaceID=""
        serverURL="https://unused.example.com"
        settingsLoaded
        onStatus={(status) => statuses.push(status)}
      />,
    );

    await waitFor(() => expect(statuses.at(-1)?.state).toBe("ready"));
    expect(mockPrivateRequestLocalInstallKeyStatus).toHaveBeenCalledTimes(1);
    expect(mockListDevicePublicKeys).toHaveBeenCalledWith("dev_clippy");
    expect(mockListDevicePublicKeys).toHaveBeenCalledWith("dev_tay");
    expect(statuses.at(-1)?.connections).toEqual(expect.arrayContaining([
      expect.objectContaining({ deviceID: "dev_clippy", publicKeyFingerprint: "fingerprint:dev_clippy", status: "registered" }),
      expect.objectContaining({ deviceID: "dev_tay", publicKeyFingerprint: "fingerprint:dev_tay", status: "registered" }),
    ]));
  });

  it("reports partial private encryption registration when only some connections have the install key", async () => {
    mockListDevicePublicKeys.mockImplementation(async (deviceId: string) => deviceId === "dev_ready" ? [{
      deviceKeyId: `key:${deviceId}`,
      deviceId,
      userId: "usr_1",
      algorithm: "p256-ecdh-hkdf-sha256",
      publicKey: "public:install",
      publicKeyFingerprint: `fingerprint:${deviceId}`,
      createdAt: "2026-06-14T00:00:00.000Z",
      updatedAt: "2026-06-14T00:00:00.000Z",
    }] : []);
    const statuses: PrivateEncryptionStatus[] = [];

    render(
      <StatusHarness
        currentAuthToken={async () => "active-token"}
        deviceID=""
        savedAccounts={[
          savedAccount({ id: "conn_1", label: "Ready", deviceID: "dev_ready" }),
          savedAccount({ id: "conn_2", label: "Missing", deviceID: "dev_missing" }),
        ]}
        selectedWorkspaceID=""
        serverURL="https://unused.example.com"
        settingsLoaded
        onStatus={(status) => statuses.push(status)}
      />,
    );

    await waitFor(() => expect(statuses.at(-1)?.state).toBe("warning"));
    expect(statuses.at(-1)?.summary).toBe("This phone's private encryption key is only registered on some connections.");
    expect(statuses.at(-1)?.connections).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: "Ready", status: "registered" }),
      expect.objectContaining({ label: "Missing", status: "not_registered" }),
    ]));
  });

  it("reports unsupported native crypto as an unavailable private encryption state", async () => {
    mockPrivateRequestLocalInstallKeyStatus.mockResolvedValue({
      status: "unsupported",
      message: "Private Requests require a development or production build with native encryption support.",
    });
    const statuses: PrivateEncryptionStatus[] = [];

    render(
      <StatusHarness
        currentAuthToken={async () => "active-token"}
        deviceID=""
        savedAccounts={[savedAccount({ deviceID: "dev_conn_1" })]}
        selectedWorkspaceID=""
        serverURL="https://at.example.com"
        settingsLoaded
        onStatus={(status) => statuses.push(status)}
      />,
    );

    await waitFor(() => expect(statuses.at(-1)?.state).toBe("unsupported"));
    expect(statuses.at(-1)?.summary).toBe("Native private encryption is unavailable in this build.");
    expect(statuses.at(-1)?.connections[0]).toEqual(expect.objectContaining({ status: "unsupported", statusLabel: "Unsupported" }));
    expect(mockListDevicePublicKeys).not.toHaveBeenCalled();
  });

  it("reports local install-key preparation errors without exposing key material", async () => {
    mockPrivateRequestLocalInstallKeyStatus.mockResolvedValue({
      status: "error",
      message: "secure enclave unavailable",
    });
    const statuses: PrivateEncryptionStatus[] = [];

    render(
      <StatusHarness
        currentAuthToken={async () => "active-token"}
        deviceID=""
        savedAccounts={[savedAccount({ deviceID: "dev_conn_1" })]}
        selectedWorkspaceID=""
        serverURL="https://at.example.com"
        settingsLoaded
        onStatus={(status) => statuses.push(status)}
      />,
    );

    await waitFor(() => expect(statuses.at(-1)?.state).toBe("error"));
    expect(statuses.at(-1)?.detail).toBe("secure enclave unavailable");
    expect(statuses.at(-1)?.connections[0]).toEqual(expect.not.objectContaining({ publicKeyFingerprint: expect.any(String) }));
    expect(mockListDevicePublicKeys).not.toHaveBeenCalled();
  });

  it("reports a different registered server key as a repairable warning", async () => {
    mockListDevicePublicKeys.mockResolvedValue([{
      deviceKeyId: "key:other",
      deviceId: "dev_conn_1",
      userId: "usr_1",
      algorithm: "p256-ecdh-hkdf-sha256",
      publicKey: "public:other",
      publicKeyFingerprint: "fingerprint:other",
      createdAt: "2026-06-14T00:00:00.000Z",
      updatedAt: "2026-06-14T00:00:00.000Z",
    }]);
    const statuses: PrivateEncryptionStatus[] = [];

    render(
      <StatusHarness
        currentAuthToken={async () => "active-token"}
        deviceID=""
        savedAccounts={[savedAccount({ deviceID: "dev_conn_1" })]}
        selectedWorkspaceID=""
        serverURL="https://at.example.com"
        settingsLoaded
        onStatus={(status) => statuses.push(status)}
      />,
    );

    await waitFor(() => expect(statuses.at(-1)?.state).toBe("warning"));
    expect(statuses.at(-1)?.connections[0]).toEqual(expect.objectContaining({
      status: "different_key",
      statusLabel: "Different key",
      publicKeyFingerprint: "fingerprint:other",
    }));
  });

  it("reports missing credentials without attempting server registration", async () => {
    mockGetStoredConnectionToken.mockResolvedValue(null);
    const statuses: PrivateEncryptionStatus[] = [];

    render(
      <StatusHarness
        currentAuthToken={async () => "active-token"}
        deviceID=""
        savedAccounts={[savedAccount({ deviceID: "dev_conn_1" })]}
        selectedWorkspaceID=""
        serverURL="https://at.example.com"
        settingsLoaded
        onStatus={(status) => statuses.push(status)}
      />,
    );

    await waitFor(() => expect(statuses.at(-1)?.state).toBe("warning"));
    expect(statuses.at(-1)?.connections[0]).toEqual(expect.objectContaining({ status: "missing_credential", statusLabel: "Missing token" }));
    expect(mockListDevicePublicKeys).not.toHaveBeenCalled();
    expect(mockRegisterDevicePublicKey).not.toHaveBeenCalled();
  });

  it("global repair registers only connections missing this phone's install key", async () => {
    mockListDevicePublicKeys.mockImplementation(async (deviceId: string) => deviceId === "dev_ready" ? [{
      deviceKeyId: `key:${deviceId}`,
      deviceId,
      userId: "usr_1",
      algorithm: "p256-ecdh-hkdf-sha256",
      publicKey: "public:install",
      publicKeyFingerprint: `fingerprint:${deviceId}`,
      createdAt: "2026-06-14T00:00:00.000Z",
      updatedAt: "2026-06-14T00:00:00.000Z",
    }] : []);
    const statuses: PrivateEncryptionStatus[] = [];
    let controls: HarnessControls | undefined;

    render(
      <StatusHarness
        currentAuthToken={async () => "active-token"}
        deviceID=""
        savedAccounts={[
          savedAccount({ id: "conn_1", label: "Ready", deviceID: "dev_ready" }),
          savedAccount({ id: "conn_2", label: "Missing", deviceID: "dev_missing" }),
        ]}
        selectedWorkspaceID=""
        serverURL="https://unused.example.com"
        settingsLoaded
        onStatus={(status) => statuses.push(status)}
        onControls={(next) => { controls = next; }}
      />,
    );

    await waitFor(() => expect(statuses.at(-1)?.state).toBe("warning"));
    await act(async () => {
      await controls?.repairPrivateEncryptionRegistration();
    });

    expect(mockEnsurePrivateRequestDeviceKeyRegistered).toHaveBeenCalledTimes(1);
    expect(mockEnsurePrivateRequestDeviceKeyRegistered).toHaveBeenCalledWith(expect.any(Object), "dev_missing");
    expect(mockEnsurePrivateRequestDeviceKeyRegistered).not.toHaveBeenCalledWith(expect.any(Object), "dev_ready");
  });

  it("repair creates an Approval Device for a saved connection that has no device id", async () => {
    mockListDevicePublicKeys.mockImplementation(async (deviceId: string) => {
      if (deviceId !== "dev_created") return [];
      if (mockEnsurePrivateRequestDeviceKeyRegistered.mock.calls.some((call) => call[1] === "dev_created")) {
        return [{
          deviceKeyId: `key:${deviceId}`,
          deviceId,
          userId: "usr_1",
          algorithm: "p256-ecdh-hkdf-sha256",
          publicKey: "public:install",
          publicKeyFingerprint: `fingerprint:${deviceId}`,
          createdAt: "2026-06-14T00:00:00.000Z",
          updatedAt: "2026-06-14T00:00:00.000Z",
        }];
      }
      return [];
    });
    let accounts = [savedAccount()];
    const setSavedAccounts = jest.fn((updater: React.SetStateAction<SavedMobileAccount[]>) => {
      accounts = typeof updater === "function" ? updater(accounts) : updater;
    });
    const setDeviceID = jest.fn();
    const statuses: PrivateEncryptionStatus[] = [];
    let controls: HarnessControls | undefined;

    render(
      <StatusHarness
        currentAuthToken={async () => "active-token"}
        deviceID=""
        savedAccounts={accounts}
        selectedWorkspaceID=""
        serverURL="https://at.example.com"
        settingsLoaded
        setDeviceID={setDeviceID}
        setSavedAccounts={setSavedAccounts}
        onStatus={(status) => statuses.push(status)}
        onControls={(next) => { controls = next; }}
      />,
    );

    await waitFor(() => expect(statuses.at(-1)?.connections[0]?.status).toBe("missing_device"));
    await act(async () => {
      await controls?.repairPrivateEncryptionRegistration();
    });

    await waitFor(() => expect(statuses.at(-1)?.state).toBe("ready"));
    expect(mockRegisterDevice).toHaveBeenCalledWith(expect.objectContaining({ installationId: "install_1" }));
    expect(mockEnsurePrivateRequestDeviceKeyRegistered).toHaveBeenCalledWith(expect.any(Object), "dev_created");
    expect(setDeviceID).toHaveBeenCalledWith("dev_created");
    expect(accounts[0]?.deviceID).toBe("dev_created");
    expect(mockSaveStoredMobileConnections).toHaveBeenCalledWith([expect.objectContaining({ deviceID: "dev_created" })]);
  });
});
