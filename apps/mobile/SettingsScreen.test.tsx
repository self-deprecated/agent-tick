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
  onNotificationsEnabledChange: jest.fn(),
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

function personalBillingFixture(options: { lifetimeActive?: boolean; hostedActive?: boolean; originPlatform?: string; purchaseReason?: string } = {}) {
  const now = "2026-05-10T00:00:00.000Z";
  return {
    entitlement: {
      userId: "usr_1",
      trialStartedAt: "2026-05-01T00:00:00.000Z",
      ...(options.lifetimeActive ? { appUnlockedAt: now } : {}),
      createdAt: "2026-05-01T00:00:00.000Z",
      updatedAt: now,
    },
    hostedPersonal: {
      lifecycle: options.hostedActive ? "active" : "expired",
      trialEndsAt: "2026-05-08T00:00:00.000Z",
      responsesEnabled: Boolean(options.hostedActive),
      routingEnabled: Boolean(options.hostedActive),
      pushEnabled: Boolean(options.hostedActive),
      historyRetentionDays: options.hostedActive ? 30 : 0,
    },
    products: [],
    activeEntitlements: {
      lifetimeUnlock: { active: Boolean(options.lifetimeActive), ...(options.lifetimeActive ? { originProvider: "revenuecat", originPlatform: "ios", purchasedAt: now } : {}) },
      hostedPersonal: { active: Boolean(options.hostedActive), ...(options.hostedActive ? { originProvider: "revenuecat", originPlatform: options.originPlatform ?? "ios", purchasedAt: now, expiresAt: "2026-06-10T00:00:00.000Z", willRenew: false } : {}) },
    },
    purchaseAvailability: {
      lifetime_unlock: { allowed: !options.lifetimeActive, ...(options.lifetimeActive ? { reason: "already_unlocked" } : {}) },
      hosted_personal_monthly: { allowed: !options.hostedActive, ...(options.purchaseReason ? { reason: options.purchaseReason, originPlatform: options.originPlatform } : {}) },
      hosted_personal_yearly: { allowed: !options.hostedActive, ...(options.purchaseReason ? { reason: options.purchaseReason, originPlatform: options.originPlatform } : {}) },
    },
  };
}

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

  it("hides the server URL input after pairing", () => {
    render(<SettingsScreen {...pairedProps} />);
    expect(screen.queryByPlaceholderText("https://tick.example.com")).toBeNull();
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

  it("disables push registration when push is already registered", () => {
    const onRegisterPush = jest.fn();
    render(<SettingsScreen {...pairedProps} onRegisterPush={onRegisterPush} pushStatus="registered" />);
    expect(screen.getByText("Push Registered")).toBeTruthy();
    expect(screen.queryByText("Register Push")).toBeNull();
    fireEvent.press(screen.getByText("Push Registered"));
    expect(onRegisterPush).not.toHaveBeenCalled();
  });

  it("lets users turn app notifications off and disables notification actions", () => {
    const onNotificationsEnabledChange = jest.fn();
    const onRequestNotifications = jest.fn();
    const onSendTestNotification = jest.fn();
    const onRegisterPush = jest.fn();
    render(
      <SettingsScreen
        {...pairedProps}
        notificationStatus="granted"
        notificationsEnabled={false}
        onNotificationsEnabledChange={onNotificationsEnabledChange}
        onRequestNotifications={onRequestNotifications}
        onSendTestNotification={onSendTestNotification}
        onRegisterPush={onRegisterPush}
      />,
    );

    expect(screen.getByText("Off in Agent Tick")).toBeTruthy();
    fireEvent.press(screen.getByText("Turn On"));
    expect(onNotificationsEnabledChange).toHaveBeenCalledWith(true);
    fireEvent.press(screen.getByText("Enable"));
    fireEvent.press(screen.getByText("Test"));
    fireEvent.press(screen.getByText("Register Push"));
    expect(onRequestNotifications).not.toHaveBeenCalled();
    expect(onSendTestNotification).not.toHaveBeenCalled();
    expect(onRegisterPush).not.toHaveBeenCalled();
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

  it("shows clear entitlement status and paywall messaging", () => {
    render(
      <SettingsScreen
        {...pairedProps}
        nativeAppEntitlement={{
          trialActive: false,
          lifetimeUnlocked: false,
          readOnly: true,
          hostedSubscriptionActive: false,
          includedHostedActive: false,
          trialRemainingMs: 0,
        }}
        trialRemainingLabel="Trial ended"
      />,
    );
    expect(screen.getByText("Entitlement status")).toBeTruthy();
    expect(screen.getByText("Read-only after Trial")).toBeTruthy();
    expect(screen.getByText("Responses are disabled until Lifetime app unlock is purchased or restored.")).toBeTruthy();
    expect(screen.getByText("Buy Lifetime app unlock to respond again and use self-hosted Agent Tick forever.")).toBeTruthy();
  });

  it("disables hosted subscription buttons when active on another app-store platform", () => {
    const onSubscribeHostedPersonal = jest.fn();
    render(
      <SettingsScreen
        {...pairedProps}
        nativeAppEntitlement={{
          trialActive: false,
          lifetimeUnlocked: true,
          readOnly: false,
          hostedSubscriptionActive: true,
          includedHostedActive: false,
          trialRemainingMs: 0,
        }}
        personalBillingStatus={personalBillingFixture({
          hostedActive: true,
          originPlatform: "ios",
          purchaseReason: "active_on_other_platform",
        })}
        hostedPersonalActive
        onSubscribeHostedPersonal={onSubscribeHostedPersonal}
      />,
    );

    expect(screen.getByText("Active via Apple. Manage on iOS or the App Store.")).toBeTruthy();
    fireEvent.press(screen.getByText("$5/month"));
    fireEvent.press(screen.getByText("$50/year"));
    expect(onSubscribeHostedPersonal).not.toHaveBeenCalled();
  });

  it("hides the lifetime purchase action after unlock", () => {
    render(
      <SettingsScreen
        {...pairedProps}
        nativeAppEntitlement={{
          trialActive: false,
          lifetimeUnlocked: true,
          readOnly: false,
          hostedSubscriptionActive: false,
          includedHostedActive: false,
          trialRemainingMs: 0,
        }}
        personalBillingStatus={personalBillingFixture({ lifetimeActive: true })}
      />,
    );

    expect(screen.getByText("Purchased")).toBeTruthy();
    expect(screen.queryByText("Buy lifetime unlock")).toBeNull();
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
      id: "local:https://tick.example.com:dev_2",
      serverURL: "https://tick.example.com",
      authProvider: "local",
      label: "Example device",
      deviceID: "dev_2",
      updatedAt: "2026-05-10T00:00:00.000Z",
    };
    render(<SettingsScreen {...pairedProps} accounts={[account]} serverURL="https://tick.example.com" onSavedAccountSelect={onSavedAccountSelect} />);
    expect(screen.getByText("Current account")).toBeTruthy();
    expect(screen.queryByText("Accounts")).toBeNull();
    fireEvent.press(screen.getByText("Switch accounts ›"));
    expect(screen.getByText("Accounts")).toBeTruthy();
    expect(screen.queryByText("Saved accounts")).toBeNull();
    expect(screen.getByText("Example device")).toBeTruthy();
    fireEvent.press(screen.getByText("Example device"));
    expect(onSavedAccountSelect).toHaveBeenCalledWith(account);
  });

  it("signs out saved accounts without selecting them", () => {
    const onSavedAccountRemove = jest.fn();
    const account = {
      id: "clerk:https://agenttick.sh:usr_2",
      serverURL: "https://agenttick.sh",
      authProvider: "clerk",
      label: "Apple account",
      userID: "usr_2",
      email: "ada@icloud.com",
      signInMethod: "Apple",
      updatedAt: "2026-05-10T00:00:00.000Z",
    };
    render(
      <SettingsScreen
        {...unpairedProps}
        accounts={[account]}
        authProvider="clerk"
        currentAccountProfile={{ userId: "usr_1", email: "ada@example.com", signInMethod: "GitHub", authProvider: "clerk", source: "human" }}
        onSavedAccountRemove={onSavedAccountRemove}
      />,
    );

    fireEvent.press(screen.getByText("Switch accounts ›"));
    fireEvent.press(screen.getAllByText("Sign Out").at(-1)!);
    expect(onSavedAccountRemove).toHaveBeenCalledWith(account);
  });

  it("signs out the current account from the account switcher", () => {
    const onForgetDevice = jest.fn();
    render(<SettingsScreen {...pairedProps} onForgetDevice={onForgetDevice} />);

    fireEvent.press(screen.getByText("Switch accounts ›"));
    fireEvent.press(screen.getByText("Sign Out"));
    expect(onForgetDevice).toHaveBeenCalled();
  });

  it("shows the Clerk account summary and lets users add another account from the switcher", () => {
    const onSignInAnotherClerkAccount = jest.fn();
    render(
      <SettingsScreen
        {...unpairedProps}
        authProvider="clerk"
        currentAccountProfile={{ userId: "usr_1", name: "Ada Lovelace", email: "ada@example.com", signInMethod: "GitHub", authProvider: "clerk", source: "human" }}
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
