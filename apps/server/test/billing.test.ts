import { afterEach, describe, expect, it } from 'vitest';
import { AgentTickStore, DEFAULT_USER_ID } from '@agent-tick/db';
import { hostedPersonalStatus } from '@self-deprecated/agent-tick-shared';
import { billingProducts, cancelPurchaseAttempt, getPersonalBillingStatus, normalizeRevenueCatEvent, normalizeRevenueCatTransferEvent, preflightPurchase, productKeyFromStoreProductId, recordRevenueCatTransfer, recordVerifiedTransaction, startNativeTrial } from '../src/services/billing.js';

let store: AgentTickStore | undefined;

const revenueCatConfig = { billingProvider: 'revenuecat' as const };
const now = new Date('2026-05-10T00:00:00.000Z');

function testStore(): AgentTickStore {
  const next = AgentTickStore.open({ databaseURL: ':memory:' });
  next.migrate();
  next.ensureSingleTenantDefaults('2026-05-01T00:00:00.000Z');
  store = next;
  return next;
}

afterEach(() => {
  store?.close();
  store = undefined;
});

describe('personal billing purchase ordering', () => {
  it('publishes Android Play product IDs and base plans that match the Play Console catalog', async () => {
    const localStore = testStore();

    const products = await billingProducts(localStore, now.toISOString());

    expect(products).toEqual(expect.arrayContaining([
      expect.objectContaining({ productKey: 'trial_7_day', appleProductId: 'ai.selfdeprecated.agenttick.initial_trial.7' }),
      expect.objectContaining({ productKey: 'lifetime_unlock', googleProductId: 'ai.selfdeprecated.agenttick.lifetime_unlock' }),
      expect.objectContaining({ productKey: 'hosted_personal_monthly', googleProductId: 'ai.selfdeprecated.agenttick.hosted', googleBasePlanId: 'hosted-personal-monthly' }),
      expect.objectContaining({ productKey: 'hosted_personal_yearly', googleProductId: 'ai.selfdeprecated.agenttick.hosted', googleBasePlanId: 'hosted-personal-yearly' }),
    ]));
    expect(products.find((product) => product.productKey === 'trial_7_day')?.googleProductId).toBeUndefined();
  });

  it('maps RevenueCat Google Play subscription product/base-plan IDs to hosted product keys', () => {
    expect(productKeyFromStoreProductId('ai.selfdeprecated.agenttick.hosted', 'hosted-personal-monthly')).toBe('hosted_personal_monthly');
    expect(productKeyFromStoreProductId('ai.selfdeprecated.agenttick.hosted', 'hosted-personal-yearly')).toBe('hosted_personal_yearly');
  });

  it('allows hosted subscription purchases without lifetime unlock', async () => {
    const localStore = testStore();

    const status = await getPersonalBillingStatus(localStore, DEFAULT_USER_ID, revenueCatConfig, now);
    expect(status.purchaseAvailability.trial_7_day).toEqual({ allowed: true });
    expect(status.purchaseAvailability.hosted_personal_monthly).toEqual({ allowed: true });
    expect(status.purchaseAvailability.hosted_personal_yearly).toEqual({ allowed: true });

    await expect(preflightPurchase(localStore, revenueCatConfig, DEFAULT_USER_ID, 'ios', 'hosted_personal_monthly', now)).resolves.toMatchObject({
      allowed: true,
      providerUserId: DEFAULT_USER_ID,
    });
  });

  it('clears canceled preflight attempts so the user can retry immediately', async () => {
    const localStore = testStore();

    const first = await preflightPurchase(localStore, revenueCatConfig, DEFAULT_USER_ID, 'ios', 'hosted_personal_monthly', now);
    await expect(preflightPurchase(localStore, revenueCatConfig, DEFAULT_USER_ID, 'ios', 'hosted_personal_monthly', now)).rejects.toMatchObject({ code: 'purchase_in_progress' });

    await expect(cancelPurchaseAttempt(localStore, DEFAULT_USER_ID, 'hosted_personal_monthly', first.purchaseAttemptId, now)).resolves.toBe(true);
    await expect(preflightPurchase(localStore, revenueCatConfig, DEFAULT_USER_ID, 'ios', 'hosted_personal_monthly', now)).resolves.toMatchObject({ allowed: true });
  });

  it('reports fresh accounts separately from expired hosted access', async () => {
    const localStore = testStore();

    const status = await getPersonalBillingStatus(localStore, DEFAULT_USER_ID, revenueCatConfig, now);
    expect(status.activeEntitlements.trial7Day.active).toBe(false);
    expect(status.hostedPersonal.lifecycle).toBe('fresh');
    expect(status.hostedPersonal.responsesEnabled).toBe(false);
  });

  it('models native trial as one startedAt timestamp plus an active flag', async () => {
    const localStore = testStore();
    const record = await localStore.getOrStartPersonalEntitlement(DEFAULT_USER_ID, now.toISOString());

    expect(hostedPersonalStatus(record, now, { nativeTrial: { startedAt: '2026-04-01T00:00:00.000Z', active: false } })).toMatchObject({
      lifecycle: 'expired',
      trialEndsAt: '2026-04-08T00:00:00.000Z',
      responsesEnabled: false,
      routingEnabled: false,
    });
    expect(hostedPersonalStatus(record, now, { nativeTrial: { startedAt: '2026-05-08T00:00:00.000Z', active: true } })).toMatchObject({
      lifecycle: 'active',
      trialEndsAt: '2026-05-15T00:00:00.000Z',
      responsesEnabled: true,
      routingEnabled: true,
    });
  });

  it('keeps expired native trial history out of the fresh account state', async () => {
    const localStore = testStore();
    await recordVerifiedTransaction(localStore, {
      userId: DEFAULT_USER_ID,
      provider: 'revenuecat',
      environment: 'sandbox',
      productKey: 'trial_7_day',
      entitlementKey: 'native_app_trial',
      platform: 'ios',
      providerTransactionId: 'txn_trial_expired',
      status: 'purchased',
      purchasedAt: '2026-04-01T00:00:00.000Z',
    }, now);

    const status = await getPersonalBillingStatus(localStore, DEFAULT_USER_ID, revenueCatConfig, now);
    expect(status.activeEntitlements.trial7Day.active).toBe(false);
    expect(status.hostedPersonal).toMatchObject({
      lifecycle: 'expired',
      trialEndsAt: '2026-04-08T00:00:00.000Z',
      responsesEnabled: false,
      routingEnabled: false,
    });
    expect(status.purchaseAvailability.trial_7_day).toMatchObject({ allowed: false, reason: 'trial_already_started' });
  });

  it('grants the Android native trial without a Play Billing purchase', async () => {
    const localStore = testStore();

    const status = await startNativeTrial(localStore, revenueCatConfig, DEFAULT_USER_ID, 'android', now);

    expect(status.activeEntitlements.trial7Day).toMatchObject({
      active: true,
      originProvider: 'google',
      originPlatform: 'android',
      purchasedAt: '2026-05-10T00:00:00.000Z',
      expiresAt: '2026-05-17T00:00:00.000Z',
    });
    await expect(startNativeTrial(localStore, revenueCatConfig, DEFAULT_USER_ID, 'android', now)).rejects.toMatchObject({ code: 'trial_already_started' });
  });

  it('derives the 7-day trial from the RevenueCat purchase timestamp', async () => {
    const localStore = testStore();
    await recordVerifiedTransaction(localStore, {
      userId: DEFAULT_USER_ID,
      provider: 'revenuecat',
      environment: 'sandbox',
      productKey: 'trial_7_day',
      entitlementKey: 'native_app_trial',
      platform: 'ios',
      providerTransactionId: 'txn_trial',
      status: 'purchased',
      purchasedAt: '2026-05-08T00:00:00.000Z',
    }, now);

    const status = await getPersonalBillingStatus(localStore, DEFAULT_USER_ID, revenueCatConfig, now);
    expect(status.activeEntitlements.trial7Day).toMatchObject({
      active: true,
      purchasedAt: '2026-05-08T00:00:00.000Z',
      expiresAt: '2026-05-15T00:00:00.000Z',
    });
    expect(status.hostedPersonal).toMatchObject({ lifecycle: 'active', responsesEnabled: true, routingEnabled: true });
    expect(status.purchaseAvailability.trial_7_day).toMatchObject({ allowed: false, reason: 'trial_already_started' });
  });

  it('keeps access active when the native trial overlaps a lifetime unlock', async () => {
    const localStore = testStore();
    await recordVerifiedTransaction(localStore, {
      userId: DEFAULT_USER_ID,
      provider: 'revenuecat',
      environment: 'sandbox',
      productKey: 'trial_7_day',
      entitlementKey: 'native_app_trial',
      platform: 'ios',
      providerTransactionId: 'txn_trial_overlap',
      status: 'purchased',
      purchasedAt: '2026-05-05T00:00:00.000Z',
    }, now);
    await recordVerifiedTransaction(localStore, {
      userId: DEFAULT_USER_ID,
      provider: 'revenuecat',
      environment: 'sandbox',
      productKey: 'lifetime_unlock',
      entitlementKey: 'lifetime_app_unlock',
      platform: 'ios',
      providerTransactionId: 'txn_lifetime_overlap',
      status: 'purchased',
      purchasedAt: '2026-05-07T00:00:00.000Z',
    }, now);

    const status = await getPersonalBillingStatus(localStore, DEFAULT_USER_ID, revenueCatConfig, now);
    expect(status.activeEntitlements.trial7Day).toMatchObject({
      active: true,
      purchasedAt: '2026-05-05T00:00:00.000Z',
      expiresAt: '2026-05-12T00:00:00.000Z',
    });
    expect(status.activeEntitlements.lifetimeUnlock).toMatchObject({
      active: true,
      purchasedAt: '2026-05-07T00:00:00.000Z',
    });
    expect(status.entitlement.appUnlockedAt).toBe('2026-05-07T00:00:00.000Z');
    expect(status.hostedPersonal).toMatchObject({ lifecycle: 'active', responsesEnabled: true, routingEnabled: true });
    expect(status.purchaseAvailability.trial_7_day).toMatchObject({ allowed: false, reason: 'trial_already_started' });
    expect(status.purchaseAvailability.lifetime_unlock).toMatchObject({ allowed: false, reason: 'already_unlocked' });
  });

  it('keeps lifetime unlock self-hosted-only and fresh for hosted service', async () => {
    const localStore = testStore();
    await recordVerifiedTransaction(localStore, {
      userId: DEFAULT_USER_ID,
      provider: 'revenuecat',
      environment: 'sandbox',
      productKey: 'lifetime_unlock',
      entitlementKey: 'lifetime_app_unlock',
      platform: 'ios',
      providerTransactionId: 'txn_lifetime',
      status: 'purchased',
      purchasedAt: '2026-05-02T00:00:00.000Z',
    }, now);

    const status = await getPersonalBillingStatus(localStore, DEFAULT_USER_ID, revenueCatConfig, now);
    expect(status.entitlement).toMatchObject({ appUnlockedAt: '2026-05-02T00:00:00.000Z' });
    expect(status.activeEntitlements.lifetimeUnlock.active).toBe(true);
    expect(status.activeEntitlements.hostedPersonal.active).toBe(false);
    expect(status.hostedPersonal).toMatchObject({ lifecycle: 'fresh', responsesEnabled: false, routingEnabled: false, pushEnabled: false });
  });

  it('activates hosted subscription access from a webhook without lifetime unlock', async () => {
    const localStore = testStore();
    await recordVerifiedTransaction(localStore, {
      userId: DEFAULT_USER_ID,
      provider: 'revenuecat',
      environment: 'sandbox',
      productKey: 'hosted_personal_monthly',
      entitlementKey: 'hosted_personal',
      platform: 'ios',
      providerTransactionId: 'txn_hosted_first',
      providerOriginalTransactionId: 'orig_hosted_first',
      status: 'purchased',
      purchasedAt: '2026-05-03T00:00:00.000Z',
      expiresAt: '2026-06-03T00:00:00.000Z',
    }, now);

    const status = await getPersonalBillingStatus(localStore, DEFAULT_USER_ID, revenueCatConfig, now);
    expect(status.activeEntitlements.lifetimeUnlock.active).toBe(false);
    expect(status.activeEntitlements.hostedPersonal.active).toBe(true);
    expect(status.hostedPersonal.lifecycle).toBe('active');
    expect(status.hostedPersonal.hostedSubscriptionEndsAt).toBe('2026-06-03T00:00:00.000Z');
    expect(status.purchaseAvailability.hosted_personal_monthly).toMatchObject({ allowed: false, reason: 'already_subscribed' });
  });

  it('locks hosted subscription receipts to the first Agent Tick account that claimed them', async () => {
    const localStore = testStore();
    const otherUserId = localStore.upsertClerkUser({
      issuer: 'https://clerk.agenttick.test',
      subject: 'user_other',
      email: 'other@example.com',
      emailVerified: true,
      name: 'Other User',
      authMethod: 'Email',
    }, now.toISOString());

    await recordVerifiedTransaction(localStore, {
      userId: DEFAULT_USER_ID,
      provider: 'revenuecat',
      environment: 'sandbox',
      productKey: 'hosted_personal_monthly',
      entitlementKey: 'hosted_personal',
      platform: 'ios',
      providerTransactionId: 'txn_owner_renewal_1',
      providerOriginalTransactionId: 'orig_shared_hosted_receipt',
      status: 'renewed',
      purchasedAt: '2026-05-03T00:00:00.000Z',
      expiresAt: '2026-06-03T00:00:00.000Z',
    }, now);

    const conflict = await recordVerifiedTransaction(localStore, {
      userId: otherUserId,
      provider: 'revenuecat',
      environment: 'sandbox',
      productKey: 'hosted_personal_monthly',
      entitlementKey: 'hosted_personal',
      platform: 'ios',
      providerTransactionId: 'txn_other_renewal_1',
      providerOriginalTransactionId: 'orig_shared_hosted_receipt',
      status: 'renewed',
      purchasedAt: '2026-05-04T00:00:00.000Z',
      expiresAt: '2026-06-04T00:00:00.000Z',
    }, now);

    expect(conflict).toMatchObject({
      created: false,
      conflict: {
        code: 'receipt_owned_by_another_account',
        productKey: 'hosted_personal_monthly',
        entitlementKey: 'hosted_personal',
        platform: 'ios',
      },
    });

    const ownerStatus = await getPersonalBillingStatus(localStore, DEFAULT_USER_ID, revenueCatConfig, now);
    expect(ownerStatus.activeEntitlements.hostedPersonal).toMatchObject({ active: true, expiresAt: '2026-06-03T00:00:00.000Z' });

    const otherStatus = await getPersonalBillingStatus(localStore, otherUserId, revenueCatConfig, now);
    expect(otherStatus.activeEntitlements.hostedPersonal.active).toBe(false);
    expect(otherStatus.hostedPersonal.lifecycle).toBe('fresh');
    expect(otherStatus.billingConflicts).toEqual([
      expect.objectContaining({
        code: 'receipt_owned_by_another_account',
        productKey: 'hosted_personal_monthly',
        entitlementKey: 'hosted_personal',
        platform: 'ios',
      }),
    ]);
  });

  it('detects hosted receipt conflicts from current receipt owner claims', async () => {
    const localStore = testStore();
    const ownerUserId = localStore.upsertClerkUser({
      issuer: 'https://clerk.agenttick.test',
      subject: 'user_historical_owner',
      email: 'historical-owner@example.com',
      emailVerified: true,
      name: 'Historical Owner',
      authMethod: 'Email',
    }, now.toISOString());
    const otherUserId = localStore.upsertClerkUser({
      issuer: 'https://clerk.agenttick.test',
      subject: 'user_after_migration',
      email: 'after-migration@example.com',
      emailVerified: true,
      name: 'After Migration',
      authMethod: 'Email',
    }, now.toISOString());

    await localStore.upsertBillingTransaction({
      userId: ownerUserId,
      provider: 'revenuecat',
      environment: 'sandbox',
      productKey: 'hosted_personal_monthly',
      entitlementKey: 'hosted_personal',
      platform: 'ios',
      providerTransactionId: 'txn_historical_owner',
      providerOriginalTransactionId: 'orig_historical_hosted_receipt',
      status: 'renewed',
      purchasedAt: '2026-05-01T00:00:00.000Z',
      expiresAt: '2026-06-01T00:00:00.000Z',
    }, '2026-05-01T00:00:00.000Z');
    localStore.claimBillingReceiptOwner({
      provider: 'revenuecat',
      environment: 'sandbox',
      platform: 'ios',
      productKey: 'hosted_personal_monthly',
      entitlementKey: 'hosted_personal',
      receiptKey: 'orig_historical_hosted_receipt',
      ownerUserId,
    }, '2026-05-01T00:00:00.000Z');

    const conflict = await recordVerifiedTransaction(localStore, {
      userId: otherUserId,
      provider: 'revenuecat',
      environment: 'sandbox',
      productKey: 'hosted_personal_monthly',
      entitlementKey: 'hosted_personal',
      platform: 'ios',
      providerTransactionId: 'txn_after_migration_transfer',
      providerOriginalTransactionId: 'orig_historical_hosted_receipt',
      status: 'renewed',
      purchasedAt: '2026-05-04T00:00:00.000Z',
      expiresAt: '2026-06-04T00:00:00.000Z',
    }, now);

    expect(conflict.conflict?.code).toBe('receipt_owned_by_another_account');
    const otherStatus = await getPersonalBillingStatus(localStore, otherUserId, revenueCatConfig, now);
    expect(otherStatus.activeEntitlements.hostedPersonal.active).toBe(false);
  });

  it('records RevenueCat transfers by moving account-bound purchases to the destination user', async () => {
    const localStore = testStore();
    const sourceUserId = localStore.upsertClerkUser({
      issuer: 'https://clerk.agenttick.test',
      subject: 'user_transfer_source',
      email: 'transfer-source@example.com',
      emailVerified: true,
      name: 'Transfer Source',
      authMethod: 'Email',
    }, now.toISOString());
    const destinationUserId = localStore.upsertClerkUser({
      issuer: 'https://clerk.agenttick.test',
      subject: 'user_transfer_destination',
      email: 'transfer-destination@example.com',
      emailVerified: true,
      name: 'Transfer Destination',
      authMethod: 'Email',
    }, now.toISOString());
    const historicalOwnerId = localStore.upsertClerkUser({
      issuer: 'https://clerk.agenttick.test',
      subject: 'user_transfer_historical_owner',
      email: 'transfer-owner@example.com',
      emailVerified: true,
      name: 'Transfer Historical Owner',
      authMethod: 'Email',
    }, now.toISOString());

    await localStore.upsertBillingTransaction({
      userId: sourceUserId,
      provider: 'revenuecat',
      environment: 'sandbox',
      productKey: 'hosted_personal_monthly',
      entitlementKey: 'hosted_personal',
      platform: 'ios',
      providerTransactionId: 'txn_transfer_source',
      providerOriginalTransactionId: 'orig_transfer_receipt',
      status: 'renewed',
      purchasedAt: '2026-05-09T00:00:00.000Z',
      expiresAt: '2026-06-09T00:00:00.000Z',
    }, now.toISOString());
    await localStore.upsertBillingTransaction({
      userId: sourceUserId,
      provider: 'revenuecat',
      environment: 'sandbox',
      productKey: 'lifetime_unlock',
      entitlementKey: 'lifetime_app_unlock',
      platform: 'ios',
      providerTransactionId: 'txn_lifetime_not_transferred',
      providerOriginalTransactionId: 'orig_lifetime_receipt',
      status: 'purchased',
      purchasedAt: '2026-05-09T00:00:00.000Z',
    }, now.toISOString());
    await localStore.claimBillingReceiptOwner({
      provider: 'revenuecat',
      environment: 'sandbox',
      platform: 'ios',
      entitlementKey: 'hosted_personal',
      receiptKey: 'orig_transfer_receipt',
      productKey: 'hosted_personal_monthly',
      ownerUserId: historicalOwnerId,
    }, now.toISOString());
    await preflightPurchase(localStore, revenueCatConfig, destinationUserId, 'ios', 'hosted_personal_monthly', now);

    const transfer = normalizeRevenueCatTransferEvent({
      event: {
        type: 'TRANSFER',
        environment: 'SANDBOX',
        store: 'APP_STORE',
        transferred_from: [sourceUserId],
        transferred_to: [destinationUserId],
        event_timestamp_ms: now.getTime(),
      },
    });
    expect(transfer).not.toBeNull();
    const result = await recordRevenueCatTransfer(localStore, transfer!, now);

    expect(result).toMatchObject({ processed: true, transferredTransactions: 1, receiptOwnersTransferred: 1 });
    expect(await localStore.listActiveBillingPurchaseAttempts(destinationUserId, 'hosted_personal', now.toISOString())).toEqual([]);
    expect(await localStore.listBillingTransactionsForUser(sourceUserId)).toHaveLength(1);
    const destinationTransactions = await localStore.listBillingTransactionsForUser(destinationUserId);
    expect(destinationTransactions).toEqual([expect.objectContaining({ entitlementKey: 'hosted_personal', providerOriginalTransactionId: 'orig_transfer_receipt' })]);
    const owner = await localStore.claimBillingReceiptOwner({
      provider: 'revenuecat',
      environment: 'sandbox',
      platform: 'ios',
      entitlementKey: 'hosted_personal',
      receiptKey: 'orig_transfer_receipt',
      productKey: 'hosted_personal_monthly',
      ownerUserId: destinationUserId,
    }, now.toISOString());
    expect(owner.ownedByCurrentUser).toBe(true);
    const status = await getPersonalBillingStatus(localStore, destinationUserId, revenueCatConfig, now);
    expect(status.activeEntitlements.hostedPersonal.active).toBe(true);
    expect(status.activeEntitlements.lifetimeUnlock.active).toBe(false);
  });

  it('recovers a pending native trial from a RevenueCat transfer without local source transactions', async () => {
    const localStore = testStore();
    const destinationUserId = localStore.upsertClerkUser({
      issuer: 'https://clerk.agenttick.test',
      subject: 'user_transfer_trial_destination',
      email: 'transfer-trial-destination@example.com',
      emailVerified: true,
      name: 'Transfer Trial Destination',
      authMethod: 'Email',
    }, now.toISOString());
    await preflightPurchase(localStore, revenueCatConfig, destinationUserId, 'ios', 'trial_7_day', now);

    const result = await recordRevenueCatTransfer(localStore, {
      provider: 'revenuecat',
      environment: 'sandbox',
      platform: 'ios',
      transferredFrom: ['$RCAnonymousID:trial-source'],
      transferredTo: [destinationUserId],
      rawEvent: { type: 'TRANSFER', event_timestamp_ms: Date.parse('2026-05-10T00:00:00.000Z') },
    }, now);

    expect(result).toMatchObject({ processed: true, transferredTransactions: 1, receiptOwnersTransferred: 1, destinationUserIds: [destinationUserId] });
    expect(await localStore.listActiveBillingPurchaseAttempts(destinationUserId, 'native_app_trial', now.toISOString())).toEqual([]);
    const transactions = await localStore.listBillingTransactionsForUser(destinationUserId);
    expect(transactions).toEqual([expect.objectContaining({ entitlementKey: 'native_app_trial', productKey: 'trial_7_day', status: 'purchased' })]);
    const status = await getPersonalBillingStatus(localStore, destinationUserId, revenueCatConfig, now);
    expect(status.activeEntitlements.trial7Day.active).toBe(true);
    expect(status.hostedPersonal.routingEnabled).toBe(true);
  });

  it('ignores RevenueCat transfer destinations that are not active local users', async () => {
    const localStore = testStore();
    const sourceUserId = localStore.upsertClerkUser({
      issuer: 'https://clerk.agenttick.test',
      subject: 'user_transfer_unknown_source',
      email: 'transfer-unknown-source@example.com',
      emailVerified: true,
      name: 'Transfer Unknown Source',
      authMethod: 'Email',
    }, now.toISOString());
    const destinationUserId = localStore.upsertClerkUser({
      issuer: 'https://clerk.agenttick.test',
      subject: 'user_transfer_known_destination',
      email: 'transfer-known-destination@example.com',
      emailVerified: true,
      name: 'Transfer Known Destination',
      authMethod: 'Email',
    }, now.toISOString());

    await localStore.upsertBillingTransaction({
      userId: sourceUserId,
      provider: 'revenuecat',
      environment: 'sandbox',
      productKey: 'trial_7_day',
      entitlementKey: 'native_app_trial',
      platform: 'ios',
      providerTransactionId: 'txn_transfer_unknown_destination',
      providerOriginalTransactionId: 'orig_transfer_unknown_destination',
      status: 'purchased',
      purchasedAt: '2026-05-09T00:00:00.000Z',
    }, now.toISOString());

    const result = await recordRevenueCatTransfer(localStore, {
      provider: 'revenuecat',
      environment: 'sandbox',
      platform: 'ios',
      transferredFrom: [sourceUserId],
      transferredTo: ['$RCAnonymousID:orphaned', destinationUserId],
      rawEvent: { type: 'TRANSFER' },
    }, now);

    expect(result).toMatchObject({ processed: true, transferredTransactions: 1, destinationUserIds: [destinationUserId] });
    expect(await localStore.listBillingTransactionsForUser('$RCAnonymousID:orphaned')).toEqual([]);
    expect(await localStore.listBillingTransactionsForUser(destinationUserId)).toEqual([expect.objectContaining({ entitlementKey: 'native_app_trial' })]);
  });

  it('normalizes RevenueCat hosted Google Play product and base plan IDs', () => {
    expect(normalizeRevenueCatEvent({
      event: {
        type: 'INITIAL_PURCHASE',
        app_user_id: DEFAULT_USER_ID,
        product_id: 'ai.selfdeprecated.agenttick.hosted',
        base_plan_id: 'hosted-personal-yearly',
        purchased_at_ms: Date.parse('2026-05-08T00:00:00.000Z'),
        expiration_at_ms: Date.parse('2027-05-08T00:00:00.000Z'),
        store: 'PLAY_STORE',
        transaction_id: 'txn_hosted_yearly',
        environment: 'SANDBOX',
      }
    })).toMatchObject({
      userId: DEFAULT_USER_ID,
      productKey: 'hosted_personal_yearly',
      entitlementKey: 'hosted_personal',
      platform: 'android',
      status: 'purchased',
    });
  });

  it('normalizes RevenueCat trial webhook product IDs', () => {
    expect(normalizeRevenueCatEvent({
      event: {
        type: 'NON_RENEWING_PURCHASE',
        app_user_id: DEFAULT_USER_ID,
        product_id: 'ai.selfdeprecated.agenttick.initial_trial.7',
        purchased_at_ms: Date.parse('2026-05-08T00:00:00.000Z'),
        store: 'APP_STORE',
        transaction_id: 'txn_trial',
        environment: 'SANDBOX',
      }
    })).toMatchObject({
      userId: DEFAULT_USER_ID,
      productKey: 'trial_7_day',
      entitlementKey: 'native_app_trial',
      purchasedAt: '2026-05-08T00:00:00.000Z',
      status: 'purchased',
    });
  });

  it('ignores RevenueCat dashboard test webhooks that do not describe Agent Tick products or entitlements', () => {
    expect(normalizeRevenueCatEvent({
      api_version: '1.0',
      event: {
        aliases: ['c3eec5a1-16f0-4573-8f0e-65da453dc836', '39e01cf9-ce4e-4c1c-800a-96023dbdfac7'],
        app_id: 'app2aa13aaee0',
        app_user_id: 'c3eec5a1-16f0-4573-8f0e-65da453dc836',
        commission_percentage: null,
        country_code: 'US',
        currency: null,
        entitlement_id: null,
        entitlement_ids: null,
        environment: 'SANDBOX',
        event_timestamp_ms: 1781864417587,
        expiration_at_ms: 1781871617587,
        id: '8BF72BC9-F4EE-4934-8077-680FD716A3A1',
        is_family_share: null,
        metadata: null,
        offer_code: null,
        original_app_user_id: 'c3eec5a1-16f0-4573-8f0e-65da453dc836',
        original_transaction_id: null,
        period_type: 'NORMAL',
        presented_offering_id: null,
        price: null,
        price_in_purchased_currency: null,
        product_id: 'test_product',
        purchased_at_ms: 1781864417587,
        renewal_number: null,
        store: 'APP_STORE',
        subscriber_attributes: {
          '$displayName': { updated_at_ms: 1781864417587, value: 'Mister Mistoffelees' },
          '$email': { updated_at_ms: 1781864417587, value: 'tuxedo@revenuecat.com' },
          '$phoneNumber': { updated_at_ms: 1781864417587, value: '+19795551234' },
          my_custom_attribute_1: { updated_at_ms: 1781864417587, value: 'catnip' },
        },
        takehome_percentage: null,
        tax_percentage: null,
        transaction_id: null,
        type: 'TEST',
      }
    })).toBeNull();
  });

  it('normalizes manually granted RevenueCat hosted entitlement webhooks without store product IDs', () => {
    expect(normalizeRevenueCatEvent({
      event: {
        id: 'evt_manual_hosted_grant',
        type: 'INITIAL_PURCHASE',
        app_user_id: DEFAULT_USER_ID,
        entitlement_ids: ['hosted_personal'],
        purchased_at_ms: Date.parse('2026-05-08T00:00:00.000Z'),
        expiration_at_ms: Date.parse('2026-06-08T00:00:00.000Z'),
        store: 'PROMOTIONAL',
        environment: 'PRODUCTION',
      }
    })).toMatchObject({
      userId: DEFAULT_USER_ID,
      productKey: 'hosted_personal_monthly',
      entitlementKey: 'hosted_personal',
      purchasedAt: '2026-05-08T00:00:00.000Z',
      expiresAt: '2026-06-08T00:00:00.000Z',
      status: 'purchased',
    });
  });

  it('activates hosted access from manually granted RevenueCat hosted entitlements with an expiry', async () => {
    const localStore = testStore();
    const transaction = normalizeRevenueCatEvent({
      event: {
        id: 'evt_manual_hosted_active',
        type: 'INITIAL_PURCHASE',
        app_user_id: DEFAULT_USER_ID,
        entitlement_ids: ['hosted_personal'],
        purchased_at_ms: Date.parse('2026-05-08T00:00:00.000Z'),
        expiration_at_ms: Date.parse('2026-06-08T00:00:00.000Z'),
        store: 'PROMOTIONAL',
        environment: 'PRODUCTION',
      }
    });
    expect(transaction).not.toBeNull();

    await recordVerifiedTransaction(localStore, transaction!, now);

    const status = await getPersonalBillingStatus(localStore, DEFAULT_USER_ID, revenueCatConfig, now);
    expect(status.activeEntitlements.hostedPersonal).toMatchObject({
      active: true,
      originProvider: 'revenuecat',
      originPlatform: 'unknown',
      expiresAt: '2026-06-08T00:00:00.000Z',
    });
    expect(status.hostedPersonal).toMatchObject({ lifecycle: 'active', responsesEnabled: true, routingEnabled: true });
  });

  it('activates hosted access from full RevenueCat manual entitlement payloads with promotional product IDs', async () => {
    const localStore = testStore();
    const transaction = normalizeRevenueCatEvent({
      api_version: '1.0',
      event: {
        aliases: [DEFAULT_USER_ID],
        app_id: 'app2aa13aaee0',
        app_user_id: DEFAULT_USER_ID,
        commission_percentage: null,
        country_code: 'US',
        currency: null,
        entitlement_id: 'hosted_personal',
        entitlement_ids: ['hosted_personal'],
        environment: 'PRODUCTION',
        event_timestamp_ms: Date.parse('2026-05-10T12:00:00.000Z'),
        expiration_at_ms: Date.parse('2026-06-10T12:00:00.000Z'),
        id: 'evt_revenuecat_manual_hosted_monthly_full',
        is_family_share: null,
        metadata: null,
        offer_code: null,
        original_app_user_id: DEFAULT_USER_ID,
        original_transaction_id: null,
        period_type: 'NORMAL',
        presented_offering_id: null,
        price: null,
        price_in_purchased_currency: null,
        product_id: 'rc_promo_hosted_personal_monthly',
        purchased_at_ms: Date.parse('2026-05-10T12:00:00.000Z'),
        renewal_number: null,
        store: 'APP_STORE',
        subscriber_attributes: {},
        takehome_percentage: null,
        tax_percentage: null,
        transaction_id: null,
        type: 'INITIAL_PURCHASE',
      }
    });
    expect(transaction).toMatchObject({
      userId: DEFAULT_USER_ID,
      productKey: 'hosted_personal_monthly',
      entitlementKey: 'hosted_personal',
      platform: 'ios',
      purchasedAt: '2026-05-10T12:00:00.000Z',
      expiresAt: '2026-06-10T12:00:00.000Z',
      status: 'purchased',
    });

    await recordVerifiedTransaction(localStore, transaction!, now);

    const status = await getPersonalBillingStatus(localStore, DEFAULT_USER_ID, revenueCatConfig, now);
    expect(status.activeEntitlements.hostedPersonal).toMatchObject({ active: true, expiresAt: '2026-06-10T12:00:00.000Z' });
    expect(status.hostedPersonal).toMatchObject({ lifecycle: 'active', responsesEnabled: true, routingEnabled: true });
  });

  it('updates manually granted RevenueCat hosted entitlements when a later webhook expires them', async () => {
    const localStore = testStore();
    const active = normalizeRevenueCatEvent({
      event: {
        id: 'evt_manual_hosted_active_before_expiry',
        type: 'INITIAL_PURCHASE',
        app_user_id: DEFAULT_USER_ID,
        entitlement_ids: ['hosted_personal'],
        product_id: 'rc_promo_hosted_personal_monthly',
        purchased_at_ms: Date.parse('2026-05-08T00:00:00.000Z'),
        expiration_at_ms: Date.parse('2026-06-08T00:00:00.000Z'),
        store: 'PROMOTIONAL',
        environment: 'PRODUCTION',
      }
    });
    const expired = normalizeRevenueCatEvent({
      event: {
        id: 'evt_manual_hosted_expired_after_grant',
        type: 'EXPIRATION',
        app_user_id: DEFAULT_USER_ID,
        entitlement_ids: ['hosted_personal'],
        product_id: 'rc_promo_hosted_personal_monthly',
        purchased_at_ms: Date.parse('2026-05-08T00:00:00.000Z'),
        expiration_at_ms: Date.parse('2026-05-09T00:00:00.000Z'),
        event_timestamp_ms: Date.parse('2026-05-09T00:00:00.000Z'),
        store: 'PROMOTIONAL',
        environment: 'PRODUCTION',
      }
    });
    await recordVerifiedTransaction(localStore, active!, now);
    await recordVerifiedTransaction(localStore, expired!, now);

    const transactions = await localStore.listBillingTransactionsForUser(DEFAULT_USER_ID);
    expect(transactions).toHaveLength(1);
    expect(transactions[0]).toMatchObject({ status: 'expired', expiresAt: '2026-05-09T00:00:00.000Z' });
    const status = await getPersonalBillingStatus(localStore, DEFAULT_USER_ID, revenueCatConfig, now);
    expect(status.activeEntitlements.hostedPersonal.active).toBe(false);
    expect(status.hostedPersonal).toMatchObject({ lifecycle: 'expired', responsesEnabled: false });
  });
});
