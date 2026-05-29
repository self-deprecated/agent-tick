import type { HostedPersonalStatus, PersonalEntitlement } from './index.js';

export const PERSONAL_TRIAL_DAYS = 7;
export const READ_ONLY_GRACE_DAYS = 30;

export interface NativeTrialStatus {
  startedAt?: string;
  active: boolean;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function addDays(value: string, days: number): string {
  return new Date(new Date(value).getTime() + days * DAY_MS).toISOString();
}

export function hostedPersonalStatus(record: PersonalEntitlement, now = new Date(), options: { nativeTrial?: NativeTrialStatus } = {}): HostedPersonalStatus {
  const nowMs = now.getTime();
  const nativeTrial = options.nativeTrial;
  const nativeTrialStartedAt = nativeTrial?.startedAt;
  const trialEndsAt = nativeTrialStartedAt ? addDays(nativeTrialStartedAt, PERSONAL_TRIAL_DAYS) : record.trialStartedAt;
  const subscriptionEndsAt = record.hostedSubscriptionEndsAt;
  const subscriptionGraceEndsAt = subscriptionEndsAt ? addDays(subscriptionEndsAt, READ_ONLY_GRACE_DAYS) : undefined;
  const trialActive = Boolean(nativeTrial?.active && nativeTrialStartedAt && new Date(trialEndsAt).getTime() > nowMs);
  const subscriptionActive = subscriptionEndsAt ? new Date(subscriptionEndsAt).getTime() > nowMs : false;
  const graceActive = Boolean(record.hostedSubscriptionCanceledAt && subscriptionEndsAt && subscriptionGraceEndsAt && new Date(subscriptionGraceEndsAt).getTime() > nowMs);

  if (record.hostedDataDeletedAt) {
    return { lifecycle: 'deleted', trialEndsAt, ...(subscriptionEndsAt ? { hostedSubscriptionEndsAt: subscriptionEndsAt } : {}), ...(subscriptionGraceEndsAt ? { readOnlyGraceEndsAt: subscriptionGraceEndsAt } : {}), responsesEnabled: false, routingEnabled: false, pushEnabled: false, historyRetentionDays: 0 };
  }
  if (trialActive || subscriptionActive) {
    return { lifecycle: 'active', trialEndsAt, ...(subscriptionEndsAt ? { hostedSubscriptionEndsAt: subscriptionEndsAt } : {}), ...(subscriptionGraceEndsAt ? { readOnlyGraceEndsAt: subscriptionGraceEndsAt } : {}), responsesEnabled: true, routingEnabled: true, pushEnabled: true, historyRetentionDays: READ_ONLY_GRACE_DAYS };
  }
  if (graceActive) {
    return { lifecycle: 'read_only_grace', trialEndsAt, ...(subscriptionEndsAt ? { hostedSubscriptionEndsAt: subscriptionEndsAt } : {}), ...(subscriptionGraceEndsAt ? { readOnlyGraceEndsAt: subscriptionGraceEndsAt } : {}), responsesEnabled: false, routingEnabled: true, pushEnabled: false, historyRetentionDays: READ_ONLY_GRACE_DAYS };
  }
  const neverPurchasedHostedAccess = !nativeTrialStartedAt && !record.hostedSubscriptionEndsAt && !record.hostedSubscriptionCanceledAt;
  if (neverPurchasedHostedAccess) {
    return { lifecycle: 'fresh', trialEndsAt, responsesEnabled: false, routingEnabled: false, pushEnabled: false, historyRetentionDays: 0 };
  }
  return { lifecycle: 'expired', trialEndsAt, ...(subscriptionEndsAt ? { hostedSubscriptionEndsAt: subscriptionEndsAt } : {}), ...(subscriptionGraceEndsAt ? { readOnlyGraceEndsAt: subscriptionGraceEndsAt } : {}), responsesEnabled: false, routingEnabled: false, pushEnabled: false, historyRetentionDays: 0 };
}
