import type { FastifyInstance } from 'fastify';
import type { AsyncAgentTickStore as AgentTickStore, AuditEventRecord } from '@agent-tick/db';
import type { ServerConfig } from '../config.js';
import { requireHuman, requirePrivilegedHuman } from '../auth/context.js';
import type { OrganizationEventBus } from '../services/eventBus.js';

export interface EventRoutesOptions {
  config: ServerConfig;
  store: AgentTickStore;
  eventBus: OrganizationEventBus;
}

const eventPollMs = 1000;
const eventHeartbeatMs = 15000;

export async function registerEventRoutes(app: FastifyInstance, { config, store, eventBus }: EventRoutesOptions): Promise<void> {
  app.post('/v1/events/ticket', async (request) => {
    const auth = await requirePrivilegedHuman(request, config, store);
    return await store.createEventTicket({
      source: auth.source,
      organizationId: auth.organizationId,
      ...(auth.userId ? { userId: auth.userId } : {}),
      ...(auth.agentId ? { agentId: auth.agentId } : {})
    });
  });

  app.get('/v1/events/poll', async (request, reply) => {
    const auth = await requireHuman(request, config, store);
    const timeoutMs = timeoutMsFromQuery(request.query);
    let lastEventId = lastEventIdFromRequest(request.query, undefined) ?? await latestAuditEventId(store, auth.organizationId);
    const toResponse = (events: AuditEventRecord[]) => {
      const nextEventId = events.at(-1)?.eventId ?? lastEventId;
      return {
        events: events.map((event) => ({
          eventId: event.eventId,
          type: event.eventType,
          targetId: event.targetId,
          createdAt: event.createdAt
        })),
        nextEventId
      };
    };

    const initialEvents = await store.listAuditEventsAfter(auth.organizationId, lastEventId, 50);
    if (initialEvents.length > 0) return toResponse(initialEvents);

    const abortController = new AbortController();
    request.raw.once('close', () => abortController.abort());
    await eventBus.waitForOrganizationEvent(auth.organizationId, timeoutMs, abortController.signal);
    if (abortController.signal.aborted) return toResponse([]);
    const events = await store.listAuditEventsAfter(auth.organizationId, lastEventId, 50);
    return toResponse(events);
  });

  app.get('/v1/events', async (request, reply) => {
    const ticket = eventTicketFromQuery(request.query);
    const eventAuth = ticket ? await store.verifyEventTicket(ticket) : null;
    if (!eventAuth) {
      return reply.status(401).send({ error: { code: 'not_authenticated', message: 'Invalid or expired event ticket', requestId: request.id } });
    }

    const once = booleanQueryFlag(request.query, 'once');
    let lastEventId = lastEventIdFromRequest(request.query, request.headers['last-event-id']) ?? await latestAuditEventId(store, eventAuth.organizationId);

    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store',
      connection: 'keep-alive'
    });
    writeSSE(reply.raw, 'ready', { organizationId: eventAuth.organizationId, lastEventId });

    const sendAuditEvents = async () => {
      const events = await store.listAuditEventsAfter(eventAuth.organizationId, lastEventId, 100);
      for (const event of events) {
        lastEventId = event.eventId;
        writeSSE(reply.raw, 'audit', event, String(event.eventId));
      }
    };
    await sendAuditEvents();

    if (once) {
      reply.raw.end();
      return reply;
    }

    await new Promise<void>((resolve) => {
      const auditTimer = setInterval(() => {
        void sendAuditEvents();
      }, eventPollMs);
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

function timeoutMsFromQuery(query: unknown): number {
  const value = (query as { timeoutMs?: unknown }).timeoutMs;
  if (typeof value !== 'string' && typeof value !== 'number') return 25_000;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 25_000;
  return Math.min(Math.max(Math.trunc(parsed), 5_000), 30_000);
}

function parseEventId(value: unknown): number | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.trunc(parsed);
}

async function latestAuditEventId(store: AgentTickStore, organizationId: string): Promise<number> {
  return (await store.listAuditEvents(organizationId, 1))[0]?.eventId ?? 0;
}

function writeSSE(raw: { write: (chunk: string) => unknown }, event: string, data: unknown, id?: string): void {
  if (id) raw.write(`id: ${id}\n`);
  raw.write(`event: ${event}\n`);
  raw.write(`data: ${JSON.stringify(data)}\n\n`);
}
