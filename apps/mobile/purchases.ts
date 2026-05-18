import { Linking, Platform } from "react-native";
import type { BillingProduct, BillingProductKey } from "@agent-tick/shared";

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

type RevenueCatOfferings = {
  current?: {
    availablePackages?: RevenueCatPackage[];
  } | null;
};

type RevenueCatStatic = {
  configure(config: { apiKey: string; appUserID?: string }): void;
  getOfferings?: () => Promise<RevenueCatOfferings>;
  getProducts?: (productIds: string[], type?: string) => Promise<RevenueCatProduct[]>;
  purchasePackage?: (pkg: RevenueCatPackage) => Promise<unknown>;
  purchaseProduct?: (productId: string) => Promise<unknown>;
  restorePurchases?: () => Promise<unknown>;
  logIn?: (appUserID: string) => Promise<unknown>;
};

const fallbackCatalog: BillingProduct[] = [
  {
    productKey: "lifetime_unlock",
    kind: "non_consumable",
    entitlementKey: "lifetime_app_unlock",
    appleProductId: "ai.selfdeprecated.agenttick.lifetime_unlock",
    googleProductId: "lifetime_unlock",
    active: true,
  },
  {
    productKey: "hosted_personal_monthly",
    kind: "subscription",
    entitlementKey: "hosted_personal",
    appleProductId: "ai.selfdeprecated.agenttick.hosted_personal_monthly",
    googleProductId: "hosted_personal",
    googleBasePlanId: "monthly",
    active: true,
  },
  {
    productKey: "hosted_personal_yearly",
    kind: "subscription",
    entitlementKey: "hosted_personal",
    appleProductId: "ai.selfdeprecated.agenttick.hosted_personal_yearly",
    googleProductId: "hosted_personal",
    googleBasePlanId: "yearly",
    active: true,
  },
];

let configuredUserID: string | null = null;
let currentCatalog: BillingProduct[] = fallbackCatalog;

export function setPurchaseCatalog(products: BillingProduct[]): void {
  const active = products.filter((product) => product.active !== false);
  currentCatalog = active.length ? active : fallbackCatalog;
}

export async function configurePurchases(userId: string): Promise<void> {
  const apiKey = revenueCatAPIKey();
  if (!apiKey) throw new Error("RevenueCat API key is not configured for this platform");
  const Purchases = await loadRevenueCat();
  if (configuredUserID === userId) return;
  Purchases.configure({ apiKey, appUserID: userId });
  configuredUserID = userId;
}

export async function loadStoreProducts(): Promise<StoreProduct[]> {
  const Purchases = await loadRevenueCat();
  const packages = await revenueCatPackages(Purchases);
  if (packages.length > 0) {
    return packages.flatMap((pkg) => {
      const productKey = productKeyForRevenueCatPackage(pkg);
      return productKey ? [storeProductFromRevenueCatProduct(productKey, pkg.product)] : [];
    });
  }

  const productIds = platformProductIds(currentCatalog);
  if (!productIds.length || !Purchases.getProducts) return [];
  const products = await Purchases.getProducts(productIds);
  return products.flatMap((product) => {
    const productKey = productKeyForStoreProduct(product.identifier);
    return productKey ? [storeProductFromRevenueCatProduct(productKey, product)] : [];
  });
}

export async function purchaseProduct(productKey: ProductKey): Promise<PurchaseResult> {
  const Purchases = await loadRevenueCat();
  const packages = await revenueCatPackages(Purchases);
  const pkg = packages.find((candidate) => productKeyForRevenueCatPackage(candidate) === productKey);
  try {
    if (pkg && Purchases.purchasePackage) {
      await Purchases.purchasePackage(pkg);
      return { success: true };
    }
    const productId = platformProductId(productForKey(productKey));
    if (!productId || !Purchases.purchaseProduct) throw new Error("Store product is not configured for this platform");
    if (productKey !== "lifetime_unlock" && packages.length === 0) throw new Error("Hosted subscription offerings are not configured in RevenueCat");
    await Purchases.purchaseProduct(productId);
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
  const mod = (await import("react-native-purchases")) as unknown as RevenueCatStatic & { default?: RevenueCatStatic };
  return mod.default ?? mod;
}

async function revenueCatPackages(Purchases: RevenueCatStatic): Promise<RevenueCatPackage[]> {
  if (!Purchases.getOfferings) return [];
  const offerings = await Purchases.getOfferings();
  return offerings.current?.availablePackages ?? [];
}

function revenueCatAPIKey(): string | undefined {
  if (Platform.OS === "ios") return process.env.EXPO_PUBLIC_REVENUECAT_IOS_API_KEY?.trim() || undefined;
  if (Platform.OS === "android") return process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY?.trim() || undefined;
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
  if (packageType === "LIFETIME" || packageId.includes("lifetime")) return "lifetime_unlock";
  if (packageType === "MONTHLY" || packageId.includes("monthly")) return "hosted_personal_monthly";
  if (packageType === "ANNUAL" || packageType === "YEARLY" || packageId.includes("annual") || packageId.includes("yearly")) return "hosted_personal_yearly";
  return productKeyForStoreProduct(pkg.product.identifier);
}

function productKeyForStoreProduct(productId: string): ProductKey | null {
  const product = currentCatalog.find((candidate) => {
    if (Platform.OS === "ios") return candidate.appleProductId === productId;
    if (Platform.OS === "android") return candidate.googleProductId === productId && candidate.productKey === "lifetime_unlock";
    return false;
  });
  if (product) return product.productKey;
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
  if (Platform.OS === "android") return product.googleProductId;
  return undefined;
}

function isUserCancelledPurchase(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const fields = error as { userCancelled?: unknown; code?: unknown };
  return fields.userCancelled === true || fields.code === "1" || fields.code === "PURCHASE_CANCELLED";
}

function titleForProduct(productKey: ProductKey): string {
  switch (productKey) {
    case "lifetime_unlock":
      return "Lifetime app unlock";
    case "hosted_personal_monthly":
      return "Hosted personal monthly";
    case "hosted_personal_yearly":
      return "Hosted personal yearly";
  }
}
