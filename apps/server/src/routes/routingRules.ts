import type { FastifyInstance } from 'fastify';
import { CreateRoutingRuleSchema, RoutingPreviewInputSchema, UpdateRoutingRuleSchema, type RoutingRuleRecord } from '@self-deprecated/agent-tick-shared';
import type { AsyncAgentTickStore as AgentTickStore } from '@agent-tick/db';
import type { ServerConfig } from '../config.js';
import { requireHuman, requireWorkspaceAdmin } from '../auth/context.js';
import { previewRouting, safeRoutingExplanation } from '../services/routingPreview.js';

export interface RoutingRuleRoutesOptions {
  config: ServerConfig;
  store: AgentTickStore;
}

export async function registerRoutingRuleRoutes(app: FastifyInstance, { config, store }: RoutingRuleRoutesOptions): Promise<void> {
  app.get('/v1/routing-rules', async (request) => {
    const auth = await requireHuman(request, config, store);
    const workspaceId = workspaceFilter(request.query, auth.workspaceId);
    const membership = await store.workspaceMembershipForUser(auth.userId ?? 'usr_default', workspaceId);
    if (!membership) throw httpError(403, 'forbidden', 'Workspace membership required');
    if (membership.memberKind === 'external_approver') throw httpError(403, 'forbidden', 'Internal Workspace member required');
    return store.listRoutingRules(workspaceId);
  });

  app.post('/v1/routing-preview', async (request) => {
    const auth = await requireHuman(request, config, store);
    const input = RoutingPreviewInputSchema.parse(request.body ?? {});
    const workspaceId = input.workspaceId ?? auth.workspaceId;
    const membership = await store.workspaceMembershipForUser(auth.userId ?? 'usr_default', workspaceId);
    if (!membership) throw httpError(403, 'forbidden', 'Workspace membership required');
    if (membership.memberKind === 'external_approver') throw httpError(403, 'forbidden', 'Internal Workspace member required');
    const agentToken = input.agentTokenId ? (await store.listAgentTokens(workspaceId)).find((token) => token.agentTokenId === input.agentTokenId) : undefined;
    if (input.agentTokenId && !agentToken) throw httpError(404, 'not_found', 'Agent Connection not found');
    const routingRuleId = input.routingRuleId ?? agentToken?.routingRuleId;
    const routingRule = routingRuleId ? await store.getRoutingRule(routingRuleId) : null;
    if (routingRuleId && (!routingRule || routingRule.workspaceId !== workspaceId)) throw httpError(404, 'not_found', 'Routing Rule not found');
    return previewRouting(store, {
      workspaceId,
      ...(routingRule ? { routingRule } : {}),
      ...(agentToken ? { agentToken } : {}),
      ...(input.recipientUserIds ? { recipientUserIds: input.recipientUserIds } : {}),
      ...(input.requiredResponseMode ? { requiredResponseMode: input.requiredResponseMode } : {}),
      ...(input.requiredResponseCount ? { requiredResponseCount: input.requiredResponseCount } : {})
    });
  });

  app.post('/v1/routing-rules', async (request) => {
    const auth = await requireWorkspaceAdmin(request, config, store);
    const input = CreateRoutingRuleSchema.parse(request.body);
    if (input.workspaceId !== auth.workspaceId) throw httpError(403, 'forbidden', 'Select the Workspace before changing routing');
    const rule = await store.createRoutingRule(input);
    await auditUnhealthyRouteSave(store, auth.userId ?? 'usr_default', rule);
    return rule;
  });

  app.patch('/v1/routing-rules/:id', async (request, reply) => {
    const auth = await requireWorkspaceAdmin(request, config, store);
    const { id } = request.params as { id: string };
    const existing = await store.getRoutingRule(id);
    if (!existing) return reply.status(404).send({ error: { code: 'not_found', message: 'Routing Rule not found', requestId: request.id } });
    if (existing.workspaceId !== auth.workspaceId) return reply.status(403).send({ error: { code: 'forbidden', message: 'Select the Workspace before changing routing', requestId: request.id } });
    const input = UpdateRoutingRuleSchema.parse(request.body);
    const rule = await store.updateRoutingRule(id, input);
    if (rule) await auditUnhealthyRouteSave(store, auth.userId ?? 'usr_default', rule);
    return rule;
  });

  app.delete('/v1/routing-rules/:id', async (request, reply) => {
    const auth = await requireWorkspaceAdmin(request, config, store);
    const { id } = request.params as { id: string };
    const deleted = await store.deleteRoutingRule(id, auth.workspaceId);
    if (!deleted) return reply.status(404).send({ error: { code: 'not_found', message: 'Routing Rule not found', requestId: request.id } });
    return { status: 'deleted', routingRuleId: id };
  });
}

async function auditUnhealthyRouteSave(store: AgentTickStore, userId: string, rule: RoutingRuleRecord): Promise<void> {
  const preview = await previewRouting(store, { workspaceId: rule.workspaceId, routingRule: rule });
  if (preview.status !== 'unhealthy') return;
  await store.writeAuditEvent(rule.workspaceId, userId, 'routing_rule.unhealthy_saved', rule.routingRuleId, safeRoutingExplanation(preview));
}

function workspaceFilter(query: unknown, fallback: string): string {
  const value = (query as { workspaceId?: unknown }).workspaceId;
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function httpError(statusCode: number, code: string, message: string): Error & { statusCode: number; code: string } {
  const error = new Error(message) as Error & { statusCode: number; code: string };
  error.statusCode = statusCode;
  error.code = code;
  return error;
}
