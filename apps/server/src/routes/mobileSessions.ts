import type { FastifyInstance } from 'fastify';
import { CreateMobileSessionSchema } from '@agent-tick/shared';
import type { AsyncAgentTickStore as AgentTickStore } from '@agent-tick/db';
import type { ServerConfig } from '../config.js';
import { verifyClerkLoginToken } from '../auth/clerk.js';
import { mintMobileSession } from '../auth/mobileSession.js';

export async function registerMobileSessionRoutes(app: FastifyInstance, { config, store }: { config: ServerConfig; store: AgentTickStore }): Promise<void> {
  app.post('/v1/auth/mobile-session', async (request, reply) => {
    if (config.mode !== 'clerk') {
      return reply.status(404).send({ error: { code: 'not_found', message: 'Not found', requestId: request.id } });
    }
    const input = CreateMobileSessionSchema.parse(request.body);
    const auth = await verifyClerkLoginToken(input.clerkToken, config, store);
    if (!auth) {
      return reply.status(401).send({ error: { code: 'not_authenticated', message: 'Authentication required', requestId: request.id } });
    }
    const token = mintMobileSession(auth, config);
    return {
      token,
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      userId: auth.userId!,
      workspaceId: auth.workspaceId,
      role: auth.role ?? 'member'
    };
  });
}
