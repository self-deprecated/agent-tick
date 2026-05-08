import type { FastifyInstance } from 'fastify';
import { CreatePolicySchema } from '@agent-tick/shared';
import type { AgentTickStore } from '@agent-tick/db';
import type { ServerConfig } from '../config.js';
import { requirePrivilegedHuman } from '../auth/context.js';

export interface PolicyRoutesOptions {
  config: ServerConfig;
  store: AgentTickStore;
}

export async function registerPolicyRoutes(app: FastifyInstance, { config, store }: PolicyRoutesOptions): Promise<void> {
  app.get('/v1/policies', async (request) => {
    const auth = await requirePrivilegedHuman(request, config, store);
    return store.listPolicies(auth.organizationId);
  });

  app.post('/v1/policies', async (request) => {
    const auth = await requirePrivilegedHuman(request, config, store);
    const input = CreatePolicySchema.parse(request.body);
    return store.createPolicy({
      organizationId: auth.organizationId,
      userId: auth.userId ?? 'usr_default',
      name: input.name,
      requiredApprovals: input.requiredApprovals,
      enabled: input.enabled,
      ...(input.description ? { description: input.description } : {}),
      ...(input.projectId ? { projectId: input.projectId } : {}),
      ...(input.teamId ? { teamId: input.teamId } : {})
    });
  });
}
