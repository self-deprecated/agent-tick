import { Linking, Platform } from "react-native";
import PurchasesModule from "react-native-purchases";
import type { BillingProduct, BillingProductKey } from "@self-deprecated/agent-tick-shared";
import { translateSource } from "@agent-tick/i18n";

export type ProductKey = BillingProductKey;

export type StoreProduct = {
  productKey: ProductKey;
  productId: string;
  title: string;
  description?: string;
  priceString?: string;
};

export type PurchaseResult = {
  success: boolean;
  cancelled?: boolean;
};

export type RestoreResult = {
  success: boolean;
};

export type PaywallPlacement = "onboarding" | "expired_trial" | "hosted_gate" | "self_hosted_gate" | "settings_access";

export type PaywallTargetingAttributes = {
  setup_intent?: "hosted" | "self_hosted" | "undecided";
  server_mode?: "hosted" | "self_hosted" | "unknown";
  app_access_state?: "trial_active" | "read_only" | "lifetime" | "hosted_active";
  last_paywall_placement?: PaywallPlacement;
};

export type PaywallConfig = {
  placement: PaywallPlacement;
  source: "revenuecat" | "fallback";
  offeringId?: string;
  products: StoreProduct[];
  productOrder: ProductKey[];
  headline: string;
  subtitle: string;
  primaryMode: "trial" | "hosted" | "lifetime";
  highlightedProduct?: ProductKey;
  lifetimeBadge?: string;
  yearlyBadge?: string;
  trialNote: string;
  footerNote: string;
  diagnostics?: string;
};

export type CustomerInfo = {
  entitlements?: {
    active?: Record<string, unknown>;
    all?: Record<string, unknown>;
  };
  originalAppUserId?: string;
  appUserID?: string;
  allPurchasedProductIdentifiers?: string[];
  allPurchaseDates?: Record<string, string | null>;
  allExpirationDates?: Record<string, string | null>;
  activeSubscriptions?: string[];
  nonSubscriptionTransactions?: unknown[];
  nonSubscriptions?: Record<string, unknown[]>;
};

type RevenueCatProduct = {
  identifier: string;
  title?: string;
  description?: string;
  priceString?: string;
};

type RevenueCatPackage = {
  identifier: string;
  packageType?: string;
  product: RevenueCatProduct;
};

type RevenueCatOffering = {
  identifier?: string;
  availablePackages?: RevenueCatPackage[];
  metadata?: Record<string, unknown>;
};

type RevenueCatOfferings = {
  current?: RevenueCatOffering | null;
};

type RevenueCatStatic = {
  configure(config: { apiKey: string; appUserID?: string }): void;
  getCustomerInfo?: () => Promise<CustomerInfo>;
  getAppUserID?: () => Promise<string>;
  getOfferings?: () => Promise<RevenueCatOfferings>;
  getCurrentOfferingForPlacement?: (placementIdentifier: string) => Promise<RevenueCatOffering | null>;
  syncAttributesAndOfferingsIfNeeded?: () => Promise<RevenueCatOfferings>;
  setAttributes?: (attributes: Record<string, string | null>) => Promise<void>;
  getProducts?: (productIds: string[], type?: string) => Promise<RevenueCatProduct[]>;
  purchasePackage?: (pkg: RevenueCatPackage) => Promise<unknown>;
  purchaseProduct?: (productId: string, upgradeInfo?: unknown, type?: string) => Promise<unknown>;
  restorePurchases?: () => Promise<unknown>;
  logIn?: (appUserID: string) => Promise<unknown>;
  logOut?: () => Promise<unknown>;
};

const fallbackCatalog: BillingProduct[] = [
  {
    productKey: "trial_7_day",
    kind: "non_consumable",
    entitlementKey: "native_app_trial",
    appleProductId: "ai.selfdeprecated.agenttick.initial_trial.7",
    active: true,
  },
  {
    productKey: "lifetime_unlock",
    kind: "non_consumable",
    entitlementKey: "lifetime_app_unlock",
    appleProductId: "ai.selfdeprecated.agenttick.lifetime_unlock",
    googleProductId: "ai.selfdeprecated.agenttick.lifetime_unlock",
    active: true,
  },
  {
    productKey: "hosted_personal_monthly",
    kind: "subscription",
    entitlementKey: "hosted_personal",
    appleProductId: "ai.selfdeprecated.agenttick.hosted_personal_monthly",
    googleProductId: "ai.selfdeprecated.agenttick.hosted",
    googleBasePlanId: "hosted-personal-monthly",
    active: true,
  },
  {
    productKey: "hosted_personal_yearly",
    kind: "subscription",
    entitlementKey: "hosted_personal",
    appleProductId: "ai.selfdeprecated.agenttick.hosted_personal_yearly",
    googleProductId: "ai.selfdeprecated.agenttick.hosted",
    googleBasePlanId: "hosted-personal-yearly",
    active: true,
  },
];

const fallbackProductOrder: ProductKey[] = ["trial_7_day", "hosted_personal_monthly", "hosted_personal_yearly", "lifetime_unlock"];
const trialProductIds = new Set([
  "ai.selfdeprecated.agenttick.initial_trial.7",
  "initial_trial.7",
  "ai.selfdeprecated.agenttick.trial_7_day",
  "trial_7_day",
  "trial",
]);
// RevenueCat mobile SDK API keys are public client identifiers, not bearer
// secrets. Keep production defaults in source so published mobile builds and
// source checkouts have a safe app-store billing fallback; EXPO_PUBLIC_* values
// can still override them for alternate RevenueCat projects or test channels.
const defaultRevenueCatIOSAPIKey = "appl_jjQlssmgYrPUZmFPbFuSyVOfPCV";
const defaultRevenueCatAndroidAPIKey = "goog_OoUVPJdUqfBKgRDuRvIEoBjfJCV";
const DAY_MS = 24 * 60 * 60 * 1000;
const TRIAL_MS = 7 * DAY_MS;

let purchasesConfigured = false;
let configuredUserID: string | null = null;
let currentCatalog: BillingProduct[] = fallbackCatalog;
let lastOfferingPackages: RevenueCatPackage[] = [];

export function setPurchaseCatalog(products: BillingProduct[]): void {
  const active = products.filter((product) => product.active !== false);
  currentCatalog = active.length ? mergeCatalog(active) : fallbackCatalog;
}

export async function configureLocalStorePurchases(installationId: string): Promise<void> {
  await configureRevenueCatIdentity(localStoreAppUserID(installationId));
}

export async function configurePurchases(userId: string): Promise<void> {
  await configureRevenueCatIdentity(userId);
}

async function configureRevenueCatIdentity(appUserID: string): Promise<void> {
  const apiKey = revenueCatAPIKey();
  if (!apiKey) throw new Error("RevenueCat API key is not configured for this platform");
  const Purchases = await loadRevenueCat();
  if (configuredUserID === appUserID) return;
  if (!purchasesConfigured) {
    Purchases.configure({ apiKey, appUserID });
    purchasesConfigured = true;
    configuredUserID = appUserID;
    return;
  }
  if (Purchases.logIn) {
    await Purchases.logIn(appUserID);
    configuredUserID = appUserID;
    return;
  }
  Purchases.configure({ apiKey, appUserID });
  purchasesConfigured = true;
  configuredUserID = appUserID;
}

function localStoreAppUserID(installationId: string): string {
  const trimmed = installationId.trim();
  if (trimmed.startsWith("install_")) return trimmed;
  return "install_" + trimmed;
}

export async function loadStoreProducts(): Promise<StoreProduct[]> {
  return (await loadPaywallConfig("settings_access")).products;
}

export async function loadPaywallConfig(placement: PaywallPlacement = "settings_access", attributes?: PaywallTargetingAttributes): Promise<PaywallConfig> {
  const Purchases = await loadRevenueCat();
  const fallbackProducts = await loadFallbackProducts(Purchases);
  try {
    await setTargetingAttributes(Purchases, { ...attributes, last_paywall_placement: placement });
    const offering = await revenueCatOffering(Purchases, placement);
    const remoteConfig = offering ? paywallConfigFromOffering(placement, offering, fallbackProducts) : null;
    if (remoteConfig) return remoteConfig;
  } catch (error) {
    return fallbackPaywallConfig(placement, fallbackProducts, error instanceof Error ? error.message : String(error));
  }
  return fallbackPaywallConfig(placement, fallbackProducts);
}

export async function purchaseProduct(productKey: ProductKey): Promise<PurchaseResult> {
  const Purchases = await loadRevenueCat();
  const packages = lastOfferingPackages.length ? lastOfferingPackages : await revenueCatPackages(Purchases).catch(() => []);
  const pkg = packages.find((candidate) => productKeyForRevenueCatPackage(candidate) === productKey);
  try {
    if (pkg && Purchases.purchasePackage) {
      await Purchases.purchasePackage(pkg);
      return { success: true };
    }
    const productId = platformProductId(productForKey(productKey));
    if (!productId || !Purchases.purchaseProduct) throw new Error("Store product is not configured for this platform");
    await Purchases.purchaseProduct(productId, null, purchaseTypeForProduct(productForKey(productKey)));
    return { success: true };
  } catch (error) {
    if (isUserCancelledPurchase(error)) return { success: false, cancelled: true };
    throw error;
  }
}

export async function restorePurchases(): Promise<RestoreResult> {
  const Purchases = await loadRevenueCat();
  if (!Purchases.restorePurchases) throw new Error("Restore purchases is unavailable");
  await Purchases.restorePurchases();
  return { success: true };
}

export async function getCurrentRevenueCatAppUserID(): Promise<string | null> {
  const Purchases = await loadRevenueCat();
  if (!Purchases.getAppUserID) return configuredUserID;
  return Purchases.getAppUserID();
}

export async function getCustomerInfo(): Promise<CustomerInfo> {
  const Purchases = await loadRevenueCat();
  if (!Purchases.getCustomerInfo) return {};
  return Purchases.getCustomerInfo();
}

export function lifetimeUnlockActiveFromCustomerInfo(info: CustomerInfo | null | undefined): boolean {
  if (!info) return false;
  const activeEntitlementKeys = Object.keys(info.entitlements?.active ?? {}).map((key) => key.toLowerCase());
  if (activeEntitlementKeys.some((key) => key === "lifetime_app_unlock" || key === "lifetime_unlock" || key.includes("lifetime"))) {
    return true;
  }
  const purchasedIds = info.allPurchasedProductIdentifiers ?? [];
  if (purchasedIds.some((id) => productKeyForStoreProduct(id) === "lifetime_unlock")) {
    return true;
  }
  const nonSubscriptionIds = Object.keys(info.nonSubscriptions ?? {});
  return nonSubscriptionIds.some((id) => productKeyForStoreProduct(id) === "lifetime_unlock");
}

export function hostedSubscriptionActiveFromCustomerInfo(info: CustomerInfo | null | undefined): boolean {
  if (!info) return false;
  const activeEntitlementKeys = Object.keys(info.entitlements?.active ?? {}).map((key) => key.toLowerCase());
  if (activeEntitlementKeys.some((key) => key === "hosted_personal" || key.includes("hosted"))) return true;
  return (info.activeSubscriptions ?? []).some((id) => {
    const key = productKeyForStoreProduct(id);
    return key === "hosted_personal_monthly" || key === "hosted_personal_yearly";
  });
}

export function trial7DayPurchaseFromCustomerInfo(info: CustomerInfo | null | undefined, now = new Date()): { purchased: boolean; purchasedAt?: string; active: boolean } {
  if (!info) return { purchased: false, active: false };
  const trialTransactions = (info.nonSubscriptionTransactions ?? []).filter((transaction) => {
    const productId = transactionProductId(transaction);
    return productId ? isTrialProductId(productId) : false;
  });
  const trialEntitlements = trialEntitlementObjects(info);
  const purchased = (info.allPurchasedProductIdentifiers ?? []).some(isTrialProductId)
    || Object.keys(info.allPurchaseDates ?? {}).some(isTrialProductId)
    || Object.keys(info.allExpirationDates ?? {}).some(isTrialProductId)
    || Object.keys(info.nonSubscriptions ?? {}).some(isTrialProductId)
    || trialTransactions.length > 0
    || trialEntitlements.length > 0;
  const dates = [
    ...Object.entries(info.allPurchaseDates ?? {}).flatMap(([productId, purchaseDate]) => isTrialProductId(productId) && purchaseDate ? [purchaseDate] : []),
    ...trialTransactions.flatMap(transactionPurchaseDates),
    ...Object.entries(info.nonSubscriptions ?? {}).flatMap(([productId, transactions]) => isTrialProductId(productId) ? transactions.flatMap(transactionPurchaseDates) : []),
    ...trialEntitlements.flatMap(transactionPurchaseDates),
  ].filter(Boolean).sort((left, right) => new Date(right).getTime() - new Date(left).getTime());
  const entitlementExpirations = [
    ...Object.entries(info.allExpirationDates ?? {}).flatMap(([productId, expirationDate]) => isTrialProductId(productId) && expirationDate ? [expirationDate] : []),
    ...trialEntitlements.flatMap(transactionExpirationDates),
  ];
  const purchasedAt = dates[0];
  const hasExplicitExpiration = entitlementExpirations.length > 0;
  const active = hasExplicitExpiration
    ? entitlementExpirations.some((expiresAt) => new Date(expiresAt).getTime() > now.getTime())
    : Boolean(purchasedAt && new Date(purchasedAt).getTime() + TRIAL_MS > now.getTime());
  return { purchased, ...(purchasedAt ? { purchasedAt } : {}), active };
}

export async function openSubscriptionManagement(): Promise<void> {
  if (Platform.OS === "ios") {
    await Linking.openURL("https://apps.apple.com/account/subscriptions");
    return;
  }
  if (Platform.OS === "android") {
    const hosted = currentCatalog.find((product) => product.productKey === "hosted_personal_monthly" || product.productKey === "hosted_personal_yearly");
    const sku = hosted?.googleProductId ?? "hosted_personal";
    const packageName = "ai.selfdeprecated.agenttick";
    await Linking.openURL(`https://play.google.com/store/account/subscriptions?sku=${encodeURIComponent(sku)}&package=${encodeURIComponent(packageName)}`);
    return;
  }
  throw new Error("Subscription management is only available on iOS and Android");
}

async function loadRevenueCat(): Promise<RevenueCatStatic> {
  return PurchasesModule as unknown as RevenueCatStatic;
}

async function revenueCatOffering(Purchases: RevenueCatStatic, placement: PaywallPlacement): Promise<RevenueCatOffering | null> {
  if (Purchases.getCurrentOfferingForPlacement) {
    const offering = await Purchases.getCurrentOfferingForPlacement(placement);
    if (offering) return offering;
  }
  if (!Purchases.getOfferings) return null;
  const offerings = await Purchases.getOfferings();
  return offerings.current ?? null;
}

async function revenueCatPackages(Purchases: RevenueCatStatic): Promise<RevenueCatPackage[]> {
  const offering = await revenueCatOffering(Purchases, "settings_access");
  lastOfferingPackages = offering?.availablePackages ?? [];
  return lastOfferingPackages;
}

async function setTargetingAttributes(Purchases: RevenueCatStatic, attributes?: PaywallTargetingAttributes): Promise<void> {
  if (!attributes || !Purchases.setAttributes) return;
  const safeAttributes = Object.fromEntries(
    Object.entries(attributes)
      .filter(([, value]) => typeof value === "string" && value.trim())
      .map(([key, value]) => [key, value!.trim()]),
  );
  if (Object.keys(safeAttributes).length === 0) return;
  await Purchases.setAttributes(safeAttributes);
  if (Purchases.syncAttributesAndOfferingsIfNeeded) {
    await Purchases.syncAttributesAndOfferingsIfNeeded();
  }
}

async function loadFallbackProducts(Purchases: RevenueCatStatic): Promise<StoreProduct[]> {
  if (!Purchases.getProducts) return fallbackStoreProducts();
  const subscriptionIds = platformProductIds(currentCatalog.filter((product) => product.kind === "subscription"));
  const nonSubscriptionIds = platformProductIds(currentCatalog.filter((product) => product.kind !== "subscription"));
  if (!subscriptionIds.length && !nonSubscriptionIds.length) return fallbackStoreProducts();
  try {
    const [subscriptions, nonSubscriptions] = await Promise.all([
      subscriptionIds.length ? Purchases.getProducts(subscriptionIds, "SUBSCRIPTION") : Promise.resolve([]),
      nonSubscriptionIds.length ? Purchases.getProducts(nonSubscriptionIds, "NON_SUBSCRIPTION") : Promise.resolve([]),
    ]);
    const mapped = [...subscriptions, ...nonSubscriptions].flatMap((product) => {
      const productKey = productKeyForStoreProduct(product.identifier);
      return productKey ? [storeProductFromRevenueCatProduct(productKey, product)] : [];
    });
    return mergeStoreProducts(mapped);
  } catch {
    return fallbackStoreProducts();
  }
}

function paywallConfigFromOffering(placement: PaywallPlacement, offering: RevenueCatOffering, fallbackProducts: StoreProduct[]): PaywallConfig | null {
  const remoteProducts = (offering.availablePackages ?? []).flatMap((pkg) => {
    const productKey = productKeyForRevenueCatPackage(pkg);
    return productKey ? [storeProductFromRevenueCatProduct(productKey, pkg.product)] : [];
  });
  if (remoteProducts.length === 0) return null;
  lastOfferingPackages = offering.availablePackages ?? [];
  const metadata = parseOfferingMetadata(offering.metadata);
  const remoteProductKeys = new Set(remoteProducts.map((product) => product.productKey));
  const missingProductKeys = fallbackProductOrder.filter((productKey) => !remoteProductKeys.has(productKey));
  const mergedProducts = mergeStoreProducts(fallbackProducts, remoteProducts);
  const orderFromOffering = (offering.availablePackages ?? []).flatMap((pkg) => {
    const key = productKeyForRevenueCatPackage(pkg);
    return key ? [key] : [];
  });
  const visibleOrder = visibleProductOrder(uniqueProductOrder([...orderFromOffering, ...fallbackProductOrder]), metadata);
  const productOrder = visibleOrder.length ? visibleOrder : fallbackProductOrder;
  return {
    ...fallbackPaywallConfig(placement, mergedProducts),
    source: "revenuecat",
    ...(offering.identifier ? { offeringId: offering.identifier } : {}),
    products: mergedProducts.filter((product) => productOrder.includes(product.productKey)),
    productOrder,
    headline: metadata.headline ?? fallbackHeadline(placement),
    subtitle: metadata.subtitle ?? fallbackSubtitle(placement),
    primaryMode: metadata.primaryMode ?? fallbackPrimaryMode(placement),
    highlightedProduct: metadata.highlightedProduct,
    lifetimeBadge: metadata.lifetimeBadge,
    yearlyBadge: metadata.yearlyBadge,
    trialNote: metadata.trialNote ?? fallbackTrialNote(),
    footerNote: metadata.footerNote ?? fallbackFooterNote(),
    ...(missingProductKeys.length ? { diagnostics: `offering_missing_products:${missingProductKeys.join(",")}` } : {}),
  };
}

function fallbackPaywallConfig(placement: PaywallPlacement, products = fallbackStoreProducts(), diagnostics?: string): PaywallConfig {
  const primaryMode = fallbackPrimaryMode(placement);
  return {
    placement,
    source: "fallback",
    products: mergeStoreProducts(products).filter((product) => fallbackProductOrder.includes(product.productKey)),
    productOrder: fallbackProductOrder,
    headline: fallbackHeadline(placement),
    subtitle: fallbackSubtitle(placement),
    primaryMode,
    highlightedProduct: primaryMode === "hosted" ? "hosted_personal_yearly" : primaryMode === "lifetime" ? "lifetime_unlock" : "trial_7_day",
    lifetimeBadge: "Self-host forever",
    yearlyBadge: "Best value",
    trialNote: fallbackTrialNote(),
    footerNote: fallbackFooterNote(),
    ...(diagnostics ? { diagnostics } : {}),
  };
}

function parseOfferingMetadata(metadata: Record<string, unknown> | undefined): Partial<PaywallConfig> & { showTrial?: boolean; showLifetime?: boolean; showHosted?: boolean } {
  if (!metadata || typeof metadata !== "object") return {};
  const schemaVersion = typeof metadata.schema_version === "number" ? metadata.schema_version : metadata.schema_version === undefined ? 1 : NaN;
  if (schemaVersion !== 1) return {};
  const primaryMode = stringOption(metadata.primary_mode, ["trial", "hosted", "lifetime"] as const);
  const highlightedProduct = stringOption(metadata.highlight_product, fallbackProductOrder);
  return {
    ...(stringValue(metadata.headline, 120) ? { headline: stringValue(metadata.headline, 120) } : {}),
    ...(stringValue(metadata.subtitle, 240) ? { subtitle: stringValue(metadata.subtitle, 240) } : {}),
    ...(primaryMode ? { primaryMode } : {}),
    ...(highlightedProduct ? { highlightedProduct } : {}),
    ...(typeof metadata.show_trial === "boolean" ? { showTrial: metadata.show_trial } : {}),
    ...(typeof metadata.show_lifetime === "boolean" ? { showLifetime: metadata.show_lifetime } : {}),
    ...(typeof metadata.show_hosted === "boolean" ? { showHosted: metadata.show_hosted } : {}),
    ...(stringValue(metadata.lifetime_badge, 40) ? { lifetimeBadge: stringValue(metadata.lifetime_badge, 40) } : {}),
    ...(stringValue(metadata.yearly_badge, 40) ? { yearlyBadge: stringValue(metadata.yearly_badge, 40) } : {}),
    ...(stringValue(metadata.trial_note, 160) ? { trialNote: stringValue(metadata.trial_note, 160) } : {}),
    ...(stringValue(metadata.footer_note, 200) ? { footerNote: stringValue(metadata.footer_note, 200) } : {}),
  };
}

function visibleProductOrder(order: ProductKey[], metadata: Partial<PaywallConfig> & { showTrial?: boolean; showLifetime?: boolean; showHosted?: boolean }): ProductKey[] {
  const visible = order.filter((productKey) => {
    if (productKey === "trial_7_day") return metadata.showTrial !== false;
    if (productKey === "lifetime_unlock") return metadata.showLifetime !== false;
    if (productKey === "hosted_personal_monthly" || productKey === "hosted_personal_yearly") return metadata.showHosted !== false;
    return true;
  });
  return visible.length ? visible : order;
}

function revenueCatUseTestStore(): boolean {
  return ["1", "true", "yes"].includes(process.env.EXPO_PUBLIC_REVENUECAT_USE_TEST_STORE?.trim().toLowerCase() ?? "");
}

function revenueCatAPIKey(): string | undefined {
  const testStoreKey = process.env.EXPO_PUBLIC_REVENUECAT_TEST_STORE_API_KEY?.trim();
  if (revenueCatUseTestStore() && testStoreKey) return testStoreKey;
  if (Platform.OS === "ios") return process.env.EXPO_PUBLIC_REVENUECAT_IOS_API_KEY?.trim() || defaultRevenueCatIOSAPIKey;
  if (Platform.OS === "android") return process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY?.trim() || defaultRevenueCatAndroidAPIKey;
  return undefined;
}

function storeProductFromRevenueCatProduct(productKey: ProductKey, product: RevenueCatProduct): StoreProduct {
  return {
    productKey,
    productId: product.identifier,
    title: product.title || titleForProduct(productKey),
    ...(product.description ? { description: product.description } : {}),
    ...(product.priceString ? { priceString: product.priceString } : {})
  };
}

function productKeyForRevenueCatPackage(pkg: RevenueCatPackage): ProductKey | null {
  const packageType = pkg.packageType?.toUpperCase();
  const packageId = pkg.identifier.toLowerCase();
  if (packageId.includes("trial")) return "trial_7_day";
  if (packageType === "LIFETIME" || packageId.includes("lifetime")) return "lifetime_unlock";
  if (packageType === "MONTHLY" || packageId.includes("monthly")) return "hosted_personal_monthly";
  if (packageType === "ANNUAL" || packageType === "YEARLY" || packageId.includes("annual") || packageId.includes("yearly")) return "hosted_personal_yearly";
  return productKeyForStoreProduct(pkg.product.identifier);
}

function productKeyForStoreProduct(productId: string): ProductKey | null {
  const product = currentCatalog.find((candidate) => {
    if (Platform.OS === "ios") return candidate.appleProductId === productId;
    if (Platform.OS === "android") return candidate.googleProductId === productId && (candidate.productKey === "trial_7_day" || candidate.productKey === "lifetime_unlock");
    return false;
  });
  if (product) return product.productKey;
  if (isTrialProductId(productId)) return "trial_7_day";
  if (productId === "ai.selfdeprecated.agenttick.lifetime_unlock" || productId === "lifetime_unlock") return "lifetime_unlock";
  if (productId === "ai.selfdeprecated.agenttick.hosted_personal_monthly" || productId === "hosted_personal_monthly") return "hosted_personal_monthly";
  if (productId === "ai.selfdeprecated.agenttick.hosted_personal_yearly" || productId === "hosted_personal_yearly") return "hosted_personal_yearly";
  return null;
}

function productForKey(productKey: ProductKey): BillingProduct {
  return currentCatalog.find((candidate) => candidate.productKey === productKey) ?? fallbackCatalog.find((candidate) => candidate.productKey === productKey)!;
}

function platformProductIds(products: BillingProduct[]): string[] {
  return [...new Set(products.map(platformProductId).filter((productId): productId is string => Boolean(productId)))];
}

function platformProductId(product: BillingProduct): string | undefined {
  if (Platform.OS === "ios") return product.appleProductId;
  if (Platform.OS === "android") {
    if (product.productKey === "trial_7_day") return undefined;
    return product.googleProductId;
  }
  return undefined;
}

function purchaseTypeForProduct(product: BillingProduct): "subs" | "inapp" {
  return product.kind === "subscription" ? "subs" : "inapp";
}

function fallbackStoreProducts(): StoreProduct[] {
  return fallbackProductOrder.map((productKey) => ({
    productKey,
    productId: platformProductId(productForKey(productKey)) ?? productKey,
    title: titleForProduct(productKey),
    priceString: fallbackPriceForProduct(productKey),
  }));
}

function mergeCatalog(products: BillingProduct[]): BillingProduct[] {
  const byKey = new Map<ProductKey, BillingProduct>();
  for (const product of [...fallbackCatalog, ...products]) byKey.set(product.productKey, product);
  return fallbackProductOrder.flatMap((key) => {
    const product = byKey.get(key);
    return product ? [product] : [];
  });
}

function mergeStoreProducts(...groups: StoreProduct[][]): StoreProduct[] {
  const byKey = new Map<ProductKey, StoreProduct>();
  for (const product of fallbackStoreProducts()) byKey.set(product.productKey, product);
  for (const group of groups) {
    for (const product of group) byKey.set(product.productKey, { ...byKey.get(product.productKey), ...product });
  }
  return fallbackProductOrder.flatMap((key) => {
    const product = byKey.get(key);
    return product ? [product] : [];
  });
}

function uniqueProductOrder(order: ProductKey[]): ProductKey[] {
  return order.filter((key, index) => order.indexOf(key) === index);
}

function isUserCancelledPurchase(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const fields = error as { userCancelled?: unknown; code?: unknown };
  return fields.userCancelled === true || fields.code === "1" || fields.code === "PURCHASE_CANCELLED" || fields.code === "PURCHASE_CANCELLED_ERROR";
}

function titleForProduct(productKey: ProductKey): string {
  switch (productKey) {
    case "trial_7_day":
      return translateSource("7-day Trial");
    case "lifetime_unlock":
      return translateSource("Self-hosted Lifetime");
    case "hosted_personal_monthly":
      return translateSource("Hosted monthly");
    case "hosted_personal_yearly":
      return translateSource("Hosted yearly");
  }
}

function fallbackPriceForProduct(productKey: ProductKey): string {
  switch (productKey) {
    case "trial_7_day":
      return translateSource("Free");
    case "lifetime_unlock":
      return translateSource("One-time purchase");
    case "hosted_personal_monthly":
      return translateSource("Monthly");
    case "hosted_personal_yearly":
      return translateSource("Yearly");
  }
}

function fallbackTrialNote(): string {
  return Platform.OS === "android"
    ? "Free 7-day trial. No Google Play purchase starts."
    : "Free App Store purchase. No subscription starts.";
}

function fallbackFooterNote(): string {
  return Platform.OS === "android"
    ? "Paid digital access uses Google Play purchases."
    : "Digital access uses App Store in-app purchases.";
}

function fallbackHeadline(placement: PaywallPlacement): string {
  switch (placement) {
    case "expired_trial":
      return "Unlock responses";
    case "hosted_gate":
      return "Hosted responses require Hosted service";
    case "self_hosted_gate":
      return "Unlock self-hosted responses";
    default:
      return "Choose how to use Agent Tick";
  }
}

function fallbackSubtitle(placement: PaywallPlacement): string {
  switch (placement) {
    case "expired_trial":
      return "Your trial is over. Viewing still works; choose Hosted service or Self-hosted Lifetime to respond again.";
    case "hosted_gate":
      return "Subscribe to Hosted service to respond on agenttick.sh Requests, or keep self-hosted access separate with Lifetime.";
    case "self_hosted_gate":
      return "Self-hosted responses require an active Trial, Hosted subscription, or Self-hosted Lifetime unlock.";
    default:
      return "Route coding-agent Requests to your phone. Start free, self-host forever, or let us host it.";
  }
}

function fallbackPrimaryMode(placement: PaywallPlacement): PaywallConfig["primaryMode"] {
  if (placement === "hosted_gate" || placement === "expired_trial") return "hosted";
  if (placement === "self_hosted_gate") return "lifetime";
  return "trial";
}

function isTrialProductId(productId: string): boolean {
  return trialProductIds.has(productId.trim());
}

function trialEntitlementObjects(info: CustomerInfo): unknown[] {
  const entitlements = { ...info.entitlements?.all, ...info.entitlements?.active };
  return Object.entries(entitlements).flatMap(([key, value]) => key.toLowerCase().includes("trial") || key === "native_app_trial" ? [value] : []);
}

function transactionProductId(transaction: unknown): string | undefined {
  if (!transaction || typeof transaction !== "object") return undefined;
  const fields = transaction as Record<string, unknown>;
  const value = fields.productIdentifier ?? fields.productId ?? fields.product_id ?? fields.identifier;
  return typeof value === "string" ? value : undefined;
}

function transactionPurchaseDates(transaction: unknown): string[] {
  if (!transaction || typeof transaction !== "object") return [];
  const fields = transaction as Record<string, unknown>;
  const stringDates = [
    fields.purchaseDate,
    fields.purchase_date,
    fields.purchasedAt,
    fields.purchased_at,
    fields.latestPurchaseDate,
    fields.originalPurchaseDate,
  ].filter(validDateString);
  const millisDates = [
    fields.purchaseDateMillis,
    fields.purchase_date_ms,
    fields.purchasedAtMillis,
    fields.purchased_at_ms,
    fields.latestPurchaseDateMillis,
    fields.originalPurchaseDateMillis,
  ]
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value))
    .map((value) => new Date(value).toISOString());
  return [...stringDates, ...millisDates];
}

function transactionExpirationDates(transaction: unknown): string[] {
  if (!transaction || typeof transaction !== "object") return [];
  const fields = transaction as Record<string, unknown>;
  const stringDates = [
    fields.expirationDate,
    fields.expiration_date,
    fields.expiresAt,
    fields.expires_at,
  ].filter(validDateString);
  const millisDates = [fields.expirationDateMillis, fields.expiration_date_ms, fields.expiresAtMillis, fields.expires_at_ms]
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value))
    .map((value) => new Date(value).toISOString());
  return [...stringDates, ...millisDates];
}

function validDateString(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(new Date(value).getTime());
}

function stringValue(value: unknown, maxLength: number): string | undefined {
  return typeof value === "string" && value.trim() && value.length <= maxLength ? value.trim() : undefined;
}

function stringOption<T extends readonly string[]>(value: unknown, allowed: T): T[number] | undefined {
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? value as T[number] : undefined;
}
