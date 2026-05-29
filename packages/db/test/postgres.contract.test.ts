import { describe, expect, it } from 'vitest';
import { DEFAULT_USER_ID, DEFAULT_WORKSPACE_ID } from './storeHarness.js';
import { postgresTestDatabaseURL, withPostgresSchemaHarness } from './postgresHarness.js';

const describePostgres = postgresTestDatabaseURL ? describe : describe.skip;
const postgresSuiteName = postgresTestDatabaseURL
  ? 'Postgres identity workspace routing contract'
  : 'Postgres identity workspace routing contract (set AGENT_TICK_TEST_POSTGRES_URL to run)';

describePostgres(postgresSuiteName, () => {
  it('seeds Personal defaults and links Clerk identities by verified email', async () => {
    await withPostgresSchemaHarness(async ({ store }) => {
      await store.migrate();
      await store.ensureSingleTenantDefaults('2026-05-08T00:00:00.000Z');
      expect(await store.listWorkspacesForUser(DEFAULT_USER_ID)).toEqual([
        expect.objectContaining({ workspaceId: DEFAULT_WORKSPACE_ID, type: 'personal', name: 'Personal', role: 'owner' })
      ]);

      const original = await store.loginOrCreateClerkIdentity({ issuer: 'https://clerk.example', subject: 'user_old_google', email: 'Alice@Example.com', emailVerified: true, name: 'Alice', authMethod: 'oauth_google' }, '2026-05-08T00:30:00.000Z');
      await store.revokeUserAccess(original.userId, '2026-05-08T00:35:00.000Z');
      const replacement = await store.loginOrCreateClerkIdentity({ issuer: 'https://clerk.example', subject: 'user_new_google', email: 'alice@example.com', emailVerified: true, name: 'Alice Again', authMethod: 'oauth_google' }, '2026-05-08T00:40:00.000Z');

      expect(replacement.userId).toBe(original.userId);
      expect(replacement.workspaceId).toBe(original.workspaceId);
      expect(await store.userProfile(original.userId)).toMatchObject({ email: 'alice@example.com', name: 'Alice Again', signInMethod: 'oauth_google' });
    });
  });

  it('upserts Clerk Workspaces memberships routing rules and audiences idempotently', async () => {
    await withPostgresSchemaHarness(async ({ store }) => {
      await store.migrate();
      await store.ensureSingleTenantDefaults('2026-05-08T00:00:00.000Z');
      const owner = await store.loginOrCreateClerkIdentity({ issuer: 'https://clerk.example', subject: 'owner', email: 'owner@example.com', emailVerified: true, name: 'Owner' });
      const workspace = await store.upsertClerkWorkspace('org_123', 'Production', owner.userId, '2026-05-08T01:00:00.000Z');
      const renamed = await store.upsertClerkWorkspace('org_123', 'Production Renamed', owner.userId, '2026-05-08T01:01:00.000Z');
      const member = await store.addWorkspaceMemberByEmail(workspace.workspaceId, 'bob@example.com', 'member', '2026-05-08T01:02:00.000Z');
      const retried = await store.upsertClerkWorkspaceMember('org_123', 'mem_owner', owner.userId, 'admin', '2026-05-08T01:03:00.000Z');
      const rule = await store.createRoutingRule({ workspaceId: workspace.workspaceId, name: 'Backend routing', recipientUserIds: [owner.userId, member.userId], requiredResponseMode: 'exact', requiredResponseCount: 3 }, '2026-05-08T01:04:00.000Z');
      const channel = await store.createAudienceChannel({ workspaceId: workspace.workspaceId, name: 'Roadmap', visibility: 'public' }, owner.userId, '2026-05-08T01:05:00.000Z');
      const subscription = await store.setAudienceSubscription(channel.channelId, member.userId, 'active', '2026-05-08T01:06:00.000Z');

      expect(renamed.workspaceId).toBe(workspace.workspaceId);
      expect(renamed.name).toBe('Production Renamed');
      expect(retried).toMatchObject({ workspaceId: workspace.workspaceId, userId: owner.userId, role: 'admin', status: 'active' });
      expect(rule).toMatchObject({ name: 'Backend routing', requiredResponseCount: 2 });
      expect(rule.recipientUserIds).toEqual(expect.arrayContaining([owner.userId, member.userId]));
      expect(await store.listRoutingRules(workspace.workspaceId)).toEqual([expect.objectContaining({ routingRuleId: rule.routingRuleId })]);
      expect(subscription).toMatchObject({ channelId: channel.channelId, userId: member.userId, status: 'active' });
    });
  });

  it('connects External Approver invites to membership and route/token setup', async () => {
    await withPostgresSchemaHarness(async ({ store }) => {
      await store.migrate();
      await store.ensureSingleTenantDefaults('2026-05-08T00:00:00.000Z');
      const shared = await store.createSharedWorkspaceForUser(DEFAULT_USER_ID, 'Customer approvals');
      const approver = await store.createExternalApprover(shared.workspaceId, { displayName: 'Client', externalSubject: 'client@example.com' }, DEFAULT_USER_ID, '2026-05-08T01:00:00.000Z');
      const invite = await store.createExternalApproverInvite({ workspaceId: shared.workspaceId, createdByUserId: DEFAULT_USER_ID, externalApproverId: approver.externalApproverId, expiresInMinutes: 60 }, '2026-05-08T01:01:00.000Z');
      const user = await store.loginOrCreateClerkIdentity({ issuer: 'https://clerk.example', subject: 'client', email: 'client@example.com', emailVerified: true, name: 'Client' });
      const membership = await store.acceptExternalApproverInvite(invite.token, user.userId, '2026-05-08T01:02:00.000Z');
      const credential = await store.createExternalApproverAgentToken(approver.externalApproverId, shared.workspaceId, DEFAULT_USER_ID, '2026-05-08T01:03:00.000Z');

      expect(membership).toMatchObject({ workspaceId: shared.workspaceId, userId: user.userId, memberKind: 'external_approver' });
      expect(credential).toMatchObject({ workspaceId: shared.workspaceId, boundRecipientUserId: user.userId, routingRuleId: expect.any(String) });
      expect(await store.getExternalApproverStatus(approver.externalApproverId, shared.workspaceId)).toMatchObject({ connected: true, routeReady: true });
    });
  });

  it('creates routed Requests responses and waiter liveness records', async () => {
    await withPostgresSchemaHarness(async ({ store }) => {
      await store.migrate();
      await store.ensureSingleTenantDefaults('2026-05-08T00:00:00.000Z');
      const shared = await store.createSharedWorkspaceForUser(DEFAULT_USER_ID, 'Production');
      const bob = await store.addWorkspaceMemberByEmail(shared.workspaceId, 'bob@example.com');
      const rule = await store.createRoutingRule({ workspaceId: shared.workspaceId, name: 'Two humans', recipientUserIds: [DEFAULT_USER_ID, bob.userId], requiredResponseMode: 'exact', requiredResponseCount: 2 });
      const credential = await store.createAgentToken({ workspaceId: shared.workspaceId, label: 'Deploy bot', routingRuleId: rule.routingRuleId }, '2026-05-08T02:00:00.000Z');
      const auth = await store.verifyAgentToken(credential.token, '2026-05-08T02:00:30.000Z');
      const request = await store.createRequest({ workspaceId: shared.workspaceId, agentTokenId: credential.agentTokenId, requester: { name: 'Deploy bot' }, requestType: 'sanction', title: 'Deploy?' }, '2026-05-08T02:01:00.000Z');
      const waiter = await store.createRequestWaiterToken(request.id, shared.workspaceId, credential.agentTokenId, undefined, '2026-05-08T02:01:10.000Z');

      expect(auth).toMatchObject({ agentTokenId: credential.agentTokenId, workspaceId: shared.workspaceId, routingRuleId: rule.routingRuleId });
      expect(request.recipients).toEqual(expect.arrayContaining([expect.objectContaining({ userId: DEFAULT_USER_ID }), expect.objectContaining({ userId: bob.userId })]));
      expect(await store.verifyRequestWaiterToken(waiter.token, request.id, '2026-05-08T02:01:20.000Z')).toMatchObject({ waiterId: waiter.waiterId, requestId: request.id });
      expect(await store.respondToRequestForWorkspace(request.id, shared.workspaceId, { choiceId: 'approve' }, DEFAULT_USER_ID, '2026-05-08T02:02:00.000Z')).toMatchObject({ status: 'pending', quorum: { receivedResponseCount: 1, waitingFor: 1 } });
      expect(await store.respondToRequestForWorkspace(request.id, shared.workspaceId, { choiceId: 'approve' }, bob.userId, '2026-05-08T02:03:00.000Z')).toMatchObject({ status: 'responded', response: { choiceId: 'approve' } });
      expect(await store.getRequestForWorkspace(request.id, shared.workspaceId, undefined, '2026-05-08T02:04:00.000Z')).toMatchObject({ agentWaiter: { state: 'stale' } });
    });
  });

  it('handles Audience responses deadline finalization and abandon semantics', async () => {
    await withPostgresSchemaHarness(async ({ store }) => {
      await store.migrate();
      await store.ensureSingleTenantDefaults('2026-05-08T00:00:00.000Z');
      const shared = await store.createSharedWorkspaceForUser(DEFAULT_USER_ID, 'Audience');
      const voter = await store.addWorkspaceMemberByEmail(shared.workspaceId, 'voter@example.com');
      const channel = await store.createAudienceChannel({ workspaceId: shared.workspaceId, name: 'Roadmap', visibility: 'public' }, DEFAULT_USER_ID, '2026-05-08T03:00:00.000Z');
      await store.setAudienceSubscription(channel.channelId, voter.userId, 'active');
      const credential = await store.createAgentToken({ workspaceId: shared.workspaceId, label: 'Audience bot' });
      const request = await store.createRequest({ workspaceId: shared.workspaceId, agentTokenId: credential.agentTokenId, requester: { name: 'Audience bot' }, requestType: 'steering', deliveryKind: 'audience_channel', audienceChannelId: channel.channelId, responsePolicy: 'deadline_plurality', closesAt: '2026-05-08T03:10:00.000Z', title: 'What next?' }, '2026-05-08T03:01:00.000Z');
      await store.respondToAudienceRequest(request.id, { choiceId: 'option_a' }, voter.userId, '2026-05-08T03:02:00.000Z');

      expect(await store.getRequestForWorkspace(request.id, shared.workspaceId, undefined, '2026-05-08T03:11:00.000Z')).toMatchObject({ status: 'responded', response: { choiceId: 'option_a' }, aggregateResult: { choices: { option_a: 1 } } });

      const routedRule = await store.createRoutingRule({ workspaceId: shared.workspaceId, name: 'Owner', recipientUserIds: [DEFAULT_USER_ID], requiredResponseMode: 'any_one' });
      const routedToken = await store.createAgentToken({ workspaceId: shared.workspaceId, label: 'Routed bot', routingRuleId: routedRule.routingRuleId });
      const routedRequest = await store.createRequest({ workspaceId: shared.workspaceId, agentTokenId: routedToken.agentTokenId, requester: { name: 'Routed bot' }, requestType: 'sanction', title: 'Abort?' }, '2026-05-08T03:12:00.000Z');
      expect(await store.abandonRequestForWorkspace(routedRequest.id, shared.workspaceId, DEFAULT_USER_ID, '2026-05-08T03:13:00.000Z')).toMatchObject({ status: 'resolved', response: { message: 'resolved' } });
    });
  });

  it('records status activity devices event tickets availability diagnostics and audit streams', async () => {
    await withPostgresSchemaHarness(async ({ store }) => {
      await store.migrate();
      await store.ensureSingleTenantDefaults('2026-05-08T00:00:00.000Z');
      const credential = await store.createAgentToken({ label: 'Pi' }, '2026-05-08T04:00:00.000Z');
      const status = await store.createStatusUpdate({ workspaceId: DEFAULT_WORKSPACE_ID, agentTokenId: credential.agentTokenId, threadId: 'thread_123', message: 'Running tests', state: 'working', session: { label: 'Thread alias' } }, '2026-05-08T04:01:00.000Z');
      expect(status).toMatchObject({ threadId: 'thread_123', sessionId: 'thread_123', recipientUserIds: [DEFAULT_USER_ID] });
      expect((await store.listActivityForUser(DEFAULT_USER_ID, DEFAULT_WORKSPACE_ID)).map((item) => item.id)).toContain(status.statusId);
      expect(await store.pendingRequestCountForUser(DEFAULT_USER_ID, DEFAULT_WORKSPACE_ID)).toBe(0);

      const device = await store.registerDevice({ userId: DEFAULT_USER_ID, deviceName: 'phone', installationId: 'install_postgres', expoPushToken: 'ExponentPushToken[one]' }, '2026-05-08T04:02:00.000Z');
      const updated = await store.registerDevice({ userId: DEFAULT_USER_ID, deviceName: 'phone renamed', installationId: 'install_postgres', expoPushToken: 'ExponentPushToken[two]' }, '2026-05-08T04:03:00.000Z');
      expect(updated.deviceId).toBe(device.deviceId);
      expect(await store.listDevicesForUser(DEFAULT_USER_ID)).toEqual([expect.objectContaining({ deviceId: device.deviceId, expoPushToken: 'ExponentPushToken[two]' })]);

      const pairing = await store.createPairingToken(DEFAULT_USER_ID, DEFAULT_WORKSPACE_ID, '2026-05-08T04:04:00.000Z');
      const paired = await store.pairDeviceWithCode(pairing.token, 'paired phone', 'ios', '2026-05-08T04:04:01.000Z');
      expect(paired).toMatchObject({ deviceId: expect.stringMatching(/^dev_/) });
      expect(await store.verifyDeviceToken(paired!.token)).toMatchObject({ userId: DEFAULT_USER_ID, workspaceId: DEFAULT_WORKSPACE_ID });

      const ticket = await store.createEventTicket({ source: 'mobile', workspaceId: DEFAULT_WORKSPACE_ID, userId: DEFAULT_USER_ID }, '2026-05-08T04:05:00.000Z');
      expect(await store.verifyEventTicket(ticket.ticket, '2026-05-08T04:05:01.000Z')).toMatchObject({ source: 'mobile', userId: DEFAULT_USER_ID });
      expect(await store.verifyEventTicket(ticket.ticket, '2026-05-08T04:05:02.000Z')).toBeNull();
      expect(await store.recordHeartbeat(DEFAULT_USER_ID, DEFAULT_WORKSPACE_ID, '2026-05-08T04:06:00.000Z')).toMatchObject({ state: 'available', lastSeenAt: '2026-05-08T04:06:00.000Z' });
      expect(await store.recordMobileDiagnostics([{ workspaceId: DEFAULT_WORKSPACE_ID, userId: DEFAULT_USER_ID, level: 'info', area: 'postgres', message: 'ok', createdAt: '2026-05-08T04:07:00.000Z' }])).toBe(1);
      expect(await store.listMobileDiagnostics(DEFAULT_WORKSPACE_ID)).toEqual([expect.objectContaining({ area: 'postgres', message: 'ok' })]);

      await store.writeAuditEvent(DEFAULT_WORKSPACE_ID, DEFAULT_USER_ID, 'postgres.audit', 'target', { ok: true }, '2026-05-08T04:08:00.000Z');
      const audit = await store.listAuditEventsAfter(DEFAULT_WORKSPACE_ID, 0);
      expect(audit.map((event) => event.eventId)).toEqual([...audit.map((event) => event.eventId)].sort((a, b) => a - b));
      expect(audit).toEqual(expect.arrayContaining([expect.objectContaining({ eventType: 'postgres.audit', targetId: 'target' })]));
    });
  });
});
