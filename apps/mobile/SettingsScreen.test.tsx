import React from "react";
import { render, screen, fireEvent } from "@testing-library/react-native";
import { SettingsScreen, ConnectionStatus, NotificationStatus, PushStatus } from "./SettingsScreen";

const baseProps = {
  connectionStatus: "disconnected" as ConnectionStatus,
  error: null,
  loading: false,
  notificationStatus: "undetermined" as NotificationStatus,
  onCheck: jest.fn(),
  onForgetDevice: jest.fn(),
  onPairDevice: jest.fn(),
  onRegisterPush: jest.fn(),
  onDiagnosticsEnabledChange: jest.fn(),
  onRequestNotifications: jest.fn(),
  onSendDiagnosticSnapshot: jest.fn(),
  onSendTestNotification: jest.fn(),
  onScanPairing: jest.fn(),
  onUseHosted: jest.fn(),
  pairingCode: "",
  pushStatus: "idle" as PushStatus,
  serverURL: "http://localhost:8787",
  setPairingCode: jest.fn(),
  setServerURL: jest.fn(),
  setToken: jest.fn(),
  token: "",
};

const unpairedProps = { ...baseProps, deviceID: "" };
const pairedProps = { ...baseProps, deviceID: "device-abc-123" };

describe("SettingsScreen — unpaired state", () => {
  it("shows Scan Pairing QR button prominently at the top", () => {
    render(<SettingsScreen {...unpairedProps} />);
    expect(screen.getByText("Scan Pairing QR")).toBeTruthy();
  });

  it("shows server URL input", () => {
    render(<SettingsScreen {...unpairedProps} />);
    expect(screen.getByPlaceholderText("https://tick.example.com")).toBeTruthy();
  });

  it("shows Check Connection button", () => {
    render(<SettingsScreen {...unpairedProps} />);
    expect(screen.getByText("Check Connection")).toBeTruthy();
  });

  it("offers agenttick.sh as the primary escape hatch from self-hosted setup", () => {
    render(<SettingsScreen {...unpairedProps} />);
    expect(screen.getByText("Use agenttick.sh")).toBeTruthy();
  });

  it("hides manual pairing code input by default (collapsed Advanced)", () => {
    render(<SettingsScreen {...unpairedProps} />);
    expect(screen.queryByPlaceholderText("pair_...")).toBeNull();
  });

  it("hides manual bearer token input by default (collapsed Advanced)", () => {
    render(<SettingsScreen {...unpairedProps} />);
    expect(screen.queryByPlaceholderText("test-token")).toBeNull();
  });

  it("shows Advanced toggle to expand the section", () => {
    render(<SettingsScreen {...unpairedProps} />);
    expect(screen.getByText("Advanced")).toBeTruthy();
  });

  it("reveals manual pairing code input when Advanced is expanded", () => {
    render(<SettingsScreen {...unpairedProps} />);
    fireEvent.press(screen.getByText("Advanced"));
    expect(screen.getByPlaceholderText("pair_...")).toBeTruthy();
  });

  it("shows Notifications section", () => {
    render(<SettingsScreen {...unpairedProps} />);
    expect(screen.getByText("Notifications")).toBeTruthy();
  });

  it("does not show Forget Device button", () => {
    render(<SettingsScreen {...unpairedProps} />);
    expect(screen.queryByText("Forget Device")).toBeNull();
  });
});

describe("SettingsScreen — paired state", () => {
  it("shows the current paired device account", () => {
    render(<SettingsScreen {...pairedProps} />);
    expect(screen.getByText("Current account")).toBeTruthy();
    expect(screen.getByText("Device device-abc-123")).toBeTruthy();
  });

  it("shows Forget Device button", () => {
    render(<SettingsScreen {...pairedProps} />);
    expect(screen.getByText("Forget Device")).toBeTruthy();
  });

  it("keeps server URL input available for server switching", () => {
    render(<SettingsScreen {...pairedProps} />);
    expect(screen.getByPlaceholderText("https://tick.example.com")).toBeTruthy();
  });

  it("hides manual pairing code input", () => {
    render(<SettingsScreen {...pairedProps} />);
    expect(screen.queryByPlaceholderText("pair_...")).toBeNull();
  });

  it("hides manual bearer token input", () => {
    render(<SettingsScreen {...pairedProps} />);
    expect(screen.queryByPlaceholderText("test-token")).toBeNull();
  });

  it("keeps Check Connection available", () => {
    render(<SettingsScreen {...pairedProps} />);
    expect(screen.getByText("Check Connection")).toBeTruthy();
  });

  it("hides Scan Pairing QR button as primary action", () => {
    render(<SettingsScreen {...pairedProps} />);
    expect(screen.queryByText("Scan Pairing QR")).toBeNull();
  });

  it("shows Notifications section", () => {
    render(<SettingsScreen {...pairedProps} />);
    expect(screen.getByText("Notifications")).toBeTruthy();
  });

  it("reminds paired users to enable notifications", () => {
    const onRequestNotifications = jest.fn();
    render(<SettingsScreen {...pairedProps} onRequestNotifications={onRequestNotifications} notificationStatus="undetermined" />);
    expect(screen.getByText("Enable approval alerts")).toBeTruthy();
    expect(screen.getByText(/urgent approval requests/)).toBeTruthy();
    fireEvent.press(screen.getByText("Enable Notifications"));
    expect(onRequestNotifications).toHaveBeenCalled();
  });

  it("does not show the notification reminder after notifications are enabled", () => {
    render(<SettingsScreen {...pairedProps} notificationStatus="granted" />);
    expect(screen.queryByText("Enable approval alerts")).toBeNull();
  });

  it("reveals hidden diagnostics controls by long-pressing Notifications", () => {
    const onDiagnosticsEnabledChange = jest.fn();
    render(<SettingsScreen {...pairedProps} onDiagnosticsEnabledChange={onDiagnosticsEnabledChange} />);
    expect(screen.queryByText("Diagnostics")).toBeNull();
    fireEvent(screen.getByText("Notifications"), "longPress");
    expect(screen.getByText("Diagnostics")).toBeTruthy();
    fireEvent.press(screen.getAllByText("Enable").at(-1)!);
    expect(onDiagnosticsEnabledChange).toHaveBeenCalledWith(true);
  });

  it("offers coarse availability controls with privacy copy", () => {
    const onAvailabilityChange = jest.fn();
    render(<SettingsScreen {...pairedProps} availability="available" onAvailabilityChange={onAvailabilityChange} />);
    expect(screen.getByText("Availability")).toBeTruthy();
    expect(screen.getByText(/coarse last-seen/)).toBeTruthy();
    fireEvent.press(screen.getByText("Off-call"));
    expect(onAvailabilityChange).toHaveBeenCalledWith("off-call");
  });

  it("lets paired users save an E2EE decryption key", () => {
    const setE2eeKey = jest.fn();
    render(<SettingsScreen {...pairedProps} e2eeKey="" setE2eeKey={setE2eeKey} />);
    expect(screen.getByText("End-to-end encryption")).toBeTruthy();
    fireEvent.changeText(screen.getByPlaceholderText("key or passphrase"), " key_123 ");
    expect(setE2eeKey).toHaveBeenCalledWith("key_123");
  });

  it("opens the account switcher and switches saved accounts", () => {
    const onSavedAccountSelect = jest.fn();
    const account = {
      id: "local:https://tick.example.com:dev_1",
      serverURL: "https://tick.example.com",
      authProvider: "local",
      label: "Example device",
      deviceID: "dev_1",
      updatedAt: "2026-05-10T00:00:00.000Z",
    };
    render(<SettingsScreen {...pairedProps} accounts={[account]} serverURL="https://tick.example.com" onSavedAccountSelect={onSavedAccountSelect} />);
    expect(screen.getByText("Current account")).toBeTruthy();
    expect(screen.queryByText("Saved accounts")).toBeNull();
    fireEvent.press(screen.getByText("Switch accounts ›"));
    expect(screen.getByText("Saved accounts")).toBeTruthy();
    expect(screen.getByText("Example device")).toBeTruthy();
    fireEvent.press(screen.getByText("Example device"));
    expect(onSavedAccountSelect).toHaveBeenCalledWith(account);
  });

  it("shows the Clerk account summary and lets users add another account from the switcher", () => {
    const onSignInAnotherClerkAccount = jest.fn();
    render(
      <SettingsScreen
        {...unpairedProps}
        authProvider="clerk"
        currentAccountProfile={{ name: "Ada Lovelace", email: "ada@example.com", signInMethod: "GitHub", authProvider: "clerk", source: "human" }}
        onSignInAnotherClerkAccount={onSignInAnotherClerkAccount}
      />,
    );

    expect(screen.getByText("GitHub account")).toBeTruthy();
    expect(screen.getByText(/ada@example.com/)).toBeTruthy();
    expect(screen.getByText(/Sign-in method: GitHub/)).toBeTruthy();
    expect(screen.queryByText(/org_/)).toBeNull();
    fireEvent.press(screen.getByText("Switch accounts ›"));
    fireEvent.press(screen.getByText("Add another account"));
    expect(onSignInAnotherClerkAccount).toHaveBeenCalled();
  });

  it("shows Clerk organization choices without device pairing", () => {
    const onSelectOrganization = jest.fn();
    render(
      <SettingsScreen
        {...unpairedProps}
        authProvider="clerk"
        organizations={[{ organizationId: "org_1", name: "Platform", role: "owner" }]}
        selectedOrganizationID="org_1"
        setSelectedOrganizationID={onSelectOrganization}
      />,
    );
    expect(screen.getByText("Account")).toBeTruthy();
    expect(screen.queryByText(/org_1/)).toBeNull();
    expect(screen.getByText("Platform")).toBeTruthy();
    fireEvent.press(screen.getByText("Platform"));
    expect(onSelectOrganization).toHaveBeenCalledWith("org_1");
  });
});
