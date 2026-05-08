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
  onRequestNotifications: jest.fn(),
  onSendTestNotification: jest.fn(),
  onScanPairing: jest.fn(),
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
    expect(screen.getByPlaceholderText("http://192.168.1.20:8787")).toBeTruthy();
  });

  it("shows Check Connection button", () => {
    render(<SettingsScreen {...unpairedProps} />);
    expect(screen.getByText("Check Connection")).toBeTruthy();
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
  it("shows Paired as <deviceID>", () => {
    render(<SettingsScreen {...pairedProps} />);
    expect(screen.getByText("Paired as device-abc-123")).toBeTruthy();
  });

  it("shows Forget Device button", () => {
    render(<SettingsScreen {...pairedProps} />);
    expect(screen.getByText("Forget Device")).toBeTruthy();
  });

  it("keeps server URL input available for server switching", () => {
    render(<SettingsScreen {...pairedProps} />);
    expect(screen.getByPlaceholderText("http://192.168.1.20:8787")).toBeTruthy();
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

  it("offers coarse availability controls with privacy copy", () => {
    const onAvailabilityChange = jest.fn();
    render(<SettingsScreen {...pairedProps} availability="available" onAvailabilityChange={onAvailabilityChange} />);
    expect(screen.getByText("Availability")).toBeTruthy();
    expect(screen.getByText(/coarse last-seen/)).toBeTruthy();
    fireEvent.press(screen.getByText("Off-call"));
    expect(onAvailabilityChange).toHaveBeenCalledWith("off-call");
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
    expect(screen.getByText("Signed in with Clerk")).toBeTruthy();
    expect(screen.getByText("Platform")).toBeTruthy();
    fireEvent.press(screen.getByText("Platform"));
    expect(onSelectOrganization).toHaveBeenCalledWith("org_1");
  });
});
