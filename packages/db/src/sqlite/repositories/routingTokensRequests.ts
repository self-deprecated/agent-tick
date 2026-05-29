import type {
  AgentCredential,
  AgentTokenAuth,
  AgentTokenRecord,
  AsyncAgentTickStore,
  AudienceChannelRecord,
  AudienceSubscriptionRecord,
  CreateAgentTokenInput,
  CreateExternalApproverInviteInput,
  CreateRequestInput,
  CreateRoutingRule,
  DeleteWorkspaceDataResult,
  ExternalApproverInviteCredential,
  ExternalApproverInviteRecord,
  ExternalApproverRecord,
  ExternalApproverStatus,
  RequestRecord,
  RequestWaiterAuth,
  RequestWaiterRecord,
  RequestWaiterTokenRecord,
  RespondRequest,
  RoutingRuleRecord,
  UpdateAgentToken,
  UpdateRoutingRule,
  WorkspaceMemberRecord
} from '../../store/types.js';

type RoutingTokenRequestImplementations = Pick<AsyncAgentTickStore,
  | 'createExternalApprover'
  | 'getExternalApprover'
  | 'getExternalApproverStatus'
  | 'createExternalApproverAgentToken'
  | 'createExternalApproverInvite'
  | 'getExternalApproverInviteByToken'
  | 'acceptExternalApproverInvite'
  | 'revokeExternalApproverInvite'
  | 'createAudienceChannel'
  | 'listAudienceChannels'
  | 'getAudienceChannel'
  | 'setAudienceSubscription'
  | 'getAudienceSubscription'
  | 'createRoutingRule'
  | 'listRoutingRules'
  | 'getRoutingRule'
  | 'updateRoutingRule'
  | 'deleteRoutingRule'
  | 'createAgentToken'
  | 'listAgentTokens'
  | 'updateAgentToken'
  | 'revokeAgentToken'
  | 'revokeAgentTokensForOwner'
  | 'verifyAgentToken'
  | 'createRequest'
  | 'listRequestsForUser'
  | 'listAudienceRequestsForUser'
  | 'getRequestForUser'
  | 'getRequestForWorkspace'
  | 'respondToRequestForWorkspace'
  | 'respondToAudienceRequest'
  | 'abandonRequestForWorkspace'
  | 'createRequestWaiterToken'
  | 'verifyRequestWaiterToken'
  | 'renewRequestWaiter'
  | 'stopRequestWaiter'
  | 'markRequestWaiterError'
>;

/**
 * Domain component for SQLite's routing/token/request surface.
 *
 * This first extraction keeps the exact SQL behavior in the existing store
 * implementation functions while making the public method group explicit and
 * delegatable. Follow-up slices can move individual implementation functions
 * here without changing callers again.
 */
export class SQLiteRoutingTokenRequestRepository {
  constructor(private readonly impl: RoutingTokenRequestImplementations) {}

  createExternalApprover(workspaceId: string, input: unknown, createdByUserId: string, now?: string): ExternalApproverRecord { return this.impl.createExternalApprover(workspaceId, input, createdByUserId, now) as ExternalApproverRecord; }
  getExternalApprover(externalApproverId: string, workspaceId: string): ExternalApproverRecord | null { return this.impl.getExternalApprover(externalApproverId, workspaceId) as ExternalApproverRecord | null; }
  getExternalApproverStatus(externalApproverId: string, workspaceId: string): ExternalApproverStatus | null { return this.impl.getExternalApproverStatus(externalApproverId, workspaceId) as ExternalApproverStatus | null; }
  createExternalApproverAgentToken(externalApproverId: string, workspaceId: string, createdByUserId: string, now?: string): AgentCredential | null { return this.impl.createExternalApproverAgentToken(externalApproverId, workspaceId, createdByUserId, now) as AgentCredential | null; }
  createExternalApproverInvite(input: CreateExternalApproverInviteInput, now?: string): ExternalApproverInviteCredential { return this.impl.createExternalApproverInvite(input, now) as ExternalApproverInviteCredential; }
  getExternalApproverInviteByToken(token: string, now?: string): ExternalApproverInviteRecord | null { return this.impl.getExternalApproverInviteByToken(token, now) as ExternalApproverInviteRecord | null; }
  acceptExternalApproverInvite(token: string, userId: string, now?: string): WorkspaceMemberRecord | null { return this.impl.acceptExternalApproverInvite(token, userId, now) as WorkspaceMemberRecord | null; }
  revokeExternalApproverInvite(inviteId: string, workspaceId: string, now?: string): ExternalApproverInviteRecord | null { return this.impl.revokeExternalApproverInvite(inviteId, workspaceId, now) as ExternalApproverInviteRecord | null; }

  createAudienceChannel(input: unknown, createdByUserId: string, now?: string): AudienceChannelRecord { return this.impl.createAudienceChannel(input, createdByUserId, now) as AudienceChannelRecord; }
  listAudienceChannels(workspaceId: string): AudienceChannelRecord[] { return this.impl.listAudienceChannels(workspaceId) as AudienceChannelRecord[]; }
  getAudienceChannel(channelId: string): AudienceChannelRecord | null { return this.impl.getAudienceChannel(channelId) as AudienceChannelRecord | null; }
  setAudienceSubscription(channelId: string, userId: string, status?: string, now?: string): AudienceSubscriptionRecord { return this.impl.setAudienceSubscription(channelId, userId, status, now) as AudienceSubscriptionRecord; }
  getAudienceSubscription(channelId: string, userId: string): AudienceSubscriptionRecord | null { return this.impl.getAudienceSubscription(channelId, userId) as AudienceSubscriptionRecord | null; }

  createRoutingRule(input: CreateRoutingRule, now?: string): RoutingRuleRecord { return this.impl.createRoutingRule(input, now) as RoutingRuleRecord; }
  listRoutingRules(workspaceId: string): RoutingRuleRecord[] { return this.impl.listRoutingRules(workspaceId) as RoutingRuleRecord[]; }
  getRoutingRule(routingRuleId: string): RoutingRuleRecord | null { return this.impl.getRoutingRule(routingRuleId) as RoutingRuleRecord | null; }
  updateRoutingRule(routingRuleId: string, input: UpdateRoutingRule, now?: string): RoutingRuleRecord | null { return this.impl.updateRoutingRule(routingRuleId, input, now) as RoutingRuleRecord | null; }
  deleteRoutingRule(routingRuleId: string, workspaceId: string, now?: string): boolean { return this.impl.deleteRoutingRule(routingRuleId, workspaceId, now) as boolean; }

  createAgentToken(input: CreateAgentTokenInput, now?: string): AgentCredential { return this.impl.createAgentToken(input, now) as AgentCredential; }
  listAgentTokens(workspaceId?: string): AgentTokenRecord[] { return this.impl.listAgentTokens(workspaceId) as AgentTokenRecord[]; }
  updateAgentToken(agentTokenId: string, workspaceId: string, input: UpdateAgentToken, now?: string): AgentTokenRecord | null { return this.impl.updateAgentToken(agentTokenId, workspaceId, input, now) as AgentTokenRecord | null; }
  revokeAgentToken(agentTokenId: string, workspaceId?: string, now?: string): AgentTokenRecord | null { return this.impl.revokeAgentToken(agentTokenId, workspaceId, now) as AgentTokenRecord | null; }
  revokeAgentTokensForOwner(userId: string, now?: string): number { return this.impl.revokeAgentTokensForOwner(userId, now) as number; }
  verifyAgentToken(token: string, now?: string): AgentTokenAuth | null { return this.impl.verifyAgentToken(token, now) as AgentTokenAuth | null; }

  createRequest(input: CreateRequestInput, now?: string): RequestRecord { return this.impl.createRequest(input, now) as RequestRecord; }
  listRequestsForUser(userId: string, workspaceId?: string, now?: string, limit?: number): RequestRecord[] { return this.impl.listRequestsForUser(userId, workspaceId, now, limit) as RequestRecord[]; }
  listAudienceRequestsForUser(userId: string, now?: string, limit?: number): RequestRecord[] { return this.impl.listAudienceRequestsForUser(userId, now, limit) as RequestRecord[]; }
  getRequestForUser(id: string, userId: string, now?: string): RequestRecord | null { return this.impl.getRequestForUser(id, userId, now) as RequestRecord | null; }
  getRequestForWorkspace(id: string, workspaceId: string, currentUserId?: string, now?: string): RequestRecord | null { return this.impl.getRequestForWorkspace(id, workspaceId, currentUserId, now) as RequestRecord | null; }
  respondToRequestForWorkspace(id: string, workspaceId: string, response: RespondRequest, responderUserId: string, now?: string): RequestRecord | null { return this.impl.respondToRequestForWorkspace(id, workspaceId, response, responderUserId, now) as RequestRecord | null; }
  respondToAudienceRequest(id: string, response: RespondRequest, responderUserId: string, now?: string): RequestRecord | null { return this.impl.respondToAudienceRequest(id, response, responderUserId, now) as RequestRecord | null; }
  abandonRequestForWorkspace(id: string, workspaceId: string, actorId: string, now?: string): RequestRecord | null { return this.impl.abandonRequestForWorkspace(id, workspaceId, actorId, now) as RequestRecord | null; }

  createRequestWaiterToken(requestId: string, workspaceId: string, agentTokenId: string, requestDeadline?: string, now?: string): RequestWaiterTokenRecord { return this.impl.createRequestWaiterToken(requestId, workspaceId, agentTokenId, requestDeadline, now) as RequestWaiterTokenRecord; }
  verifyRequestWaiterToken(token: string, requestId: string, now?: string): RequestWaiterAuth | null { return this.impl.verifyRequestWaiterToken(token, requestId, now) as RequestWaiterAuth | null; }
  renewRequestWaiter(waiterId: string, leaseExpiresAt: string, now?: string): RequestWaiterRecord | null { return this.impl.renewRequestWaiter(waiterId, leaseExpiresAt, now) as RequestWaiterRecord | null; }
  stopRequestWaiter(waiterId: string, reason: string, now?: string): RequestWaiterRecord | null { return this.impl.stopRequestWaiter(waiterId, reason, now) as RequestWaiterRecord | null; }
  markRequestWaiterError(waiterId: string, errorCode: string, errorMessage?: string, now?: string): RequestWaiterRecord | null { return this.impl.markRequestWaiterError(waiterId, errorCode, errorMessage, now) as RequestWaiterRecord | null; }
}
