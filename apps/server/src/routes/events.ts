import type { FastifyInstance } from 'fastify';
import type { AgentTickStore, AuditEventRecord } from '@agent-tick/db';
import type { ServerConfig } from '../config.js';
import { requirePrivilegedHuman } from '../auth/context.js';

export interface EventRoutesOptions {
  config: ServerConfig;
  store: AgentTickStore;
}

const eventPollMs = 1000;
const eventHeartbeatMs = 15000;

export async function registerEventRoutes(app: FastifyInstance, { config, store }: EventRoutesOptions): Promise<void> {
  app.post('/v1/events/ticket', async (request) => {
    const auth = await requirePrivilegedHuman(request, config, store);
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

    const once = booleanQueryFlag(request.query, 'once');
    let lastEventId = lastEventIdFromRequest(request.query, request.headers['last-event-id']) ?? latestAuditEventId(store, eventAuth.organizationId);

    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store',
      connection: 'keep-alive'
    });
    writeSSE(reply.raw, 'ready', { organizationId: eventAuth.organizationId, lastEventId });

    const eventStore = store as AgentTickStore & {
      listAuditEventsAfter(organizationId: string, afterEventId?: number, limit?: number): AuditEventRecord[];
    };
    const sendAuditEvents = () => {
      const events = eventStore.listAuditEventsAfter(eventAuth.organizationId, lastEventId, 100);
      for (const event of events) {
        lastEventId = event.eventId;
        writeSSE(reply.raw, 'audit', event, String(event.eventId));
      }
    };
    sendAuditEvents();

    if (once) {
      reply.raw.end();
      return reply;
    }

    await new Promise<void>((resolve) => {
      const auditTimer = setInterval(sendAuditEvents, eventPollMs);
      const heartbeatTimer = setInterval(() => {
        reply.raw.write(': keep-alive\n\n');
      }, eventHeartbeatMs);
      const cleanup = () => {
        clearInterval(auditTimer);
        clearInterval(heartbeatTimer);
        resolve();
      };
      request.raw.once('close', cleanup);
      reply.raw.once('error', cleanup);
    });
    return reply;
  });
}

function eventTicketFromQuery(query: unknown): string | null {
  const value = (query as { ticket?: unknown }).ticket;
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function booleanQueryFlag(query: unknown, key: string): boolean {
  const value = (query as Record<string, unknown>)[key];
  return value === true || value === 'true' || value === '1' || value === '';
}

function lastEventIdFromRequest(query: unknown, lastEventIdHeader: string | string[] | undefined): number | null {
  const queryValue = (query as { lastEventId?: unknown }).lastEventId;
  const headerValue = Array.isArray(lastEventIdHeader) ? lastEventIdHeader[0] : lastEventIdHeader;
  return parseEventId(queryValue ?? headerValue);
}

function parseEventId(value: unknown): number | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.trunc(parsed);
}

function latestAuditEventId(store: AgentTickStore, organizationId: string): number {
  return store.listAuditEvents(organizationId, 1)[0]?.eventId ?? 0;
}

function writeSSE(raw: { write: (chunk: string) => unknown }, event: string, data: unknown, id?: string): void {
  if (id) raw.write(`id: ${id}\n`);
  raw.write(`event: ${event}\n`);
  raw.write(`data: ${JSON.stringify(data)}\n\n`);
}
