import type { AsyncAgentTickStore } from '../../store/types.js';

type RemainingSQLiteMethod =
  | 'ensureSingleTenantDefaults'
  | 'cleanupExpiredSecrets'
  | 'cleanupRetention'
  | 'createStatusUpdate'
  | 'getStatusUpdate'
  | 'listLatestStatusUpdates'
  | 'listActivityForUser'
  | 'pendingRequestCountForUser'
  | 'registerDevice'
  | 'listDevicesForUser'
  | 'listPushDevicesForRequestRecipients'
  | 'listPushDevicesForAudienceChannel'
  | 'listPushDevicesForUsers'
  | 'getDeviceForUser'
  | 'updateDeviceName'
  | 'updateDevicePushToken'
  | 'unregisterDevice'
  | 'createPairingToken'
  | 'pairDeviceWithCode'
  | 'verifyDeviceToken'
  | 'recordHeartbeat'
  | 'setAvailability'
  | 'getAvailability'
  | 'createEventTicket'
  | 'verifyEventTicket'
  | 'recordMobileDiagnostics'
  | 'listMobileDiagnostics'
  | 'listAuditEvents'
  | 'listAuditEventsAfter'
  | 'writeAuditEvent'
  | 'getOrStartPersonalEntitlement'
  | 'updatePersonalEntitlement'
  | 'upsertBillingProducts'
  | 'listBillingProducts'
  | 'createBillingPurchaseAttempt'
  | 'updateBillingPurchaseAttemptStatus'
  | 'listActiveBillingPurchaseAttempts'
  | 'upsertBillingTransaction'
  | 'listBillingTransactionsForUser'
  | 'transferAccountBoundBillingPurchases'
  | 'claimBillingReceiptOwner'
  | 'upsertBillingIdentityConflict'
  | 'listBillingIdentityConflictsForUser'
  | 'deleteHostedPersonalData'
  | 'deleteHostedAccountData';

type RemainingSQLiteImplementations = Record<RemainingSQLiteMethod, (...args: any[]) => any>;

/**
 * Domain component for SQLite status, device, event, audit, billing,
 * retention, and hosted privacy behavior.
 *
 * Like the earlier extraction slices, this component first makes the remaining
 * public method group explicit and delegatable while preserving the existing
 * SQL implementation functions byte-for-byte in the SQLite store. Smaller
 * follow-up refactors can move each implementation body here without changing
 * the app-facing store contract again.
 */
export class SQLiteStatusDeviceBillingRepository {
  constructor(private readonly impl: RemainingSQLiteImplementations) {}

  invoke<Method extends RemainingSQLiteMethod>(method: Method, ...args: Parameters<Extract<AsyncAgentTickStore[Method], (...args: any[]) => any>>): ReturnType<Extract<AsyncAgentTickStore[Method], (...args: any[]) => any>> {
    return this.impl[method](...args);
  }
}
