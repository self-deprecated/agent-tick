import type { FastifyInstance } from 'fastify';
import { RespondRequestSchema } from '@self-deprecated/agent-tick-shared';
import type { AsyncAgentTickStore as AgentTickStore } from '@agent-tick/db';
import type { ServerConfig } from '../config.js';
import { requireHuman } from '../auth/context.js';
import { requireRequestResponseEntitlement } from '../services/workspaceEntitlements.js';

export async function registerAudienceRequestRoutes(app: FastifyInstance, { config, store }: { config: ServerConfig; store: AgentTickStore }): Promise<void> {
  app.get('/v1/audience-requests', async (request) => {
    const auth = await requireHuman(request, config, store);
    return store.listAudienceRequestsForUser(auth.userId ?? 'usr_default');
  });

  app.post('/v1/audience-requests/:id/responses', async (request, reply) => {
    const auth = await requireHuman(request, config, store);
    const { id } = request.params as { id: string };
    const visibleRequest = (await store.listAudienceRequestsForUser(auth.userId ?? 'usr_default')).find((candidate) => candidate.id === id);
    if (!visibleRequest) return reply.status(404).send({ error: { code: 'not_found', message: 'Audience Request not found', requestId: request.id } });
    requireRequestResponseEntitlement(config, visibleRequest);
    const input = RespondRequestSchema.parse(request.body);
    const record = await store.respondToAudienceRequest(id, input, auth.userId ?? 'usr_default');
    if (!record) return reply.status(404).send({ error: { code: 'not_found', message: 'Audience Request not found', requestId: request.id } });
    return record;
  });
}
