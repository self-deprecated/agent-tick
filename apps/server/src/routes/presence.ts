import type { FastifyInstance } from 'fastify';
import { SetAvailabilitySchema } from '@self-deprecated/agent-tick-shared';
import type { AsyncAgentTickStore as AgentTickStore } from '@agent-tick/db';
import type { ServerConfig } from '../config.js';
import { requireHuman } from '../auth/context.js';

export interface PresenceRoutesOptions {
  config: ServerConfig;
  store: AgentTickStore;
}

export async function registerPresenceRoutes(app: FastifyInstance, { config, store }: PresenceRoutesOptions): Promise<void> {
  app.post('/v1/heartbeat', async (request) => {
    const auth = await requireHuman(request, config, store);
    const record = await store.recordHeartbeat(auth.userId ?? 'usr_default', auth.workspaceId);
    return { status: 'ok', ...record };
  });

  app.post('/v1/availability', async (request) => {
    const auth = await requireHuman(request, config, store);
    const input = SetAvailabilitySchema.parse(request.body);
    return await store.setAvailability(auth.userId ?? 'usr_default', auth.workspaceId, input.state);
  });
}
