import fs from 'node:fs';
import path from 'node:path';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import type { AgentTickStore } from '@agent-tick/db';
import type { ServerConfig } from './config.js';
import { registerAgentTokenRoutes } from './routes/agentTokens.js';
import { registerApprovalRoutes } from './routes/approvals.js';
import { registerAuditRoutes } from './routes/audit.js';
import { registerBillingRoutes } from './routes/billing.js';
import { registerDeviceRoutes } from './routes/devices.js';
import { registerEventRoutes } from './routes/events.js';
import { registerInviteRoutes } from './routes/invites.js';
import { registerMeRoutes } from './routes/me.js';
import { registerOrganizationRoutes } from './routes/organizations.js';
import { registerPairingRoutes } from './routes/pairing.js';
import { registerPolicyRoutes } from './routes/policies.js';
import { registerPresenceRoutes } from './routes/presence.js';
import { registerProjectRoutes } from './routes/projects.js';
import { registerTeamRoutes } from './routes/teams.js';
import { createExpoPushNotifier, type ApprovalNotifier } from './services/notifications.js';

export interface BuildAppOptions {
  config: ServerConfig;
  store: AgentTickStore;
  notifier?: ApprovalNotifier;
}

export async function buildApp({ config, store, notifier = createExpoPushNotifier({ store }) }: BuildAppOptions): Promise<FastifyInstance> {
  const app = Fastify({
    logger: true,
    genReqId: (request) => request.headers['x-request-id']?.toString() ?? crypto.randomUUID()
  });

  app.setErrorHandler((error, request, reply) => {
    const statusCode = statusCodeForError(error);
    request.log.error({ err: error, statusCode }, 'request failed');
    void reply.status(statusCode).send({
      error: {
        code: statusCode >= 500 ? 'internal_error' : codeForError(error),
        message: statusCode >= 500 ? 'Internal server error' : messageForError(error),
        requestId: request.id
      }
    });
  });
  registerRateLimitHook(app);

  app.get('/healthz', async () => ({ status: 'ok' as const, time: new Date().toISOString() }));

  app.get('/v1/auth/config', async () => ({
    mode: config.mode,
    authProvider: config.authProvider,
    publicURL: config.publicURL,
    clerkPublishableKey: config.mode === 'clerk' ? config.clerkPublishableKey : undefined
  }));

  await registerMeRoutes(app, { config, store });
  await registerOrganizationRoutes(app, { config, store });
  await registerInviteRoutes(app, { config, store });
  await registerAgentTokenRoutes(app, { config, store });
  await registerBillingRoutes(app, { config, store });
  await registerApprovalRoutes(app, { config, store, notifier });
  await registerDeviceRoutes(app, { config, store });
  await registerPairingRoutes(app, { config, store });
  await registerPresenceRoutes(app, { config, store });
  await registerProjectRoutes(app, { config, store });
  await registerTeamRoutes(app, { config, store });
  await registerPolicyRoutes(app, { config, store });
  await registerAuditRoutes(app, { config, store });
  await registerEventRoutes(app, { config, store });

  const adminIndexPath = await registerStaticAdmin(app, config.adminDistDir);
  setFallbackNotFoundHandler(app, adminIndexPath);
  return app;
}

async function registerStaticAdmin(app: FastifyInstance, adminDistDir: string): Promise<string | undefined> {
  if (!fs.existsSync(adminDistDir)) {
    app.log.warn({ adminDistDir }, 'admin dist directory does not exist; static dashboard disabled');
    return undefined;
  }

  await app.register(fastifyStatic, {
    root: adminDistDir,
    prefix: '/',
    decorateReply: false
  });

  const indexPath = path.join(adminDistDir, 'index.html');
  return fs.existsSync(indexPath) ? indexPath : undefined;
}

function setFallbackNotFoundHandler(app: FastifyInstance, adminIndexPath: string | undefined): void {
  app.setNotFoundHandler((request, reply) => {
    if (adminIndexPath && request.raw.method === 'GET' && acceptsHTML(request.headers.accept)) {
      return reply.type('text/html').send(fs.createReadStream(adminIndexPath));
    }
    return reply.status(404).send({
      error: {
        code: 'not_found',
        message: 'Not found',
        requestId: request.id
      }
    });
  });
}

function acceptsHTML(accept: string | undefined): boolean {
  return Boolean(accept?.includes('text/html'));
}

interface RateLimitRule {
  windowMs: number;
  max: number;
}

function registerRateLimitHook(app: FastifyInstance): void {
  const buckets = new Map<string, { windowStart: number; count: number }>();
  app.addHook('preHandler', async (request, reply) => {
    const routePath = request.routeOptions.url ?? request.url.split('?', 1)[0] ?? request.url;
    const rule = rateLimitRule(request.method, routePath);
    if (!rule) return;

    const now = Date.now();
    const key = `${request.ip}:${request.method}:${routePath}`;
    const existing = buckets.get(key);
    const bucket = existing && now - existing.windowStart < rule.windowMs ? existing : { windowStart: now, count: 0 };
    bucket.count += 1;
    buckets.set(key, bucket);

    if (bucket.count > rule.max) {
      const retryAfterSeconds = Math.max(1, Math.ceil((rule.windowMs - (now - bucket.windowStart)) / 1000));
      return reply
        .header('retry-after', String(retryAfterSeconds))
        .status(429)
        .send({ error: { code: 'rate_limited', message: 'Too many requests', requestId: request.id } });
    }

    if (buckets.size > 1000) pruneRateLimitBuckets(buckets, now, rule.windowMs);
  });
}

function rateLimitRule(method: string, routePath: string): RateLimitRule | null {
  if (method === 'GET' && routePath === '/v1/invites/:token') return { windowMs: 60_000, max: 30 };
  if (method === 'POST' && routePath === '/v1/invites/:token/accept') return { windowMs: 60_000, max: 30 };
  if (method === 'POST' && routePath === '/v1/devices/pair') return { windowMs: 60_000, max: 30 };
  if (method === 'POST' && routePath === '/v1/pairing-tokens') return { windowMs: 60_000, max: 60 };
  if (method === 'POST' && routePath === '/v1/events/ticket') return { windowMs: 60_000, max: 60 };
  return null;
}

function pruneRateLimitBuckets(buckets: Map<string, { windowStart: number; count: number }>, now: number, windowMs: number): void {
  for (const [key, bucket] of buckets) {
    if (now - bucket.windowStart >= windowMs) buckets.delete(key);
  }
}

function statusCodeForError(error: unknown): number {
  const maybeFastifyError = error as Partial<FastifyError>;
  if (typeof maybeFastifyError.statusCode === 'number') return maybeFastifyError.statusCode;
  if (typeof maybeFastifyError.validation === 'object') return 400;
  return 500;
}

function codeForError(error: unknown): string {
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : 'bad_request';
}

function messageForError(error: unknown): string {
  return error instanceof Error ? error.message : 'Request failed';
}
