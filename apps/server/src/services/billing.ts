import crypto from 'node:crypto';
import type {
  AsyncAgentTickStore as AgentTickStore,
  BillingProductRecord,
  BillingTransactionRecord,
  PersonalEntitlementRecord,
  UpsertBillingProductInput
} from '@agent-tick/db';
import type { ServerConfig } from '../config.js';
import { hostedPersonalStatus } from './personalEntitlements.js';

export type BillingProductKey = 'lifetime_unlock' | 'hosted_personal_monthly' | 'hosted_personal_yearly';
export type BillingPlatform = 'ios' | 'android';
export type BillingProvider = 'revenuecat' | 'apple' | 'google';
export type BillingEntitlementKey = 'lifetime_app_unlock' | 'hosted_personal';

type BillingProductGroup = 'app_unlock' | 'hosted_personal';
type TransactionStatus = 'purchased' | 'active' | 'renewed' | 'canceled' | 'expired' | 'refunded' | 'revoked' | 'failed';

const PURCHASE_ATTEMPT_LOCK_MS = 10 * 60 * 1000;

export const DEFAULT_BILLING_PRODUCTS: UpsertBillingProductInput[] = [
  {
    productKey: 'lifetime_unlock',
    kind: 'non_consumable',
    entitlementKey: 'lifetime_app_unlock',
    appleProductId: 'ai.selfdeprecated.agenttick.lifetime_unlock',
    googleProductId: 'lifetime_unlock'
  },
  {
    productKey: 'hosted_personal_monthly',
    kind: 'subscription',
    entitlementKey: 'hosted_personal',
    appleProductId: 'ai.selfdeprecated.agenttick.hosted_personal_monthly',
    googleProductId: 'hosted_personal',
    googleBasePlanId: 'monthly'
  },
  {
    productKey: 'hosted_personal_yearly',
    kind: 'subscription',
    entitlementKey: 'hosted_personal',
    appleProductId: 'ai.selfdeprecated.agenttick.hosted_personal_yearly',
    googleProductId: 'hosted_personal',
    googleBasePlanId: 'yearly'
  }
];

export interface PersonalBillingStatus {
  entitlement: PersonalEntitlementRecord;
  hostedPersonal: ReturnType<typeof hostedPersonalStatus>;
  products: BillingProductRecord[];
  activeEntitlements: {
    lifetimeUnlock: ActiveEntitlementStatus;
    hostedPersonal: ActiveEntitlementStatus;
  };
  purchaseAvailability: Record<BillingProductKey, PurchaseAvailability>;
}

export interface ActiveEntitlementStatus {
  active: boolean;
  originProvider?: string;
  originPlatform?: string;
  purchasedAt?: string;
  expiresAt?: string;
  willRenew?: boolean;
}

export interface PurchaseAvailability {
  allowed: boolean;
  reason?: string;
  originProvider?: string;
  originPlatform?: string;
}

export interface PurchasePreflightResult {
  purchaseAttemptId: string;
  providerUserId: string;
  allowed: true;
}

export interface VerifiedBillingTransaction {
  userId: string;
  provider: BillingProvider;
  environment: 'sandbox' | 'production' | 'unknown';
  productKey: BillingProductKey;
  entitlementKey: BillingEntitlementKey;
  platform: 'ios' | 'android' | 'unknown';
  providerTransactionId?: string;
  providerOriginalTransactionId?: string;
  providerPurchaseToken?: string;
  status: TransactionStatus;
  purchasedAt?: string;
  expiresAt?: string;
  canceledAt?: string | null;
  revokedAt?: string | null;
  rawEvent?: unknown;
}

export interface RecordVerifiedTransactionResult {
  transaction: BillingTransactionRecord;
  created: boolean;
  entitlement: PersonalEntitlementRecord;
}

export async function billingProducts(store: AgentTickStore, now = new Date().toISOString()): Promise<BillingProductRecord[]> {
  await store.upsertBillingProducts(DEFAULT_BILLING_PRODUCTS, now);
  return store.listBillingProducts(true);
}

export async function getPersonalBillingStatus(store: AgentTickStore, userId: string, config: Pick<ServerConfig, 'billingProvider'>, now = new Date()): Promise<PersonalBillingStatus> {
  const products = await billingProducts(store, now.toISOString());
  const entitlement = await recomputePersonalEntitlement(store, userId, now);
  const activeEntitlements = await activeEntitlementsForUser(store, userId, entitlement, now);
  const purchaseAvailability = await purchaseAvailabilityForUser(store, userId, activeEntitlements, config, now);
  return {
    entitlement,
    hostedPersonal: hostedPersonalStatus(entitlement, now),
    products,
    activeEntitlements,
    purchaseAvailability
  };
}

export async function preflightPurchase(store: AgentTickStore, config: Pick<ServerConfig, 'billingProvider'>, userId: string, platform: BillingPlatform, productKey: BillingProductKey, now = new Date()): Promise<PurchasePreflightResult> {
  if (config.billingProvider === 'none') throw billingError(409, 'billing_disabled', 'In-app purchases are not enabled for this server');
  const products = await billingProducts(store, now.toISOString());
  if (!products.some((product) => product.productKey === productKey && product.active)) throw billingError(404, 'product_not_found', 'Billing product is not available');

  const entitlement = await recomputePersonalEntitlement(store, userId, now);
  const activeEntitlements = await activeEntitlementsForUser(store, userId, entitlement, now);
  const availability = await purchaseAvailabilityForProduct(store, userId, productKey, activeEntitlements, config, now, platform);
  if (!availability.allowed) throw billingError(409, availability.reason ?? 'purchase_not_allowed', purchaseBlockedMessage(availability.reason, availability.originPlatform));

  const attempt = await store.createBillingPurchaseAttempt({
    userId,
    productKey,
    productGroup: productGroupForProduct(productKey),
    platform,
    provider: config.billingProvider,
    providerUserId: userId,
    idempotencyKey: `bpa_${crypto.randomUUID()}`,
    expiresAt: new Date(now.getTime() + PURCHASE_ATTEMPT_LOCK_MS).toISOString()
  }, now.toISOString());

  return { purchaseAttemptId: attempt.attemptId, providerUserId: userId, allowed: true };
}

export async function recordVerifiedTransaction(store: AgentTickStore, input: VerifiedBillingTransaction, now = new Date()): Promise<RecordVerifiedTransactionResult> {
  await billingProducts(store, now.toISOString());
  const result = await store.upsertBillingTransaction({
    userId: input.userId,
    provider: input.provider,
    environment: input.environment,
    productKey: input.productKey,
    entitlementKey: input.entitlementKey,
    platform: input.platform,
    ...(input.providerTransactionId ? { providerTransactionId: input.providerTransactionId } : {}),
    ...(input.providerOriginalTransactionId ? { providerOriginalTransactionId: input.providerOriginalTransactionId } : {}),
    ...(input.providerPurchaseToken ? { providerPurchaseToken: input.providerPurchaseToken } : {}),
    status: input.status,
    ...(input.purchasedAt ? { purchasedAt: input.purchasedAt } : {}),
    ...(input.expiresAt ? { expiresAt: input.expiresAt } : {}),
    ...(input.canceledAt !== undefined ? { canceledAt: input.canceledAt } : {}),
    ...(input.revokedAt !== undefined ? { revokedAt: input.revokedAt } : {}),
    ...(input.rawEvent ? { rawEventJSON: JSON.stringify(sanitizeBillingEvent(input.rawEvent)) } : {})
  }, now.toISOString());

  const productGroup = productGroupForProduct(input.productKey);
  const attempts = await store.listActiveBillingPurchaseAttempts(input.userId, productGroup, now.toISOString());
  await Promise.all(attempts.map((attempt) => store.updateBillingPurchaseAttemptStatus(attempt.attemptId, terminalAttemptStatus(input.status), now.toISOString())));

  const entitlement = await recomputePersonalEntitlement(store, input.userId, now);
  const membership = await store.defaultMembershipForUser(input.userId);
  await store.writeAuditEvent(membership.organizationId, input.userId, 'billing.transaction_recorded', result.record.transactionId, {
    provider: input.provider,
    environment: input.environment,
    productKey: input.productKey,
    entitlementKey: input.entitlementKey,
    platform: input.platform,
    status: input.status,
    created: result.created
  }, now.toISOString());

  return { transaction: result.record, created: result.created, entitlement };
}

export async function recomputePersonalEntitlement(store: AgentTickStore, userId: string, now = new Date()): Promise<PersonalEntitlementRecord> {
  const current = await store.getOrStartPersonalEntitlement(userId, now.toISOString());
  const transactions = await store.listBillingTransactionsForUser(userId);
  const lifetimeTransactions = transactions.filter((transaction) => transaction.entitlementKey === 'lifetime_app_unlock');
  const hostedTransactions = transactions.filter((transaction) => transaction.entitlementKey === 'hosted_personal');

  const activeLifetime = newestTransaction(lifetimeTransactions.filter(isActiveLifetimeTransaction));
  const hostedProjection = projectHostedSubscription(hostedTransactions, now);

  return store.updatePersonalEntitlement({
    userId,
    ...(lifetimeTransactions.length > 0 ? { appUnlockedAt: activeLifetime?.purchasedAt ?? activeLifetime?.createdAt ?? null } : {}),
    ...(hostedTransactions.length > 0 ? { hostedSubscriptionEndsAt: hostedProjection.endsAt ?? null, hostedSubscriptionCanceledAt: hostedProjection.canceledAt ?? null } : {})
  }, now.toISOString());
}

export function normalizeRevenueCatEvent(payload: unknown): VerifiedBillingTransaction | null {
  const event = revenueCatEvent(payload);
  if (!event) throw billingError(400, 'bad_request', 'Invalid RevenueCat webhook payload');

  const eventType = (stringField(event.type) ?? '').toUpperCase();
  if (eventType === 'TRANSFER' && !stringField(event.product_id)) return null;

  const userId = stringField(event.app_user_id) || stringField(event.original_app_user_id);
  const productKey = productKeyFromStoreProductId(stringField(event.product_id), stringField(event.base_plan_id) || stringField(event.google_base_plan_id));
  if (!productKey) return null;
  if (!userId) throw billingError(400, 'bad_request', 'RevenueCat event is missing app_user_id');

  const providerTransactionId = stringField(event.transaction_id) || stringField(event.id);
  const providerOriginalTransactionId = stringField(event.original_transaction_id);
  const providerPurchaseToken = stringField(event.purchase_token) || stringField(event.store_transaction_id);
  const purchasedAt = millisToISOString(numberField(event.purchased_at_ms) ?? numberField(event.event_timestamp_ms));
  const expiresAt = millisToISOString(numberField(event.expiration_at_ms));
  const canceledAt = revenueCatCanceledAt(eventType, event);
  const revokedAt = revenueCatRevokedAt(eventType, event);
  const clearsCancellation = revenueCatClearsCancellation(eventType);
  const clearsRevocation = revenueCatClearsRevocation(eventType);
  return {
    userId,
    provider: 'revenuecat',
    environment: revenueCatEnvironment(stringField(event.environment)),
    productKey,
    entitlementKey: entitlementKeyForProduct(productKey),
    platform: platformFromRevenueCatStore(stringField(event.store)),
    ...(providerTransactionId ? { providerTransactionId } : {}),
    ...(providerOriginalTransactionId ? { providerOriginalTransactionId } : {}),
    ...(providerPurchaseToken ? { providerPurchaseToken } : {}),
    status: revenueCatStatus(eventType),
    ...(purchasedAt ? { purchasedAt } : {}),
    ...(expiresAt ? { expiresAt } : {}),
    ...(canceledAt !== undefined ? { canceledAt } : clearsCancellation ? { canceledAt: null } : {}),
    ...(revokedAt !== undefined ? { revokedAt } : clearsRevocation ? { revokedAt: null } : {}),
    rawEvent: event
  };
}

export function productKeyFromStoreProductId(productId: string | undefined, basePlanId?: string): BillingProductKey | null {
  const normalized = productId?.trim();
  const normalizedBasePlan = basePlanId?.trim().toLowerCase();
  if (!normalized) return null;
  if (normalized === 'ai.selfdeprecated.agenttick.lifetime_unlock' || normalized === 'lifetime_unlock') return 'lifetime_unlock';
  if (normalized === 'ai.selfdeprecated.agenttick.hosted_personal_monthly' || normalized === 'hosted_personal_monthly' || normalized === 'hosted_personal:monthly') return 'hosted_personal_monthly';
  if (normalized === 'ai.selfdeprecated.agenttick.hosted_personal_yearly' || normalized === 'hosted_personal_yearly' || normalized === 'hosted_personal_yearly' || normalized === 'hosted_personal:yearly' || normalized === 'hosted_personal:annual') return 'hosted_personal_yearly';
  if (normalized === 'hosted_personal' && normalizedBasePlan === 'monthly') return 'hosted_personal_monthly';
  if (normalized === 'hosted_personal' && (normalizedBasePlan === 'yearly' || normalizedBasePlan === 'annual')) return 'hosted_personal_yearly';
  return null;
}

export function entitlementKeyForProduct(productKey: BillingProductKey): BillingEntitlementKey {
  return productKey === 'lifetime_unlock' ? 'lifetime_app_unlock' : 'hosted_personal';
}

function productGroupForProduct(productKey: BillingProductKey): BillingProductGroup {
  return productKey === 'lifetime_unlock' ? 'app_unlock' : 'hosted_personal';
}

async function activeEntitlementsForUser(store: AgentTickStore, userId: string, entitlement: PersonalEntitlementRecord, now: Date): Promise<PersonalBillingStatus['activeEntitlements']> {
  const transactions = await store.listBillingTransactionsForUser(userId);
  const lifetimeOrigin = newestTransaction(transactions.filter((transaction) => transaction.entitlementKey === 'lifetime_app_unlock' && isActiveLifetimeTransaction(transaction)));
  const hostedOrigin = newestTransaction(transactions.filter((transaction) => transaction.entitlementKey === 'hosted_personal' && isActiveHostedTransaction(transaction, now)));
  return {
    lifetimeUnlock: lifetimeOrigin
      ? activeEntitlementFromTransaction(lifetimeOrigin, true)
      : { active: Boolean(entitlement.appUnlockedAt), ...(entitlement.appUnlockedAt ? { purchasedAt: entitlement.appUnlockedAt } : {}) },
    hostedPersonal: hostedOrigin
      ? activeEntitlementFromTransaction(hostedOrigin, isRenewingHostedTransaction(hostedOrigin))
      : { active: false }
  };
}

async function purchaseAvailabilityForUser(store: AgentTickStore, userId: string, activeEntitlements: PersonalBillingStatus['activeEntitlements'], config: Pick<ServerConfig, 'billingProvider'>, now: Date): Promise<Record<BillingProductKey, PurchaseAvailability>> {
  return {
    lifetime_unlock: await purchaseAvailabilityForProduct(store, userId, 'lifetime_unlock', activeEntitlements, config, now),
    hosted_personal_monthly: await purchaseAvailabilityForProduct(store, userId, 'hosted_personal_monthly', activeEntitlements, config, now),
    hosted_personal_yearly: await purchaseAvailabilityForProduct(store, userId, 'hosted_personal_yearly', activeEntitlements, config, now)
  };
}

async function purchaseAvailabilityForProduct(store: AgentTickStore, userId: string, productKey: BillingProductKey, activeEntitlements: PersonalBillingStatus['activeEntitlements'], config: Pick<ServerConfig, 'billingProvider'>, now: Date, platform?: BillingPlatform): Promise<PurchaseAvailability> {
  if (productKey === 'lifetime_unlock' && activeEntitlements.lifetimeUnlock.active) {
    return {
      allowed: false,
      reason: 'already_unlocked',
      ...(activeEntitlements.lifetimeUnlock.originProvider ? { originProvider: activeEntitlements.lifetimeUnlock.originProvider } : {}),
      ...(activeEntitlements.lifetimeUnlock.originPlatform ? { originPlatform: activeEntitlements.lifetimeUnlock.originPlatform } : {})
    };
  }
  if (productKey !== 'lifetime_unlock' && activeEntitlements.hostedPersonal.active) {
    const originPlatform = activeEntitlements.hostedPersonal.originPlatform;
    return {
      allowed: false,
      reason: platform && originPlatform && originPlatform !== 'unknown' && originPlatform !== platform ? 'active_on_other_platform' : 'already_subscribed',
      ...(activeEntitlements.hostedPersonal.originProvider ? { originProvider: activeEntitlements.hostedPersonal.originProvider } : {}),
      ...(originPlatform ? { originPlatform } : {})
    };
  }
  if (config.billingProvider === 'none') return { allowed: false, reason: 'billing_disabled' };
  const locks = await store.listActiveBillingPurchaseAttempts(userId, productGroupForProduct(productKey), now.toISOString());
  if (locks.length > 0) return { allowed: false, reason: 'purchase_in_progress' };
  return { allowed: true };
}

function activeEntitlementFromTransaction(transaction: BillingTransactionRecord, willRenew: boolean): ActiveEntitlementStatus {
  return {
    active: true,
    originProvider: transaction.provider,
    originPlatform: transaction.platform,
    purchasedAt: transaction.purchasedAt ?? transaction.createdAt,
    ...(transaction.expiresAt ? { expiresAt: transaction.expiresAt } : {}),
    willRenew
  };
}

function isActiveLifetimeTransaction(transaction: BillingTransactionRecord): boolean {
  return ['purchased', 'active', 'renewed'].includes(transaction.status);
}

function isActiveHostedTransaction(transaction: BillingTransactionRecord, now: Date): boolean {
  if (!['purchased', 'active', 'renewed', 'canceled'].includes(transaction.status)) return false;
  return Boolean(transaction.expiresAt && new Date(transaction.expiresAt).getTime() > now.getTime());
}

function isRenewingHostedTransaction(transaction: BillingTransactionRecord): boolean {
  return ['purchased', 'active', 'renewed'].includes(transaction.status) && !transaction.canceledAt;
}

function projectHostedSubscription(transactions: BillingTransactionRecord[], now: Date): { endsAt?: string; canceledAt?: string } {
  const relevant = transactions.filter((transaction) => ['purchased', 'active', 'renewed', 'canceled', 'expired'].includes(transaction.status) && transaction.expiresAt);
  const newest = relevant.sort(compareTransactionExpiryDescending)[0];
  const canceled = transactions
    .filter((transaction) => ['canceled', 'expired'].includes(transaction.status) && transaction.canceledAt && transaction.expiresAt)
    .sort(compareTransactionExpiryDescending)[0];
  const active = transactions
    .filter((transaction) => isActiveHostedTransaction(transaction, now))
    .sort(compareTransactionExpiryDescending)[0];
  const endsAt = active?.expiresAt ?? newest?.expiresAt;
  const canceledAt = canceled?.canceledAt ?? (canceled ? canceled.updatedAt : undefined);
  return {
    ...(endsAt ? { endsAt } : {}),
    ...(canceledAt ? { canceledAt } : {})
  };
}

function newestTransaction(transactions: BillingTransactionRecord[]): BillingTransactionRecord | undefined {
  return [...transactions].sort((left, right) => new Date(right.purchasedAt ?? right.createdAt).getTime() - new Date(left.purchasedAt ?? left.createdAt).getTime())[0];
}

function compareTransactionExpiryDescending(left: BillingTransactionRecord, right: BillingTransactionRecord): number {
  return new Date(right.expiresAt ?? right.updatedAt).getTime() - new Date(left.expiresAt ?? left.updatedAt).getTime();
}

function terminalAttemptStatus(status: TransactionStatus): string {
  return ['failed', 'expired', 'refunded', 'revoked'].includes(status) ? 'failed' : 'completed';
}

function revenueCatEvent(payload: unknown): Record<string, unknown> | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const event = (payload as { event?: unknown }).event;
  if (!event || typeof event !== 'object' || Array.isArray(event)) return null;
  return event as Record<string, unknown>;
}

function revenueCatEnvironment(value: string | undefined): VerifiedBillingTransaction['environment'] {
  const normalized = value?.toLowerCase();
  if (normalized === 'production') return 'production';
  if (normalized === 'sandbox') return 'sandbox';
  return 'unknown';
}

function platformFromRevenueCatStore(value: string | undefined): VerifiedBillingTransaction['platform'] {
  const normalized = value?.toUpperCase();
  if (normalized === 'APP_STORE' || normalized === 'MAC_APP_STORE') return 'ios';
  if (normalized === 'PLAY_STORE') return 'android';
  return 'unknown';
}

function revenueCatStatus(type: string): TransactionStatus {
  switch (type) {
    case 'INITIAL_PURCHASE':
    case 'NON_RENEWING_PURCHASE':
      return 'purchased';
    case 'RENEWAL':
      return 'renewed';
    case 'UNCANCELLATION':
    case 'PRODUCT_CHANGE':
      return 'active';
    case 'CANCELLATION':
    case 'BILLING_ISSUE':
    case 'SUBSCRIPTION_PAUSED':
      return 'canceled';
    case 'EXPIRATION':
      return 'expired';
    case 'REFUND':
      return 'refunded';
    case 'REVOKE':
    case 'REVOKED':
      return 'revoked';
    default:
      return 'active';
  }
}

function revenueCatCanceledAt(type: string, event: Record<string, unknown>): string | undefined {
  if (!['CANCELLATION', 'BILLING_ISSUE', 'SUBSCRIPTION_PAUSED'].includes(type)) return undefined;
  return millisToISOString(numberField(event.event_timestamp_ms));
}

function revenueCatRevokedAt(type: string, event: Record<string, unknown>): string | undefined {
  if (!['REFUND', 'REVOKE', 'REVOKED'].includes(type)) return undefined;
  return millisToISOString(numberField(event.event_timestamp_ms));
}

function revenueCatClearsCancellation(type: string): boolean {
  return ['INITIAL_PURCHASE', 'RENEWAL', 'UNCANCELLATION', 'PRODUCT_CHANGE'].includes(type);
}

function revenueCatClearsRevocation(type: string): boolean {
  return ['INITIAL_PURCHASE', 'NON_RENEWING_PURCHASE', 'RENEWAL', 'UNCANCELLATION', 'PRODUCT_CHANGE'].includes(type);
}

function millisToISOString(value: number | undefined): string | undefined {
  if (value === undefined || !Number.isFinite(value)) return undefined;
  return new Date(value).toISOString();
}

function stringField(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function numberField(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function sanitizeBillingEvent(event: unknown): unknown {
  if (!event || typeof event !== 'object' || Array.isArray(event)) return {};
  const source = event as Record<string, unknown>;
  const safeKeys = [
    'id',
    'type',
    'app_user_id',
    'original_app_user_id',
    'product_id',
    'entitlement_id',
    'entitlement_ids',
    'environment',
    'store',
    'transaction_id',
    'original_transaction_id',
    'event_timestamp_ms',
    'purchased_at_ms',
    'expiration_at_ms',
    'base_plan_id',
    'google_base_plan_id'
  ];
  return Object.fromEntries(safeKeys.filter((key) => source[key] !== undefined).map((key) => [key, source[key]]));
}

function purchaseBlockedMessage(reason: string | undefined, originPlatform?: string): string {
  switch (reason) {
    case 'already_unlocked':
      return 'Lifetime app unlock is already active for this account';
    case 'already_subscribed':
      return 'Hosted service is already active for this account';
    case 'active_on_other_platform':
      return originPlatform === 'ios'
        ? 'Hosted service is active via Apple. Manage it on iOS or the App Store.'
        : originPlatform === 'android'
          ? 'Hosted service is active via Google. Manage it on Android or Google Play.'
          : 'Hosted service is already active on another platform.';
    case 'purchase_in_progress':
      return 'A purchase is already in progress. Wait a few minutes, then try again.';
    case 'billing_disabled':
      return 'In-app purchases are not enabled for this server';
    default:
      return 'Purchase is not available';
  }
}

export function billingError(statusCode: number, code: string, message: string): Error & { statusCode: number; code: string } {
  const error = new Error(message) as Error & { statusCode: number; code: string };
  error.statusCode = statusCode;
  error.code = code;
  return error;
}
