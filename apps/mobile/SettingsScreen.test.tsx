import React from "react";
import { render, screen, fireEvent } from "@testing-library/react-native";
import { StyleSheet } from "react-native";
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

function personalBillingFixture(options: { lifetimeActive?: boolean; hostedActive?: boolean; trialActive?: boolean; includedHostedActivated?: boolean; includedHostedActive?: boolean; originPlatform?: string; purchaseReason?: string } = {}) {
  const now = "2026-05-10T00:00:00.000Z";
  const trialStartedAt = options.trialActive ? "2099-05-04T00:00:00.000Z" : "2026-05-01T00:00:00.000Z";
  const includedHostedActivatedAt = options.includedHostedActive ? "2026-05-01T00:00:00.000Z" : options.includedHostedActivated ? "2026-04-01T00:00:00.000Z" : undefined;
  const hostedLifecycleActive = Boolean(options.hostedActive || options.trialActive || options.includedHostedActive);
  return {
    entitlement: {
      userId: "usr_1",
      trialStartedAt,
      ...(options.lifetimeActive ? { appUnlockedAt: now } : {}),
      ...(includedHostedActivatedAt ? { includedHostedActivatedAt } : {}),
      createdAt: "2026-05-01T00:00:00.000Z",
      updatedAt: now,
    },
    hostedPersonal: {
      lifecycle: hostedLifecycleActive ? "active" : "expired",
      trialEndsAt: options.trialActive ? "2099-05-11T00:00:00.000Z" : "2026-05-08T00:00:00.000Z",
      ...(options.includedHostedActive ? { includedHostedEndsAt: "2026-06-01T00:00:00.000Z" } : {}),
      responsesEnabled: hostedLifecycleActive,
      routingEnabled: hostedLifecycleActive,
      pushEnabled: hostedLifecycleActive,
      historyRetentionDays: hostedLifecycleActive ? 30 : 0,
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

  it("shows server URL input from manual self-hosted setup", () => {
    render(<SettingsScreen {...unpairedProps} />);
    fireEvent.press(screen.getByText("Manual self-hosted setup"));
    expect(screen.getByPlaceholderText("https://tick.example.com")).toBeTruthy();
  });

  it("shows Check Connection from manual self-hosted setup", () => {
    render(<SettingsScreen {...unpairedProps} />);
    fireEvent.press(screen.getByText("Manual self-hosted setup"));
    expect(screen.getByText("Check Connection")).toBeTruthy();
  });

  it("offers hosted service as a clear account choice", () => {
    render(<SettingsScreen {...unpairedProps} />);
    expect(screen.getByText("Agent Tick Hosted")).toBeTruthy();
    expect(screen.getByText("Sign in to agenttick.sh")).toBeTruthy();
  });

  it("hides manual pairing code input by default (collapsed Advanced)", () => {
    render(<SettingsScreen {...unpairedProps} />);
    expect(screen.queryByPlaceholderText("pair_...")).toBeNull();
  });

  it("hides manual bearer token input by default (collapsed Advanced)", () => {
    render(<SettingsScreen {...unpairedProps} />);
    expect(screen.queryByPlaceholderText("test-token")).toBeNull();
  });

  it("shows Advanced toggle inside manual self-hosted setup", () => {
    render(<SettingsScreen {...unpairedProps} />);
    fireEvent.press(screen.getByText("Manual self-hosted setup"));
    expect(screen.getByText("Advanced")).toBeTruthy();
  });

  it("reveals manual pairing code input when Advanced is expanded", () => {
    render(<SettingsScreen {...unpairedProps} />);
    fireEvent.press(screen.getByText("Manual self-hosted setup"));
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

  it("shows Forget Device button in Account settings", () => {
    render(<SettingsScreen {...pairedProps} />);
    fireEvent.press(screen.getByText("Manage account ›"));
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

  it("keeps Check Connection available in Account settings", () => {
    render(<SettingsScreen {...pairedProps} />);
    fireEvent.press(screen.getByText("Manage account ›"));
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
    fireEvent.press(screen.getByText("Notifications"));
    expect(screen.getByText("Enable approval alerts")).toBeTruthy();
    expect(screen.getByText(/urgent approval requests/)).toBeTruthy();
    fireEvent.press(screen.getByText("Enable Notifications"));
    expect(onRequestNotifications).toHaveBeenCalled();
  });

  it("does not show the notification reminder after notifications are enabled", () => {
    render(<SettingsScreen {...pairedProps} notificationStatus="granted" />);
    fireEvent.press(screen.getByText("Notifications"));
    expect(screen.queryByText("Enable approval alerts")).toBeNull();
  });

  it("disables push registration when push is already registered", () => {
    const onRegisterPush = jest.fn();
    render(<SettingsScreen {...pairedProps} onRegisterPush={onRegisterPush} pushStatus="registered" />);
    fireEvent.press(screen.getByText("Notifications"));
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

    fireEvent.press(screen.getByText("Notifications"));
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

  it("opens General settings for language", () => {
    render(<SettingsScreen {...pairedProps} />);
    fireEvent.press(screen.getByText("General"));
    expect(screen.getByText("Language")).toBeTruthy();
    expect(screen.getByText(/System/)).toBeTruthy();
  });

  it("reveals hidden debug controls by long-pressing General", () => {
    const onDiagnosticsEnabledChange = jest.fn();
    const onShowHostedExpiryWarning = jest.fn();
    const onShowNativePaywall = jest.fn();
    render(
      <SettingsScreen
        {...pairedProps}
        onDiagnosticsEnabledChange={onDiagnosticsEnabledChange}
        onShowHostedExpiryWarning={onShowHostedExpiryWarning}
        onShowNativePaywall={onShowNativePaywall}
      />,
    );
    expect(screen.queryByText("Debug")).toBeNull();
    fireEvent(screen.getByText("General"), "longPress");
    expect(screen.getByText("Language")).toBeTruthy();
    expect(screen.getByText("Debug")).toBeTruthy();
    fireEvent.press(screen.getByText("Show native paywall"));
    fireEvent.press(screen.getByText("Show hosted expiry warning"));
    fireEvent.press(screen.getAllByText("Enable").at(-1)!);
    expect(onShowNativePaywall).toHaveBeenCalledTimes(1);
    expect(onShowHostedExpiryWarning).toHaveBeenCalledTimes(1);
    expect(onDiagnosticsEnabledChange).toHaveBeenCalledWith(true);
  });

  it("keeps debug controls hidden after restart even when diagnostic logging is enabled", () => {
    render(<SettingsScreen {...pairedProps} diagnosticsEnabled />);
    fireEvent.press(screen.getByText("General"));
    expect(screen.getByText("Language")).toBeTruthy();
    expect(screen.queryByText("Debug")).toBeNull();
  });

  it("shows clear app access and paywall messaging", () => {
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
    fireEvent.press(screen.getByText("App access"));
    expect(screen.getByText("App access")).toBeTruthy();
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

    fireEvent.press(screen.getByText("App access"));
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

    fireEvent.press(screen.getByText("App access"));
    expect(screen.getByText("Purchased")).toBeTruthy();
    expect(screen.queryByText("Buy lifetime unlock")).toBeNull();
  });

  it("offers the included hosted month after lifetime unlock and trial end", () => {
    const onActivateIncludedHostedMonth = jest.fn();
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
        onActivateIncludedHostedMonth={onActivateIncludedHostedMonth}
      />,
    );

    fireEvent.press(screen.getByText("App access"));
    expect(screen.getByText("Start included hosted month")).toBeTruthy();
    expect(screen.getByText("$5/month")).toBeTruthy();
    expect(screen.getByText("$50/year")).toBeTruthy();
    fireEvent.press(screen.getByText("Start included hosted month"));
    expect(onActivateIncludedHostedMonth).toHaveBeenCalledTimes(1);
  });

  it("waits until Trial ends before activating the included hosted month", () => {
    render(
      <SettingsScreen
        {...pairedProps}
        nativeAppEntitlement={{
          trialActive: true,
          lifetimeUnlocked: true,
          readOnly: false,
          hostedSubscriptionActive: false,
          includedHostedActive: false,
          trialRemainingMs: 1000,
        }}
        personalBillingStatus={personalBillingFixture({ lifetimeActive: true })}
      />,
    );

    fireEvent.press(screen.getByText("App access"));
    expect(screen.getByText("The included hosted month waits until Trial ends, then you can activate it before subscribing.")).toBeTruthy();
    expect(screen.getByText("$5/month")).toBeTruthy();
    expect(screen.getByText("$50/year")).toBeTruthy();
    expect(screen.queryByText("Start included hosted month")).toBeNull();
  });

  it("shows the current hosted usage expiry date", () => {
    render(
      <SettingsScreen
        {...pairedProps}
        nativeAppEntitlement={{
          trialActive: true,
          lifetimeUnlocked: false,
          readOnly: false,
          hostedSubscriptionActive: false,
          includedHostedActive: false,
          trialRemainingMs: 1000,
        }}
        personalBillingStatus={personalBillingFixture({ trialActive: true })}
      />,
    );

    fireEvent.press(screen.getByText("App access"));
    expect(screen.getByText("Hosted Trial ends on May 11, 2099.")).toBeTruthy();
  });

  it("shows hosted subscription buttons after the included month has been used", () => {
    const onSubscribeHostedPersonal = jest.fn();
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
        personalBillingStatus={personalBillingFixture({ lifetimeActive: true, includedHostedActivated: true })}
        onSubscribeHostedPersonal={onSubscribeHostedPersonal}
      />,
    );

    fireEvent.press(screen.getByText("App access"));
    fireEvent.press(screen.getByText("$5/month"));
    fireEvent.press(screen.getByText("$50/year"));
    expect(onSubscribeHostedPersonal).toHaveBeenCalledWith("monthly");
    expect(onSubscribeHostedPersonal).toHaveBeenCalledWith("yearly");
  });

  it("keeps availability controls hidden while the feature is turned off", () => {
    const onAvailabilityChange = jest.fn();
    render(<SettingsScreen {...pairedProps} availability="available" onAvailabilityChange={onAvailabilityChange} />);
    expect(screen.queryByText("Availability")).toBeNull();
    fireEvent.press(screen.getByText("Manage account ›"));
    expect(screen.queryByText("Availability")).toBeNull();
    expect(screen.queryByText("Off-call")).toBeNull();
    expect(onAvailabilityChange).not.toHaveBeenCalled();
  });

  it("makes sub-settings back buttons full-width press targets", () => {
    render(<SettingsScreen {...pairedProps} />);
    fireEvent.press(screen.getByText("Security"));
    const backButtonStyle = StyleSheet.flatten(screen.getByLabelText("‹ Settings").props.style);
    expect(backButtonStyle.alignSelf).toBe("stretch");
  });

  it("lets paired users save an E2EE decryption key", () => {
    const setE2eeKey = jest.fn();
    render(<SettingsScreen {...pairedProps} e2eeKey="" setE2eeKey={setE2eeKey} />);
    fireEvent.press(screen.getByText("Security"));
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
    fireEvent.press(screen.getByText("Manage account ›"));
    fireEvent.press(screen.getByText("Switch accounts"));
    expect(screen.getByText("Accounts")).toBeTruthy();
    expect(screen.queryByText("Saved accounts")).toBeNull();
    expect(screen.getByText("Example device")).toBeTruthy();
    fireEvent.press(screen.getByText("Example device"));
    expect(onSavedAccountSelect).toHaveBeenCalledWith(account);
  });

  it("signs out saved accounts without selecting them", () => {
    const onSavedAccountRemove = jest.fn();
    const account = {
      id: "clerk:https://app.agenttick.sh:usr_2",
      serverURL: "https://app.agenttick.sh",
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

    fireEvent.press(screen.getByText("Manage account ›"));
    fireEvent.press(screen.getByText("Switch accounts"));
    fireEvent.press(screen.getAllByText("Sign Out").at(-1)!);
    expect(onSavedAccountRemove).toHaveBeenCalledWith(account);
  });

  it("signs out the current account from the account switcher", () => {
    const onForgetDevice = jest.fn();
    render(<SettingsScreen {...pairedProps} onForgetDevice={onForgetDevice} />);

    fireEvent.press(screen.getByText("Manage account ›"));
    fireEvent.press(screen.getByText("Switch accounts"));
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
    fireEvent.press(screen.getByText("Manage account ›"));
    fireEvent.press(screen.getByText("Switch accounts"));
    fireEvent.press(screen.getByText("Add another account"));
    expect(onSignInAnotherClerkAccount).toHaveBeenCalled();
  });

  it("hides workspace choices when a Clerk account has only one organization", () => {
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
    expect(screen.queryByText("Platform")).toBeNull();
  });

  it("shows Clerk workspace choices only when there are multiple organizations", () => {
    const onSelectOrganization = jest.fn();
    render(
      <SettingsScreen
        {...unpairedProps}
        authProvider="clerk"
        organizations={[
          { organizationId: "org_1", name: "Platform", role: "owner" },
          { organizationId: "org_2", name: "Research", role: "member" },
        ]}
        selectedOrganizationID="org_1"
        setSelectedOrganizationID={onSelectOrganization}
      />,
    );
    fireEvent.press(screen.getByText("Manage account ›"));
    expect(screen.getByText("Workspace")).toBeTruthy();
    expect(screen.queryByText(/org_1/)).toBeNull();
    expect(screen.getByText("Platform")).toBeTruthy();
    fireEvent.press(screen.getByText("Research"));
    expect(onSelectOrganization).toHaveBeenCalledWith("org_2");
  });
});
