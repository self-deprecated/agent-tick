import type { FastifyInstance } from 'fastify';
import { CreateProjectSchema } from '@agent-tick/shared';
import type { AsyncAgentTickStore as AgentTickStore } from '@agent-tick/db';
import type { ServerConfig } from '../config.js';
import { requireOrganizationAdmin } from '../auth/context.js';

export interface ProjectRoutesOptions {
  config: ServerConfig;
  store: AgentTickStore;
}

export async function registerProjectRoutes(app: FastifyInstance, { config, store }: ProjectRoutesOptions): Promise<void> {
  app.get('/v1/projects', async (request) => {
    const auth = await requireOrganizationAdmin(request, config, store);
    return await store.listProjects(auth.organizationId);
  });

  app.post('/v1/projects', async (request) => {
    const auth = await requireOrganizationAdmin(request, config, store);
    const input = CreateProjectSchema.parse(request.body);
    return await store.createProject({
      organizationId: auth.organizationId,
      userId: auth.userId ?? 'usr_default',
      name: input.name,
      ...(input.slug ? { slug: input.slug } : {}),
      ...(input.description ? { description: input.description } : {})
    });
  });
}
