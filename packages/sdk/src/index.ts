import type { ZodType } from 'zod';
import {
  ActivityItemSchema,
  AddWorkspaceMemberSchema,
  AgentCredentialSchema,
  AgentTokenRecordSchema,
  ApiErrorEnvelopeSchema,
  AuditEventRecordSchema,
  AudienceChannelRecordSchema,
  AudienceSubscriptionRecordSchema,
  AuthConfigSchema,
  AvailabilityRecordSchema,
  BillingProductsResponseSchema,
  BillingPurchaseAttemptCancelRequestSchema,
  BillingPurchaseAttemptCancelResponseSchema,
  BillingPurchasePreflightRequestSchema,
  BillingPurchasePreflightResponseSchema,
  BillingStatusSchema,
  BillingTrialStartRequestSchema,
  CreateAgentTokenSchema,
  CreateAudienceChannelSchema,
  CreateExternalApproverInviteSchema,
  CreateExternalApproverSchema,
  CreateMobileDiagnosticsSchema,
  CreateMobileSessionSchema,
  CreateRequestResponseSchema,
  CreateRequestSchema,
  CreateRoutingRuleSchema,
  CreateSharedWorkspaceSchema,
  CreateStatusUpdateSchema,
  CreateToolActivitySchema,
  DeleteMeResponseSchema,
  DeleteRoutingRuleResponseSchema,
  DeviceCredentialSchema,
  DevicePublicKeyRecordSchema,
  ExternalApproverInviteCredentialSchema,
  ExternalApproverInviteRecordSchema,
  ExternalApproverRecordSchema,
  ExternalApproverStatusSchema,
  DeviceRecordSchema,
  EventPollResponseSchema,
  EventTicketResponseSchema,
  HealthResponseSchema,
  HeartbeatRequestSchema,
  HeartbeatResponseSchema,
  MeResponseSchema,
  MobileDiagnosticsResponseSchema,
  MobileSessionResponseSchema,
  OnboardingStatusSchema,
  PairDeviceRequestSchema,
  PairingTokenSchema,
  PendingActivityCountSchema,
  PreparePrivateRequestSchema,
  PreparePrivateStatusUpdateSchema,
  PrivateRequestPrepareResponseSchema,
  PrivateStatusUpdatePrepareResponseSchema,
  PersonalBillingStatusSchema,
  PersonalBillingUpdateSchema,
  RegisterDevicePublicKeySchema,
  RegisterDeviceResponseSchema,
  RegisterDeviceSchema,
  ReadyResponseSchema,
  RequestRecordSchema,
  ReportRequestWaiterErrorSchema,
  RespondRequestSchema,
  StopRequestWaiterSchema,
  RoutingPreviewInputSchema,
  RoutingPreviewSchema,
  RoutingRuleRecordSchema,
  SendTestActivityResponseSchema,
  SendTestActivitySchema,
  SetAvailabilitySchema,
  SessionDetailSchema,
  SessionSummarySchema,
  StatusUpdateRecordSchema,
  ToolActivityRecordSchema,
  UpdateAgentTokenSchema,
  UpdateDeviceNameSchema,
  UpdateDevicePushTokenSchema,
  UpdateRoutingRuleSchema,
  UpdateWorkspaceSchema,
  WaitRequestResponseSchema,
  WorkspaceMemberRecordSchema,
  WorkspaceRecordSchema,
  type ActivityItem,
  type AddWorkspaceMember,
  type AgentCredential,
  type AgentTokenRecord,
  type ApiErrorEnvelope,
  type AuditEventRecord,
  type AudienceChannelRecord,
  type AudienceSubscriptionRecord,
  type AuthConfig,
  type AvailabilityRecord,
  type BillingProductsResponse,
  type BillingPurchaseAttemptCancelRequest,
  type BillingPurchaseAttemptCancelResponse,
  type BillingPurchasePreflightRequest,
  type BillingPurchasePreflightResponse,
  type BillingStatus,
  type BillingTrialStartRequest,
  type CreateAgentToken,
  type CreateAudienceChannel,
  type CreateExternalApprover,
  type CreateExternalApproverInvite,
  type CreateMobileDiagnostics,
  type CreateMobileSession,
  type CreateRequest,
  type CreateRequestResponse,
  type CreateRoutingRule,
  type CreateSharedWorkspace,
  type CreateStatusUpdate,
  type CreateToolActivity,
  type DeleteMeResponse,
  type DeleteRoutingRuleResponse,
  type DeviceCredential,
  type DevicePublicKeyRecord,
  type DeviceRecord,
  type EventPollEvent,
  type ExternalApproverInviteCredential,
  type ExternalApproverInviteRecord,
  type ExternalApproverRecord,
  type ExternalApproverStatus,
  type EventPollResponse,
  type EventTicketResponse,
  type HealthResponse,
  type HeartbeatRequest,
  type HeartbeatResponse,
  type MeResponse,
  type MobileDiagnosticsResponse,
  type MobileSessionResponse,
  type OnboardingStatus,
  type PairDeviceRequest,
  type PairingToken,
  type PendingActivityCount,
  type PersonalBillingStatus,
  type PreparePrivateRequest,
  type PreparePrivateStatusUpdate,
  type PrivateRequestPrepareResponse,
  type PrivateStatusUpdatePrepareResponse,
  type PersonalBillingUpdate,
  type RegisterDevice,
  type RegisterDevicePublicKey,
  type RegisterDeviceResponse,
  type ReadyResponse,
  type ReportRequestWaiterError,
  type RequestAgentWaiterSummary,
  type RequestRecord,
  type RequestWaiterCredential,
  type RespondRequest,
  type StopRequestWaiter,
  type RoutingPreview,
  type RoutingPreviewInput,
  type RoutingRuleRecord,
  type SendTestActivity,
  type SendTestActivityResponse,
  type SetAvailability,
  type SessionDetail,
  type SessionSummary,
  type StatusUpdateRecord,
  type ToolActivityRecord,
  type UpdateAgentToken,
  type UpdateDeviceName,
  type UpdateDevicePushToken,
  type UpdateRoutingRule,
  type UpdateWorkspace,
  type WaitRequestResponse,
  type WorkspaceMemberRecord,
  type WorkspaceRecord
} from '@self-deprecated/agent-tick-shared';

export type TokenProvider = () => Promise<string | null | undefined> | string | null | undefined;
export type WorkspaceIdProvider = () => Promise<string | null | undefined> | string | null | undefined;
export type EventSourceConstructor = new (url: string | URL, eventSourceInitDict?: EventSourceInit) => EventSource;

// Keep client-side long waits below common reverse-proxy read timeouts
// (Cloudflare's default is around 100-120s) and re-poll until the caller's
// total deadline. This lets CLI/MCP waits last minutes without a single
// minutes-long HTTP request.
const MAX_WAIT_LONG_POLL_MS = 55_000;
const INITIAL_WAIT_RETRY_BACKOFF_MS = 1_000;
const MAX_WAIT_RETRY_BACKOFF_MS = 60_000;

export interface AgentTickClientOptions {
  baseUrl: string;
  tokenProvider?: TokenProvider;
  workspaceIdProvider?: WorkspaceIdProvider;
  fetch?: typeof fetch;
}

export class AgentTickApiError extends Error {
  readonly status: number;
  readonly body: unknown;
  readonly code: string | undefined;
  readonly requestId: string | undefined;

  constructor(message: string, status: number, body: unknown, code?: string, requestId?: string) {
    super(message);
    this.name = 'AgentTickApiError';
    this.status = status;
    this.body = body;
    this.code = code;
    this.requestId = requestId;
  }
}

export type SessionClientStatus = 'idle' | 'loading' | 'empty' | 'ready' | 'error' | 'stale';

export interface SessionClientDataState {
  status: SessionClientStatus;
  summaries: SessionSummary[];
  selectedSessionId?: string;
  detail?: SessionDetail;
  error?: string;
  lastUpdatedAt?: string;
}

export interface SessionDataClient {
  listSessions(options?: { workspaceId?: string; limit?: number }): Promise<SessionSummary[]>;
  getSession(id: string, options?: { workspaceId?: string; limit?: number }): Promise<SessionDetail>;
}

export function initialSessionClientState(selectedSessionId?: string): SessionClientDataState {
  return { status: 'idle', summaries: [], ...(selectedSessionId ? { selectedSessionId } : {}) };
}

export async function loadSessionSummaries(client: Pick<SessionDataClient, 'listSessions'>, previous: SessionClientDataState = initialSessionClientState(), options: { workspaceId?: string; limit?: number } = {}): Promise<SessionClientDataState> {
  try {
    const summaries = await client.listSessions(options);
    return {
      status: summaries.length ? 'ready' : 'empty',
      summaries,
      ...(previous.selectedSessionId ? { selectedSessionId: previous.selectedSessionId } : {}),
      ...(previous.detail ? { detail: previous.detail } : {}),
      lastUpdatedAt: new Date().toISOString()
    };
  } catch (error) {
    return {
      status: previous.summaries.length || previous.detail ? 'stale' : 'error',
      summaries: previous.summaries,
      ...(previous.selectedSessionId ? { selectedSessionId: previous.selectedSessionId } : {}),
      ...(previous.detail ? { detail: previous.detail } : {}),
      error: sessionDataErrorMessage(error),
      ...(previous.lastUpdatedAt ? { lastUpdatedAt: previous.lastUpdatedAt } : {})
    };
  }
}

export async function loadSessionTimeline(client: Pick<SessionDataClient, 'getSession'>, sessionId: string, previous: SessionClientDataState = initialSessionClientState(sessionId), options: { workspaceId?: string; limit?: number } = {}): Promise<SessionClientDataState> {
  try {
    const detail = await client.getSession(sessionId, options);
    return {
      status: 'ready',
      summaries: previous.summaries,
      selectedSessionId: sessionId,
      detail,
      lastUpdatedAt: new Date().toISOString()
    };
  } catch (error) {
    return {
      status: previous.detail ? 'stale' : 'error',
      summaries: previous.summaries,
      selectedSessionId: sessionId,
      ...(previous.detail ? { detail: previous.detail } : {}),
      error: sessionDataErrorMessage(error),
      ...(previous.lastUpdatedAt ? { lastUpdatedAt: previous.lastUpdatedAt } : {})
    };
  }
}

function sessionDataErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class AgentTickClient {
  readonly #baseUrl: string;
  readonly #tokenProvider: TokenProvider | undefined;
  readonly #workspaceIdProvider: WorkspaceIdProvider | undefined;
  readonly #fetch: typeof fetch;

  constructor(options: AgentTickClientOptions) {
    this.#baseUrl = normalizeBaseUrl(options.baseUrl);
    this.#tokenProvider = options.tokenProvider;
    this.#workspaceIdProvider = options.workspaceIdProvider;
    this.#fetch = options.fetch ?? globalThis.fetch?.bind(globalThis);
    if (!this.#fetch) throw new Error('A fetch implementation is required');
  }

  health(): Promise<HealthResponse> { return this.#request('GET', '/healthz', HealthResponseSchema); }
  ready(): Promise<ReadyResponse> { return this.#request('GET', '/readyz', ReadyResponseSchema); }
  getAuthConfig(): Promise<AuthConfig> { return this.#request('GET', '/v1/auth/config', AuthConfigSchema); }
  getMe(): Promise<MeResponse> { return this.#request('GET', '/v1/me', MeResponseSchema); }
  deleteMe(): Promise<DeleteMeResponse> { return this.#request('DELETE', '/v1/me', DeleteMeResponseSchema, { includeWorkspace: false }); }

  createMobileSession(input: CreateMobileSession): Promise<MobileSessionResponse> {
    return this.#request('POST', '/v1/auth/mobile-session', MobileSessionResponseSchema, { body: CreateMobileSessionSchema.parse(input), includeWorkspace: false });
  }

  sendMobileDiagnostics(input: CreateMobileDiagnostics): Promise<MobileDiagnosticsResponse> {
    return this.#request('POST', '/v1/mobile-diagnostics', MobileDiagnosticsResponseSchema, { body: CreateMobileDiagnosticsSchema.parse(input) });
  }

  listAuditEvents(options: { limit?: number } = {}): Promise<AuditEventRecord[]> {
    const params = new URLSearchParams();
    if (options.limit !== undefined) params.set('limit', String(options.limit));
    return this.#request('GET', `/v1/audit-events${querySuffix(params)}`, AuditEventRecordSchema.array());
  }

  getBillingStatus(): Promise<BillingStatus> { return this.#request('GET', '/v1/billing', BillingStatusSchema); }
  getBillingProducts(): Promise<BillingProductsResponse> { return this.#request('GET', '/v1/billing/products', BillingProductsResponseSchema, { includeWorkspace: false }); }
  getPersonalBillingStatus(): Promise<PersonalBillingStatus> { return this.#request('GET', '/v1/billing/personal', PersonalBillingStatusSchema, { includeWorkspace: false }); }
  updatePersonalBilling(input: PersonalBillingUpdate): Promise<PersonalBillingStatus> {
    return this.#request('POST', '/v1/billing/personal', PersonalBillingStatusSchema, { body: PersonalBillingUpdateSchema.parse(input), includeWorkspace: false });
  }
  preflightPurchase(input: BillingPurchasePreflightRequest): Promise<BillingPurchasePreflightResponse> {
    return this.#request('POST', '/v1/billing/purchases/preflight', BillingPurchasePreflightResponseSchema, { body: BillingPurchasePreflightRequestSchema.parse(input), includeWorkspace: false });
  }
  startNativeTrial(input: BillingTrialStartRequest): Promise<PersonalBillingStatus> {
    return this.#request('POST', '/v1/billing/purchases/start-trial', PersonalBillingStatusSchema, { body: BillingTrialStartRequestSchema.parse(input), includeWorkspace: false });
  }
  cancelPurchaseAttempt(input: BillingPurchaseAttemptCancelRequest): Promise<BillingPurchaseAttemptCancelResponse> {
    return this.#request('POST', '/v1/billing/purchases/cancel', BillingPurchaseAttemptCancelResponseSchema, { body: BillingPurchaseAttemptCancelRequestSchema.parse(input), includeWorkspace: false });
  }
  getOnboardingStatus(): Promise<OnboardingStatus> { return this.#request('GET', '/v1/onboarding', OnboardingStatusSchema); }
  sendHeartbeat(input: HeartbeatRequest = {}): Promise<HeartbeatResponse> { return this.#request('POST', '/v1/heartbeat', HeartbeatResponseSchema, { body: HeartbeatRequestSchema.parse(input) }); }
  setAvailability(input: SetAvailability): Promise<AvailabilityRecord> { return this.#request('POST', '/v1/availability', AvailabilityRecordSchema, { body: SetAvailabilitySchema.parse(input) }); }

  createStatusUpdate(input: CreateStatusUpdate): Promise<StatusUpdateRecord> {
    return this.#request('POST', '/v1/status-updates', StatusUpdateRecordSchema, { body: CreateStatusUpdateSchema.parse(input) });
  }
  createToolActivity(input: CreateToolActivity): Promise<ToolActivityRecord> {
    return this.#request('POST', '/v1/tool-activities', ToolActivityRecordSchema, { body: CreateToolActivitySchema.parse(input) });
  }
  listStatusUpdates(options: { limit?: number } = {}): Promise<StatusUpdateRecord[]> {
    const params = new URLSearchParams();
    if (options.limit !== undefined) params.set('limit', String(options.limit));
    return this.#request('GET', `/v1/status-updates${querySuffix(params)}`, StatusUpdateRecordSchema.array());
  }

  preparePrivateRequest(input: PreparePrivateRequest = {}): Promise<PrivateRequestPrepareResponse> { return this.#request('POST', '/v1/private-requests/prepare', PrivateRequestPrepareResponseSchema, { body: PreparePrivateRequestSchema.parse(input) }); }
  preparePrivateStatusUpdate(input: PreparePrivateStatusUpdate = {}): Promise<PrivateStatusUpdatePrepareResponse> { return this.#request('POST', '/v1/private-status-updates/prepare', PrivateStatusUpdatePrepareResponseSchema, { body: PreparePrivateStatusUpdateSchema.parse(input) }); }
  createRequest(input: CreateRequest): Promise<CreateRequestResponse> { return this.#request('POST', '/v1/requests', CreateRequestResponseSchema, { body: CreateRequestSchema.parse(input) }); }
  listRequests(options: { workspaceId?: string } = {}): Promise<RequestRecord[]> {
    const params = new URLSearchParams();
    if (options.workspaceId) params.set('workspaceId', options.workspaceId);
    return this.#request('GET', `/v1/requests${querySuffix(params)}`, RequestRecordSchema.array());
  }
  getRequest(id: string): Promise<RequestRecord> { return this.#request('GET', `/v1/requests/${encodeURIComponent(id)}`, RequestRecordSchema); }
  respondToRequest(id: string, input: RespondRequest, options: { responseSurface?: 'web-fallback' } = {}): Promise<RequestRecord> {
    return this.#request('POST', `/v1/requests/${encodeURIComponent(id)}/responses`, RequestRecordSchema, {
      body: RespondRequestSchema.parse(input),
      ...(options.responseSurface ? { responseSurface: options.responseSurface } : {})
    });
  }
  listAudienceRequests(): Promise<RequestRecord[]> { return this.#request('GET', '/v1/audience-requests', RequestRecordSchema.array(), { includeWorkspace: false }); }
  respondToAudienceRequest(id: string, input: RespondRequest): Promise<RequestRecord> { return this.#request('POST', `/v1/audience-requests/${encodeURIComponent(id)}/responses`, RequestRecordSchema, { body: RespondRequestSchema.parse(input), includeWorkspace: false }); }
  abandonRequest(id: string): Promise<RequestRecord> { return this.#request('POST', `/v1/requests/${encodeURIComponent(id)}/abandon`, RequestRecordSchema, { body: {} }); }
  stopRequestWaiter(id: string, input: StopRequestWaiter, options: { waiterToken: string }): Promise<RequestRecord> {
    return this.#request('POST', `/v1/requests/${encodeURIComponent(id)}/waiter/stop`, RequestRecordSchema, { body: StopRequestWaiterSchema.parse(input), bearerToken: options.waiterToken });
  }
  reportRequestWaiterError(id: string, input: ReportRequestWaiterError, options: { waiterToken: string }): Promise<RequestRecord> {
    return this.#request('POST', `/v1/requests/${encodeURIComponent(id)}/waiter/error`, RequestRecordSchema, { body: ReportRequestWaiterErrorSchema.parse(input), bearerToken: options.waiterToken });
  }
  waitForRequest(id: string, options: { timeoutMs?: number; waiterToken?: string; signal?: AbortSignal } = {}): Promise<WaitRequestResponse> {
    const params = new URLSearchParams();
    if (options.timeoutMs !== undefined) params.set('timeoutMs', String(options.timeoutMs));
    return this.#request('GET', `/v1/requests/${encodeURIComponent(id)}/wait${querySuffix(params)}`, WaitRequestResponseSchema, {
      ...(options.waiterToken ? { bearerToken: options.waiterToken } : {}),
      ...(options.signal ? { signal: options.signal } : {})
    });
  }
  async waitForCreatedRequest(created: CreateRequestResponse, options: { timeoutMs?: number; signal?: AbortSignal } = {}): Promise<WaitRequestResponse> {
    const waitOptions = {
      ...(options.signal ? { signal: options.signal } : {}),
      ...(created.waiter ? { waiterToken: created.waiter.token } : {})
    };
    const timeoutMs = options.timeoutMs;
    if (timeoutMs === undefined || !Number.isFinite(timeoutMs)) {
      return this.waitForRequest(created.request.id, waitOptions);
    }
    if (timeoutMs <= 0) {
      return this.waitForRequest(created.request.id, { timeoutMs, ...waitOptions });
    }

    const deadline = Date.now() + timeoutMs;
    let retryBackoffMs = INITIAL_WAIT_RETRY_BACKOFF_MS;

    while (true) {
      const remainingMs = Math.max(1, deadline - Date.now());
      try {
        const result = await this.waitForRequest(created.request.id, {
          timeoutMs: Math.min(MAX_WAIT_LONG_POLL_MS, remainingMs),
          ...waitOptions
        });
        retryBackoffMs = INITIAL_WAIT_RETRY_BACKOFF_MS;
        if (result.terminal || timeoutMs <= MAX_WAIT_LONG_POLL_MS || Date.now() >= deadline) return result;
      } catch (error) {
        if (!isTransientWaitError(error, options.signal) || Date.now() >= deadline) throw error;
        const delayMs = Math.min(waitBackoffDelay(retryBackoffMs), Math.max(0, deadline - Date.now()));
        if (delayMs <= 0) throw error;
        await sleep(delayMs, options.signal);
        retryBackoffMs = Math.min(MAX_WAIT_RETRY_BACKOFF_MS, retryBackoffMs * 2);
      }
    }
  }

  listActivity(options: { workspaceId?: string; limit?: number } = {}): Promise<ActivityItem[]> {
    const params = new URLSearchParams();
    if (options.workspaceId) params.set('workspaceId', options.workspaceId);
    if (options.limit !== undefined) params.set('limit', String(options.limit));
    return this.#request('GET', `/v1/activity${querySuffix(params)}`, ActivityItemSchema.array());
  }
  listActivityHistory(options: { workspaceId?: string; limit?: number } = {}): Promise<ActivityItem[]> {
    const params = new URLSearchParams();
    if (options.workspaceId) params.set('workspaceId', options.workspaceId);
    if (options.limit !== undefined) params.set('limit', String(options.limit));
    return this.#request('GET', `/v1/activity/history${querySuffix(params)}`, ActivityItemSchema.array());
  }
  getPendingRequestCount(options: { workspaceId?: string } = {}): Promise<PendingActivityCount> {
    const params = new URLSearchParams();
    if (options.workspaceId) params.set('workspaceId', options.workspaceId);
    return this.#request('GET', `/v1/activity/pending-count${querySuffix(params)}`, PendingActivityCountSchema);
  }
  listSessions(options: { workspaceId?: string; limit?: number } = {}): Promise<SessionSummary[]> {
    const params = new URLSearchParams();
    if (options.workspaceId) params.set('workspaceId', options.workspaceId);
    if (options.limit !== undefined) params.set('limit', String(options.limit));
    return this.#request('GET', `/v1/sessions${querySuffix(params)}`, SessionSummarySchema.array());
  }
  getSession(id: string, options: { workspaceId?: string; limit?: number } = {}): Promise<SessionDetail> {
    const params = new URLSearchParams();
    if (options.workspaceId) params.set('workspaceId', options.workspaceId);
    if (options.limit !== undefined) params.set('limit', String(options.limit));
    return this.#request('GET', `/v1/sessions/${encodeURIComponent(id)}${querySuffix(params)}`, SessionDetailSchema);
  }

  listWorkspaces(): Promise<WorkspaceMemberRecord[]> { return this.#request('GET', '/v1/workspaces', WorkspaceMemberRecordSchema.array()); }
  createSharedWorkspace(input: CreateSharedWorkspace): Promise<WorkspaceMemberRecord> { return this.#request('POST', '/v1/workspaces', WorkspaceMemberRecordSchema, { body: CreateSharedWorkspaceSchema.parse(input) }); }
  updateWorkspace(id: string, input: UpdateWorkspace): Promise<WorkspaceRecord> { return this.#request('PATCH', `/v1/workspaces/${encodeURIComponent(id)}`, WorkspaceRecordSchema, { body: UpdateWorkspaceSchema.parse(input) }); }
  listWorkspaceMembers(workspaceId: string): Promise<WorkspaceMemberRecord[]> { return this.#request('GET', `/v1/workspaces/${encodeURIComponent(workspaceId)}/members`, WorkspaceMemberRecordSchema.array()); }
  addWorkspaceMember(workspaceId: string, input: AddWorkspaceMember): Promise<WorkspaceMemberRecord> {
    return this.#request('POST', `/v1/workspaces/${encodeURIComponent(workspaceId)}/members`, WorkspaceMemberRecordSchema, { body: AddWorkspaceMemberSchema.parse(input) });
  }
  createExternalApprover(input: CreateExternalApprover): Promise<ExternalApproverRecord> {
    return this.#request('POST', '/v1/external-approvers', ExternalApproverRecordSchema, { body: CreateExternalApproverSchema.parse(input) });
  }
  getExternalApproverStatus(externalApproverId: string): Promise<ExternalApproverStatus> {
    return this.#request('GET', `/v1/external-approvers/${encodeURIComponent(externalApproverId)}/status`, ExternalApproverStatusSchema);
  }
  createExternalApproverBoundAgentToken(externalApproverId: string): Promise<AgentCredential> {
    return this.#request('POST', `/v1/external-approvers/${encodeURIComponent(externalApproverId)}/agent-token`, AgentCredentialSchema, { body: {} });
  }
  createExternalApproverInviteForApprover(externalApproverId: string): Promise<ExternalApproverInviteCredential> {
    return this.#request('POST', `/v1/external-approvers/${encodeURIComponent(externalApproverId)}/invite`, ExternalApproverInviteCredentialSchema, { body: {} });
  }
  createExternalApproverInvite(workspaceId: string, input: CreateExternalApproverInvite): Promise<ExternalApproverInviteCredential> {
    return this.#request('POST', `/v1/workspaces/${encodeURIComponent(workspaceId)}/external-approver-invites`, ExternalApproverInviteCredentialSchema, { body: CreateExternalApproverInviteSchema.parse(input) });
  }
  getExternalApproverInvite(token: string): Promise<ExternalApproverInviteRecord> {
    return this.#request('GET', `/v1/external-approver-invites/${encodeURIComponent(token)}`, ExternalApproverInviteRecordSchema, { includeWorkspace: false });
  }
  acceptExternalApproverInvite(token: string): Promise<WorkspaceMemberRecord> {
    return this.#request('POST', `/v1/external-approver-invites/${encodeURIComponent(token)}/accept`, WorkspaceMemberRecordSchema, { body: {}, includeWorkspace: false });
  }
  revokeExternalApproverInvite(workspaceId: string, inviteId: string): Promise<ExternalApproverInviteRecord> {
    return this.#request('POST', `/v1/workspaces/${encodeURIComponent(workspaceId)}/external-approver-invites/${encodeURIComponent(inviteId)}/revoke`, ExternalApproverInviteRecordSchema, { body: {} });
  }
  revokeExternalApproverInviteById(inviteId: string): Promise<ExternalApproverInviteRecord> {
    return this.#request('POST', `/v1/external-approver-invites/${encodeURIComponent(inviteId)}/revoke`, ExternalApproverInviteRecordSchema, { body: {} });
  }

  listAgentTokens(): Promise<AgentTokenRecord[]> { return this.#request('GET', '/v1/agent-tokens', AgentTokenRecordSchema.array()); }
  createAgentToken(input: CreateAgentToken): Promise<AgentCredential> { return this.#request('POST', '/v1/agent-tokens', AgentCredentialSchema, { body: CreateAgentTokenSchema.parse(input) }); }
  updateAgentToken(agentTokenId: string, input: UpdateAgentToken): Promise<AgentTokenRecord> { return this.#request('PATCH', `/v1/agent-tokens/${encodeURIComponent(agentTokenId)}`, AgentTokenRecordSchema, { body: UpdateAgentTokenSchema.parse(input) }); }
  revokeAgentToken(agentTokenId: string): Promise<AgentTokenRecord> { return this.#request('POST', `/v1/agent-tokens/${encodeURIComponent(agentTokenId)}/revoke`, AgentTokenRecordSchema, { body: {} }); }

  listRoutingRules(options: { workspaceId?: string } = {}): Promise<RoutingRuleRecord[]> {
    const params = new URLSearchParams();
    if (options.workspaceId) params.set('workspaceId', options.workspaceId);
    return this.#request('GET', `/v1/routing-rules${querySuffix(params)}`, RoutingRuleRecordSchema.array());
  }
  previewRouting(input: RoutingPreviewInput = {}): Promise<RoutingPreview> { return this.#request('POST', '/v1/routing-preview', RoutingPreviewSchema, { body: RoutingPreviewInputSchema.parse(input) }); }
  createRoutingRule(input: CreateRoutingRule): Promise<RoutingRuleRecord> { return this.#request('POST', '/v1/routing-rules', RoutingRuleRecordSchema, { body: CreateRoutingRuleSchema.parse(input) }); }
  updateRoutingRule(id: string, input: UpdateRoutingRule): Promise<RoutingRuleRecord> { return this.#request('PATCH', `/v1/routing-rules/${encodeURIComponent(id)}`, RoutingRuleRecordSchema, { body: UpdateRoutingRuleSchema.parse(input) }); }
  deleteRoutingRule(id: string): Promise<DeleteRoutingRuleResponse> { return this.#request('DELETE', `/v1/routing-rules/${encodeURIComponent(id)}`, DeleteRoutingRuleResponseSchema); }

  listAudienceChannels(options: { workspaceId?: string } = {}): Promise<AudienceChannelRecord[]> {
    const params = new URLSearchParams();
    if (options.workspaceId) params.set('workspaceId', options.workspaceId);
    return this.#request('GET', `/v1/audience-channels${querySuffix(params)}`, AudienceChannelRecordSchema.array());
  }
  createAudienceChannel(input: CreateAudienceChannel): Promise<AudienceChannelRecord> { return this.#request('POST', '/v1/audience-channels', AudienceChannelRecordSchema, { body: CreateAudienceChannelSchema.parse(input) }); }
  getAudienceChannel(channelId: string): Promise<AudienceChannelRecord> { return this.#request('GET', `/v1/audience-channels/${encodeURIComponent(channelId)}`, AudienceChannelRecordSchema, { includeWorkspace: false }); }
  subscribeToAudienceChannel(channelId: string): Promise<AudienceSubscriptionRecord> { return this.#request('POST', `/v1/audience-channels/${encodeURIComponent(channelId)}/subscribe`, AudienceSubscriptionRecordSchema, { body: {}, includeWorkspace: false }); }
  muteAudienceChannel(channelId: string): Promise<AudienceSubscriptionRecord> { return this.#request('POST', `/v1/audience-channels/${encodeURIComponent(channelId)}/mute`, AudienceSubscriptionRecordSchema, { body: {}, includeWorkspace: false }); }
  unsubscribeFromAudienceChannel(channelId: string): Promise<AudienceSubscriptionRecord> { return this.#request('POST', `/v1/audience-channels/${encodeURIComponent(channelId)}/unsubscribe`, AudienceSubscriptionRecordSchema, { body: {}, includeWorkspace: false }); }

  sendTestActivity(input: SendTestActivity): Promise<SendTestActivityResponse> { return this.#request('POST', '/v1/tests', SendTestActivityResponseSchema, { body: SendTestActivitySchema.parse(input) }); }

  createPairingToken(): Promise<PairingToken> { return this.#request('POST', '/v1/pairing-tokens', PairingTokenSchema, { body: {} }); }
  pairDevice(input: PairDeviceRequest): Promise<DeviceCredential> { return this.#request('POST', '/v1/devices/pair', DeviceCredentialSchema, { body: PairDeviceRequestSchema.parse(input), includeWorkspace: false }); }
  registerDevice(input: RegisterDevice): Promise<RegisterDeviceResponse> { return this.#request('POST', '/v1/devices/register', RegisterDeviceResponseSchema, { body: RegisterDeviceSchema.parse(input) }); }
  listDevices(): Promise<DeviceRecord[]> { return this.#request('GET', '/v1/devices', DeviceRecordSchema.array()); }
  registerDevicePublicKey(deviceId: string, input: RegisterDevicePublicKey): Promise<DevicePublicKeyRecord> { return this.#request('POST', `/v1/devices/${encodeURIComponent(deviceId)}/public-key`, DevicePublicKeyRecordSchema, { body: RegisterDevicePublicKeySchema.parse(input) }); }
  listDevicePublicKeys(deviceId: string): Promise<DevicePublicKeyRecord[]> { return this.#request('GET', `/v1/devices/${encodeURIComponent(deviceId)}/public-keys`, DevicePublicKeyRecordSchema.array()); }
  renameDevice(deviceId: string, name: string): Promise<DeviceRecord> { return this.#request('PATCH', `/v1/devices/${encodeURIComponent(deviceId)}`, DeviceRecordSchema, { body: UpdateDeviceNameSchema.parse({ name }) }); }
  updateDevicePushToken(deviceId: string, input: UpdateDevicePushToken): Promise<DeviceRecord> { return this.#request('POST', `/v1/devices/${encodeURIComponent(deviceId)}/push-token`, DeviceRecordSchema, { body: UpdateDevicePushTokenSchema.parse(input) }); }
  unpairDevice(deviceId: string): Promise<DeviceRecord> { return this.#request('POST', `/v1/devices/${encodeURIComponent(deviceId)}/unpair`, DeviceRecordSchema, { body: {} }); }
  unregisterDevice(deviceId: string): Promise<DeviceRecord> { return this.#request('POST', `/v1/devices/${encodeURIComponent(deviceId)}/unregister`, DeviceRecordSchema, { body: {} }); }

  createEventTicket(): Promise<EventTicketResponse> { return this.#request('POST', '/v1/events/ticket', EventTicketResponseSchema, { body: {} }); }
  pollEvents(options: { lastEventId?: number; timeoutMs?: number; signal?: AbortSignal } = {}): Promise<EventPollResponse> {
    const params = new URLSearchParams();
    if (options.lastEventId !== undefined) params.set('lastEventId', String(options.lastEventId));
    if (options.timeoutMs !== undefined) params.set('timeoutMs', String(options.timeoutMs));
    return this.#request('GET', `/v1/events/poll${querySuffix(params)}`, EventPollResponseSchema, { ...(options.signal ? { signal: options.signal } : {}) });
  }

  async createEventStreamURL(options: { lastEventId?: number } = {}): Promise<string> {
    const ticket = await this.createEventTicket();
    const params = new URLSearchParams({ ticket: ticket.ticket });
    if (options.lastEventId !== undefined) params.set('lastEventId', String(options.lastEventId));
    return `${this.#baseUrl}/v1/events?${params.toString()}`;
  }

  async openEventStream(options: { EventSource?: EventSourceConstructor; lastEventId?: number } = {}): Promise<EventSource> {
    const EventSourceImpl = options.EventSource ?? globalThis.EventSource;
    if (!EventSourceImpl) throw new Error('EventSource is not available');
    return new EventSourceImpl(await this.createEventStreamURL({ ...(options.lastEventId !== undefined ? { lastEventId: options.lastEventId } : {}) }));
  }

  async #request<T>(method: string, path: string, schema: ZodType<T>, options: { body?: unknown; includeWorkspace?: boolean; signal?: AbortSignal; bearerToken?: string; responseSurface?: 'web-fallback' } = {}): Promise<T> {
    const headers = new Headers({ Accept: 'application/json' });
    const token = options.bearerToken ?? await resolveProvider(this.#tokenProvider);
    if (token) headers.set('Authorization', `Bearer ${token}`);
    if (options.responseSurface) headers.set('X-Agent-Tick-Response-Surface', options.responseSurface);
    if (options.includeWorkspace !== false) {
      const workspaceId = await resolveProvider(this.#workspaceIdProvider);
      if (workspaceId) headers.set('X-Agent-Tick-Workspace-ID', workspaceId);
    }
    let body: string | undefined;
    if (options.body !== undefined) {
      headers.set('Content-Type', 'application/json');
      body = JSON.stringify(options.body);
    }
    const init: RequestInit = { method, headers, ...(body !== undefined ? { body } : {}), ...(options.signal ? { signal: options.signal } : {}) };
    const response = await this.#fetch(new URL(path, this.#baseUrl), init);
    const text = await response.text();
    const parsed = text ? JSON.parse(text) as unknown : undefined;
    if (!response.ok) {
      const envelope = ApiErrorEnvelopeSchema.safeParse(parsed);
      if (envelope.success) {
        const { error } = envelope.data as ApiErrorEnvelope;
        throw new AgentTickApiError(error.message, response.status, parsed, error.code, error.requestId);
      }
      throw new AgentTickApiError(response.statusText || 'Request failed', response.status, parsed);
    }
    return schema.parse(parsed);
  }
}

function isAbortError(error: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted) return true;
  return typeof error === 'object' && error !== null && 'name' in error
    && (String((error as { name?: unknown }).name) === 'AbortError' || String((error as { name?: unknown }).name) === 'TimeoutError');
}

function isTransientWaitError(error: unknown, signal?: AbortSignal): boolean {
  if (isAbortError(error, signal)) return false;
  if (error instanceof AgentTickApiError) return error.status === 408 || error.status === 429 || error.status >= 500;
  // Fetch network failures are usually TypeError in Node/browser runtimes.
  // CDN/proxy HTML timeout bodies can surface as SyntaxError because #request
  // parses JSON before checking non-2xx statuses.
  return error instanceof TypeError || error instanceof SyntaxError;
}

function waitBackoffDelay(baseMs: number): number {
  const jitterMultiplier = 0.8 + Math.random() * 0.4;
  return Math.max(1, Math.round(baseMs * jitterMultiplier));
}

function abortReason(signal?: AbortSignal): Error {
  if (signal?.reason instanceof Error) return signal.reason;
  return new Error('Agent Tick wait aborted');
}

async function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) throw abortReason(signal);
  await new Promise<void>((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onAbort = () => {
      if (timer) clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      reject(abortReason(signal));
    };
    timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) onAbort();
  });
}

async function resolveProvider(provider: TokenProvider | WorkspaceIdProvider | undefined): Promise<string | null | undefined> {
  return typeof provider === 'function' ? provider() : provider;
}

function normalizeBaseUrl(value: string): string {
  const url = new URL(value);
  return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
}

function querySuffix(params: URLSearchParams): string {
  return params.size ? `?${params.toString()}` : '';
}

export type {
  ActivityItem,
  AddWorkspaceMember,
  AgentCredential,
  AgentTokenRecord,
  AuditEventRecord,
  AudienceChannelRecord,
  AudienceSubscriptionRecord,
  AuthConfig,
  AvailabilityRecord,
  BillingProductsResponse,
  BillingPurchaseAttemptCancelRequest,
  BillingPurchaseAttemptCancelResponse,
  BillingPurchasePreflightRequest,
  BillingPurchasePreflightResponse,
  BillingStatus,
  BillingTrialStartRequest,
  CreateAgentToken,
  CreateAudienceChannel,
  CreateExternalApprover,
  CreateExternalApproverInvite,
  CreateMobileDiagnostics,
  CreateMobileSession,
  CreateRequest,
  CreateRequestResponse,
  CreateRoutingRule,
  CreateSharedWorkspace,
  CreateStatusUpdate,
  CreateToolActivity,
  DeleteMeResponse,
  DeleteRoutingRuleResponse,
  DeviceCredential,
  DeviceRecord,
  EventPollEvent,
  EventPollResponse,
  EventTicketResponse,
  ExternalApproverInviteCredential,
  ExternalApproverInviteRecord,
  ExternalApproverRecord,
  ExternalApproverStatus,
  HealthResponse,
  HeartbeatRequest,
  HeartbeatResponse,
  MeResponse,
  MobileDiagnosticsResponse,
  MobileSessionResponse,
  OnboardingStatus,
  PairDeviceRequest,
  PairingToken,
  PendingActivityCount,
  PersonalBillingStatus,
  PreparePrivateStatusUpdate,
  PrivateStatusUpdatePrepareResponse,
  PersonalBillingUpdate,
  RegisterDevice,
  RegisterDeviceResponse,
  ReadyResponse,
  ReportRequestWaiterError,
  RequestAgentWaiterSummary,
  RequestRecord,
  RequestWaiterCredential,
  RespondRequest,
  StopRequestWaiter,
  RoutingPreview,
  RoutingPreviewInput,
  RoutingRuleRecord,
  SendTestActivity,
  SendTestActivityResponse,
  SetAvailability,
  SessionDetail,
  SessionSummary,
  StatusUpdateRecord,
  ToolActivityRecord,
  UpdateAgentToken,
  UpdateDeviceName,
  UpdateDevicePushToken,
  UpdateRoutingRule,
  UpdateWorkspace,
  WaitRequestResponse,
  WorkspaceMemberRecord,
  WorkspaceRecord
};
