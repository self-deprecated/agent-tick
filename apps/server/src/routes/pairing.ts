import { PairDeviceRequestSchema } from '@agent-tick/shared';
import type { FastifyInstance } from 'fastify';
import type { AgentTickStore } from '@agent-tick/db';
import type { ServerConfig } from '../config.js';
import { requirePrivilegedHuman } from '../auth/context.js';

export interface PairingRoutesOptions {
  config: ServerConfig;
  store: AgentTickStore;
}

export async function registerPairingRoutes(app: FastifyInstance, { config, store }: PairingRoutesOptions): Promise<void> {
  app.post('/v1/pairing-tokens', async (request, reply) => {
    const auth = await requirePrivilegedHuman(request, config, store);
    if (config.mode !== 'single') {
      return reply.status(404).send({ error: { code: 'not_found', message: 'Pairing tokens are only available in single mode', requestId: request.id } });
    }
    return store.createPairingToken(auth.userId ?? 'usr_default', auth.organizationId);
  });

  app.post('/v1/devices/pair', async (request, reply) => {
    if (config.mode !== 'single') {
      return reply.status(404).send({ error: { code: 'not_found', message: 'Device pairing is only available in single mode', requestId: request.id } });
    }
    const input = PairDeviceRequestSchema.parse(request.body);
    const credential = store.pairDeviceWithCode(input.token, input.deviceName, input.platform);
    if (!credential) {
      return reply.status(401).send({ error: { code: 'not_authenticated', message: 'Invalid or expired pairing code', requestId: request.id } });
    }
    return credential;
  });
}
