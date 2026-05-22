import { afterEach, describe, expect, it } from 'vitest';
import { AgentTickStore, DEFAULT_USER_ID, DEFAULT_WORKSPACE_ID, openAgentTickStore } from '../src/index.js';

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

describe('AgentTickStore Workspace model', () => {
  it('fails fast for PostgreSQL URLs until the Postgres store is implemented', () => {
    expect(() => openAgentTickStore({ databaseURL: 'postgres://agent_tick:secret@localhost:5432/agent_tick' })).toThrow(/PostgreSQL database URLs are not supported/);
  });

  it('runs a fresh Workspace schema with Personal defaults', () => {
    const local = freshStore();
    const workspace = local.db.prepare('SELECT workspace_id, type, name FROM workspaces WHERE workspace_id = ?').get(DEFAULT_WORKSPACE_ID);
    expect(workspace).toEqual({ workspace_id: DEFAULT_WORKSPACE_ID, type: 'personal', name: 'Personal' });
    expect(local.listWorkspacesForUser(DEFAULT_USER_ID)).toEqual([expect.objectContaining({ workspaceId: DEFAULT_WORKSPACE_ID, type: 'personal', name: 'Personal', role: 'owner' })]);
    expect(local.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('organizations', 'teams', 'projects', 'policies', 'approval_requests', 'approval_votes')").all()).toEqual([]);
  });

  it('creates Clerk humans with fixed-name Personal Workspaces', () => {
    const local = freshStore();
    const identity = local.loginOrCreateClerkIdentity({ issuer: 'https://clerk.example', subject: 'user_alice', email: 'Alice@Example.com', emailVerified: true, name: 'Alice', authMethod: 'oauth_google' }, '2026-05-08T00:30:00.000Z');
    expect(identity).toMatchObject({ userId: expect.stringMatching(/^usr_/), workspaceId: expect.stringMatching(/^wsp_/), role: 'owner' });
    expect(local.userProfile(identity.userId)).toMatchObject({ email: 'alice@example.com', name: 'Alice', signInMethod: 'oauth_google' });
    expect(local.listWorkspacesForUser(identity.userId)).toEqual([expect.objectContaining({ workspaceId: identity.workspaceId, type: 'personal', name: 'Personal' })]);
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

  it('links Clerk sign-in to a manually added Shared Workspace member', () => {
    const local = freshStore();
    const shared = local.createSharedWorkspaceForUser(DEFAULT_USER_ID, 'Production', '2026-05-08T01:00:00.000Z');
    const invited = local.addWorkspaceMemberByEmail(shared.workspaceId, 'bob@example.com', 'member', '2026-05-08T01:01:00.000Z');

    const identity = local.loginOrCreateClerkIdentity({ issuer: 'https://clerk.example', subject: 'user_bob', email: 'bob@example.com', emailVerified: true, name: 'Bob', authMethod: 'oauth_google' }, '2026-05-08T01:02:00.000Z');

    expect(identity).toMatchObject({ userId: invited.userId, role: 'owner' });
    expect(local.workspaceMembershipForUser(invited.userId, shared.workspaceId)).toMatchObject({ role: 'member' });
    expect(local.userProfile(invited.userId)).toMatchObject({ email: 'bob@example.com', name: 'Bob', signInMethod: 'oauth_google' });
  });

  it('routes Personal Workspace activity to the sole member', () => {
    const local = freshStore();
    const credential = local.createAgentToken({ label: 'Pi' }, '2026-05-08T00:00:00.000Z');
    const request = local.createRequest({ workspaceId: DEFAULT_WORKSPACE_ID, agentTokenId: credential.agentTokenId, requester: { name: 'Pi' }, requestType: 'sanction', title: 'Deploy?' }, '2026-05-08T00:01:00.000Z');
    const status = local.createStatusUpdate({ workspaceId: DEFAULT_WORKSPACE_ID, agentTokenId: credential.agentTokenId, message: 'Running tests', state: 'working' }, '2026-05-08T00:02:00.000Z');

    expect(request.recipients).toEqual([expect.objectContaining({ userId: DEFAULT_USER_ID })]);
    expect(status.recipientUserIds).toEqual([DEFAULT_USER_ID]);
    expect(local.pendingRequestCountForUser(DEFAULT_USER_ID, DEFAULT_WORKSPACE_ID)).toBe(1);
    expect(local.listActivityForUser(DEFAULT_USER_ID, DEFAULT_WORKSPACE_ID).map((item) => item.id)).toEqual([status.statusId, request.id]);
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
});
