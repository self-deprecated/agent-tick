import type { FastifyInstance } from 'fastify';
import { CreatePolicySchema, UpdatePolicySchema } from '@agent-tick/shared';
import type { AsyncAgentTickStore as AgentTickStore } from '@agent-tick/db';
import type { ServerConfig } from '../config.js';
import { requireOrganizationAdmin } from '../auth/context.js';

export interface PolicyRoutesOptions {
  config: ServerConfig;
  store: AgentTickStore;
}

export async function registerPolicyRoutes(app: FastifyInstance, { config, store }: PolicyRoutesOptions): Promise<void> {
  app.get('/v1/policies', async (request) => {
    const auth = await requireOrganizationAdmin(request, config, store);
    return await store.listPolicies(auth.organizationId);
  });

  app.post('/v1/policies', async (request) => {
    const auth = await requireOrganizationAdmin(request, config, store);
    const input = CreatePolicySchema.parse(request.body);
    return await store.createPolicy({
      organizationId: auth.organizationId,
      userId: auth.userId ?? 'usr_default',
      name: input.name,
      requiredApprovals: input.requiredApprovals,
      ...(input.description ? { description: input.description } : {}),
      ...(input.projectId ? { projectId: input.projectId } : {}),
      ...(input.teamId ? { teamId: input.teamId } : {})
    });
  });

  app.patch('/v1/policies/:id', async (request, reply) => {
    const auth = await requireOrganizationAdmin(request, config, store);
    const { id } = request.params as { id: string };
    const input = UpdatePolicySchema.parse(request.body);
    const policy = await store.updatePolicy({
      organizationId: auth.organizationId,
      userId: auth.userId ?? 'usr_default',
      policyId: id,
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.projectId !== undefined ? { projectId: input.projectId } : {}),
      ...(input.teamId !== undefined ? { teamId: input.teamId } : {}),
      ...(input.requiredApprovals !== undefined ? { requiredApprovals: input.requiredApprovals } : {}),
      ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
      ...(input.archived !== undefined ? { archived: input.archived } : {})
    });
    if (!policy) return reply.status(404).send({ error: { code: 'not_found', message: 'Policy not found', requestId: request.id } });
    return policy;
  });
}
