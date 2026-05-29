import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react-native";
import { Alert, Linking, Platform, StyleSheet } from "react-native";
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

beforeEach(() => {
  jest.restoreAllMocks();
});

function personalBillingFixture(options: { lifetimeActive?: boolean; hostedActive?: boolean; trialActive?: boolean; originPlatform?: string; purchaseReason?: string } = {}) {
  const now = "2026-05-10T00:00:00.000Z";
  const trialStartedAt = options.trialActive ? "2099-05-04T00:00:00.000Z" : "2026-05-01T00:00:00.000Z";
  const hostedLifecycleActive = Boolean(options.hostedActive || options.trialActive);
  return {
    entitlement: {
      userId: "usr_1",
      trialStartedAt,
      ...(options.lifetimeActive ? { appUnlockedAt: now } : {}),
      createdAt: "2026-05-01T00:00:00.000Z",
      updatedAt: now,
    },
    hostedPersonal: {
      lifecycle: hostedLifecycleActive ? "active" : "expired",
      trialEndsAt: options.trialActive ? "2099-05-11T00:00:00.000Z" : "2026-05-08T00:00:00.000Z",
      responsesEnabled: hostedLifecycleActive,
      routingEnabled: hostedLifecycleActive,
      pushEnabled: hostedLifecycleActive,
      historyRetentionDays: hostedLifecycleActive ? 30 : 0,
    },
    products: [],
    activeEntitlements: {
      trial7Day: { active: Boolean(options.trialActive), ...(options.trialActive ? { originProvider: "revenuecat", originPlatform: "ios", purchasedAt: trialStartedAt, expiresAt: "2099-05-11T00:00:00.000Z" } : {}) },
      lifetimeUnlock: { active: Boolean(options.lifetimeActive), ...(options.lifetimeActive ? { originProvider: "revenuecat", originPlatform: "ios", purchasedAt: now } : {}) },
      hostedPersonal: { active: Boolean(options.hostedActive), ...(options.hostedActive ? { originProvider: "revenuecat", originPlatform: options.originPlatform ?? "ios", purchasedAt: now, expiresAt: "2026-06-10T00:00:00.000Z", willRenew: false } : {}) },
    },
    purchaseAvailability: {
      trial_7_day: { allowed: !options.trialActive, ...(options.trialActive ? { reason: "trial_already_started" } : {}) },
      lifetime_unlock: { allowed: !options.lifetimeActive, ...(options.lifetimeActive ? { reason: "already_unlocked" } : {}) },
      hosted_personal_monthly: { allowed: !options.hostedActive, ...(options.purchaseReason ? { reason: options.purchaseReason, originPlatform: options.originPlatform } : {}) },
      hosted_personal_yearly: { allowed: !options.hostedActive, ...(options.purchaseReason ? { reason: options.purchaseReason, originPlatform: options.originPlatform } : {}) },
    },
    billingConflicts: [],
  };
}

describe("SettingsScreen — unpaired state", () => {
  it("shows Scan Pairing QR button prominently at the top", () => {
    render(<SettingsScreen {...unpairedProps} />);
    expect(screen.getByText("Scan Pairing QR")).toBeTruthy();
  });

  it("does not point users at a removed CLI pairing command", () => {
    render(<SettingsScreen {...unpairedProps} />);
    fireEvent.press(screen.getByText("Manual self-hosted setup"));
    expect(screen.getByText("Scan a pairing QR from your self-hosted Agent Tick server, or open Advanced to enter a pairing code manually.")).toBeTruthy();
    expect(screen.queryByText("agent-tick pair")).toBeNull();
  });

  it("shows server URL input from manual self-hosted setup", () => {
    render(<SettingsScreen {...unpairedProps} />);
    fireEvent.press(screen.getByText("Manual self-hosted setup"));
    expect(screen.getByPlaceholderText("https://tick.example.com")).toBeTruthy();
  });

  it("shows the self-hosted privacy boundary in manual setup", () => {
    render(<SettingsScreen {...unpairedProps} />);
    fireEvent.press(screen.getByText("Manual self-hosted setup"));
    expect(screen.getByText(/Self-hosted server data is controlled/)).toBeTruthy();
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
  it("shows a connection inbox summary instead of a current device", () => {
    render(<SettingsScreen {...pairedProps} />);
    expect(screen.getByText("Connections")).toBeTruthy();
    expect(screen.getByText("0 connections")).toBeTruthy();
    expect(screen.queryByText("Device device-abc-123")).toBeNull();
  });

  it("shows Forget Device button in Account settings", () => {
    render(<SettingsScreen {...pairedProps} />);
    fireEvent.press(screen.getByText("Manage connections ›"));
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
    fireEvent.press(screen.getByText("Manage connections ›"));
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

  it("does not expose Session Stack settings", () => {
    render(<SettingsScreen {...pairedProps} />);
    expect(screen.queryByText("Session Stack")).toBeNull();
  });

  it("reminds paired users to enable notifications", () => {
    const onRequestNotifications = jest.fn();
    render(<SettingsScreen {...pairedProps} onRequestNotifications={onRequestNotifications} notificationStatus="undetermined" />);
    fireEvent.press(screen.getByText("Notifications"));
    expect(screen.getByText("Enable Request alerts")).toBeTruthy();
    expect(screen.getByText(/urgent Requests/)).toBeTruthy();
    fireEvent.press(screen.getByText("Enable Notifications"));
    expect(onRequestNotifications).toHaveBeenCalled();
  });

  it("does not show the notification reminder after notifications are enabled", () => {
    render(<SettingsScreen {...pairedProps} notificationStatus="granted" />);
    fireEvent.press(screen.getByText("Notifications"));
    expect(screen.queryByText("Enable Request alerts")).toBeNull();
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

  it("opens canonical legal links from unauthenticated settings", async () => {
    const openURL = jest.spyOn(Linking, "openURL").mockResolvedValue(undefined);
    render(<SettingsScreen {...unpairedProps} />);

    fireEvent.press(screen.getByText("General"));
    expect(screen.getByText("Legal & support")).toBeTruthy();
    fireEvent.press(screen.getByText("Privacy Policy"));
    fireEvent.press(screen.getByText("Terms"));
    fireEvent.press(screen.getByText("Support"));

    await waitFor(() => {
      expect(openURL).toHaveBeenCalledWith("https://agenttick.sh/privacy");
      expect(openURL).toHaveBeenCalledWith("https://agenttick.sh/terms");
      expect(openURL).toHaveBeenCalledWith("https://agenttick.sh/support");
    });
  });

  it("shows a visible error when a legal link cannot open", async () => {
    jest.spyOn(Linking, "openURL").mockRejectedValue(new Error("blocked"));
    const alert = jest.spyOn(Alert, "alert").mockImplementation(() => undefined);
    render(<SettingsScreen {...pairedProps} />);

    fireEvent.press(screen.getByText("General"));
    fireEvent.press(screen.getByText("Support"));

    await waitFor(() => {
      expect(alert).toHaveBeenCalledWith("Could not open link", "Open this URL in your browser: https://agenttick.sh/support");
    });
  });

  it("opens Developer settings for debug controls", () => {
    const onDiagnosticsEnabledChange = jest.fn();
    const onResetLocalTestState = jest.fn();
    const onShowHostedExpiryWarning = jest.fn();
    const onShowNativePaywall = jest.fn();
    render(
      <SettingsScreen
        {...pairedProps}
        onDiagnosticsEnabledChange={onDiagnosticsEnabledChange}
        onResetLocalTestState={onResetLocalTestState}
        onShowHostedExpiryWarning={onShowHostedExpiryWarning}
        onShowNativePaywall={onShowNativePaywall}
      />,
    );
    fireEvent.press(screen.getByText("Developer"));
    expect(screen.getByText("Developer")).toBeTruthy();
    fireEvent.press(screen.getByText("Show native paywall"));
    fireEvent.press(screen.getByText("Show hosted expiry warning"));
    fireEvent.press(screen.getByText("Reset local test state"));
    fireEvent.press(screen.getByText("Diagnostic logs"));
    fireEvent.press(screen.getAllByText("Enable").at(-1)!);
    expect(onShowNativePaywall).toHaveBeenCalledTimes(1);
    expect(onShowHostedExpiryWarning).toHaveBeenCalledTimes(1);
    expect(onResetLocalTestState).toHaveBeenCalledTimes(1);
    expect(onDiagnosticsEnabledChange).toHaveBeenCalledWith(true);
  });

  it("returns to top-level settings when the home signal changes", () => {
    const { rerender } = render(<SettingsScreen {...pairedProps} settingsHomeSignal={0} />);

    fireEvent.press(screen.getByText("Developer"));
    expect(screen.getByText("Show native paywall")).toBeTruthy();

    rerender(<SettingsScreen {...pairedProps} settingsHomeSignal={1} />);
    expect(screen.getByText("Debug tools and diagnostics")).toBeTruthy();
    expect(screen.queryByText("Show native paywall")).toBeNull();
  });

  it("keeps developer diagnostic details collapsed until expanded", () => {
    render(
      <SettingsScreen
        {...pairedProps}
        diagnosticsEventCount={3}
        diagnosticsLastSentAt="2026-05-10T00:00:00.000Z"
        entitlementSourceDiagnostics={["Agent Tick: usr_1", "RevenueCat appUserID: rc_1"]}
        nativeAppEntitlement={{
          trialActive: false,
          trialPurchased: false,
          lifetimeUnlocked: false,
          readOnly: true,
          hostedSubscriptionActive: false,
          trialRemainingMs: 0,
        }}
      />,
    );

    fireEvent.press(screen.getByText("Developer"));
    expect(screen.getByText("Entitlement source")).toBeTruthy();
    expect(screen.getByText("Diagnostic logs")).toBeTruthy();
    expect(screen.queryByText("Agent Tick: usr_1")).toBeNull();
    expect(screen.queryByText(/last sent/)).toBeNull();

    fireEvent.press(screen.getByText("Entitlement source"));
    expect(screen.getByText("Agent Tick: usr_1")).toBeTruthy();

    fireEvent.press(screen.getByText("Diagnostic logs"));
    expect(screen.getByText(/last sent 2026-05-10T00:00:00.000Z/)).toBeTruthy();
  });

  it("shows clear app access and paywall messaging", () => {
    render(
      <SettingsScreen
        {...pairedProps}
        nativeAppEntitlement={{
          trialActive: false,
          trialPurchased: false,
          lifetimeUnlocked: false,
          readOnly: true,
          hostedSubscriptionActive: false,
          trialRemainingMs: 0,
        }}
        trialRemainingLabel="Trial ended"
      />,
    );
    fireEvent.press(screen.getByText("App access"));
    expect(screen.getByText("App access")).toBeTruthy();
    expect(screen.getByText("Read-only")).toBeTruthy();
    expect(screen.getByText("Responses require an active 7-day Trial, Hosted subscription, or Self-hosted Lifetime unlock.")).toBeTruthy();
    expect(screen.getByText("Unlock responses to answer Requests again.")).toBeTruthy();
  });

  it("allows self-hosted users to buy and restore Lifetime unlock without hosted billing status", () => {
    const onPurchaseLifetimeUnlock = jest.fn();
    const onRestorePurchases = jest.fn();
    render(
      <SettingsScreen
        {...pairedProps}
        nativeAppEntitlement={{
          trialActive: false,
          trialPurchased: false,
          lifetimeUnlocked: false,
          readOnly: true,
          hostedSubscriptionActive: false,
          trialRemainingMs: 0,
        }}
        personalBillingStatus={null}
        onPurchaseLifetimeUnlock={onPurchaseLifetimeUnlock}
        onRestorePurchases={onRestorePurchases}
      />,
    );

    fireEvent.press(screen.getByText("App access"));
    fireEvent.press(screen.getByText("Buy Self-hosted Lifetime"));
    fireEvent.press(screen.getByText("Restore purchases"));

    expect(onPurchaseLifetimeUnlock).toHaveBeenCalledTimes(1);
    expect(onRestorePurchases).toHaveBeenCalledTimes(1);
    expect(screen.getByText("You can subscribe now with your app-store account. Sign in later to link hosted routing, push, history, and billing."));
    expect(screen.queryByText("Sign in to hosted Agent Tick before subscribing. Hosted service needs an account for routing, push, history, and billing.")).toBeNull();
    expect(screen.queryByText("Sign in or connect to Agent Tick to load server purchase status before buying.")).toBeNull();
  });

  it("distinguishes local Self-hosted Lifetime from a fresh hosted account", () => {
    render(
      <SettingsScreen
        {...pairedProps}
        nativeAppEntitlement={{
          trialActive: false,
          trialPurchased: true,
          lifetimeUnlocked: true,
          readOnly: false,
          hostedSubscriptionActive: false,
          trialRemainingMs: 0,
        }}
        personalBillingStatus={personalBillingFixture({ lifetimeActive: false, hostedActive: false })}
      />,
    );

    fireEvent.press(screen.getByText("App access"));
    expect(screen.getByText("Self-hosted Lifetime is active on this App Store account.")).toBeTruthy();
    expect(screen.getByText("Active on this App Store account, independent of your hosted Agent Tick account.")).toBeTruthy();
    expect(screen.getByText("Deleting or recreating a hosted account does not remove Self-hosted Lifetime from the same App Store account.")).toBeTruthy();
    expect(screen.getByText("Hosted account: fresh. No Hosted subscription is linked to this Agent Tick account.")).toBeTruthy();
  });

  it("allows hosted subscriptions without hosted billing status", () => {
    const onSubscribeHostedPersonal = jest.fn();
    render(
      <SettingsScreen
        {...pairedProps}
        nativeAppEntitlement={{
          trialActive: false,
          trialPurchased: false,
          lifetimeUnlocked: false,
          readOnly: true,
          hostedSubscriptionActive: false,
          trialRemainingMs: 0,
        }}
        personalBillingStatus={null}
        onSubscribeHostedPersonal={onSubscribeHostedPersonal}
      />,
    );

    fireEvent.press(screen.getByText("App access"));
    expect(screen.getByText("You can subscribe now with your app-store account. Sign in later to link hosted routing, push, history, and billing.")).toBeTruthy();
    fireEvent.press(screen.getByText("Monthly"));
    fireEvent.press(screen.getByText("Yearly"));
    expect(onSubscribeHostedPersonal).toHaveBeenCalledWith("monthly");
    expect(onSubscribeHostedPersonal).toHaveBeenCalledWith("yearly");
  });

  it("explains local hosted subscriptions that are not linked to a hosted account yet", () => {
    render(
      <SettingsScreen
        {...pairedProps}
        nativeAppEntitlement={{
          trialActive: false,
          trialPurchased: false,
          lifetimeUnlocked: false,
          readOnly: false,
          hostedSubscriptionActive: true,
          trialRemainingMs: 0,
        }}
        hostedPersonalActive
        personalBillingStatus={null}
      />,
    );

    fireEvent.press(screen.getByText("App access"));
    expect(screen.getByText("Optional: buy Self-hosted Lifetime only if you want self-hosted responses after your hosted subscription ends.")).toBeTruthy();
    expect(screen.getByText("Hosted service is active. Hosted subscriptions also unlock self-hosted responses while active.")).toBeTruthy();
    expect(screen.getByText("Hosted subscription is active for this app-store account. Sign in to hosted Agent Tick to link routing, push, history, and billing.")).toBeTruthy();
  });

  it("exposes explicit hosted purchase linking only when available", () => {
    const onLinkPurchasesToHostedAccount = jest.fn();
    const nativeAppEntitlement = {
      trialActive: true,
      trialPurchased: true,
      lifetimeUnlocked: false,
      readOnly: false,
      hostedSubscriptionActive: false,
      trialRemainingMs: 1000,
    };
    const { rerender } = render(
      <SettingsScreen
        {...pairedProps}
        nativeAppEntitlement={nativeAppEntitlement}
        personalBillingStatus={personalBillingFixture({ lifetimeActive: false })}
        onLinkPurchasesToHostedAccount={onLinkPurchasesToHostedAccount}
      />,
    );

    fireEvent.press(screen.getByText("App access"));
    fireEvent.press(screen.getByText("Link purchases to hosted account"));
    expect(onLinkPurchasesToHostedAccount).toHaveBeenCalledTimes(1);

    rerender(
      <SettingsScreen
        {...pairedProps}
        nativeAppEntitlement={nativeAppEntitlement}
        personalBillingStatus={null}
        onLinkPurchasesToHostedAccount={onLinkPurchasesToHostedAccount}
      />,
    );
    fireEvent.press(screen.getByText("App access"));
    expect(screen.queryByText("Link purchases to hosted account")).toBeNull();

    rerender(
      <SettingsScreen
        {...pairedProps}
        nativeAppEntitlement={nativeAppEntitlement}
        personalBillingStatus={personalBillingFixture({ lifetimeActive: false })}
      />,
    );
    fireEvent.press(screen.getByText("App access"));
    expect(screen.queryByText("Link purchases to hosted account")).toBeNull();
  });

  it("keeps self-hosted setup reachable from expired Trial read-only state", () => {
    render(
      <SettingsScreen
        {...unpairedProps}
        nativeAppEntitlement={{
          trialActive: false,
          trialPurchased: false,
          lifetimeUnlocked: false,
          readOnly: true,
          hostedSubscriptionActive: false,
          trialRemainingMs: 0,
        }}
        personalBillingStatus={null}
      />,
    );

    fireEvent.press(screen.getByText("Manual self-hosted setup"));

    expect(screen.getByPlaceholderText("https://tick.example.com")).toBeTruthy();
    expect(screen.getByText("Scan Pairing QR")).toBeTruthy();
  });

  it("disables hosted subscription buttons when active on another app-store platform", () => {
    const onSubscribeHostedPersonal = jest.fn();
    render(
      <SettingsScreen
        {...pairedProps}
        nativeAppEntitlement={{
          trialActive: false,
          trialPurchased: false,
          lifetimeUnlocked: true,
          readOnly: false,
          hostedSubscriptionActive: true,
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
    expect(screen.queryByText("Monthly")).toBeNull();
    expect(screen.queryByText("Yearly")).toBeNull();
    expect(screen.getByText("Manage subscription")).toBeTruthy();
    expect(onSubscribeHostedPersonal).not.toHaveBeenCalled();
  });

  it("uses platform-neutral copy on iOS for hosted subscriptions bought on Android", () => {
    Object.defineProperty(Platform, "OS", { configurable: true, value: "ios" });

    render(
      <SettingsScreen
        {...pairedProps}
        nativeAppEntitlement={{
          trialActive: false,
          trialPurchased: false,
          lifetimeUnlocked: true,
          readOnly: false,
          hostedSubscriptionActive: true,
          trialRemainingMs: 0,
        }}
        personalBillingStatus={personalBillingFixture({
          hostedActive: true,
          originPlatform: "android",
          purchaseReason: "active_on_other_platform",
        })}
        hostedPersonalActive
      />,
    );

    fireEvent.press(screen.getByText("App access"));

    expect(screen.getByText("Hosted service is active on another platform. Manage it on the platform where it was purchased.")).toBeTruthy();
    expect(screen.queryByText("Active via Google. Manage on Android or Google Play.")).toBeNull();
  });

  it("hides the lifetime purchase action after unlock", () => {
    render(
      <SettingsScreen
        {...pairedProps}
        nativeAppEntitlement={{
          trialActive: false,
          trialPurchased: false,
          lifetimeUnlocked: true,
          readOnly: false,
          hostedSubscriptionActive: false,
          trialRemainingMs: 0,
        }}
        personalBillingStatus={personalBillingFixture({ lifetimeActive: true })}
      />,
    );

    fireEvent.press(screen.getByText("App access"));
    expect(screen.getByText("You own this app. Use it as much as you want with self-hosted Agent Tick servers.")).toBeTruthy();
    expect(screen.queryByText("Purchased")).toBeNull();
    expect(screen.queryByText("One-time purchase")).toBeNull();
    expect(screen.queryByText("Buy Self-hosted Lifetime")).toBeNull();
  });

  it("does not show remaining Trial copy once paid entitlements are active", () => {
    render(
      <SettingsScreen
        {...pairedProps}
        nativeAppEntitlement={{
          trialActive: true,
          trialPurchased: true,
          lifetimeUnlocked: true,
          readOnly: false,
          hostedSubscriptionActive: true,
          trialRemainingMs: 6 * 24 * 60 * 60 * 1000,
        }}
        personalBillingStatus={personalBillingFixture({ lifetimeActive: true, hostedActive: true, trialActive: true })}
        trialRemainingLabel="6 days left in trial"
      />,
    );

    fireEvent.press(screen.getByText("App access"));
    expect(screen.getByText("Hosted service active")).toBeTruthy();
    expect(screen.getByText("Your Hosted subscription and Self-hosted Lifetime unlock are active.")).toBeTruthy();
    expect(screen.queryByText("6 days left in trial")).toBeNull();
  });

  it("shows the current hosted usage expiry date", () => {
    render(
      <SettingsScreen
        {...pairedProps}
        nativeAppEntitlement={{
          trialActive: true,
          trialPurchased: true,
          lifetimeUnlocked: false,
          readOnly: false,
          hostedSubscriptionActive: false,
          trialRemainingMs: 1000,
        }}
        personalBillingStatus={personalBillingFixture({ trialActive: true })}
      />,
    );

    fireEvent.press(screen.getByText("App access"));
    expect(screen.getByText("Hosted Trial ends on May 11, 2099.")).toBeTruthy();
  });

  it("hides the new-user trial after any app access entitlement is active", () => {
    render(
      <SettingsScreen
        {...pairedProps}
        nativeAppEntitlement={{
          trialActive: false,
          trialPurchased: false,
          lifetimeUnlocked: true,
          readOnly: false,
          hostedSubscriptionActive: false,
          trialRemainingMs: 0,
        }}
        personalBillingStatus={personalBillingFixture({ lifetimeActive: true })}
      />,
    );

    fireEvent.press(screen.getByText("App access"));
    expect(screen.queryByText("7-day Trial")).toBeNull();
    expect(screen.getByText("Self-hosted Lifetime")).toBeTruthy();
  });

  it("shows Apple-compliant hosted subscription terms before purchase", async () => {
    const openURL = jest.spyOn(Linking, "openURL").mockResolvedValue(undefined);
    const onSubscribeHostedPersonal = jest.fn();
    render(
      <SettingsScreen
        {...pairedProps}
        nativeAppEntitlement={{
          trialActive: false,
          trialPurchased: false,
          lifetimeUnlocked: true,
          readOnly: false,
          hostedSubscriptionActive: false,
          trialRemainingMs: 0,
        }}
        personalBillingStatus={personalBillingFixture({ lifetimeActive: true })}
        storeProducts={[
          { productKey: "hosted_personal_monthly", productId: "monthly", title: "Hosted personal monthly", priceString: "$4.99/month" },
          { productKey: "hosted_personal_yearly", productId: "yearly", title: "Hosted personal yearly", priceString: "$49.99/year" },
        ]}
        onSubscribeHostedPersonal={onSubscribeHostedPersonal}
      />,
    );

    fireEvent.press(screen.getByText("App access"));
    expect(screen.getByText("Hosted personal service")).toBeTruthy();
    expect(screen.getByText("Includes hosted personal routing, push notifications, updates, uptime, and responses for your Agent Tick account.")).toBeTruthy();
    expect(screen.getByText("Monthly: $4.99/month. Yearly: $49.99/year.")).toBeTruthy();
    expect(screen.getByText("Subscriptions auto-renew until canceled. Manage or cancel in your App Store account settings.")).toBeTruthy();
    fireEvent.press(screen.getByText("Terms"));
    fireEvent.press(screen.getByText("Privacy Policy"));
    fireEvent.press(screen.getByText("$4.99/month"));
    fireEvent.press(screen.getByText("$49.99/year"));

    await waitFor(() => {
      expect(openURL).toHaveBeenCalledWith("https://agenttick.sh/terms");
      expect(openURL).toHaveBeenCalledWith("https://agenttick.sh/privacy");
    });
    expect(onSubscribeHostedPersonal).toHaveBeenCalledWith("monthly");
    expect(onSubscribeHostedPersonal).toHaveBeenCalledWith("yearly");
  });

  it("shows hosted subscription buttons for lifetime users without hosted service", () => {
    const onSubscribeHostedPersonal = jest.fn();
    render(
      <SettingsScreen
        {...pairedProps}
        nativeAppEntitlement={{
          trialActive: false,
          trialPurchased: false,
          lifetimeUnlocked: true,
          readOnly: false,
          hostedSubscriptionActive: false,
          trialRemainingMs: 0,
        }}
        personalBillingStatus={personalBillingFixture({ lifetimeActive: true })}
        onSubscribeHostedPersonal={onSubscribeHostedPersonal}
      />,
    );

    fireEvent.press(screen.getByText("App access"));
    fireEvent.press(screen.getByText("Monthly"));
    fireEvent.press(screen.getByText("Yearly"));
    expect(onSubscribeHostedPersonal).toHaveBeenCalledWith("monthly");
    expect(onSubscribeHostedPersonal).toHaveBeenCalledWith("yearly");
  });

  it("shows hosted subscription status without active subscribe buttons", () => {
    const onSubscribeHostedPersonal = jest.fn();
    render(
      <SettingsScreen
        {...pairedProps}
        nativeAppEntitlement={{
          trialActive: false,
          trialPurchased: false,
          lifetimeUnlocked: true,
          readOnly: false,
          hostedSubscriptionActive: true,
          trialRemainingMs: 0,
        }}
        personalBillingStatus={personalBillingFixture({ lifetimeActive: true, hostedActive: true })}
        storeProducts={[
          { productKey: "hosted_personal_monthly", productId: "monthly", title: "Hosted personal monthly", priceString: "39 kr./md." },
          { productKey: "hosted_personal_yearly", productId: "yearly", title: "Hosted personal yearly", priceString: "399 kr./år" },
        ]}
        hostedPersonalActive
        onSubscribeHostedPersonal={onSubscribeHostedPersonal}
      />,
    );

    fireEvent.press(screen.getByText("App access"));
    expect(screen.getByText("Hosted subscription expires on Jun 10, 2026.")).toBeTruthy();
    expect(screen.queryByText("39 kr./md.")).toBeNull();
    expect(screen.queryByText("399 kr./år")).toBeNull();
    expect(screen.getByText("Manage subscription")).toBeTruthy();
    expect(onSubscribeHostedPersonal).not.toHaveBeenCalled();
  });

  it("keeps availability controls hidden while the feature is turned off", () => {
    const onAvailabilityChange = jest.fn();
    render(<SettingsScreen {...pairedProps} availability="available" onAvailabilityChange={onAvailabilityChange} />);
    expect(screen.queryByText("Availability")).toBeNull();
    fireEvent.press(screen.getByText("Manage connections ›"));
    expect(screen.queryByText("Availability")).toBeNull();
    expect(screen.queryByText("Off-call")).toBeNull();
    expect(onAvailabilityChange).not.toHaveBeenCalled();
  });

  it("makes sub-settings back buttons full-width press targets", () => {
    render(<SettingsScreen {...pairedProps} />);
    fireEvent.press(screen.getByText("General"));
    const backButtonStyle = StyleSheet.flatten(screen.getByLabelText("‹ Settings").props.style);
    expect(backButtonStyle.alignSelf).toBe("stretch");
  });

  it("opens connection management without switching saved accounts", () => {
    const account = {
      id: "local:https://tick.example.com:dev_2",
      serverURL: "https://tick.example.com",
      authProvider: "local",
      label: "Example device",
      deviceID: "dev_2",
      updatedAt: "2026-05-10T00:00:00.000Z",
    };
    render(<SettingsScreen {...pairedProps} accounts={[account]} serverURL="https://tick.example.com" />);
    expect(screen.getByText("Connections")).toBeTruthy();
    expect(screen.queryByText("Connected accounts")).toBeNull();
    fireEvent.press(screen.getByText("Manage connections ›"));
    fireEvent.press(screen.getByText("Manage connections"));
    expect(screen.getByText("Connected accounts")).toBeTruthy();
    expect(screen.queryByText("Saved accounts")).toBeNull();
    expect(screen.getByText("Example device")).toBeTruthy();
  });

  it("removes saved connections without selecting them", () => {
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

    fireEvent.press(screen.getByText("Manage connections ›"));
    fireEvent.press(screen.getByText("Manage connections"));
    fireEvent.press(screen.getByText("Remove"));
    expect(onSavedAccountRemove).toHaveBeenCalledWith(account);
  });

  it("keeps hosted login session clearing in Developer settings", () => {
    const onForgetDevice = jest.fn();
    const onClearHostedLoginSession = jest.fn();
    const accounts = [
      {
        id: "clerk:https://app.agenttick.sh:usr_1",
        serverURL: "https://app.agenttick.sh",
        authProvider: "clerk",
        label: "GitHub account",
        userID: "usr_1",
        email: "ada@example.com",
        signInMethod: "GitHub",
        updatedAt: "2026-05-10T00:00:00.000Z",
      },
      {
        id: "clerk:https://app.agenttick.sh:usr_2",
        serverURL: "https://app.agenttick.sh",
        authProvider: "clerk",
        label: "Apple account",
        userID: "usr_2",
        email: "ada@icloud.com",
        signInMethod: "Apple",
        updatedAt: "2026-05-10T00:00:00.000Z",
      },
    ];
    render(
      <SettingsScreen
        {...unpairedProps}
        accounts={accounts}
        authProvider="clerk"
        currentAccountProfile={{ userId: "usr_1", email: "ada@example.com", signInMethod: "GitHub", authProvider: "clerk", source: "human" }}
        onForgetDevice={onForgetDevice}
        onClearHostedLoginSession={onClearHostedLoginSession}
      />,
    );

    fireEvent.press(screen.getByText("Manage connections ›"));
    expect(screen.queryByText("Sign out of hosted login")).toBeNull();
    fireEvent.press(screen.getByLabelText("‹ Settings"));
    fireEvent.press(screen.getByText("Developer"));
    fireEvent.press(screen.getByText("Sign out of hosted login"));
    expect(onClearHostedLoginSession).toHaveBeenCalled();
    expect(onForgetDevice).not.toHaveBeenCalled();
  });

  it("lets users add another hosted connection without a signed-in-session summary", () => {
    const onSignInAnotherClerkAccount = jest.fn();
    render(
      <SettingsScreen
        {...unpairedProps}
        authProvider="clerk"
        currentAccountProfile={{ userId: "usr_1", name: "Ada Lovelace", email: "ada@example.com", signInMethod: "GitHub", authProvider: "clerk", source: "human" }}
        onSignInAnotherClerkAccount={onSignInAnotherClerkAccount}
      />,
    );

    expect(screen.getByText("0 connections")).toBeTruthy();
    expect(screen.queryByText("Signed-in session")).toBeNull();
    fireEvent.press(screen.getByText("Manage connections ›"));
    fireEvent.press(screen.getByText("Manage connections"));
    expect(screen.getByText("No saved hosted connections")).toBeTruthy();
    expect(screen.queryByText("ada@example.com")).toBeNull();
    fireEvent.press(screen.getByText("Add hosted connection"));
    expect(onSignInAnotherClerkAccount).toHaveBeenCalled();
  });

  it("lets paired users add a self-hosted connection from connection management", () => {
    render(<SettingsScreen {...pairedProps} />);

    fireEvent.press(screen.getByText("Manage connections ›"));
    fireEvent.press(screen.getByText("Manage connections"));
    fireEvent.press(screen.getByText("Add self-hosted connection"));

    expect(screen.getByText("Pairing")).toBeTruthy();
    expect(screen.getByPlaceholderText("https://tick.example.com")).toBeTruthy();
  });

  it("shows Clerk account deletion with destructive copy", () => {
    const onDeleteAccount = jest.fn();
    render(
      <SettingsScreen
        {...unpairedProps}
        authProvider="clerk"
        currentAccountProfile={{ userId: "usr_1", email: "ada@example.com", signInMethod: "Apple", authProvider: "clerk", source: "human" }}
        onDeleteAccount={onDeleteAccount}
      />,
    );

    fireEvent.press(screen.getByText("Manage connections ›"));
    expect(screen.getByText("Danger zone")).toBeTruthy();
    expect(screen.getByText(/hosted personal Requests and Activity/)).toBeTruthy();
    fireEvent.press(screen.getByText("Delete account"));
    expect(onDeleteAccount).toHaveBeenCalledTimes(1);
  });

  it("hides workspace choices when a Clerk account has only one Workspace", () => {
    const onSelectWorkspace = jest.fn();
    render(
      <SettingsScreen
        {...unpairedProps}
        authProvider="clerk"
        workspaces={[{ workspaceId: "org_1", name: "Platform", role: "owner" }]}
        selectedWorkspaceID="org_1"
        setSelectedWorkspaceID={onSelectWorkspace}
      />,
    );
    expect(screen.getByText("Connections")).toBeTruthy();
    expect(screen.queryByText(/org_1/)).toBeNull();
    expect(screen.queryByText("Platform")).toBeNull();
  });

  it("shows Clerk workspace choices only when there are multiple Workspaces", () => {
    const onSelectWorkspace = jest.fn();
    render(
      <SettingsScreen
        {...unpairedProps}
        authProvider="clerk"
        workspaces={[
          { workspaceId: "org_1", name: "Platform", role: "owner" },
          { workspaceId: "org_2", name: "Research", role: "member" },
        ]}
        selectedWorkspaceID="org_1"
        setSelectedWorkspaceID={onSelectWorkspace}
      />,
    );
    fireEvent.press(screen.getByText("Manage connections ›"));
    expect(screen.getByText("Workspace")).toBeTruthy();
    expect(screen.queryByText(/org_1/)).toBeNull();
    expect(screen.getByText("Platform")).toBeTruthy();
    fireEvent.press(screen.getByText("Research"));
    expect(onSelectWorkspace).toHaveBeenCalledWith("org_2");
  });
});
