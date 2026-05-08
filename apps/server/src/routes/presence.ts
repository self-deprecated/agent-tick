import type { FastifyInstance } from 'fastify';
import { SetAvailabilitySchema } from '@agent-tick/shared';
import type { AgentTickStore } from '@agent-tick/db';
import type { ServerConfig } from '../config.js';
import { requireAuth, requireHuman } from '../auth/context.js';

export interface PresenceRoutesOptions {
  config: ServerConfig;
  store: AgentTickStore;
}

export async function registerPresenceRoutes(app: FastifyInstance, { config, store }: PresenceRoutesOptions): Promise<void> {
  app.post('/v1/heartbeat', async (request) => {
    const auth = await requireAuth(request, config, store);
    if (auth.userId) {
      const record = store.recordHeartbeat(auth.userId, auth.organizationId);
      return { status: 'ok', ...record };
    }
    return { status: 'ok' };
  });

  app.post('/v1/availability', async (request) => {
    const auth = await requireHuman(request, config, store);
    const input = SetAvailabilitySchema.parse(request.body);
    return store.setAvailability(auth.userId ?? 'usr_default', auth.organizationId, input.state);
  });
}
