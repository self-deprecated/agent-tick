import type { FastifyInstance } from 'fastify';
import type { AgentTickStore } from '@agent-tick/db';
import type { ServerConfig } from '../config.js';
import { requireAuth } from '../auth/context.js';

export interface EventRoutesOptions {
  config: ServerConfig;
  store: AgentTickStore;
}

export async function registerEventRoutes(app: FastifyInstance, { config, store }: EventRoutesOptions): Promise<void> {
  app.post('/v1/events/ticket', async (request) => {
    const auth = await requireAuth(request, config, store);
    return store.createEventTicket({
      source: auth.source,
      organizationId: auth.organizationId,
      ...(auth.userId ? { userId: auth.userId } : {}),
      ...(auth.agentId ? { agentId: auth.agentId } : {})
    });
  });

  app.get('/v1/events', async (request, reply) => {
    const ticket = eventTicketFromQuery(request.query);
    const eventAuth = ticket ? store.verifyEventTicket(ticket) : null;
    if (!eventAuth) {
      return reply.status(401).send({ error: { code: 'not_authenticated', message: 'Invalid or expired event ticket', requestId: request.id } });
    }

    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store',
      connection: 'keep-alive'
    });
    reply.raw.write(`event: ready\ndata: ${JSON.stringify({ organizationId: eventAuth.organizationId })}\n\n`);
    reply.raw.end();
    return reply;
  });
}

function eventTicketFromQuery(query: unknown): string | null {
  const value = (query as { ticket?: unknown }).ticket;
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}
