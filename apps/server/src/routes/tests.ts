import type { FastifyInstance } from 'fastify';
import { SendTestActivitySchema } from '@agent-tick/shared';
import type { AsyncAgentTickStore as AgentTickStore } from '@agent-tick/db';
import type { ServerConfig } from '../config.js';
import { requireHuman } from '../auth/context.js';

export interface TestActivityRoutesOptions {
  config: ServerConfig;
  store: AgentTickStore;
}

export async function registerTestActivityRoutes(app: FastifyInstance, { config, store }: TestActivityRoutesOptions): Promise<void> {
  app.post('/v1/tests', async (request, reply) => {
    const auth = await requireHuman(request, config, store);
    const input = SendTestActivitySchema.parse(request.body);
    const workspaceId = input.workspaceId ?? auth.workspaceId;
    const membership = await store.workspaceMembershipForUser(auth.userId ?? 'usr_default', workspaceId);
    if (!membership) return reply.status(403).send({ error: { code: 'forbidden', message: 'Workspace membership required', requestId: request.id } });
    const route = await resolveTestRoute(store, workspaceId, input.agentTokenId, input.routingRuleId);
    const workflowLabel = input.context === 'routing_rule' ? 'Agent Tick workflow test' : 'Agent Tick setup test';

    if (input.kind === 'status') {
      const status = await store.createStatusUpdate({
        workspaceId,
        ...(route.agentTokenId ? { agentTokenId: route.agentTokenId } : {}),
        ...(route.routingRuleId ? { routingRuleId: route.routingRuleId } : {}),
        message: route.name ? `Testing status delivery from the web console (${route.name})` : 'Testing status delivery from the web console',
        state: 'done',
        isTest: true,
        testLabel: workflowLabel,
        ...(auth.userId ? { userId: auth.userId } : {})
      });
      return { status: 'sent' as const, kind: input.kind, id: status.statusId };
    }

    const requestRecord = await store.createRequest({
      workspaceId,
      ...(route.agentTokenId ? { agentTokenId: route.agentTokenId } : {}),
      ...(route.routingRuleId ? { routingRuleId: route.routingRuleId } : {}),
      requester: { name: workflowLabel },
      requestType: input.kind === 'steering' ? 'steering' : 'sanction',
      title: testTitle(input.kind, route.name),
      ...(input.kind === 'sanction' ? { command: 'echo "Agent Tick test"' } : {}),
      choices: input.kind === 'steering'
        ? [{ id: 'option_a', label: 'Option A' }, { id: 'option_b', label: 'Option B' }, { id: 'cancel', label: 'Cancel', kind: 'deny' }]
        : [{ id: 'approve', label: 'Approve' }, { id: 'deny', label: 'Deny', kind: 'deny' }],
      deadline: new Date(Date.now() + 10 * 60_000).toISOString(),
      isTest: true,
      testLabel: workflowLabel,
      ...(auth.userId ? { userId: auth.userId } : {})
    });
    return { status: 'sent' as const, kind: input.kind, id: requestRecord.id };
  });
}

async function resolveTestRoute(store: AgentTickStore, workspaceId: string, agentTokenId?: string, routingRuleId?: string): Promise<{ agentTokenId?: string; routingRuleId?: string; name?: string }> {
  if (routingRuleId) {
    const rule = await store.getRoutingRule(routingRuleId);
    if (!rule || rule.workspaceId !== workspaceId) throw httpError(404, 'not_found', 'Routing Rule not found');
    const token = (await store.listAgentTokens(workspaceId)).find((candidate) => candidate.routingRuleId === rule.routingRuleId && !candidate.revokedAt);
    return { routingRuleId, ...(token ? { agentTokenId: token.agentTokenId } : {}), name: rule.name };
  }
  if (agentTokenId) {
    const token = (await store.listAgentTokens(workspaceId)).find((candidate) => candidate.agentTokenId === agentTokenId && !candidate.revokedAt);
    if (!token) throw httpError(404, 'not_found', 'Agent Token not found');
    return { agentTokenId, ...(token.routingRuleId ? { routingRuleId: token.routingRuleId } : {}) };
  }
  const tokens = (await store.listAgentTokens(workspaceId)).filter((token) => !token.revokedAt && token.routingRuleId);
  const token = tokens[0] ?? (await store.listAgentTokens(workspaceId)).find((candidate) => !candidate.revokedAt);
  return token ? { agentTokenId: token.agentTokenId, ...(token.routingRuleId ? { routingRuleId: token.routingRuleId } : {}) } : {};
}

function testTitle(kind: 'status' | 'steering' | 'sanction', routeName?: string): string {
  if (kind === 'steering') return routeName ? `Agent Tick steering test (${routeName})` : 'Agent Tick steering test';
  return routeName ? `Approve test command? (${routeName})` : 'Approve test command?';
}

function httpError(statusCode: number, code: string, message: string): Error & { statusCode: number; code: string } {
  const error = new Error(message) as Error & { statusCode: number; code: string };
  error.statusCode = statusCode;
  error.code = code;
  return error;
}
