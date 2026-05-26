import { afterEach, describe, expect, it } from 'vitest';
import { AgentTickStore, DEFAULT_USER_ID } from '@agent-tick/db';
import { getPersonalBillingStatus, preflightPurchase, recordVerifiedTransaction } from '../src/services/billing.js';

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
  it('blocks hosted subscription purchases until lifetime unlock is active', async () => {
    const localStore = testStore();

    const status = await getPersonalBillingStatus(localStore, DEFAULT_USER_ID, revenueCatConfig, now);
    expect(status.purchaseAvailability.hosted_personal_monthly).toMatchObject({ allowed: false, reason: 'app_purchase_required' });
    expect(status.purchaseAvailability.hosted_personal_yearly).toMatchObject({ allowed: false, reason: 'app_purchase_required' });

    await expect(preflightPurchase(localStore, revenueCatConfig, DEFAULT_USER_ID, 'ios', 'hosted_personal_monthly', now)).rejects.toMatchObject({
      statusCode: 409,
      code: 'app_purchase_required',
    });
  });

  it('allows hosted subscription purchases after lifetime unlock is active', async () => {
    const localStore = testStore();
    localStore.updatePersonalEntitlement({ userId: DEFAULT_USER_ID, appUnlockedAt: '2026-05-02T00:00:00.000Z' }, '2026-05-02T00:00:00.000Z');

    const status = await getPersonalBillingStatus(localStore, DEFAULT_USER_ID, revenueCatConfig, now);
    expect(status.purchaseAvailability.hosted_personal_monthly).toEqual({ allowed: true });
    expect(status.purchaseAvailability.hosted_personal_yearly).toEqual({ allowed: true });

    await expect(preflightPurchase(localStore, revenueCatConfig, DEFAULT_USER_ID, 'ios', 'hosted_personal_monthly', now)).resolves.toMatchObject({
      allowed: true,
      providerUserId: DEFAULT_USER_ID,
    });
  });

  it('does not activate hosted subscription access from a webhook until lifetime unlock exists', async () => {
    const localStore = testStore();
    await recordVerifiedTransaction(localStore, {
      userId: DEFAULT_USER_ID,
      provider: 'revenuecat',
      environment: 'sandbox',
      productKey: 'hosted_personal_monthly',
      entitlementKey: 'hosted_personal',
      platform: 'ios',
      providerTransactionId: 'txn_hosted_first',
      status: 'purchased',
      purchasedAt: '2026-05-03T00:00:00.000Z',
      expiresAt: '2026-06-03T00:00:00.000Z',
    }, now);

    const lockedStatus = await getPersonalBillingStatus(localStore, DEFAULT_USER_ID, revenueCatConfig, now);
    expect(lockedStatus.activeEntitlements.lifetimeUnlock.active).toBe(false);
    expect(lockedStatus.activeEntitlements.hostedPersonal.active).toBe(false);
    expect(lockedStatus.hostedPersonal.lifecycle).toBe('expired');
    expect(lockedStatus.hostedPersonal.hostedSubscriptionEndsAt).toBeUndefined();

    localStore.updatePersonalEntitlement({ userId: DEFAULT_USER_ID, appUnlockedAt: '2026-05-10T00:00:00.000Z' }, '2026-05-10T00:00:00.000Z');
    const unlockedStatus = await getPersonalBillingStatus(localStore, DEFAULT_USER_ID, revenueCatConfig, now);
    expect(unlockedStatus.activeEntitlements.lifetimeUnlock.active).toBe(true);
    expect(unlockedStatus.activeEntitlements.hostedPersonal.active).toBe(true);
    expect(unlockedStatus.hostedPersonal.lifecycle).toBe('active');
  });
});
