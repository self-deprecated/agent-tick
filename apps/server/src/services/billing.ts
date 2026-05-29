import crypto from 'node:crypto';
import type {
  AsyncAgentTickStore as AgentTickStore,
  BillingIdentityConflictRecord,
  BillingProductRecord,
  BillingTransactionRecord,
  PersonalEntitlementRecord,
  UpsertBillingProductInput
} from '@agent-tick/db';
import { hostedPersonalStatus, type NativeTrialStatus } from '@self-deprecated/agent-tick-shared';
import type { ServerConfig } from '../config.js';

export type BillingProductKey = 'trial_7_day' | 'lifetime_unlock' | 'hosted_personal_monthly' | 'hosted_personal_yearly';
export type BillingPlatform = 'ios' | 'android';
export type BillingProvider = 'revenuecat' | 'apple' | 'google';
export type BillingEntitlementKey = 'native_app_trial' | 'lifetime_app_unlock' | 'hosted_personal';

type BillingProductGroup = 'native_app_trial' | 'app_unlock' | 'hosted_personal';
type TransactionStatus = 'purchased' | 'active' | 'renewed' | 'canceled' | 'expired' | 'refunded' | 'revoked' | 'failed';

const PURCHASE_ATTEMPT_LOCK_MS = 10 * 60 * 1000;

export const DEFAULT_BILLING_PRODUCTS: UpsertBillingProductInput[] = [
  {
    productKey: 'trial_7_day',
    kind: 'non_consumable',
    entitlementKey: 'native_app_trial',
    appleProductId: 'ai.selfdeprecated.agenttick.initial_trial.7',
    googleProductId: 'trial_7_day'
  },
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
    trial7Day: ActiveEntitlementStatus;
    lifetimeUnlock: ActiveEntitlementStatus;
    hostedPersonal: ActiveEntitlementStatus;
  };
  purchaseAvailability: Record<BillingProductKey, PurchaseAvailability>;
  billingConflicts: BillingIdentityConflictStatus[];
}

export interface BillingIdentityConflictStatus {
  code: 'receipt_owned_by_another_account';
  productKey: BillingProductKey;
  entitlementKey: Extract<BillingEntitlementKey, 'native_app_trial' | 'hosted_personal'>;
  platform: 'ios' | 'android' | 'unknown';
  createdAt: string;
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

export interface RevenueCatTransfer {
  provider: 'revenuecat';
  environment?: VerifiedBillingTransaction['environment'];
  platform?: VerifiedBillingTransaction['platform'];
  transferredFrom: string[];
  transferredTo: string[];
  rawEvent: unknown;
}

export interface RevenueCatTransferResult {
  processed: boolean;
  transferredTransactions: number;
  receiptOwnersTransferred: number;
  destinationUserIds: string[];
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
  transaction?: BillingTransactionRecord;
  created: boolean;
  entitlement: PersonalEntitlementRecord;
  conflict?: BillingIdentityConflictStatus;
}

export async function billingProducts(store: AgentTickStore, now = new Date().toISOString()): Promise<BillingProductRecord[]> {
  await store.upsertBillingProducts(DEFAULT_BILLING_PRODUCTS, now);
  return store.listBillingProducts(true);
}

export async function getPersonalBillingStatus(store: AgentTickStore, userId: string, config: Pick<ServerConfig, 'billingProvider'>, now = new Date()): Promise<PersonalBillingStatus> {
  const products = await billingProducts(store, now.toISOString());
  const entitlement = await recomputePersonalEntitlement(store, userId, now);
  const activeEntitlements = await activeEntitlementsForUser(store, userId, entitlement, now);
  const nativeTrial = await nativeTrialStatusForUser(store, userId, activeEntitlements.trial7Day.purchasedAt);
  const purchaseAvailability = await purchaseAvailabilityForUser(store, userId, entitlement, activeEntitlements, config, now);
  const billingConflicts = (await store.listBillingIdentityConflictsForUser(userId)).map(billingIdentityConflictStatus);
  return {
    entitlement,
    hostedPersonal: hostedPersonalStatus(entitlement, now, { nativeTrial }),
    products,
    activeEntitlements,
    purchaseAvailability,
    billingConflicts
  };
}

export async function preflightPurchase(store: AgentTickStore, config: Pick<ServerConfig, 'billingProvider'>, userId: string, platform: BillingPlatform, productKey: BillingProductKey, now = new Date()): Promise<PurchasePreflightResult> {
  if (config.billingProvider === 'none') throw billingError(409, 'billing_disabled', 'In-app purchases are not enabled for this server');
  const products = await billingProducts(store, now.toISOString());
  if (!products.some((product) => product.productKey === productKey && product.active)) throw billingError(404, 'product_not_found', 'Billing product is not available');

  const entitlement = await recomputePersonalEntitlement(store, userId, now);
  const activeEntitlements = await activeEntitlementsForUser(store, userId, entitlement, now);
  const availability = await purchaseAvailabilityForProduct(store, userId, productKey, entitlement, activeEntitlements, config, now, platform);
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

export async function cancelPurchaseAttempt(store: AgentTickStore, userId: string, productKey: BillingProductKey, purchaseAttemptId: string, now = new Date()): Promise<boolean> {
  const attempts = await store.listActiveBillingPurchaseAttempts(userId, productGroupForProduct(productKey), now.toISOString());
  const attempt = attempts.find((candidate) => candidate.attemptId === purchaseAttemptId && candidate.productKey === productKey);
  if (!attempt) return false;
  await store.updateBillingPurchaseAttemptStatus(attempt.attemptId, 'canceled', now.toISOString());
  return true;
}

export async function recordVerifiedTransaction(store: AgentTickStore, input: VerifiedBillingTransaction, now = new Date()): Promise<RecordVerifiedTransactionResult> {
  await billingProducts(store, now.toISOString());
  const receiptKey = accountBoundReceiptKey(input);
  if (receiptKey) {
    const owner = await store.claimBillingReceiptOwner({
      provider: input.provider,
      environment: input.environment,
      platform: input.platform,
      entitlementKey: input.entitlementKey,
      receiptKey,
      productKey: input.productKey,
      ownerUserId: input.userId,
    }, now.toISOString());
    if (!owner.ownedByCurrentUser) {
      const conflictRecord = await store.upsertBillingIdentityConflict({
        userId: input.userId,
        provider: input.provider,
        environment: input.environment,
        platform: input.platform,
        productKey: input.productKey,
        entitlementKey: input.entitlementKey,
        receiptKey,
        code: 'receipt_owned_by_another_account',
      }, now.toISOString());
      const productGroup = productGroupForProduct(input.productKey);
      const attempts = await store.listActiveBillingPurchaseAttempts(input.userId, productGroup, now.toISOString());
      await Promise.all(attempts.map((attempt) => store.updateBillingPurchaseAttemptStatus(attempt.attemptId, 'failed', now.toISOString())));
      const entitlement = await recomputePersonalEntitlement(store, input.userId, now);
      const membership = await store.defaultMembershipForUser(input.userId);
      await store.writeAuditEvent(membership.workspaceId, input.userId, 'billing.identity_conflict', conflictRecord.conflictId, {
        provider: input.provider,
        environment: input.environment,
        productKey: input.productKey,
        entitlementKey: input.entitlementKey,
        platform: input.platform,
        code: conflictRecord.code
      }, now.toISOString());
      return { created: false, entitlement, conflict: billingIdentityConflictStatus(conflictRecord) };
    }
  }

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
  await store.writeAuditEvent(membership.workspaceId, input.userId, 'billing.transaction_recorded', result.record.transactionId, {
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
  const activeLifetimeUnlockedAt = activeLifetime?.purchasedAt ?? activeLifetime?.createdAt;
  const effectiveAppUnlockedAt = lifetimeTransactions.length > 0 ? activeLifetimeUnlockedAt ?? null : current.appUnlockedAt;
  const hostedProjection = projectHostedSubscription(hostedTransactions, now);

  return store.updatePersonalEntitlement({
    userId,
    ...(lifetimeTransactions.length > 0 ? { appUnlockedAt: effectiveAppUnlockedAt } : {}),
    ...(hostedTransactions.length > 0 ? { hostedSubscriptionEndsAt: hostedProjection.endsAt ?? null, hostedSubscriptionCanceledAt: hostedProjection.canceledAt ?? null } : {})
  }, now.toISOString());
}

export async function recordRevenueCatTransfer(store: AgentTickStore, transfer: RevenueCatTransfer, now = new Date()): Promise<RevenueCatTransferResult> {
  const destinationCandidates = [...new Set(transfer.transferredTo.map((userId) => userId.trim()).filter(Boolean))];
  const sourceUserIds = [...new Set(transfer.transferredFrom.map((userId) => userId.trim()).filter(Boolean))];
  const destinationUserIds = (await Promise.all(destinationCandidates.map(async (userId) => {
    try {
      await store.defaultMembershipForUser(userId);
      return userId;
    } catch {
      return null;
    }
  }))).filter((userId): userId is string => Boolean(userId));
  if (destinationUserIds.length === 0 || sourceUserIds.length === 0) {
    return { processed: false, transferredTransactions: 0, receiptOwnersTransferred: 0, destinationUserIds };
  }

  let transferredTransactions = 0;
  let receiptOwnersTransferred = 0;
  for (const destinationUserId of destinationUserIds) {
    const result = await store.transferAccountBoundBillingPurchases({
      provider: transfer.provider,
      ...(transfer.environment ? { environment: transfer.environment } : {}),
      ...(transfer.platform ? { platform: transfer.platform } : {}),
      fromUserIds: sourceUserIds,
      toUserId: destinationUserId,
      rawEventJSON: JSON.stringify(sanitizeBillingEvent(transfer.rawEvent)),
    }, now.toISOString());
    let recoveredTrialTransaction: BillingTransactionRecord | undefined;
    if (result.transactions.length === 0 && result.receiptOwnersTransferred === 0) {
      recoveredTrialTransaction = await recoverPendingNativeTrialFromRevenueCatTransfer(store, transfer, destinationUserId, now);
    }
    transferredTransactions += result.transactions.length + (recoveredTrialTransaction ? 1 : 0);
    receiptOwnersTransferred += result.receiptOwnersTransferred + (recoveredTrialTransaction ? 1 : 0);

    const groups = new Map<BillingProductGroup, TransactionStatus>();
    for (const transaction of result.transactions) groups.set(productGroupForProduct(transaction.productKey as BillingProductKey), transaction.status as TransactionStatus);
    await Promise.all([...groups].map(async ([productGroup, status]) => {
      const attempts = await store.listActiveBillingPurchaseAttempts(destinationUserId, productGroup, now.toISOString());
      await Promise.all(attempts.map((attempt) => store.updateBillingPurchaseAttemptStatus(attempt.attemptId, terminalAttemptStatus(status), now.toISOString())));
    }));

    const entitlement = await recomputePersonalEntitlement(store, destinationUserId, now);
    if (result.transactions.length > 0 || recoveredTrialTransaction) {
      const membership = await store.defaultMembershipForUser(destinationUserId);
      await store.writeAuditEvent(membership.workspaceId, destinationUserId, 'billing.transfer_recorded', destinationUserId, {
        provider: transfer.provider,
        environment: transfer.environment,
        platform: transfer.platform,
        transferredFrom: sourceUserIds,
        transferredTransactions: result.transactions.length + (recoveredTrialTransaction ? 1 : 0),
        receiptOwnersTransferred: result.receiptOwnersTransferred + (recoveredTrialTransaction ? 1 : 0),
        recoveredPendingTrial: Boolean(recoveredTrialTransaction),
        hostedSubscriptionEndsAt: entitlement.hostedSubscriptionEndsAt,
      }, now.toISOString());
    }
  }

  return { processed: transferredTransactions > 0 || receiptOwnersTransferred > 0, transferredTransactions, receiptOwnersTransferred, destinationUserIds };
}

async function recoverPendingNativeTrialFromRevenueCatTransfer(store: AgentTickStore, transfer: RevenueCatTransfer, destinationUserId: string, now: Date): Promise<BillingTransactionRecord | undefined> {
  const attempts = await store.listActiveBillingPurchaseAttempts(destinationUserId, 'native_app_trial', now.toISOString());
  const trialAttempts = attempts.filter((attempt) => attempt.productKey === 'trial_7_day');
  if (trialAttempts.length !== 1) return undefined;
  const event = transfer.rawEvent && typeof transfer.rawEvent === 'object' && !Array.isArray(transfer.rawEvent) ? transfer.rawEvent as Record<string, unknown> : {};
  const purchasedAt = millisToISOString(numberField(event.event_timestamp_ms)) ?? now.toISOString();
  const syntheticReceiptKey = `revenuecat_transfer_trial_${crypto.createHash('sha256').update(JSON.stringify({ destinationUserId, purchasedAt, transferredFrom: transfer.transferredFrom, transferredTo: transfer.transferredTo })).digest('base64url').slice(0, 24)}`;
  const result = await recordVerifiedTransaction(store, {
    userId: destinationUserId,
    provider: transfer.provider,
    environment: transfer.environment ?? 'unknown',
    productKey: 'trial_7_day',
    entitlementKey: 'native_app_trial',
    platform: transfer.platform ?? 'unknown',
    providerTransactionId: syntheticReceiptKey,
    providerOriginalTransactionId: syntheticReceiptKey,
    status: 'purchased',
    purchasedAt,
    rawEvent: transfer.rawEvent,
  }, now);
  return result.transaction;
}

export function normalizeRevenueCatTransferEvent(payload: unknown): RevenueCatTransfer | null {
  const event = revenueCatEvent(payload);
  if (!event) throw billingError(400, 'bad_request', 'Invalid RevenueCat webhook payload');
  const eventType = (stringField(event.type) ?? '').toUpperCase();
  if (eventType !== 'TRANSFER') return null;
  return {
    provider: 'revenuecat',
    environment: revenueCatEnvironment(stringField(event.environment)),
    platform: platformFromRevenueCatStore(stringField(event.store)),
    transferredFrom: stringArrayField(event.transferred_from),
    transferredTo: stringArrayField(event.transferred_to),
    rawEvent: event,
  };
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
  if (
    normalized === 'ai.selfdeprecated.agenttick.initial_trial.7'
    || normalized === 'initial_trial.7'
    || normalized === 'ai.selfdeprecated.agenttick.trial_7_day'
    || normalized === 'trial_7_day'
    || normalized === 'trial'
  ) return 'trial_7_day';
  if (normalized === 'ai.selfdeprecated.agenttick.lifetime_unlock' || normalized === 'lifetime_unlock' || normalized === 'lifetime') return 'lifetime_unlock';
  if (normalized === 'ai.selfdeprecated.agenttick.hosted_personal_monthly' || normalized === 'hosted_personal_monthly' || normalized === 'hosted_personal:monthly' || normalized === 'monthly') return 'hosted_personal_monthly';
  if (normalized === 'ai.selfdeprecated.agenttick.hosted_personal_yearly' || normalized === 'hosted_personal_yearly' || normalized === 'hosted_personal:yearly' || normalized === 'hosted_personal:annual' || normalized === 'yearly' || normalized === 'annual') return 'hosted_personal_yearly';
  if (normalized === 'hosted_personal' && normalizedBasePlan === 'monthly') return 'hosted_personal_monthly';
  if (normalized === 'hosted_personal' && (normalizedBasePlan === 'yearly' || normalizedBasePlan === 'annual')) return 'hosted_personal_yearly';
  return null;
}

export function entitlementKeyForProduct(productKey: BillingProductKey): BillingEntitlementKey {
  if (productKey === 'trial_7_day') return 'native_app_trial';
  return productKey === 'lifetime_unlock' ? 'lifetime_app_unlock' : 'hosted_personal';
}

function productGroupForProduct(productKey: BillingProductKey): BillingProductGroup {
  if (productKey === 'trial_7_day') return 'native_app_trial';
  return productKey === 'lifetime_unlock' ? 'app_unlock' : 'hosted_personal';
}

function accountBoundReceiptKey(input: VerifiedBillingTransaction): string | null {
  if (input.entitlementKey !== 'hosted_personal' && input.entitlementKey !== 'native_app_trial') return null;
  return input.providerOriginalTransactionId ?? input.providerPurchaseToken ?? input.providerTransactionId ?? null;
}

function billingIdentityConflictStatus(record: BillingIdentityConflictRecord): BillingIdentityConflictStatus {
  return {
    code: 'receipt_owned_by_another_account',
    productKey: record.productKey as BillingProductKey,
    entitlementKey: record.entitlementKey as Extract<BillingEntitlementKey, 'native_app_trial' | 'hosted_personal'>,
    platform: record.platform as 'ios' | 'android' | 'unknown',
    createdAt: record.createdAt,
  };
}

async function activeEntitlementsForUser(store: AgentTickStore, userId: string, entitlement: PersonalEntitlementRecord, now: Date): Promise<PersonalBillingStatus['activeEntitlements']> {
  const transactions = await store.listBillingTransactionsForUser(userId);
  const trialOrigin = newestTransaction(transactions.filter((transaction) => transaction.entitlementKey === 'native_app_trial' && isActiveTrialTransaction(transaction, now)));
  const lifetimeOrigin = newestTransaction(transactions.filter((transaction) => transaction.entitlementKey === 'lifetime_app_unlock' && isActiveLifetimeTransaction(transaction)));
  const lifetimeUnlock = lifetimeOrigin
    ? activeEntitlementFromTransaction(lifetimeOrigin, true)
    : { active: Boolean(entitlement.appUnlockedAt), ...(entitlement.appUnlockedAt ? { purchasedAt: entitlement.appUnlockedAt } : {}) };
  const hostedOrigin = newestTransaction(transactions.filter((transaction) => transaction.entitlementKey === 'hosted_personal' && isActiveHostedTransaction(transaction, now)));
  return {
    trial7Day: trialOrigin
      ? activeEntitlementFromTransaction(trialOrigin, false, trialEndsAtForTransaction(trialOrigin))
      : { active: false },
    lifetimeUnlock,
    hostedPersonal: hostedOrigin
      ? activeEntitlementFromTransaction(hostedOrigin, isRenewingHostedTransaction(hostedOrigin))
      : { active: false }
  };
}

async function nativeTrialStatusForUser(store: AgentTickStore, userId: string, activeStartedAt?: string): Promise<NativeTrialStatus> {
  const trialTransactions = (await store.listBillingTransactionsForUser(userId))
    .filter((transaction) => transaction.entitlementKey === 'native_app_trial' && ['purchased', 'active', 'renewed', 'canceled', 'expired', 'refunded', 'revoked'].includes(transaction.status))
    .sort((left, right) => new Date(right.purchasedAt ?? right.createdAt).getTime() - new Date(left.purchasedAt ?? left.createdAt).getTime());
  const newest = trialTransactions[0];
  const startedAt = activeStartedAt ?? newest?.purchasedAt ?? newest?.createdAt;
  return { active: Boolean(activeStartedAt), ...(startedAt ? { startedAt } : {}) };
}

async function purchaseAvailabilityForUser(store: AgentTickStore, userId: string, entitlement: PersonalEntitlementRecord, activeEntitlements: PersonalBillingStatus['activeEntitlements'], config: Pick<ServerConfig, 'billingProvider'>, now: Date): Promise<Record<BillingProductKey, PurchaseAvailability>> {
  return {
    trial_7_day: await purchaseAvailabilityForProduct(store, userId, 'trial_7_day', entitlement, activeEntitlements, config, now),
    lifetime_unlock: await purchaseAvailabilityForProduct(store, userId, 'lifetime_unlock', entitlement, activeEntitlements, config, now),
    hosted_personal_monthly: await purchaseAvailabilityForProduct(store, userId, 'hosted_personal_monthly', entitlement, activeEntitlements, config, now),
    hosted_personal_yearly: await purchaseAvailabilityForProduct(store, userId, 'hosted_personal_yearly', entitlement, activeEntitlements, config, now)
  };
}

async function purchaseAvailabilityForProduct(store: AgentTickStore, userId: string, productKey: BillingProductKey, entitlement: PersonalEntitlementRecord, activeEntitlements: PersonalBillingStatus['activeEntitlements'], config: Pick<ServerConfig, 'billingProvider'>, now: Date, platform?: BillingPlatform): Promise<PurchaseAvailability> {
  if (productKey === 'trial_7_day') {
    const transactions = await store.listBillingTransactionsForUser(userId);
    if (transactions.some((transaction) => transaction.productKey === 'trial_7_day' || transaction.entitlementKey === 'native_app_trial')) {
      return { allowed: false, reason: 'trial_already_started' };
    }
  }
  if (productKey === 'lifetime_unlock' && activeEntitlements.lifetimeUnlock.active) {
    return {
      allowed: false,
      reason: 'already_unlocked',
      ...(activeEntitlements.lifetimeUnlock.originProvider ? { originProvider: activeEntitlements.lifetimeUnlock.originProvider } : {}),
      ...(activeEntitlements.lifetimeUnlock.originPlatform ? { originPlatform: activeEntitlements.lifetimeUnlock.originPlatform } : {})
    };
  }
  if (productKey === 'hosted_personal_monthly' || productKey === 'hosted_personal_yearly') {
    if (activeEntitlements.hostedPersonal.active) {
      const originPlatform = activeEntitlements.hostedPersonal.originPlatform;
      return {
        allowed: false,
        reason: platform && originPlatform && originPlatform !== 'unknown' && originPlatform !== platform ? 'active_on_other_platform' : 'already_subscribed',
        ...(activeEntitlements.hostedPersonal.originProvider ? { originProvider: activeEntitlements.hostedPersonal.originProvider } : {}),
        ...(originPlatform ? { originPlatform } : {})
      };
    }
    if (entitlement.hostedSubscriptionEndsAt && new Date(entitlement.hostedSubscriptionEndsAt).getTime() > now.getTime()) return { allowed: false, reason: 'already_subscribed' };
  }
  if (config.billingProvider === 'none') return { allowed: false, reason: 'billing_disabled' };
  const locks = await store.listActiveBillingPurchaseAttempts(userId, productGroupForProduct(productKey), now.toISOString());
  if (locks.length > 0) return { allowed: false, reason: 'purchase_in_progress' };
  return { allowed: true };
}

function activeEntitlementFromTransaction(transaction: BillingTransactionRecord, willRenew: boolean, expiresAtOverride?: string): ActiveEntitlementStatus {
  const expiresAt = expiresAtOverride ?? transaction.expiresAt;
  return {
    active: true,
    originProvider: transaction.provider,
    originPlatform: transaction.platform,
    purchasedAt: transaction.purchasedAt ?? transaction.createdAt,
    ...(expiresAt ? { expiresAt } : {}),
    willRenew
  };
}

function isActiveTrialTransaction(transaction: BillingTransactionRecord, now: Date): boolean {
  if (!['purchased', 'active', 'renewed'].includes(transaction.status)) return false;
  const expiresAt = trialEndsAtForTransaction(transaction);
  return Boolean(expiresAt && new Date(expiresAt).getTime() > now.getTime());
}

function trialEndsAtForTransaction(transaction: BillingTransactionRecord): string | undefined {
  const purchasedAt = transaction.purchasedAt ?? transaction.createdAt;
  return purchasedAt ? new Date(new Date(purchasedAt).getTime() + 7 * 24 * 60 * 60 * 1000).toISOString() : undefined;
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

function stringArrayField(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const text = stringField(item);
    return text ? [text] : [];
  });
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
    case 'trial_already_started':
      return 'The 7-day Trial has already been started for this account';
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
    case 'app_purchase_required':
      return 'A qualifying app access purchase is required before this action.';
    case 'trial_active':
      return 'Hosted personal service is included during Trial.';
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
