import { describe, expect, it } from 'vitest';
import { DEFAULT_USER_ID, DEFAULT_WORKSPACE_ID, closeStore, openSeededStore, postgresStoreHarness, sqliteStoreHarness, type StoreContractHarness } from './storeHarness.js';
import { postgresTestDatabaseURL } from './postgresHarness.js';
import type { AsyncAgentTickStore } from '../src/index.js';

async function withStore<T>(harness: StoreContractHarness, run: (store: AsyncAgentTickStore) => T | Promise<T>): Promise<T> {
  let store: AsyncAgentTickStore | undefined;
  try {
    store = await openSeededStore(harness);
    return await run(store);
  } finally {
    await closeStore(store, harness);
  }
}

function awaitable(run: () => unknown): Promise<unknown> {
  return Promise.resolve().then(run);
}

export function defineStoreContractTests(harness: StoreContractHarness): void {
  describe(`${harness.name} AgentTickStore contract`, () => {
    it('seeds a Personal Workspace default owner', async () => {
      await withStore(harness, async (store) => {
        expect(await store.listWorkspacesForUser(DEFAULT_USER_ID)).toEqual([
          expect.objectContaining({ workspaceId: DEFAULT_WORKSPACE_ID, type: 'personal', name: 'Personal', role: 'owner' })
        ]);
      });
    });

    it('creates Clerk humans with fixed-name Personal Workspaces', async () => {
      await withStore(harness, async (store) => {
        const identity = await store.loginOrCreateClerkIdentity({ issuer: 'https://clerk.example', subject: 'user_alice', email: 'Alice@Example.com', emailVerified: true, name: 'Alice', authMethod: 'oauth_google' }, '2026-05-08T00:30:00.000Z');
        expect(identity).toMatchObject({ userId: expect.stringMatching(/^usr_/), workspaceId: expect.stringMatching(/^wsp_/), role: 'owner' });
        expect(await store.userProfile(identity.userId)).toMatchObject({ email: 'alice@example.com', name: 'Alice', signInMethod: 'oauth_google' });
        expect(await store.listWorkspacesForUser(identity.userId)).toEqual([expect.objectContaining({ workspaceId: identity.workspaceId, type: 'personal', name: 'Personal' })]);
      });
    });

    it('links recreated Clerk identities by verified email', async () => {
      await withStore(harness, async (store) => {
        const original = await store.loginOrCreateClerkIdentity({ issuer: 'https://clerk.example', subject: 'user_old_google', email: 'Alice@Example.com', emailVerified: true, name: 'Alice', authMethod: 'oauth_google' }, '2026-05-08T00:30:00.000Z');
        await store.revokeUserAccess(original.userId, '2026-05-08T00:35:00.000Z');

        const replacement = await store.loginOrCreateClerkIdentity({ issuer: 'https://clerk.example', subject: 'user_new_google', email: 'alice@example.com', emailVerified: true, name: 'Alice Again', authMethod: 'oauth_google' }, '2026-05-08T00:40:00.000Z');

        expect(replacement.userId).toBe(original.userId);
        expect(replacement.workspaceId).toBe(original.workspaceId);
        expect(await store.userProfile(original.userId)).toMatchObject({ email: 'alice@example.com', name: 'Alice Again', signInMethod: 'oauth_google' });
      });
    });

    it('upserts Clerk Workspaces and memberships idempotently', async () => {
      await withStore(harness, async (store) => {
        const owner = await store.loginOrCreateClerkIdentity({ issuer: 'https://clerk.example', subject: 'owner', email: 'owner@example.com', emailVerified: true, name: 'Owner' });
        const workspace = await store.upsertClerkWorkspace('org_123', 'Production', owner.userId, '2026-05-08T01:00:00.000Z');
        const renamed = await store.upsertClerkWorkspace('org_123', 'Production Renamed', owner.userId, '2026-05-08T01:01:00.000Z');
        const member = await store.upsertClerkWorkspaceMember('org_123', 'mem_123', owner.userId, 'admin', '2026-05-08T01:02:00.000Z');
        const retried = await store.upsertClerkWorkspaceMember('org_123', 'mem_123', owner.userId, 'admin', '2026-05-08T01:03:00.000Z');

        expect(renamed.workspaceId).toBe(workspace.workspaceId);
        expect(renamed.name).toBe('Production Renamed');
        expect(member.workspaceId).toBe(workspace.workspaceId);
        expect(retried).toMatchObject({ workspaceId: workspace.workspaceId, userId: owner.userId, role: 'admin', status: 'active' });
      });
    });

    it('creates Shared Workspaces and Routing Rules', async () => {
      await withStore(harness, async (store) => {
        const shared = await store.createSharedWorkspaceForUser(DEFAULT_USER_ID, 'Production', '2026-05-08T01:00:00.000Z');
        const bob = await store.addWorkspaceMemberByEmail(shared.workspaceId, 'bob@example.com', 'member', '2026-05-08T01:01:00.000Z');
        const rule = await store.createRoutingRule({ workspaceId: shared.workspaceId, name: 'Backend routing', recipientUserIds: [DEFAULT_USER_ID, bob.userId], requiredResponseMode: 'exact', requiredResponseCount: 3 }, '2026-05-08T01:02:00.000Z');

        expect(shared).toMatchObject({ type: 'shared', role: 'owner' });
        expect(rule).toMatchObject({ name: 'Backend routing', requiredResponseCount: 2 });
        expect(rule.recipientUserIds).toEqual(expect.arrayContaining([DEFAULT_USER_ID, bob.userId]));
        expect(await store.listRoutingRules(shared.workspaceId)).toEqual([expect.objectContaining({ routingRuleId: rule.routingRuleId })]);
      });
    });

    it('validates Routing Rule updates Agent Token bindings and member removal cleanup', async () => {
      await withStore(harness, async (store) => {
        const shared = await store.createSharedWorkspaceForUser(DEFAULT_USER_ID, 'Routing parity');
        const external = await store.addWorkspaceMemberByEmail(shared.workspaceId, 'client-parity@example.com', 'member', undefined, 'external_approver');
        const other = await store.addWorkspaceMemberByEmail(shared.workspaceId, 'other-parity@example.com');
        const externalRule = await store.createRoutingRule({ workspaceId: shared.workspaceId, name: 'Client only', recipientUserIds: [external.userId], requiredResponseMode: 'any_one', requiredResponseCount: 1 });
        const otherRule = await store.createRoutingRule({ workspaceId: shared.workspaceId, name: 'Other only', recipientUserIds: [other.userId], requiredResponseMode: 'any_one', requiredResponseCount: 1 });

        await expect(awaitable(() => store.updateRoutingRule(otherRule.routingRuleId, { recipientUserIds: ['usr_not_a_member'] }))).rejects.toThrow(/active Workspace Member/);
        await expect(awaitable(() => store.updateRoutingRule(otherRule.routingRuleId, { recipientUserIds: [external.userId, other.userId], requiredResponseMode: 'any_one', requiredResponseCount: 1 }))).rejects.toThrow(/External Approvers/);
        await expect(awaitable(() => store.createAgentToken({ workspaceId: shared.workspaceId, label: 'Wrong bound bot', routingRuleId: otherRule.routingRuleId, boundRecipientUserId: external.userId }))).rejects.toThrow(/bound recipient/i);

        const credential = await store.createAgentToken({ workspaceId: shared.workspaceId, label: 'Client bot', routingRuleId: externalRule.routingRuleId, boundRecipientUserId: external.userId });
        expect(credential).toMatchObject({ routingRuleId: externalRule.routingRuleId, boundRecipientUserId: external.userId });
        await store.removeWorkspaceMember(shared.workspaceId, external.userId, '2026-05-08T02:00:00.000Z');
        expect(await store.getRoutingRule(externalRule.routingRuleId)).toBeNull();
        expect(await store.listAgentTokens(shared.workspaceId)).toEqual(expect.arrayContaining([expect.objectContaining({ agentTokenId: credential.agentTokenId, revokedAt: '2026-05-08T02:00:00.000Z' })]));
      });
    });

    it('creates Audience Channels and resolves deadline plurality defaults', async () => {
      await withStore(harness, async (store) => {
        const shared = await store.createSharedWorkspaceForUser(DEFAULT_USER_ID, 'Audience');
        const channel = await store.createAudienceChannel({ workspaceId: shared.workspaceId, name: 'Roadmap', visibility: 'public' }, DEFAULT_USER_ID, '2026-05-08T01:20:00.000Z');
        const voter = await store.loginOrCreateClerkIdentity({ issuer: 'https://clerk.example', subject: 'audience_voter', email: 'audience-voter@example.com', emailVerified: true, name: 'Voter' });
        await store.setAudienceSubscription(channel.channelId, voter.userId, 'active');
        const credential = await store.createAgentToken({ workspaceId: shared.workspaceId, label: 'Roadmap bot' });
        const request = await store.createRequest({ workspaceId: shared.workspaceId, agentTokenId: credential.agentTokenId, requester: { name: 'Roadmap bot' }, requestType: 'steering', deliveryKind: 'audience_channel', audienceChannelId: channel.channelId, responsePolicy: 'deadline_plurality', defaultChoice: 'deny', closesAt: '2026-05-08T01:30:00.000Z', title: 'What next?' }, '2026-05-08T01:21:00.000Z');

        expect(request).toMatchObject({ deliveryKind: 'audience_channel', responsePolicy: 'deadline_plurality', recipients: [] });
        expect(await store.respondToAudienceRequest(request.id, { choiceId: 'option_a' }, voter.userId, '2026-05-08T01:22:00.000Z')).toMatchObject({ status: 'pending' });
        expect(await store.getRequestForWorkspace(request.id, shared.workspaceId, undefined, '2026-05-08T01:31:00.000Z')).toMatchObject({ status: 'responded', response: { choiceId: 'option_a' }, aggregateResult: { choices: { option_a: 1 } } });
      });
    });

    it('connects External Approver invites to member routing and Agent Tokens', async () => {
      await withStore(harness, async (store) => {
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

    it('records Responses and reaches quorum by first choice to required count', async () => {
      await withStore(harness, async (store) => {
        const shared = await store.createSharedWorkspaceForUser(DEFAULT_USER_ID, 'Production');
        const bob = await store.addWorkspaceMemberByEmail(shared.workspaceId, 'bob@example.com');
        const rule = await store.createRoutingRule({ workspaceId: shared.workspaceId, name: 'Two humans', recipientUserIds: [DEFAULT_USER_ID, bob.userId], requiredResponseMode: 'exact', requiredResponseCount: 2 });
        const credential = await store.createAgentToken({ workspaceId: shared.workspaceId, label: 'Deploy bot', routingRuleId: rule.routingRuleId });
        const request = await store.createRequest({ workspaceId: shared.workspaceId, agentTokenId: credential.agentTokenId, requester: { name: 'Deploy bot' }, requestType: 'sanction', title: 'Deploy?' });

        expect(await store.respondToRequestForWorkspace(request.id, shared.workspaceId, { choiceId: 'approve' }, DEFAULT_USER_ID)).toMatchObject({ status: 'pending', quorum: { receivedResponseCount: 1, waitingFor: 1 } });
        expect(await store.respondToRequestForWorkspace(request.id, shared.workspaceId, { choiceId: 'approve' }, bob.userId)).toMatchObject({ status: 'responded', response: { choiceId: 'approve' } });
      });
    });

    it('covers status device event audit billing cleanup and privacy surfaces', async () => {
      await withStore(harness, async (store) => {
        const credential = await store.createAgentToken({ label: 'Pi' }, '2026-05-08T00:00:00.000Z');
        const status = await store.createStatusUpdate({ workspaceId: DEFAULT_WORKSPACE_ID, agentTokenId: credential.agentTokenId, message: 'Running tests', state: 'working', sessionId: 'run_123' }, '2026-05-08T00:01:00.000Z');
        expect(await store.getStatusUpdate(status.statusId, DEFAULT_WORKSPACE_ID)).toMatchObject({ sessionId: 'run_123', message: 'Running tests' });
        expect((await store.listActivityForUser(DEFAULT_USER_ID, DEFAULT_WORKSPACE_ID)).map((item) => item.id)).toContain(status.statusId);
        const toolActivity = await store.createToolActivity({ workspaceId: DEFAULT_WORKSPACE_ID, agentTokenId: credential.agentTokenId, sessionId: 'run_123', turnId: 'turn_1', toolCallId: 'call_1', toolName: 'bash', state: 'finished', outcome: 'success', summary: 'Ran validation' }, '2026-05-08T00:01:30.000Z');
        expect(await store.getToolActivity(toolActivity.toolActivityId, DEFAULT_WORKSPACE_ID)).toMatchObject({ sessionId: 'run_123', toolName: 'bash', outcome: 'success', recipientUserIds: [DEFAULT_USER_ID] });
        expect(await store.listLatestToolActivities(DEFAULT_WORKSPACE_ID)).toEqual([expect.objectContaining({ toolActivityId: toolActivity.toolActivityId, summary: 'Ran validation' })]);
        expect((await store.listActivityForUser(DEFAULT_USER_ID, DEFAULT_WORKSPACE_ID)).find((item) => item.id === toolActivity.toolActivityId)).toMatchObject({ kind: 'tool_activity', toolActivity: { toolName: 'bash' } });

        const device = await store.registerDevice({ userId: DEFAULT_USER_ID, deviceName: 'phone', installationId: 'install_contract', expoPushToken: 'ExponentPushToken[contract]' }, '2026-05-08T00:02:00.000Z');
        const updatedDevice = await store.registerDevice({ userId: DEFAULT_USER_ID, deviceName: 'phone renamed', installationId: 'install_contract', expoPushToken: 'ExponentPushToken[contract2]' }, '2026-05-08T00:03:00.000Z');
        expect(updatedDevice.deviceId).toBe(device.deviceId);
        expect(await store.listDevicesForUser(DEFAULT_USER_ID)).toEqual([expect.objectContaining({ deviceId: device.deviceId, expoPushToken: 'ExponentPushToken[contract2]' })]);
        const deviceKey = await store.registerDevicePublicKey({ deviceId: device.deviceId, userId: DEFAULT_USER_ID, algorithm: 'p256-ecdh-hkdf-sha256', publicKey: 'test-spki' }, '2026-05-08T00:03:30.000Z');
        expect(await store.listDevicePublicKeysForUser(DEFAULT_USER_ID)).toEqual([expect.objectContaining({ deviceKeyId: deviceKey.deviceKeyId, publicKey: 'test-spki' })]);
        const preparedPrivate = await store.preparePrivateRequest({ workspaceId: DEFAULT_WORKSPACE_ID });
        expect(preparedPrivate).toMatchObject({ contentMode: 'private', recipientUserIds: [DEFAULT_USER_ID], deviceKeys: [expect.objectContaining({ deviceKeyId: deviceKey.deviceKeyId })] });
        const privateRequest = await store.createRequest({ workspaceId: DEFAULT_WORKSPACE_ID, agentTokenId: credential.agentTokenId, requester: { name: 'Pi' }, requestType: 'sanction', title: 'Private Request', choices: [{ id: 'approve', label: 'Approve', kind: 'approve' }, { id: 'deny', label: 'Deny', kind: 'deny' }], contentMode: 'private', privateRecipientVersion: preparedPrivate.recipientVersion, encryptedPayload: { version: 1, algorithm: 'aes-256-gcm', nonce: 'nonce', ciphertext: 'ciphertext', tag: 'tag', keyEnvelopes: [{ deviceKeyId: deviceKey.deviceKeyId, algorithm: 'p256-ecdh-hkdf-sha256+aes-256-gcm', ephemeralPublicKey: 'ephemeral', nonce: 'wrapnonce', ciphertext: 'wrapped', tag: 'wraptag' }] } }, '2026-05-08T00:03:40.000Z');
        expect(privateRequest).toMatchObject({ contentMode: 'private', title: 'Private Request', encryptedPayload: expect.any(Object), recipients: [expect.objectContaining({ userId: DEFAULT_USER_ID })] });

        const ticket = await store.createEventTicket({ source: 'mobile', workspaceId: DEFAULT_WORKSPACE_ID, userId: DEFAULT_USER_ID }, '2026-05-08T00:04:00.000Z');
        expect(await store.verifyEventTicket(ticket.ticket, '2026-05-08T00:04:01.000Z')).toMatchObject({ source: 'mobile', userId: DEFAULT_USER_ID });
        expect(await store.verifyEventTicket(ticket.ticket, '2026-05-08T00:04:02.000Z')).toBeNull();

        await store.writeAuditEvent(DEFAULT_WORKSPACE_ID, DEFAULT_USER_ID, 'contract.audit', 'target', { ok: true }, '2026-05-08T00:05:00.000Z');
        expect(await store.listAuditEvents(DEFAULT_WORKSPACE_ID)).toEqual(expect.arrayContaining([expect.objectContaining({ eventType: 'contract.audit', targetId: 'target' })]));
        expect(await store.recordMobileDiagnostics([{ workspaceId: DEFAULT_WORKSPACE_ID, userId: DEFAULT_USER_ID, level: 'info', area: 'contract', message: 'diagnostic', createdAt: '2026-05-08T00:06:00.000Z' }])).toBe(1);
        expect(await store.listMobileDiagnostics(DEFAULT_WORKSPACE_ID)).toEqual([expect.objectContaining({ area: 'contract', message: 'diagnostic' })]);

        await store.upsertBillingProducts([{ productKey: 'hosted_personal_monthly', kind: 'subscription', entitlementKey: 'hosted_personal' }], '2026-05-08T00:07:00.000Z');
        expect(await store.listBillingProducts()).toEqual([expect.objectContaining({ productKey: 'hosted_personal_monthly', active: true })]);
        const receipt = await store.claimBillingReceiptOwner({ provider: 'revenuecat', environment: 'sandbox', platform: 'ios', productKey: 'hosted_personal_monthly', entitlementKey: 'hosted_personal', receiptKey: 'receipt_contract', ownerUserId: DEFAULT_USER_ID }, '2026-05-08T00:08:00.000Z');
        expect(receipt).toMatchObject({ created: true, ownedByCurrentUser: true });
        const otherUser = await store.loginOrCreateClerkIdentity({ issuer: 'https://clerk.example', subject: 'contract_other', email: 'contract-other@example.com', emailVerified: true, name: 'Other' });
        expect(await store.claimBillingReceiptOwner({ provider: 'revenuecat', environment: 'sandbox', platform: 'ios', productKey: 'hosted_personal_monthly', entitlementKey: 'hosted_personal', receiptKey: 'receipt_contract', ownerUserId: otherUser.userId }, '2026-05-08T00:09:00.000Z')).toMatchObject({ created: false, ownedByCurrentUser: false });

        expect(await store.cleanupExpiredSecrets('2026-05-08T01:00:00.000Z')).toMatchObject({ eventTickets: 1 });
        await store.deleteHostedPersonalData(DEFAULT_USER_ID, DEFAULT_WORKSPACE_ID, '2026-05-08T00:10:00.000Z');
        expect(await store.getOrStartPersonalEntitlement(DEFAULT_USER_ID, '2026-05-08T00:11:00.000Z')).toMatchObject({ hostedDataDeletedAt: '2026-05-08T00:10:00.000Z' });
      });
    });

    it('models Request waiter liveness through the public store contract', async () => {
      await withStore(harness, async (store) => {
        const credential = await store.createAgentToken({ label: 'Pi' }, '2026-05-08T00:00:00.000Z');
        const request = await store.createRequest({ workspaceId: DEFAULT_WORKSPACE_ID, agentTokenId: credential.agentTokenId, requester: { name: 'Pi' }, requestType: 'sanction', title: 'Deploy?' }, '2026-05-08T00:01:00.000Z');
        const waiter = await store.createRequestWaiterToken(request.id, DEFAULT_WORKSPACE_ID, credential.agentTokenId, undefined, '2026-05-08T00:01:10.000Z');

        expect(waiter).toMatchObject({ token: expect.stringMatching(/^wait_/), waiterId: expect.stringMatching(/^waiter_/), leaseExpiresAt: '2026-05-08T00:02:10.000Z' });
        expect(await store.verifyRequestWaiterToken(waiter.token, request.id, '2026-05-08T00:01:20.000Z')).toMatchObject({ waiterId: waiter.waiterId, requestId: request.id, agentTokenId: credential.agentTokenId });
        await store.renewRequestWaiter(waiter.waiterId, '2026-05-08T00:04:00.000Z', '2026-05-08T00:03:00.000Z');
        expect(await store.getRequestForWorkspace(request.id, DEFAULT_WORKSPACE_ID, undefined, '2026-05-08T00:03:30.000Z')).toMatchObject({ agentWaiter: { state: 'waiting', lastSeenAt: '2026-05-08T00:03:00.000Z', leaseExpiresAt: '2026-05-08T00:04:00.000Z' } });

        await store.renewRequestWaiter(waiter.waiterId, '2026-05-08T01:08:00.000Z', '2026-05-08T01:05:30.000Z');
        expect(await store.verifyRequestWaiterToken(waiter.token, request.id, '2026-05-08T01:07:00.000Z')).toMatchObject({ waiterId: waiter.waiterId, requestId: request.id, agentTokenId: credential.agentTokenId });
        expect(await store.getRequestForWorkspace(request.id, DEFAULT_WORKSPACE_ID, undefined, '2026-05-08T01:07:00.000Z')).toMatchObject({ agentWaiter: { state: 'waiting', lastSeenAt: '2026-05-08T01:05:30.000Z', leaseExpiresAt: '2026-05-08T01:08:00.000Z', credentialExpiresAt: '2026-05-08T02:10:30.000Z' } });
      });
    });
  });
}

defineStoreContractTests(sqliteStoreHarness);
if (postgresStoreHarness) {
  defineStoreContractTests(postgresStoreHarness);
} else {
  describe.skip('PostgreSQL AgentTickStore contract (set AGENT_TICK_TEST_POSTGRES_URL to run)', () => {
    it('runs the shared store contract against real PostgreSQL when configured', () => {
      expect(postgresTestDatabaseURL).toBeUndefined();
    });
  });
}
