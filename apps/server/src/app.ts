import fs from 'node:fs';
import path from 'node:path';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import type { AsyncAgentTickStore as AgentTickStore } from '@agent-tick/db';
import type { ServerConfig } from './config.js';
import { registerActivityRoutes } from './routes/activity.js';
import { registerAgentTokenRoutes } from './routes/agentTokens.js';
import { registerAuditRoutes } from './routes/audit.js';
import { registerBillingRoutes } from './routes/billing.js';
import { registerClerkWebhookRoutes } from './routes/clerkWebhooks.js';
import { registerDeviceRoutes } from './routes/devices.js';
import { registerEventRoutes } from './routes/events.js';
import { registerMeRoutes } from './routes/me.js';
import { registerMobileDiagnosticsRoutes } from './routes/mobileDiagnostics.js';
import { registerMobileSessionRoutes } from './routes/mobileSessions.js';
import { registerOnboardingRoutes } from './routes/onboarding.js';
import { registerPairingRoutes } from './routes/pairing.js';
import { registerPresenceRoutes } from './routes/presence.js';
import { registerRequestRoutes } from './routes/requests.js';
import { registerRoutingRuleRoutes } from './routes/routingRules.js';
import { registerStatusRoutes } from './routes/status.js';
import { registerTestActivityRoutes } from './routes/tests.js';
import { registerTestSupportRoutes } from './routes/testSupport.js';
import { registerWorkspaceRoutes } from './routes/workspaces.js';
import { createConfiguredWorkspaceEventBus, publishAuditWrites } from './services/eventBus.js';
import { createRequestNotifier, type RequestNotifier } from './services/notifications.js';
import { createConfiguredRateLimiter, registerRateLimitHook } from './services/rateLimit.js';

export interface BuildAppOptions {
  config: ServerConfig;
  store: AgentTickStore;
  notifier?: RequestNotifier;

}

export async function buildApp({ config, store, notifier = createRequestNotifier({ store, config }) }: BuildAppOptions): Promise<FastifyInstance> {
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
  const eventBus = await createConfiguredWorkspaceEventBus({ backend: config.eventBusBackend, redisURL: config.redisURL });
  const rateLimiter = await createConfiguredRateLimiter({ backend: config.rateLimitBackend, redisURL: config.redisURL });
  publishAuditWrites(store, eventBus);
  app.addHook('onClose', async () => {
    await Promise.allSettled([eventBus.close?.(), rateLimiter.close?.()]);
  });

  registerRateLimitHook(app, config, rateLimiter);
  await registerTestSupportRoutes(app, { config, store });

  app.get('/healthz', async () => ({ status: 'ok' as const, time: new Date().toISOString() }));

  app.get('/readyz', async (request, reply) => {
    const dependencies: { database?: 'ok' | 'error'; redis?: 'ok' | 'error' } = {};
    try {
      await store.ping();
      dependencies.database = 'ok';
      if (config.redisURL) {
        await Promise.all([eventBus.ping?.(), rateLimiter.ping?.()]);
        dependencies.redis = 'ok';
      }
      return { status: 'ready' as const, time: new Date().toISOString(), dependencies };
    } catch (error) {
      request.log.error({ err: error }, 'readiness check failed');
      dependencies.database ??= 'error';
      if (config.redisURL) dependencies.redis ??= 'error';
      return reply.status(503).send({ status: 'not_ready' as const, time: new Date().toISOString(), dependencies });
    }
  });

  app.get('/v1/auth/config', async () => ({
    mode: config.mode,
    authProvider: config.authProvider,
    publicURL: config.publicURL,
    clerkPublishableKey: config.mode === 'clerk' ? config.clerkPublishableKey : undefined,
    testAuth: config.testAuth || undefined
  }));

  await registerMeRoutes(app, { config, store });
  await registerClerkWebhookRoutes(app, { config, store });
  await registerMobileSessionRoutes(app, { config, store });
  await registerMobileDiagnosticsRoutes(app, { config, store });
  await registerWorkspaceRoutes(app, { config, store });
  await registerAgentTokenRoutes(app, { config, store });
  await registerBillingRoutes(app, { config, store });
  await registerOnboardingRoutes(app, { config, store });
  await registerRequestRoutes(app, { config, store, notifier });
  await registerActivityRoutes(app, { config, store });
  await registerDeviceRoutes(app, { config, store });
  await registerPairingRoutes(app, { config, store });
  await registerPresenceRoutes(app, { config, store });
  await registerStatusRoutes(app, { config, store });
  await registerRoutingRuleRoutes(app, { config, store });
  await registerTestActivityRoutes(app, { config, store, notifier });
  await registerAuditRoutes(app, { config, store });
  await registerEventRoutes(app, { config, store, eventBus });

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
