import { afterEach, describe, expect, it } from 'vitest';
import { AgentTickStore, DEFAULT_USER_ID, DEFAULT_WORKSPACE_ID, PostgresAgentTickStore, openAgentTickStore } from '../src/index.js';

let store: AgentTickStore | undefined;

afterEach(() => {
  store?.close();
  store = undefined;
});

function freshStore(): AgentTickStore {
  const next = AgentTickStore.open({ databaseURL: ':memory:' });
  next.migrate();
  next.ensureSingleTenantDefaults('2026-05-08T00:00:00.000Z');
  store = next;
  return next;
}

function countRows(local: AgentTickStore, table: string, column: string, value: string): number {
  return (local.db.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE ${column} = ?`).get(value) as { count: number }).count;
}

describe('AgentTickStore Workspace model', () => {
  it('routes PostgreSQL URLs to the Postgres store factory', async () => {
    const postgres = openAgentTickStore({ databaseURL: 'postgres://agent_tick:secret@localhost:5432/agent_tick' });
    const postgresql = openAgentTickStore({ databaseURL: 'postgresql://agent_tick:secret@localhost:5432/agent_tick' });
    expect(postgres).toBeInstanceOf(PostgresAgentTickStore);
    expect(postgresql).toBeInstanceOf(PostgresAgentTickStore);
    await Promise.all([postgres.close(), postgresql.close()]);
  });

  it('runs a fresh pre-launch Workspace schema with Personal defaults', () => {
    const local = freshStore();
    local.migrate();
    const workspace = local.db.prepare('SELECT workspace_id, type, name FROM workspaces WHERE workspace_id = ?').get(DEFAULT_WORKSPACE_ID);
    expect(workspace).toEqual({ workspace_id: DEFAULT_WORKSPACE_ID, type: 'personal', name: 'Personal' });
    expect(local.listWorkspacesForUser(DEFAULT_USER_ID)).toEqual([expect.objectContaining({ workspaceId: DEFAULT_WORKSPACE_ID, type: 'personal', name: 'Personal', role: 'owner' })]);
    expect(local.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('schema_migrations', 'organizations', 'teams', 'projects', 'policies', 'approval_requests', 'approval_votes')").all()).toEqual([]);
    expect(local.db.prepare("SELECT [notnull] FROM pragma_table_info('request_waiter_tokens') WHERE name = 'waiter_id'").get()).toEqual({ notnull: 1 });
  });

  it('creates Clerk humans with fixed-name Personal Workspaces', () => {
    const local = freshStore();
    const identity = local.loginOrCreateClerkIdentity({ issuer: 'https://clerk.example', subject: 'user_alice', email: 'Alice@Example.com', emailVerified: true, name: 'Alice', authMethod: 'oauth_google' }, '2026-05-08T00:30:00.000Z');
    expect(identity).toMatchObject({ userId: expect.stringMatching(/^usr_/), workspaceId: expect.stringMatching(/^wsp_/), role: 'owner' });
    expect(local.userProfile(identity.userId)).toMatchObject({ email: 'alice@example.com', name: 'Alice', signInMethod: 'oauth_google' });
    expect(local.listWorkspacesForUser(identity.userId)).toEqual([expect.objectContaining({ workspaceId: identity.workspaceId, type: 'personal', name: 'Personal' })]);
  });

  it('links recreated Clerk identities by verified email instead of leaving the mobile app signed out', () => {
    const local = freshStore();
    const original = local.loginOrCreateClerkIdentity({ issuer: 'https://clerk.example', subject: 'user_old_google', email: 'Alice@Example.com', emailVerified: true, name: 'Alice', authMethod: 'oauth_google' }, '2026-05-08T00:30:00.000Z');
    local.revokeUserAccess(original.userId, '2026-05-08T00:35:00.000Z');

    const replacement = local.loginOrCreateClerkIdentity({ issuer: 'https://clerk.example', subject: 'user_new_google', email: 'alice@example.com', emailVerified: true, name: 'Alice Again', authMethod: 'oauth_google' }, '2026-05-08T00:40:00.000Z');

    expect(replacement.userId).toBe(original.userId);
    expect(replacement.workspaceId).toBe(original.workspaceId);
    expect(local.userProfile(original.userId)).toMatchObject({ email: 'alice@example.com', name: 'Alice Again', signInMethod: 'oauth_google' });
    expect(local.db.prepare('SELECT revoked_at FROM users WHERE id = ?').get(original.userId)).toEqual({ revoked_at: null });
    expect(local.db.prepare('SELECT COUNT(*) AS count FROM auth_identities WHERE user_id = ?').get(original.userId)).toEqual({ count: 2 });
  });

  it('creates Shared Workspaces and Routing Rules instead of teams/projects/policies', () => {
    const local = freshStore();
    const shared = local.createSharedWorkspaceForUser(DEFAULT_USER_ID, 'Production', '2026-05-08T01:00:00.000Z');
    const bob = local.addWorkspaceMemberByEmail(shared.workspaceId, 'bob@example.com', 'member', '2026-05-08T01:01:00.000Z');
    const rule = local.createRoutingRule({ workspaceId: shared.workspaceId, name: 'Backend routing', recipientUserIds: [DEFAULT_USER_ID, bob.userId], requiredResponseMode: 'exact', requiredResponseCount: 3 }, '2026-05-08T01:02:00.000Z');

    expect(shared).toMatchObject({ type: 'shared', role: 'owner' });
    expect(rule).toMatchObject({ name: 'Backend routing', requiredResponseCount: 2 });
    expect(rule.recipientUserIds).toEqual(expect.arrayContaining([DEFAULT_USER_ID, bob.userId]));
    expect(local.listRoutingRules(shared.workspaceId)).toEqual([expect.objectContaining({ routingRuleId: rule.routingRuleId })]);
  });

  it('constrains External Approvers to single-recipient Routing Rules', () => {
    const local = freshStore();
    const shared = local.createSharedWorkspaceForUser(DEFAULT_USER_ID, 'Customer approvals', '2026-05-08T01:00:00.000Z');
    const external = local.addWorkspaceMemberByEmail(shared.workspaceId, 'client@example.com', 'member', '2026-05-08T01:01:00.000Z', 'external_approver');

    expect(external).toMatchObject({ role: 'member', memberKind: 'external_approver' });
    expect(local.listWorkspaceMembers(shared.workspaceId)).toEqual(expect.arrayContaining([expect.objectContaining({ userId: external.userId, memberKind: 'external_approver' })]));
    expect(() => local.addWorkspaceMemberByEmail(shared.workspaceId, 'admin-client@example.com', 'admin', '2026-05-08T01:01:30.000Z', 'external_approver')).toThrow(/External approvers/);
    expect(() => local.createRoutingRule({ workspaceId: shared.workspaceId, name: 'Mixed route', recipientUserIds: [DEFAULT_USER_ID, external.userId], requiredResponseMode: 'any_one' })).toThrow(/External Approvers/);
    expect(() => local.createRoutingRule({ workspaceId: shared.workspaceId, name: 'External exact', recipientUserIds: [external.userId], requiredResponseMode: 'exact', requiredResponseCount: 1 })).toThrow(/External Approvers/);

    const rule = local.createRoutingRule({ workspaceId: shared.workspaceId, name: 'Client only', recipientUserIds: [external.userId], requiredResponseMode: 'any_one', requiredResponseCount: 1 });
    expect(rule).toMatchObject({ name: 'Client only', recipientUserIds: [external.userId], requiredResponseMode: 'any_one', requiredResponseCount: 1 });
  });

  it('enforces bound recipient Agent Token routes', () => {
    const local = freshStore();
    const shared = local.createSharedWorkspaceForUser(DEFAULT_USER_ID, 'Customer approvals');
    const external = local.addWorkspaceMemberByEmail(shared.workspaceId, 'client-bound@example.com', 'member', undefined, 'external_approver');
    const other = local.addWorkspaceMemberByEmail(shared.workspaceId, 'other-bound@example.com');
    const clientRule = local.createRoutingRule({ workspaceId: shared.workspaceId, name: 'Client only', recipientUserIds: [external.userId], requiredResponseMode: 'any_one', requiredResponseCount: 1 });
    const otherRule = local.createRoutingRule({ workspaceId: shared.workspaceId, name: 'Other only', recipientUserIds: [other.userId], requiredResponseMode: 'any_one', requiredResponseCount: 1 });

    expect(() => local.createAgentToken({ workspaceId: shared.workspaceId, label: 'Wrong bound bot', routingRuleId: otherRule.routingRuleId, boundRecipientUserId: external.userId })).toThrow(/bound recipient/i);
    const credential = local.createAgentToken({ workspaceId: shared.workspaceId, label: 'Client bot', routingRuleId: clientRule.routingRuleId, boundRecipientUserId: external.userId });
    expect(credential).toMatchObject({ boundRecipientUserId: external.userId, routingRuleId: clientRule.routingRuleId });
    expect(() => local.updateAgentToken(credential.agentTokenId, shared.workspaceId, { routingRuleId: otherRule.routingRuleId })).toThrow(/bound recipient/i);
    expect(local.createRequest({ workspaceId: shared.workspaceId, agentTokenId: credential.agentTokenId, requester: { name: 'Client bot' }, requestType: 'sanction', title: 'Approve?' })).toMatchObject({ recipients: [expect.objectContaining({ userId: external.userId })] });

    local.removeWorkspaceMember(shared.workspaceId, external.userId);
    expect(local.listAgentTokens(shared.workspaceId)).toEqual(expect.arrayContaining([expect.objectContaining({ agentTokenId: credential.agentTokenId, revokedAt: expect.any(String) })]));
  });

  it('links Clerk sign-in to a manually added Shared Workspace member', () => {
    const local = freshStore();
    const shared = local.createSharedWorkspaceForUser(DEFAULT_USER_ID, 'Production', '2026-05-08T01:00:00.000Z');
    const invited = local.addWorkspaceMemberByEmail(shared.workspaceId, 'bob@example.com', 'member', '2026-05-08T01:01:00.000Z');

    const identity = local.loginOrCreateClerkIdentity({ issuer: 'https://clerk.example', subject: 'user_bob', email: 'bob@example.com', emailVerified: true, name: 'Bob', authMethod: 'oauth_google' }, '2026-05-08T01:02:00.000Z');

    expect(identity).toMatchObject({ userId: invited.userId, role: 'owner' });
    expect(local.workspaceMembershipForUser(invited.userId, shared.workspaceId)).toMatchObject({ role: 'member' });
    expect(local.userProfile(invited.userId)).toMatchObject({ email: 'bob@example.com', name: 'Bob', signInMethod: 'oauth_google' });
  });

  it('reuses a mobile installation when push registration runs more than once', () => {
    const local = freshStore();
    const first = local.registerDevice({ userId: DEFAULT_USER_ID, deviceName: 'ios phone', platform: 'ios', installationId: 'install_same', expoPushToken: 'ExponentPushToken[first]' }, '2026-05-08T01:10:00.000Z');
    const second = local.registerDevice({ userId: DEFAULT_USER_ID, deviceName: 'ios phone renamed', platform: 'ios', installationId: 'install_same', expoPushToken: 'ExponentPushToken[second]' }, '2026-05-08T01:11:00.000Z');

    expect(second.deviceId).toBe(first.deviceId);
    expect(second).toMatchObject({ name: 'ios phone renamed', expoPushToken: 'ExponentPushToken[second]', updatedAt: '2026-05-08T01:11:00.000Z' });
    expect(local.listDevicesForUser(DEFAULT_USER_ID)).toEqual([expect.objectContaining({ deviceId: first.deviceId, expoPushToken: 'ExponentPushToken[second]' })]);
  });

  it('keeps one physical mobile installation registered for each signed-in user', () => {
    const local = freshStore();
    const alice = local.loginOrCreateClerkIdentity({ issuer: 'https://clerk.example', subject: 'user_alice', email: 'alice@example.com', emailVerified: true, name: 'Alice' }, '2026-05-08T01:12:00.000Z');
    const bob = local.loginOrCreateClerkIdentity({ issuer: 'https://clerk.example', subject: 'user_bob', email: 'bob@example.com', emailVerified: true, name: 'Bob' }, '2026-05-08T01:13:00.000Z');

    const aliceDevice = local.registerDevice({ userId: alice.userId, deviceName: 'ios phone', platform: 'ios', installationId: 'install_same_phone', expoPushToken: 'ExponentPushToken[same-phone]' }, '2026-05-08T01:14:00.000Z');
    const bobDevice = local.registerDevice({ userId: bob.userId, deviceName: 'ios phone', platform: 'ios', installationId: 'install_same_phone', expoPushToken: 'ExponentPushToken[same-phone]' }, '2026-05-08T01:15:00.000Z');

    expect(bobDevice.deviceId).not.toBe(aliceDevice.deviceId);
    expect(local.listDevicesForUser(alice.userId)).toEqual([expect.objectContaining({ deviceId: aliceDevice.deviceId, expoPushToken: 'ExponentPushToken[same-phone]' })]);
    expect(local.listDevicesForUser(bob.userId)).toEqual([expect.objectContaining({ deviceId: bobDevice.deviceId, expoPushToken: 'ExponentPushToken[same-phone]' })]);
  });

  it('clears push and device credentials when unregistering a mobile device', () => {
    const local = freshStore();
    const pairing = local.createPairingToken(DEFAULT_USER_ID, DEFAULT_WORKSPACE_ID, '2026-05-08T01:16:00.000Z');
    const credential = local.pairDeviceWithCode(pairing.token, 'ios phone', 'ios', '2026-05-08T01:16:01.000Z')!;
    local.updateDevicePushToken(credential.deviceId, DEFAULT_USER_ID, 'ExponentPushToken[logout]', '2026-05-08T01:16:02.000Z');

    const unregistered = local.unregisterDevice(credential.deviceId, DEFAULT_USER_ID, '2026-05-08T01:16:03.000Z');
    const row = local.db.prepare('SELECT unregistered_at, expo_push_token, token_hash FROM approval_devices WHERE device_id = ?').get(credential.deviceId) as { unregistered_at: string | null; expo_push_token: string | null; token_hash: string | null };

    expect(unregistered).toMatchObject({ deviceId: credential.deviceId, unregisteredAt: '2026-05-08T01:16:03.000Z' });
    expect(unregistered).not.toHaveProperty('expoPushToken');
    expect(row).toEqual({ unregistered_at: '2026-05-08T01:16:03.000Z', expo_push_token: null, token_hash: null });
    expect(local.verifyDeviceToken(credential.token)).toBeNull();
  });

  it('marks Request recipients active only when they have a push-ready device', () => {
    const local = freshStore();
    local.registerDevice({ userId: DEFAULT_USER_ID, deviceName: 'phone without push' });
    const credential = local.createAgentToken({ label: 'Pi' });
    const noPush = local.createRequest({ workspaceId: DEFAULT_WORKSPACE_ID, agentTokenId: credential.agentTokenId, requester: { name: 'Pi' }, requestType: 'sanction', title: 'Deploy?' });
    expect(noPush.recipients).toEqual([expect.objectContaining({ userId: DEFAULT_USER_ID, hasActiveDevice: false })]);

    local.registerDevice({ userId: DEFAULT_USER_ID, deviceName: 'phone with push', expoPushToken: 'ExponentPushToken[ready]' });
    const pushReady = local.createRequest({ workspaceId: DEFAULT_WORKSPACE_ID, agentTokenId: credential.agentTokenId, requester: { name: 'Pi' }, requestType: 'sanction', title: 'Deploy again?' });
    expect(pushReady.recipients).toEqual([expect.objectContaining({ userId: DEFAULT_USER_ID, hasActiveDevice: true })]);
  });

  it('deduplicates push targets by Expo token', () => {
    const local = freshStore();
    local.registerDevice({ userId: DEFAULT_USER_ID, deviceName: 'phone one', expoPushToken: 'ExponentPushToken[same]' });
    local.registerDevice({ userId: DEFAULT_USER_ID, deviceName: 'phone two', expoPushToken: 'ExponentPushToken[same]' });
    const credential = local.createAgentToken({ label: 'Pi' });
    const request = local.createRequest({ workspaceId: DEFAULT_WORKSPACE_ID, agentTokenId: credential.agentTokenId, requester: { name: 'Pi' }, requestType: 'sanction', title: 'Deploy?' });

    expect(local.listPushDevicesForRequestRecipients(request.id)).toEqual([expect.objectContaining({ expoPushToken: 'ExponentPushToken[same]' })]);
  });

  it('routes Personal Workspace activity to the sole member', () => {
    const local = freshStore();
    const credential = local.createAgentToken({ label: 'Pi' }, '2026-05-08T00:00:00.000Z');
    const request = local.createRequest({ workspaceId: DEFAULT_WORKSPACE_ID, agentTokenId: credential.agentTokenId, requester: { name: 'Pi', host: 'lattice', workingDirectory: '/repo', clientName: 'Pi' }, requestType: 'sanction', title: 'Deploy?', sessionId: 'run_123', session: { title: 'Billing migration' } }, '2026-05-08T00:01:00.000Z');
    const status = local.createStatusUpdate({ workspaceId: DEFAULT_WORKSPACE_ID, agentTokenId: credential.agentTokenId, message: 'Running tests', state: 'working', sessionId: 'run_123', session: { label: 'Billing migration' }, host: 'lattice', workingDirectory: '/repo', clientName: 'Pi' }, '2026-05-08T00:02:00.000Z');
    const customStatus = local.createStatusUpdate({ workspaceId: DEFAULT_WORKSPACE_ID, agentTokenId: credential.agentTokenId, message: 'Provider-specific pause', state: 'waiting_for_ci', metadata: { reason: 'ci-lag' } }, '2026-05-08T00:03:00.000Z');

    expect(request).toMatchObject({ deliveryKind: 'routed_members', responsePolicy: 'quorum', sessionId: 'run_123', session: { title: 'Billing migration' }, requester: { host: 'lattice', workingDirectory: '/repo', clientName: 'Pi' } });
    expect(request.recipients).toEqual([expect.objectContaining({ userId: DEFAULT_USER_ID })]);
    expect(status).toMatchObject({ semanticState: 'working', stateBehavior: 'semantic', sessionId: 'run_123', session: { label: 'Billing migration' }, host: 'lattice', workingDirectory: '/repo', clientName: 'Pi' });
    expect(status.recipientUserIds).toEqual([DEFAULT_USER_ID]);
    expect(customStatus).toMatchObject({ state: 'waiting_for_ci', stateBehavior: 'display_only', metadata: { reason: 'ci-lag' } });
    expect(customStatus).not.toHaveProperty('semanticState');
    expect(local.pendingRequestCountForUser(DEFAULT_USER_ID, DEFAULT_WORKSPACE_ID)).toBe(1);
    expect(local.listActivityForUser(DEFAULT_USER_ID, DEFAULT_WORKSPACE_ID).map((item) => item.id)).toEqual([customStatus.statusId, status.statusId, request.id]);
  });

  it('models Request waiter liveness and derives active, stale, expired, stopped, and errored states', () => {
    const local = freshStore();
    const credential = local.createAgentToken({ label: 'Pi' }, '2026-05-08T00:00:00.000Z');
    const request = local.createRequest({ workspaceId: DEFAULT_WORKSPACE_ID, agentTokenId: credential.agentTokenId, requester: { name: 'Pi' }, requestType: 'sanction', title: 'Deploy?' }, '2026-05-08T00:01:00.000Z');
    const waiter = local.createRequestWaiterToken(request.id, DEFAULT_WORKSPACE_ID, credential.agentTokenId, undefined, '2026-05-08T00:01:10.000Z');

    expect(waiter).toMatchObject({ token: expect.stringMatching(/^wait_/), waiterId: expect.stringMatching(/^waiter_/), leaseExpiresAt: '2026-05-08T00:02:10.000Z' });
    expect(local.getRequestForWorkspace(request.id, DEFAULT_WORKSPACE_ID, undefined, '2026-05-08T00:01:30.000Z')).toMatchObject({ agentWaiter: { waiterId: waiter.waiterId, state: 'waiting', lastSeenAt: '2026-05-08T00:01:10.000Z', leaseExpiresAt: '2026-05-08T00:02:10.000Z' } });

    local.renewRequestWaiter(waiter.waiterId, '2026-05-08T00:04:00.000Z', '2026-05-08T00:03:00.000Z');
    expect(local.verifyRequestWaiterToken(waiter.token, request.id, '2026-05-08T00:03:10.000Z')).toMatchObject({ waiterId: waiter.waiterId, requestId: request.id, agentTokenId: credential.agentTokenId });
    expect(local.getRequestForWorkspace(request.id, DEFAULT_WORKSPACE_ID, undefined, '2026-05-08T00:03:30.000Z')).toMatchObject({ agentWaiter: { state: 'waiting', lastSeenAt: '2026-05-08T00:03:00.000Z', leaseExpiresAt: '2026-05-08T00:04:00.000Z' } });
    expect(local.getRequestForWorkspace(request.id, DEFAULT_WORKSPACE_ID, undefined, '2026-05-08T00:04:01.000Z')).toMatchObject({ agentWaiter: { state: 'stale' } });
    expect(local.getRequestForWorkspace(request.id, DEFAULT_WORKSPACE_ID, undefined, '2026-05-08T01:08:01.000Z')).toMatchObject({ agentWaiter: { state: 'expired' } });

    local.stopRequestWaiter(waiter.waiterId, 'agent_cancelled', '2026-05-08T00:05:00.000Z');
    local.stopRequestWaiter(waiter.waiterId, 'shutdown', '2026-05-08T00:05:10.000Z');
    expect(local.getRequestForWorkspace(request.id, DEFAULT_WORKSPACE_ID, undefined, '2026-05-08T01:07:00.000Z')).toMatchObject({ status: 'pending', agentWaiter: { state: 'stopped', stopReason: 'agent_cancelled', stoppedAt: '2026-05-08T00:05:00.000Z' } });

    const errorWaiter = local.createRequestWaiterToken(request.id, DEFAULT_WORKSPACE_ID, credential.agentTokenId, undefined, '2026-05-08T00:06:00.000Z');
    local.markRequestWaiterError(errorWaiter.waiterId, 'wait_failed', 'network down', '2026-05-08T00:06:05.000Z');
    local.markRequestWaiterError(errorWaiter.waiterId, 'other_failure', 'other', '2026-05-08T00:06:06.000Z');
    expect(local.getRequestForWorkspace(request.id, DEFAULT_WORKSPACE_ID, undefined, '2026-05-08T00:06:10.000Z')).toMatchObject({ status: 'pending', agentWaiter: { state: 'errored', errorCode: 'wait_failed', errorMessage: 'network down' } });
  });

  it('uses Status Update threadId as a Session identity compatibility alias', () => {
    const local = freshStore();
    const credential = local.createAgentToken({ label: 'Pi' });
    const status = local.createStatusUpdate({ workspaceId: DEFAULT_WORKSPACE_ID, agentTokenId: credential.agentTokenId, threadId: 'legacy_thread_123', message: 'Legacy threaded update', state: 'working' });

    expect(status).toMatchObject({ threadId: 'legacy_thread_123', sessionId: 'legacy_thread_123' });
  });

  it('expires tied audience Steering without a default choice', () => {
    const local = freshStore();
    const shared = local.createSharedWorkspaceForUser(DEFAULT_USER_ID, 'Public dev');
    const channel = local.createAudienceChannel({ workspaceId: shared.workspaceId, name: 'Roadmap', visibility: 'public' }, DEFAULT_USER_ID, '2026-05-08T01:10:00.000Z');
    const left = local.loginOrCreateClerkIdentity({ issuer: 'https://clerk.example', subject: 'user_left', email: 'left@example.com', emailVerified: true, name: 'Left' });
    const right = local.loginOrCreateClerkIdentity({ issuer: 'https://clerk.example', subject: 'user_right', email: 'right@example.com', emailVerified: true, name: 'Right' });
    local.setAudienceSubscription(channel.channelId, left.userId, 'active');
    local.setAudienceSubscription(channel.channelId, right.userId, 'active');
    const credential = local.createAgentToken({ workspaceId: shared.workspaceId, label: 'Roadmap bot' });
    const request = local.createRequest({ workspaceId: shared.workspaceId, agentTokenId: credential.agentTokenId, requester: { name: 'Roadmap bot' }, requestType: 'steering', deliveryKind: 'audience_channel', audienceChannelId: channel.channelId, responsePolicy: 'deadline_plurality', closesAt: '2026-05-08T01:20:00.000Z', title: 'What next?' }, '2026-05-08T01:11:00.000Z');

    local.respondToAudienceRequest(request.id, { choiceId: 'option_a' }, left.userId, '2026-05-08T01:12:00.000Z');
    local.respondToAudienceRequest(request.id, { choiceId: 'option_b' }, right.userId, '2026-05-08T01:13:00.000Z');

    expect(local.getRequestForWorkspace(request.id, shared.workspaceId, undefined, '2026-05-08T01:21:00.000Z')).toMatchObject({ status: 'expired', aggregateResult: { choices: { option_a: 1, option_b: 1 } } });
  });

  it('uses the default choice to break tied audience Steering', () => {
    const local = freshStore();
    const shared = local.createSharedWorkspaceForUser(DEFAULT_USER_ID, 'Public dev');
    const channel = local.createAudienceChannel({ workspaceId: shared.workspaceId, name: 'Roadmap', visibility: 'public' }, DEFAULT_USER_ID, '2026-05-08T01:20:00.000Z');
    const left = local.loginOrCreateClerkIdentity({ issuer: 'https://clerk.example', subject: 'user_default_left', email: 'default-left@example.com', emailVerified: true, name: 'Left' });
    const right = local.loginOrCreateClerkIdentity({ issuer: 'https://clerk.example', subject: 'user_default_right', email: 'default-right@example.com', emailVerified: true, name: 'Right' });
    local.setAudienceSubscription(channel.channelId, left.userId, 'active');
    local.setAudienceSubscription(channel.channelId, right.userId, 'active');
    const credential = local.createAgentToken({ workspaceId: shared.workspaceId, label: 'Roadmap bot' });
    const request = local.createRequest({ workspaceId: shared.workspaceId, agentTokenId: credential.agentTokenId, requester: { name: 'Roadmap bot' }, requestType: 'steering', deliveryKind: 'audience_channel', audienceChannelId: channel.channelId, responsePolicy: 'deadline_plurality', defaultChoice: 'option_b', closesAt: '2026-05-08T01:30:00.000Z', title: 'What next?' }, '2026-05-08T01:21:00.000Z');

    local.respondToAudienceRequest(request.id, { choiceId: 'option_a' }, left.userId, '2026-05-08T01:22:00.000Z');
    local.respondToAudienceRequest(request.id, { choiceId: 'option_b' }, right.userId, '2026-05-08T01:23:00.000Z');

    expect(local.getRequestForWorkspace(request.id, shared.workspaceId, undefined, '2026-05-08T01:31:00.000Z')).toMatchObject({ status: 'responded', response: { choiceId: 'option_b' }, aggregateResult: { choices: { option_a: 1, option_b: 1 } } });
  });

  it('uses the default choice even when the tied votes do not include it', () => {
    const local = freshStore();
    const shared = local.createSharedWorkspaceForUser(DEFAULT_USER_ID, 'Public dev');
    const channel = local.createAudienceChannel({ workspaceId: shared.workspaceId, name: 'Roadmap', visibility: 'public' }, DEFAULT_USER_ID, '2026-05-08T01:20:00.000Z');
    const left = local.loginOrCreateClerkIdentity({ issuer: 'https://clerk.example', subject: 'user_default_c_left', email: 'default-c-left@example.com', emailVerified: true, name: 'Left' });
    const right = local.loginOrCreateClerkIdentity({ issuer: 'https://clerk.example', subject: 'user_default_c_right', email: 'default-c-right@example.com', emailVerified: true, name: 'Right' });
    local.setAudienceSubscription(channel.channelId, left.userId, 'active');
    local.setAudienceSubscription(channel.channelId, right.userId, 'active');
    const credential = local.createAgentToken({ workspaceId: shared.workspaceId, label: 'Roadmap bot' });
    const request = local.createRequest({ workspaceId: shared.workspaceId, agentTokenId: credential.agentTokenId, requester: { name: 'Roadmap bot' }, requestType: 'steering', deliveryKind: 'audience_channel', audienceChannelId: channel.channelId, responsePolicy: 'deadline_plurality', defaultChoice: 'deny', closesAt: '2026-05-08T01:30:00.000Z', title: 'What next?' }, '2026-05-08T01:21:00.000Z');

    local.respondToAudienceRequest(request.id, { choiceId: 'option_a' }, left.userId, '2026-05-08T01:22:00.000Z');
    local.respondToAudienceRequest(request.id, { choiceId: 'option_b' }, right.userId, '2026-05-08T01:23:00.000Z');

    expect(local.getRequestForWorkspace(request.id, shared.workspaceId, undefined, '2026-05-08T01:31:00.000Z')).toMatchObject({ status: 'responded', response: { choiceId: 'deny' }, aggregateResult: { choices: { option_a: 1, option_b: 1 } } });
  });

  it('creates Audience Channels and audience Steering without member routing', () => {
    const local = freshStore();
    const shared = local.createSharedWorkspaceForUser(DEFAULT_USER_ID, 'Public dev');
    const channel = local.createAudienceChannel({ workspaceId: shared.workspaceId, name: 'Roadmap', slug: 'roadmap', visibility: 'public' }, DEFAULT_USER_ID, '2026-05-08T01:30:00.000Z');
    const subscriber = local.loginOrCreateClerkIdentity({ issuer: 'https://clerk.example', subject: 'user_audience', email: 'audience@example.com', emailVerified: true, name: 'Audience' });
    expect(local.setAudienceSubscription(channel.channelId, subscriber.userId, 'active')).toMatchObject({ channelId: channel.channelId, userId: subscriber.userId, status: 'active' });
    const credential = local.createAgentToken({ workspaceId: shared.workspaceId, label: 'Roadmap bot' });

    const request = local.createRequest({ workspaceId: shared.workspaceId, agentTokenId: credential.agentTokenId, requester: { name: 'Roadmap bot' }, requestType: 'steering', deliveryKind: 'audience_channel', audienceChannelId: channel.channelId, responsePolicy: 'deadline_plurality', closesAt: '2026-05-08T01:40:00.000Z', title: 'What next?' }, '2026-05-08T01:31:00.000Z');

    expect(request).toMatchObject({ deliveryKind: 'audience_channel', responsePolicy: 'deadline_plurality', audienceChannelId: channel.channelId, closesAt: '2026-05-08T01:40:00.000Z', recipients: [] });
    expect(local.respondToAudienceRequest(request.id, { choiceId: 'option_a' }, subscriber.userId, '2026-05-08T01:35:00.000Z')).toMatchObject({ status: 'pending' });
    expect(local.getRequestForWorkspace(request.id, shared.workspaceId, undefined, '2026-05-08T01:41:00.000Z')).toMatchObject({ status: 'responded', response: { choiceId: 'option_a' }, aggregateResult: { choices: { option_a: 1 } } });
  });

  it('requires Routing Rule assignment for Shared Workspace Agent Tokens', () => {
    const local = freshStore();
    const shared = local.createSharedWorkspaceForUser(DEFAULT_USER_ID, 'Production');
    const credential = local.createAgentToken({ workspaceId: shared.workspaceId, label: 'Deploy bot' });

    expect(() => local.createStatusUpdate({ workspaceId: shared.workspaceId, agentTokenId: credential.agentTokenId, message: 'Waiting', state: 'waiting' })).toThrow(/Routing Rule/);

    const rule = local.createRoutingRule({ workspaceId: shared.workspaceId, name: 'Release', recipientUserIds: [DEFAULT_USER_ID], requiredResponseMode: 'any_one' });
    local.updateAgentToken(credential.agentTokenId, shared.workspaceId, { routingRuleId: rule.routingRuleId });
    expect(local.createStatusUpdate({ workspaceId: shared.workspaceId, agentTokenId: credential.agentTokenId, message: 'Ready', state: 'done' })).toMatchObject({ routingRuleId: rule.routingRuleId, recipientUserIds: [DEFAULT_USER_ID] });
  });

  it('records Responses and reaches quorum by first choice to required count', () => {
    const local = freshStore();
    const shared = local.createSharedWorkspaceForUser(DEFAULT_USER_ID, 'Production');
    const bob = local.addWorkspaceMemberByEmail(shared.workspaceId, 'bob@example.com');
    const rule = local.createRoutingRule({ workspaceId: shared.workspaceId, name: 'Two humans', recipientUserIds: [DEFAULT_USER_ID, bob.userId], requiredResponseMode: 'exact', requiredResponseCount: 2 });
    const credential = local.createAgentToken({ workspaceId: shared.workspaceId, label: 'Deploy bot', routingRuleId: rule.routingRuleId });
    const request = local.createRequest({ workspaceId: shared.workspaceId, agentTokenId: credential.agentTokenId, requester: { name: 'Deploy bot' }, requestType: 'sanction', title: 'Deploy?' });

    expect(local.respondToRequestForWorkspace(request.id, shared.workspaceId, { choiceId: 'approve' }, DEFAULT_USER_ID)).toMatchObject({ status: 'pending', quorum: { receivedResponseCount: 1, waitingFor: 1 } });
    expect(local.respondToRequestForWorkspace(request.id, shared.workspaceId, { choiceId: 'approve' }, bob.userId)).toMatchObject({ status: 'responded', response: { choiceId: 'approve' } });
  });

  it('removing a member deletes empty Routing Rules and unroutes assigned Agent Tokens', () => {
    const local = freshStore();
    const shared = local.createSharedWorkspaceForUser(DEFAULT_USER_ID, 'Production');
    const bob = local.addWorkspaceMemberByEmail(shared.workspaceId, 'bob@example.com');
    const rule = local.createRoutingRule({ workspaceId: shared.workspaceId, name: 'Bob only', recipientUserIds: [bob.userId], requiredResponseMode: 'any_one' });
    const credential = local.createAgentToken({ workspaceId: shared.workspaceId, label: 'Deploy bot', routingRuleId: rule.routingRuleId });

    local.removeWorkspaceMember(shared.workspaceId, bob.userId);

    expect(local.getRoutingRule(rule.routingRuleId)).toBeNull();
    const [token] = local.listAgentTokens(shared.workspaceId);
    expect(token).toMatchObject({ agentTokenId: credential.agentTokenId });
    expect(token).not.toHaveProperty('routingRuleId');
  });

  it('tombstones hosted account deletion and removes personal Workspace content', () => {
    const local = freshStore();
    const identity = local.loginOrCreateClerkIdentity({ issuer: 'https://clerk.example', subject: 'user_delete', email: 'delete@example.com', emailVerified: true, name: 'Delete Me', authMethod: 'oauth_google' }, '2026-05-08T02:00:00.000Z');
    const userId = identity.userId;
    const workspaceId = identity.workspaceId;
    const agent = local.createAgentToken({ workspaceId, creatorUserId: userId, label: 'Personal bot' }, '2026-05-08T02:01:00.000Z');
    const request = local.createRequest({ workspaceId, agentTokenId: agent.agentTokenId, userId, requester: { name: 'Personal bot' }, requestType: 'sanction', title: 'Delete-sensitive request', body: 'body', command: 'rm -rf tmp' }, '2026-05-08T02:02:00.000Z');
    local.respondToRequestForWorkspace(request.id, workspaceId, { choiceId: 'approve' }, userId, '2026-05-08T02:03:00.000Z');
    local.createRequestWaiterToken(request.id, workspaceId, agent.agentTokenId, undefined, '2026-05-08T02:04:00.000Z');
    local.createStatusUpdate({ workspaceId, agentTokenId: agent.agentTokenId, userId, message: 'secret status', state: 'working' }, '2026-05-08T02:05:00.000Z');
    local.createPairingToken(userId, workspaceId, '2026-05-08T02:06:00.000Z');
    local.createEventTicket({ source: 'mobile', workspaceId, userId }, '2026-05-08T02:07:00.000Z');
    local.recordHeartbeat(userId, workspaceId, '2026-05-08T02:08:00.000Z');
    local.recordMobileDiagnostics([{ workspaceId, userId, level: 'info', area: 'account', message: 'delete me', metadata: { safe: true }, createdAt: '2026-05-08T02:09:00.000Z' }]);
    const paired = local.pairDeviceWithCode(local.createPairingToken(userId, workspaceId, '2026-05-08T02:10:00.000Z').token, 'iPhone', 'ios', '2026-05-08T02:11:00.000Z')!;
    local.updateDevicePushToken(paired.deviceId, userId, 'ExponentPushToken[delete]', '2026-05-08T02:12:00.000Z');
    local.createBillingPurchaseAttempt({ userId, productKey: 'hosted_personal_monthly', productGroup: 'hosted_personal', platform: 'ios', provider: 'app_store', providerUserId: 'app-user', idempotencyKey: 'delete-attempt', expiresAt: '2026-05-09T02:00:00.000Z' }, '2026-05-08T02:13:00.000Z');
    local.upsertBillingTransaction({ userId, provider: 'revenuecat', environment: 'sandbox', productKey: 'hosted_personal_monthly', entitlementKey: 'hosted_personal', platform: 'ios', providerTransactionId: 'txn_delete', status: 'active' }, '2026-05-08T02:14:00.000Z');
    local.claimBillingReceiptOwner({ userId, ownerUserId: userId, provider: 'revenuecat', environment: 'sandbox', platform: 'ios', productKey: 'hosted_personal_monthly', entitlementKey: 'hosted_personal', receiptKey: 'original_delete' }, '2026-05-08T02:15:00.000Z');
    local.claimBillingReceiptOwner({ userId, ownerUserId: userId, provider: 'revenuecat', environment: 'sandbox', platform: 'ios', productKey: 'trial_7_day', entitlementKey: 'native_app_trial', receiptKey: 'trial_delete' }, '2026-05-08T02:16:00.000Z');

    local.deleteHostedAccountData(userId, workspaceId, '2026-05-08T03:00:00.000Z');
    local.deleteHostedAccountData(userId, workspaceId, '2026-05-08T03:01:00.000Z');

    expect(local.db.prepare('SELECT COUNT(*) AS count FROM workspaces WHERE workspace_id = ?').get(workspaceId)).toEqual({ count: 0 });
    for (const [table, column, value] of [
      ['requests', 'workspace_id', workspaceId],
      ['status_updates', 'workspace_id', workspaceId],
      ['request_recipients', 'user_id', userId],
      ['responses', 'user_id', userId],
      ['mobile_diagnostics', 'user_id', userId],
      ['availability', 'user_id', userId],
      ['request_waiter_tokens', 'workspace_id', workspaceId],
      ['event_tickets', 'workspace_id', workspaceId],
      ['device_pairing_codes', 'workspace_id', workspaceId],
      ['agent_tokens', 'workspace_id', workspaceId]
    ] as const) {
      expect(countRows(local, table, column, value)).toBe(0);
    }
    expect(local.db.prepare('SELECT email, email_verified, name, sign_in_method, revoked_at FROM users WHERE id = ?').get(userId)).toEqual({ email: '', email_verified: 0, name: '', sign_in_method: null, revoked_at: '2026-05-08T03:00:00.000Z' });
    expect(local.db.prepare('SELECT COUNT(*) AS count FROM auth_identities WHERE user_id = ?').get(userId)).toEqual({ count: 0 });
    expect(local.db.prepare('SELECT hosted_data_deleted_at FROM personal_entitlements WHERE user_id = ?').get(userId)).toEqual({ hosted_data_deleted_at: '2026-05-08T03:01:00.000Z' });
    expect(local.db.prepare('SELECT unregistered_at, expo_push_token, token_hash FROM approval_devices WHERE user_id = ?').get(userId)).toEqual({ unregistered_at: '2026-05-08T03:00:00.000Z', expo_push_token: null, token_hash: null });
    expect(local.listBillingTransactionsForUser(userId)).toEqual([expect.objectContaining({ transactionId: expect.stringMatching(/^txn_/) })]);
    expect(local.listActiveBillingPurchaseAttempts(userId, 'hosted_personal', '2026-05-08T03:00:00.000Z')).toEqual([expect.objectContaining({ idempotencyKey: 'delete-attempt' })]);
    expect(local.db.prepare('SELECT COUNT(*) AS count FROM billing_receipt_owners WHERE owner_user_id = ?').get(userId)).toEqual({ count: 0 });
    local.migrate();
    expect(local.db.prepare('SELECT COUNT(*) AS count FROM billing_receipt_owners WHERE owner_user_id = ?').get(userId)).toEqual({ count: 0 });

    const replacement = local.loginOrCreateClerkIdentity({ issuer: 'https://clerk.example', subject: 'user_replacement', email: 'delete@example.com', emailVerified: true, name: 'Replacement' }, '2026-05-08T04:00:00.000Z');
    expect(replacement.userId).not.toBe(userId);
  });

  it('removes deleted users from shared Workspaces without deleting shared content', () => {
    const local = freshStore();
    const alice = local.loginOrCreateClerkIdentity({ issuer: 'https://clerk.example', subject: 'user_alice_delete', email: 'alice-delete@example.com', emailVerified: true, name: 'Alice' }, '2026-05-08T04:00:00.000Z');
    const shared = local.createSharedWorkspaceForUser(alice.userId, 'Shared Production', '2026-05-08T04:01:00.000Z');
    const bob = local.addWorkspaceMemberByEmail(shared.workspaceId, 'bob-shared@example.com', 'admin', '2026-05-08T04:02:00.000Z');
    const rule = local.createRoutingRule({ workspaceId: shared.workspaceId, name: 'Shared route', recipientUserIds: [alice.userId, bob.userId], requiredResponseMode: 'any_one' }, '2026-05-08T04:03:00.000Z');
    const sharedToken = local.createAgentToken({ workspaceId: shared.workspaceId, creatorUserId: alice.userId, label: 'Shared bot', routingRuleId: rule.routingRuleId }, '2026-05-08T04:04:00.000Z');
    const request = local.createRequest({ workspaceId: shared.workspaceId, agentTokenId: sharedToken.agentTokenId, userId: alice.userId, requester: { name: 'Shared bot' }, requestType: 'sanction', title: 'Shared request' }, '2026-05-08T04:05:00.000Z');
    local.respondToRequestForWorkspace(request.id, shared.workspaceId, { choiceId: 'approve' }, alice.userId, '2026-05-08T04:06:00.000Z');
    const status = local.createStatusUpdate({ workspaceId: shared.workspaceId, agentTokenId: sharedToken.agentTokenId, userId: alice.userId, message: 'shared status', state: 'working' }, '2026-05-08T04:07:00.000Z');

    local.deleteHostedAccountData(alice.userId, alice.workspaceId, '2026-05-08T05:00:00.000Z');

    expect(local.db.prepare('SELECT COUNT(*) AS count FROM workspaces WHERE workspace_id = ?').get(shared.workspaceId)).toEqual({ count: 1 });
    expect(local.getRequestForWorkspace(request.id, shared.workspaceId)).toMatchObject({ id: request.id, title: 'Shared request' });
    expect(local.getStatusUpdate(status.statusId, shared.workspaceId)).toMatchObject({ statusId: status.statusId, message: 'shared status' });
    expect(local.workspaceMembershipForUser(alice.userId, shared.workspaceId)).toBeNull();
    expect(local.workspaceMembershipForUser(bob.userId, shared.workspaceId)).toMatchObject({ role: 'admin' });
    expect(local.db.prepare('SELECT COUNT(*) AS count FROM request_recipients WHERE request_id = ? AND user_id = ?').get(request.id, alice.userId)).toEqual({ count: 0 });
    expect(local.db.prepare('SELECT COUNT(*) AS count FROM responses WHERE request_id = ? AND user_id = ?').get(request.id, alice.userId)).toEqual({ count: 0 });
    expect(local.listAgentTokens(shared.workspaceId)).toEqual([expect.objectContaining({ agentTokenId: sharedToken.agentTokenId, revokedAt: '2026-05-08T05:00:00.000Z' })]);
  });
});
