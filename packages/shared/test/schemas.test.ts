import { describe, expect, it } from 'vitest';
import {
  ApiErrorEnvelopeSchema,
  AuthConfigSchema,
  BillingStatusSchema,
  ChoiceListSchema,
  CreateRequestSchema,
  CreateRoutingRuleSchema,
  DeleteRoutingRuleResponseSchema,
  PersonalBillingUpdateSchema,
  ReadyResponseSchema,
  hostedPersonalStatus,
  ReportRequestWaiterErrorSchema,
  RequestRecordSchema,
  RequestWaiterCredentialSchema,
  SEMANTIC_STATUS_UPDATE_STATES,
  SessionSummarySchema,
  StopRequestWaiterSchema,
  StatusUpdateRecordSchema,
  UpdateDeviceNameSchema,
  UpdateDevicePushTokenSchema,
  WorkspaceMemberRecordSchema,
  deriveSessionSummaryTitle,
  isRedundantWaitingStatusUpdateAfterRequest,
  semanticStatusUpdateState,
  statusUpdateStateBehavior,
  suppressRedundantWaitingStatusUpdates
} from '../src/index.js';

describe('shared Workspace and Request schemas', () => {
  it('validates public auth config', () => {
    expect(AuthConfigSchema.parse({
      mode: 'clerk',
      authProvider: 'clerk',
      publicURL: 'https://tick.example.com',
      clerkPublishableKey: 'pk_test_123',
      mobile: { minimumSupportedVersion: '0.2.0', updateURL: 'https://apps.apple.com/app/id123', message: 'Update required.' }
    })).toMatchObject({ mode: 'clerk', mobile: { minimumSupportedVersion: '0.2.0' } });
  });

  it('validates readiness and operational response schemas', () => {
    expect(ReadyResponseSchema.parse({ status: 'ready', dependencies: { database: 'ok' } })).toMatchObject({ status: 'ready', dependencies: { database: 'ok' } });
    expect(DeleteRoutingRuleResponseSchema.parse({ status: 'deleted', routingRuleId: 'rul_1' })).toEqual({ status: 'deleted', routingRuleId: 'rul_1' });
    expect(PersonalBillingUpdateSchema.parse({ event: 'cancel_subscription' })).toEqual({ event: 'cancel_subscription' });
  });

  it('validates Workspace membership records', () => {
    expect(WorkspaceMemberRecordSchema.parse({ workspaceId: 'wsp_1', type: 'personal', name: 'Personal', userId: 'usr_1', role: 'owner', status: 'active', createdAt: '2026-05-08T00:00:00.000Z' })).toMatchObject({ workspaceId: 'wsp_1', name: 'Personal' });
  });

  it('validates routing rules without teams/projects/policies', () => {
    expect(CreateRoutingRuleSchema.parse({ workspaceId: 'wsp_1', name: 'Backend', recipientUserIds: ['usr_1'], requiredResponseMode: 'exact', requiredResponseCount: 2 })).toMatchObject({ name: 'Backend', requiredResponseMode: 'exact' });
  });

  it('validates billing status with Workspace language', () => {
    expect(BillingStatusSchema.parse({ workspaceId: 'wsp_1', plan: 'self-hosted', limits: { seats: 3 }, usage: { activeMembers: 2, pendingMembers: 0 } })).toMatchObject({ workspaceId: 'wsp_1' });
  });

  it('rejects empty Request titles', () => {
    expect(() => CreateRequestSchema.parse({ requester: { name: 'agent' }, title: '' })).toThrow();
  });

  it('accepts Session identity and metadata on Agent Activity schemas', () => {
    expect(CreateRequestSchema.parse({ requester: { name: 'agent', host: 'lattice', workingDirectory: '/repo', clientName: 'Pi' }, title: 'Pick?', sessionId: 'run_123', session: { title: 'Billing migration' } })).toMatchObject({ sessionId: 'run_123', session: { title: 'Billing migration' }, requester: { host: 'lattice' } });
    expect(StatusUpdateRecordSchema.parse({ statusId: 'stat_1', workspaceId: 'wsp_1', message: 'Working', state: 'working', sessionId: 'run_123', session: { label: 'Test run' }, host: 'lattice', workingDirectory: '/repo', clientName: 'Pi', createdAt: '2026-05-08T00:00:00.000Z' })).toMatchObject({ sessionId: 'run_123', session: { label: 'Test run' }, host: 'lattice' });
  });

  it('validates Request waiter liveness schemas', () => {
    expect(RequestWaiterCredentialSchema.parse({ token: 'wait_123', waiterId: 'waiter_123', expiresAt: '2026-05-08T01:00:00.000Z', leaseExpiresAt: '2026-05-08T00:02:00.000Z' })).toMatchObject({ waiterId: 'waiter_123' });
    expect(StopRequestWaiterSchema.parse({ reason: 'local_answer' })).toEqual({ reason: 'local_answer' });
    expect(ReportRequestWaiterErrorSchema.parse({ code: 'wait_failed.network', message: 'Network down' })).toEqual({ code: 'wait_failed.network', message: 'Network down' });
    expect(() => ReportRequestWaiterErrorSchema.parse({ code: 'not valid spaces' })).toThrow();
    expect(SessionSummarySchema.parse({
      sessionId: 'session_1',
      title: 'Release validation',
      state: 'needs-input',
      latestActivity: { kind: 'request', id: 'req_1', createdAt: '2026-05-08T00:00:00.000Z', preview: 'Pick?', requestStatus: 'pending', agentWaiter: { waiterId: 'waiter_123', state: 'waiting' } },
      pendingRequestCount: 1,
      pendingRequests: [{ id: 'req_1', title: 'Pick?', createdAt: '2026-05-08T00:00:00.000Z', status: 'pending', agentWaiter: { waiterId: 'waiter_123', state: 'waiting' } }],
      sourceLabels: ['Pi'],
      startedAt: '2026-05-08T00:00:00.000Z',
      updatedAt: '2026-05-08T00:00:30.000Z'
    })).toMatchObject({ latestActivity: { agentWaiter: { state: 'waiting' } }, pendingRequests: [{ agentWaiter: { waiterId: 'waiter_123' } }] });
    expect(RequestRecordSchema.parse({
      id: 'req_1',
      workspaceId: 'wsp_1',
      requester: { name: 'agent', agentTokenId: 'agt_1' },
      requestType: 'steering',
      title: 'Pick?',
      choices: [{ id: 'approve', label: 'Proceed' }, { id: 'deny', label: 'Stop', kind: 'deny' }],
      status: 'pending',
      createdAt: '2026-05-08T00:00:00.000Z',
      agentWaiter: { waiterId: 'waiter_123', state: 'waiting', lastSeenAt: '2026-05-08T00:00:30.000Z', leaseExpiresAt: '2026-05-08T00:01:30.000Z', credentialExpiresAt: '2026-05-08T01:00:00.000Z' }
    })).toMatchObject({ agentWaiter: { state: 'waiting', waiterId: 'waiter_123' } });
  });

  it('derives Session summary titles from Session metadata before Activity fallback titles', () => {
    const request = RequestRecordSchema.parse({ id: 'req_1', workspaceId: 'wsp_1', requester: { name: 'agent', host: 'lattice', workingDirectory: '/repo', clientName: 'Pi' }, requestType: 'sanction', title: 'Approve command?', sessionId: 'run_123', session: { title: 'Billing migration' }, choices: [{ id: 'approve', label: 'Approve' }, { id: 'deny', label: 'Deny', kind: 'deny' }], status: 'pending', createdAt: '2026-05-08T00:00:00.000Z' });
    const laterStatus = StatusUpdateRecordSchema.parse({ statusId: 'stat_1', workspaceId: 'wsp_1', message: 'Running tests', state: 'working', host: 'not-a-title', workingDirectory: '/not/a/title', clientName: 'Source hint only', createdAt: '2026-05-08T00:01:00.000Z' });

    expect(deriveSessionSummaryTitle([
      { kind: 'request', id: request.id, workspaceId: request.workspaceId, createdAt: request.createdAt, request },
      { kind: 'status_update', id: laterStatus.statusId, workspaceId: laterStatus.workspaceId, createdAt: laterStatus.createdAt, statusUpdate: laterStatus }
    ])).toBe('Billing migration');
    expect(deriveSessionSummaryTitle([{ kind: 'status_update', id: laterStatus.statusId, workspaceId: laterStatus.workspaceId, createdAt: laterStatus.createdAt, statusUpdate: laterStatus }])).toBe('Running tests');
  });

  it('requires custom Request choices to include a deny kind', () => {
    expect(() => CreateRequestSchema.parse({ requester: { name: 'agent' }, title: 'Pick?', choices: [{ id: 'a', label: 'A' }] })).toThrow(/deny/);
    expect(CreateRequestSchema.parse({ requester: { name: 'agent' }, requestType: 'steering', title: 'Pick?', choices: [{ id: 'a', label: 'A' }, { id: 'cancel', label: 'Cancel', kind: 'deny' }] }).choices).toEqual([{ id: 'a', label: 'A', kind: 'approve' }, { id: 'cancel', label: 'Cancel', kind: 'deny' }]);
  });

  it('constrains audience Request creation to public-safe deadline Steering', () => {
    expect(() => CreateRequestSchema.parse({ requester: { name: 'agent' }, requestType: 'sanction', deliveryKind: 'audience_channel', audienceChannelId: 'aud_1', responsePolicy: 'deadline_plurality', closesAt: '2026-05-08T00:10:00.000Z', title: 'Deploy?' })).toThrow(/Steering/);
    expect(() => CreateRequestSchema.parse({ requester: { name: 'agent' }, requestType: 'steering', deliveryKind: 'audience_channel', audienceChannelId: 'aud_1', responsePolicy: 'deadline_plurality', closesAt: '2026-05-08T00:10:00.000Z', title: 'Run command?', command: 'deploy' })).toThrow(/commands/);
    expect(() => CreateRequestSchema.parse({ requester: { name: 'agent' }, requestType: 'steering', deliveryKind: 'audience_channel', audienceChannelId: 'aud_1', responsePolicy: 'quorum', closesAt: '2026-05-08T00:10:00.000Z', title: 'Pick?' })).toThrow(/deadline_plurality/);
    expect(CreateRequestSchema.parse({ requester: { name: 'agent' }, requestType: 'steering', deliveryKind: 'audience_channel', audienceChannelId: 'aud_1', responsePolicy: 'deadline_plurality', closesAt: '2026-05-08T00:10:00.000Z', title: 'Pick?' })).toMatchObject({ deliveryKind: 'audience_channel', responsePolicy: 'deadline_plurality' });
  });

  it('deduplicates duplicate choice ids for display and response safety', () => {
    expect(ChoiceListSchema.parse([{ id: 'id', label: 'First' }, { id: 'id', label: 'Second' }, { id: 'id', label: 'Cancel', kind: 'deny' }])).toEqual([{ id: 'id', label: 'First', kind: 'approve' }, { id: 'id_2', label: 'Second', kind: 'approve' }, { id: 'id_3', label: 'Cancel', kind: 'deny' }]);
  });

  it('classifies semantic Status Update states separately from custom display-only states', () => {
    expect(SEMANTIC_STATUS_UPDATE_STATES).toEqual(['working', 'waiting', 'blocked', 'done', 'failed']);
    expect(SEMANTIC_STATUS_UPDATE_STATES.map((state) => semanticStatusUpdateState(state))).toEqual(SEMANTIC_STATUS_UPDATE_STATES);
    expect(statusUpdateStateBehavior('blocked')).toBe('semantic');
    expect(statusUpdateStateBehavior('waiting_for_ci')).toBe('display_only');
    expect(semanticStatusUpdateState('waiting_for_ci')).toBeUndefined();
    expect(StatusUpdateRecordSchema.parse({
      statusId: 'stat_1',
      workspaceId: 'wsp_1',
      message: 'Custom integration state',
      state: 'waiting_for_ci',
      stateBehavior: 'display_only',
      metadata: { reason: 'ci-lag', vendorState: 'waiting_for_ci' },
      createdAt: '2026-05-08T00:00:00.000Z'
    })).toMatchObject({ state: 'waiting_for_ci', stateBehavior: 'display_only', metadata: { reason: 'ci-lag' } });
  });

  it('suppresses near-immediate waiting Status Updates after pending Requests in a Session timeline', () => {
    const request = RequestRecordSchema.parse({
      id: 'req_1',
      workspaceId: 'wsp_1',
      requester: { name: 'agent', agentTokenId: 'agt_1' },
      requestType: 'steering',
      title: 'Pick an approach',
      choices: [{ id: 'approve', label: 'Proceed' }, { id: 'deny', label: 'Stop', kind: 'deny' }],
      status: 'pending',
      createdAt: '2026-05-08T00:00:00.000Z'
    });
    const redundantWaiting = StatusUpdateRecordSchema.parse({
      statusId: 'stat_waiting',
      workspaceId: 'wsp_1',
      agentTokenId: 'agt_1',
      message: 'Waiting for your answer',
      state: 'waiting',
      semanticState: 'waiting',
      stateBehavior: 'semantic',
      createdAt: '2026-05-08T00:00:02.000Z'
    });
    const laterWaiting = StatusUpdateRecordSchema.parse({
      ...redundantWaiting,
      statusId: 'stat_later',
      createdAt: '2026-05-08T00:01:00.000Z'
    });
    const customWaiting = StatusUpdateRecordSchema.parse({
      ...redundantWaiting,
      statusId: 'stat_custom',
      state: 'waiting_for_ci',
      semanticState: undefined,
      stateBehavior: 'display_only'
    });

    expect(isRedundantWaitingStatusUpdateAfterRequest(redundantWaiting, request)).toBe(true);
    expect(isRedundantWaitingStatusUpdateAfterRequest(laterWaiting, request)).toBe(false);
    expect(isRedundantWaitingStatusUpdateAfterRequest(customWaiting, request)).toBe(false);
    expect(suppressRedundantWaitingStatusUpdates([
      { kind: 'request', id: request.id, workspaceId: request.workspaceId, createdAt: request.createdAt, request },
      { kind: 'status_update', id: redundantWaiting.statusId, workspaceId: redundantWaiting.workspaceId, createdAt: redundantWaiting.createdAt, statusUpdate: redundantWaiting },
      { kind: 'status_update', id: customWaiting.statusId, workspaceId: customWaiting.workspaceId, createdAt: customWaiting.createdAt, statusUpdate: customWaiting }
    ]).map((item) => item.id)).toEqual(['req_1', 'stat_custom']);
  });

  it('projects hosted personal lifecycle from shared entitlement policy', () => {
    const entitlement = {
      userId: 'usr_1',
      trialStartedAt: '2026-05-01T00:00:00.000Z',
      createdAt: '2026-05-01T00:00:00.000Z',
      updatedAt: '2026-05-01T00:00:00.000Z',
    };
    const now = new Date('2026-05-10T00:00:00.000Z');

    expect(hostedPersonalStatus(entitlement, now).lifecycle).toBe('fresh');
    expect(hostedPersonalStatus({ ...entitlement, appUnlockedAt: '2026-05-02T00:00:00.000Z' }, now).lifecycle).toBe('fresh');
    expect(hostedPersonalStatus(entitlement, now, { nativeTrial: { startedAt: '2026-04-01T00:00:00.000Z', active: false } })).toMatchObject({ lifecycle: 'expired', trialEndsAt: '2026-04-08T00:00:00.000Z', routingEnabled: false });
    expect(hostedPersonalStatus(entitlement, now, { nativeTrial: { startedAt: '2026-05-08T00:00:00.000Z', active: true } })).toMatchObject({ lifecycle: 'active', trialEndsAt: '2026-05-15T00:00:00.000Z', responsesEnabled: true });
    expect(hostedPersonalStatus({ ...entitlement, hostedSubscriptionEndsAt: '2026-05-01T00:00:00.000Z', hostedSubscriptionCanceledAt: '2026-04-20T00:00:00.000Z' }, now)).toMatchObject({ lifecycle: 'read_only_grace', routingEnabled: true, responsesEnabled: false });
  });

  it('validates device update bodies and structured API errors', () => {
    expect(UpdateDeviceNameSchema.parse({ name: 'Ada’s iPhone' })).toEqual({ name: 'Ada’s iPhone' });
    expect(UpdateDevicePushTokenSchema.parse({ token: 'ExponentPushToken[1]' })).toEqual({ token: 'ExponentPushToken[1]' });
    expect(() => UpdateDevicePushTokenSchema.parse({})).toThrow();
    expect(ApiErrorEnvelopeSchema.parse({ error: { code: 'not_authenticated', message: 'Authentication required', requestId: 'req-1' } }).error.code).toBe('not_authenticated');
  });
});
