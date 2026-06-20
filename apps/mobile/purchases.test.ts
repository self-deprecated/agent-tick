let mockPlatformOS: "ios" | "android" = "ios";

const mockPurchases = {
  configure: jest.fn(),
  getCustomerInfo: jest.fn(),
  getAppUserID: jest.fn(),
  getOfferings: jest.fn(),
  getProducts: jest.fn(),
  purchasePackage: jest.fn(),
  purchaseProduct: jest.fn(),
  restorePurchases: jest.fn(),
  setAttributes: jest.fn(),
  syncAttributesAndOfferingsIfNeeded: jest.fn(),
  getCurrentOfferingForPlacement: jest.fn(),
  logIn: jest.fn(),
  logOut: jest.fn(),
};

jest.mock("react-native-purchases", () => mockPurchases);

function loadPurchases(): typeof import("./purchases") {
  jest.resetModules();
  jest.doMock("react-native", () => ({
    Linking: { openURL: jest.fn(async () => undefined) },
    Platform: { OS: mockPlatformOS },
  }));
  jest.doMock("react-native-purchases", () => mockPurchases);
  return require("./purchases");
}

function setPlatform(os: "ios" | "android") {
  mockPlatformOS = os;
}

describe("purchases", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPurchases.getCustomerInfo.mockResolvedValue({ entitlements: { active: {} }, allPurchasedProductIdentifiers: [] });
    mockPurchases.getAppUserID.mockResolvedValue("install_test_123");
    mockPurchases.getOfferings.mockResolvedValue({ current: { availablePackages: [] } });
    mockPurchases.getProducts.mockResolvedValue([]);
    mockPurchases.purchasePackage.mockResolvedValue({});
    mockPurchases.purchaseProduct.mockResolvedValue({});
    mockPurchases.restorePurchases.mockResolvedValue({});
    mockPurchases.setAttributes.mockResolvedValue(undefined);
    mockPurchases.syncAttributesAndOfferingsIfNeeded.mockResolvedValue({ current: null });
    mockPurchases.getCurrentOfferingForPlacement.mockResolvedValue(null);
    mockPurchases.logIn.mockResolvedValue({});
    mockPurchases.logOut.mockResolvedValue({});
    delete process.env.EXPO_PUBLIC_REVENUECAT_USE_TEST_STORE;
    delete process.env.EXPO_PUBLIC_REVENUECAT_TEST_STORE_API_KEY;
    delete process.env.EXPO_PUBLIC_REVENUECAT_IOS_API_KEY;
    delete process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY;
  });

  it("configures RevenueCat with a stable install identity for self-hosted lifetime purchases", async () => {
    setPlatform("ios");
    const purchases = loadPurchases();

    await purchases.configureLocalStorePurchases("install_test_123");

    expect(mockPurchases.configure).toHaveBeenCalledWith(expect.objectContaining({ apiKey: expect.stringMatching(/^appl_/), appUserID: "install_test_123" }));
    expect(mockPurchases.logIn).not.toHaveBeenCalled();
    expect(mockPurchases.logOut).not.toHaveBeenCalled();
  });

  it("configures Android RevenueCat with the bundled public SDK key", async () => {
    setPlatform("android");
    const purchases = loadPurchases();

    await purchases.configureLocalStorePurchases("install_test_123");

    expect(mockPurchases.configure).toHaveBeenCalledWith(expect.objectContaining({ apiKey: "goog_OoUVPJdUqfBKgRDuRvIEoBjfJCV", appUserID: "install_test_123" }));
  });

  it("configures hosted purchases directly as the signed-in Agent Tick user id", async () => {
    setPlatform("ios");
    const purchases = loadPurchases();

    await purchases.configurePurchases("usr_123");

    expect(mockPurchases.configure).toHaveBeenCalledWith(expect.objectContaining({ apiKey: expect.stringMatching(/^appl_/), appUserID: "usr_123" }));
    expect(mockPurchases.logIn).not.toHaveBeenCalled();
  });

  it("reports the currently configured RevenueCat app user id for diagnostics", async () => {
    setPlatform("ios");
    const purchases = loadPurchases();
    mockPurchases.getAppUserID.mockResolvedValue("install_live_123");

    await purchases.configureLocalStorePurchases("install_test_123");

    await expect(purchases.getCurrentRevenueCatAppUserID()).resolves.toBe("install_live_123");
  });

  it("switches from local install identity to hosted identity without logging out to anonymous", async () => {
    setPlatform("ios");
    const purchases = loadPurchases();

    await purchases.configureLocalStorePurchases("install_test_123");
    await purchases.configurePurchases("usr_123");

    expect(mockPurchases.configure).toHaveBeenCalledTimes(1);
    expect(mockPurchases.logIn).toHaveBeenCalledWith("usr_123");
    expect(mockPurchases.logOut).not.toHaveBeenCalled();
  });

  it("switches from hosted identity back to local install identity without creating an anonymous RevenueCat user", async () => {
    setPlatform("ios");
    const purchases = loadPurchases();

    await purchases.configurePurchases("usr_123");
    await purchases.configureLocalStorePurchases("install_test_123");

    expect(mockPurchases.logIn).toHaveBeenCalledWith("install_test_123");
    expect(mockPurchases.logOut).not.toHaveBeenCalled();
  });

  it("uses neutral labels instead of dollar fallback prices when store prices are unavailable", async () => {
    setPlatform("ios");
    const purchases = loadPurchases();
    mockPurchases.getProducts.mockResolvedValue([]);
    mockPurchases.getOfferings.mockResolvedValue({ current: null });

    await expect(purchases.loadStoreProducts()).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ productKey: "hosted_personal_monthly", priceString: "Monthly" }),
      expect.objectContaining({ productKey: "hosted_personal_yearly", priceString: "Yearly" }),
      expect.objectContaining({ productKey: "lifetime_unlock", priceString: "One-time purchase" }),
    ]));
  });

  it("maps RevenueCat trial, lifetime, monthly, and yearly packages to Agent Tick product keys", async () => {
    setPlatform("ios");
    const purchases = loadPurchases();
    mockPurchases.getOfferings.mockResolvedValue({
      current: {
        availablePackages: [
          { identifier: "$rc_initial_trial.7", packageType: "CUSTOM", product: { identifier: "ai.selfdeprecated.agenttick.initial_trial.7", title: "7-day Trial", priceString: "Free" } },
          { identifier: "$rc_lifetime", packageType: "LIFETIME", product: { identifier: "ai.selfdeprecated.agenttick.lifetime_unlock", title: "Lifetime", priceString: "$19.99" } },
          { identifier: "$rc_monthly", packageType: "MONTHLY", product: { identifier: "ai.selfdeprecated.agenttick.hosted_personal_monthly", title: "Monthly", priceString: "$4.99/month" } },
          { identifier: "$rc_annual", packageType: "ANNUAL", product: { identifier: "ai.selfdeprecated.agenttick.hosted_personal_yearly", title: "Yearly", priceString: "$49.99/year" } },
        ],
      },
    });

    await expect(purchases.loadStoreProducts()).resolves.toEqual([
      expect.objectContaining({ productKey: "trial_7_day", productId: "ai.selfdeprecated.agenttick.initial_trial.7", priceString: "Free" }),
      expect.objectContaining({ productKey: "hosted_personal_monthly", productId: "ai.selfdeprecated.agenttick.hosted_personal_monthly", priceString: "$4.99/month" }),
      expect.objectContaining({ productKey: "hosted_personal_yearly", productId: "ai.selfdeprecated.agenttick.hosted_personal_yearly", priceString: "$49.99/year" }),
      expect.objectContaining({ productKey: "lifetime_unlock", productId: "ai.selfdeprecated.agenttick.lifetime_unlock", priceString: "$19.99" }),
    ]);
  });

  it("maps Android RevenueCat hosted packages by package type even when monthly and yearly share a Play subscription product", async () => {
    setPlatform("android");
    const purchases = loadPurchases();
    mockPurchases.getOfferings.mockResolvedValue({
      current: {
        availablePackages: [
          { identifier: "$rc_monthly", packageType: "MONTHLY", product: { identifier: "ai.selfdeprecated.agenttick.hosted", title: "Hosted", priceString: "$4.99/month" } },
          { identifier: "$rc_annual", packageType: "ANNUAL", product: { identifier: "ai.selfdeprecated.agenttick.hosted", title: "Hosted", priceString: "$49.99/year" } },
        ],
      },
    });

    await expect(purchases.loadStoreProducts()).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ productKey: "hosted_personal_monthly", productId: "ai.selfdeprecated.agenttick.hosted", priceString: "$4.99/month" }),
      expect.objectContaining({ productKey: "hosted_personal_yearly", productId: "ai.selfdeprecated.agenttick.hosted", priceString: "$49.99/year" }),
    ]));
  });

  it("purchases subscriptions through configured RevenueCat packages instead of external links", async () => {
    setPlatform("ios");
    const purchases = loadPurchases();
    const monthly = { identifier: "$rc_monthly", packageType: "MONTHLY", product: { identifier: "ai.selfdeprecated.agenttick.hosted_personal_monthly" } };
    mockPurchases.getOfferings.mockResolvedValue({ current: { availablePackages: [monthly] } });

    await expect(purchases.purchaseProduct("hosted_personal_monthly")).resolves.toEqual({ success: true });

    expect(mockPurchases.purchasePackage).toHaveBeenCalledWith(monthly);
    expect(mockPurchases.purchaseProduct).not.toHaveBeenCalled();
  });

  it("falls back to the exact App Store product id for lifetime unlock", async () => {
    setPlatform("ios");
    const purchases = loadPurchases();

    await expect(purchases.purchaseProduct("lifetime_unlock")).resolves.toEqual({ success: true });

    expect(mockPurchases.purchaseProduct).toHaveBeenCalledWith("ai.selfdeprecated.agenttick.lifetime_unlock", null, "inapp");
  });

  it("queries Android subscriptions and one-time products with the correct Play product ids and product categories", async () => {
    setPlatform("android");
    const purchases = loadPurchases();
    mockPurchases.getProducts.mockImplementation(async (ids: string[], type: string) => {
      if (type === "SUBSCRIPTION") return ids.map((identifier) => ({ identifier, title: identifier, priceString: "$4.99" }));
      if (type === "NON_SUBSCRIPTION") return ids.map((identifier) => ({ identifier, title: identifier, priceString: "$19.99" }));
      return [];
    });
    mockPurchases.getOfferings.mockResolvedValue({ current: null });

    await purchases.loadStoreProducts();

    expect(mockPurchases.getProducts).toHaveBeenCalledWith(["ai.selfdeprecated.agenttick.hosted"], "SUBSCRIPTION");
    expect(mockPurchases.getProducts).toHaveBeenCalledWith(["ai.selfdeprecated.agenttick.lifetime_unlock"], "NON_SUBSCRIPTION");
    expect(mockPurchases.getProducts).not.toHaveBeenCalledWith(expect.arrayContaining(["trial_7_day"]), expect.anything());
  });

  it("detects an active 7-day trial from RevenueCat customer info", () => {
    setPlatform("ios");
    const purchases = loadPurchases();

    expect(purchases.trial7DayPurchaseFromCustomerInfo({
      allPurchasedProductIdentifiers: ["ai.selfdeprecated.agenttick.initial_trial.7"],
      allPurchaseDates: {
        "ai.selfdeprecated.agenttick.initial_trial.7": "2026-05-01T00:00:00.000Z",
      },
      nonSubscriptionTransactions: [
        { productIdentifier: "ai.selfdeprecated.agenttick.initial_trial.7", purchaseDate: "2026-05-01T00:00:00.000Z" },
      ],
    }, new Date("2026-05-02T00:00:00.000Z"))).toEqual({ purchased: true, purchasedAt: "2026-05-01T00:00:00.000Z", active: true });
  });

  it("derives the trial window from the RevenueCat trial entitlement purchase date", () => {
    setPlatform("ios");
    const purchases = loadPurchases();

    expect(purchases.trial7DayPurchaseFromCustomerInfo({
      entitlements: {
        active: {
          trial_period: {
            productIdentifier: "ai.selfdeprecated.agenttick.initial_trial.7",
            latestPurchaseDate: "2026-05-01T00:00:00.000Z",
          },
        },
      },
      allPurchasedProductIdentifiers: ["ai.selfdeprecated.agenttick.initial_trial.7"],
    }, new Date("2026-05-08T00:00:00.000Z"))).toEqual({ purchased: true, purchasedAt: "2026-05-01T00:00:00.000Z", active: false });
  });

  it("accepts a temporary RevenueCat trial entitlement grant for development testing", () => {
    setPlatform("ios");
    const purchases = loadPurchases();

    expect(purchases.trial7DayPurchaseFromCustomerInfo({
      entitlements: {
        active: {
          trial_period: {
            identifier: "trial_period",
            productIdentifier: "rc_promo_trial",
            latestPurchaseDate: "2026-05-01T00:00:00.000Z",
            expirationDate: "2026-05-20T00:00:00.000Z",
            store: "PROMOTIONAL",
          },
        },
      },
    }, new Date("2026-05-12T00:00:00.000Z"))).toEqual({ purchased: true, purchasedAt: "2026-05-01T00:00:00.000Z", active: true });
  });

  it("detects simultaneous active trial and lifetime entitlement from RevenueCat customer info", () => {
    setPlatform("ios");
    const purchases = loadPurchases();
    const info = {
      entitlements: {
        active: {
          trial_period: {
            productIdentifier: "ai.selfdeprecated.agenttick.initial_trial.7",
            latestPurchaseDate: "2026-05-01T00:00:00.000Z",
          },
          lifetime_app_unlock: {
            productIdentifier: "ai.selfdeprecated.agenttick.lifetime_unlock",
            latestPurchaseDate: "2026-05-03T00:00:00.000Z",
          },
        },
      },
      allPurchasedProductIdentifiers: ["ai.selfdeprecated.agenttick.initial_trial.7", "ai.selfdeprecated.agenttick.lifetime_unlock"],
    };

    expect(purchases.trial7DayPurchaseFromCustomerInfo(info, new Date("2026-05-06T00:00:00.000Z"))).toMatchObject({ purchased: true, active: true });
    expect(purchases.lifetimeUnlockActiveFromCustomerInfo(info)).toBe(true);
  });

  it("detects simultaneous active trial and lifetime product purchase from RevenueCat customer info", () => {
    setPlatform("ios");
    const purchases = loadPurchases();
    const info = {
      allPurchasedProductIdentifiers: ["ai.selfdeprecated.agenttick.initial_trial.7", "ai.selfdeprecated.agenttick.lifetime_unlock"],
      allPurchaseDates: {
        "ai.selfdeprecated.agenttick.initial_trial.7": "2026-05-01T00:00:00.000Z",
        "ai.selfdeprecated.agenttick.lifetime_unlock": "2026-05-03T00:00:00.000Z",
      },
      nonSubscriptionTransactions: [
        { productIdentifier: "ai.selfdeprecated.agenttick.initial_trial.7", purchaseDate: "2026-05-01T00:00:00.000Z" },
        { productIdentifier: "ai.selfdeprecated.agenttick.lifetime_unlock", purchaseDate: "2026-05-03T00:00:00.000Z" },
      ],
    };

    expect(purchases.trial7DayPurchaseFromCustomerInfo(info, new Date("2026-05-06T00:00:00.000Z"))).toMatchObject({ purchased: true, active: true });
    expect(purchases.lifetimeUnlockActiveFromCustomerInfo(info)).toBe(true);
  });

  it("fetches placement-specific RevenueCat paywall metadata with fallback products", async () => {
    setPlatform("ios");
    const purchases = loadPurchases();
    mockPurchases.setAttributes = jest.fn().mockResolvedValue(undefined);
    mockPurchases.syncAttributesAndOfferingsIfNeeded = jest.fn().mockResolvedValue({ current: null });
    mockPurchases.getCurrentOfferingForPlacement = jest.fn().mockResolvedValue({
      identifier: "hosted_gate_v1",
      metadata: { schema_version: 1, headline: "Hosted access", primary_mode: "hosted", highlight_product: "hosted_personal_yearly" },
      availablePackages: [
        { identifier: "$rc_monthly", packageType: "MONTHLY", product: { identifier: "ai.selfdeprecated.agenttick.hosted_personal_monthly", title: "Monthly", priceString: "$4.99/month" } },
      ],
    });

    await expect(purchases.loadPaywallConfig("hosted_gate", { setup_intent: "hosted" })).resolves.toMatchObject({
      source: "revenuecat",
      offeringId: "hosted_gate_v1",
      headline: "Hosted access",
      highlightedProduct: "hosted_personal_yearly",
      products: expect.arrayContaining([expect.objectContaining({ productKey: "hosted_personal_monthly" })]),
    });
    expect(mockPurchases.setAttributes).toHaveBeenCalledWith(expect.objectContaining({ setup_intent: "hosted", last_paywall_placement: "hosted_gate" }));
    expect(mockPurchases.getCurrentOfferingForPlacement).toHaveBeenCalledWith("hosted_gate");
  });

  it("detects lifetime unlock from restored RevenueCat customer info", async () => {
    setPlatform("ios");
    const purchases = loadPurchases();
    mockPurchases.getCustomerInfo.mockResolvedValue({
      entitlements: { active: { lifetime_app_unlock: { isActive: true } } },
      allPurchasedProductIdentifiers: [],
    });

    await expect(purchases.getCustomerInfo()).resolves.toEqual(expect.objectContaining({ entitlements: expect.any(Object) }));
    expect(purchases.lifetimeUnlockActiveFromCustomerInfo(await purchases.getCustomerInfo())).toBe(true);
  });

  it("detects lifetime unlock from non-subscription product identifiers", async () => {
    setPlatform("ios");
    const purchases = loadPurchases();

    expect(purchases.lifetimeUnlockActiveFromCustomerInfo({ allPurchasedProductIdentifiers: ["ai.selfdeprecated.agenttick.lifetime_unlock"] })).toBe(true);
    expect(purchases.lifetimeUnlockActiveFromCustomerInfo({ allPurchasedProductIdentifiers: [] })).toBe(false);
  });

  it("restores RevenueCat purchases without requiring a hosted account", async () => {
    setPlatform("ios");
    const purchases = loadPurchases();

    await purchases.configureLocalStorePurchases("install_test_restore");
    await expect(purchases.restorePurchases()).resolves.toEqual({ success: true });

    expect(mockPurchases.configure).toHaveBeenCalledWith(expect.objectContaining({ appUserID: "install_test_restore" }));
    expect(mockPurchases.restorePurchases).toHaveBeenCalledTimes(1);
  });
});
