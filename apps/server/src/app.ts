import fs from 'node:fs';
import path from 'node:path';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance, type FastifyReply } from 'fastify';
import type { AsyncAgentTickStore as AgentTickStore } from '@agent-tick/db';
import type { ServerConfig } from './config.js';
import { registerActivityRoutes } from './routes/activity.js';
import { registerAgentTokenRoutes } from './routes/agentTokens.js';
import { registerAuditRoutes } from './routes/audit.js';
import { registerAudienceChannelRoutes } from './routes/audienceChannels.js';
import { registerAudienceRequestRoutes } from './routes/audienceRequests.js';
import { registerBillingRoutes } from './routes/billing.js';
import { registerClerkWebhookRoutes } from './routes/clerkWebhooks.js';
import { registerDeviceRoutes } from './routes/devices.js';
import { registerDiagnosticsRoutes } from './routes/diagnostics.js';
import { registerEventRoutes } from './routes/events.js';
import { registerExternalApproverRoutes } from './routes/externalApprovers.js';
import { registerExternalApproverInviteRoutes } from './routes/externalApproverInvites.js';
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
import { registerToolActivityRoutes } from './routes/toolActivities.js';
import { registerWorkspaceRoutes } from './routes/workspaces.js';
import { serverErrorEnvelope } from './dbErrors.js';
import { createConfiguredWorkspaceEventBus, publishAuditWrites } from './services/eventBus.js';
import { createRequestNotifier, type RequestNotifier } from './services/notifications.js';
import { createConfiguredRateLimiter, registerRateLimitHook } from './services/rateLimit.js';
import { appleAppSiteAssociation } from './wellKnown.js';

const serverPackage = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version?: string };
const SERVER_VERSION = serverPackage.version ?? 'unknown';

export interface BuildAppOptions {
  config: ServerConfig;
  store: AgentTickStore;
  notifier?: RequestNotifier;

}

export async function buildApp({ config, store, notifier }: BuildAppOptions): Promise<FastifyInstance> {
  const app = Fastify({
    logger: true,
    genReqId: (request) => request.headers['x-request-id']?.toString() ?? crypto.randomUUID()
  });
  const requestNotifier = notifier ?? createRequestNotifier({ store, config, logger: app.log });

  app.setErrorHandler((error, request, reply) => {
    const { statusCode, code, message } = serverErrorEnvelope(error);
    if (statusCode >= 500) request.log.error({ err: error, statusCode, code }, 'request failed');
    void reply.status(statusCode).send({
      error: {
        code,
        message,
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

  app.get('/healthz', async () => ({ status: 'ok' as const, version: SERVER_VERSION, time: new Date().toISOString() }));

  app.get('/readyz', async (request, reply) => {
    const dependencies: { database?: 'ok' | 'error' | 'schema_mismatch'; redis?: 'ok' | 'error' } = {};
    let ready = true;
    try {
      await store.ping();
      const schema = await store.verifySchemaCompatibility();
      if (schema.ok) {
        dependencies.database = 'ok';
      } else {
        dependencies.database = 'schema_mismatch';
        ready = false;
        request.log.error({ missing: schema.missing }, 'schema compatibility check failed; database is not ready');
      }
      if (config.redisURL) {
        await Promise.all([eventBus.ping?.(), rateLimiter.ping?.()]);
        dependencies.redis = 'ok';
      }
    } catch (error) {
      request.log.error({ err: error }, 'readiness check failed');
      dependencies.database ??= 'error';
      if (config.redisURL) dependencies.redis ??= 'error';
      ready = false;
    }
    if (ready) return { status: 'ready' as const, time: new Date().toISOString(), dependencies };
    return reply.status(503).send({ status: 'not_ready' as const, time: new Date().toISOString(), dependencies });
  });

  app.get('/v1/auth/config', async () => ({
    mode: config.mode,
    authProvider: config.authProvider,
    publicURL: config.publicURL,
    clerkPublishableKey: config.mode === 'clerk' ? config.clerkPublishableKey : undefined,
    testAuth: config.testAuth || undefined,
    mobile: mobileUpdatePolicy(config)
  }));

  app.get('/.well-known/apple-app-site-association', async (_request, reply) => {
    return reply.type('application/json').send(appleAppSiteAssociation);
  });

  await registerMeRoutes(app, { config, store });
  await registerClerkWebhookRoutes(app, { config, store });
  await registerMobileSessionRoutes(app, { config, store });
  await registerMobileDiagnosticsRoutes(app, { config, store });
  await registerWorkspaceRoutes(app, { config, store });
  await registerAgentTokenRoutes(app, { config, store });
  await registerBillingRoutes(app, { config, store });
  await registerOnboardingRoutes(app, { config, store });
  await registerRequestRoutes(app, { config, store, notifier: requestNotifier, eventBus });
  await registerActivityRoutes(app, { config, store });
  await registerDeviceRoutes(app, { config, store });
  await registerPairingRoutes(app, { config, store });
  await registerPresenceRoutes(app, { config, store });
  await registerStatusRoutes(app, { config, store });
  await registerToolActivityRoutes(app, { config, store });
  await registerRoutingRuleRoutes(app, { config, store });
  await registerTestActivityRoutes(app, { config, store, notifier: requestNotifier });
  await registerDiagnosticsRoutes(app, { config, store });
  await registerAuditRoutes(app, { config, store });
  await registerAudienceChannelRoutes(app, { config, store });
  await registerAudienceRequestRoutes(app, { config, store });
  await registerEventRoutes(app, { config, store, eventBus });
  await registerExternalApproverRoutes(app, { config, store });
  await registerExternalApproverInviteRoutes(app, { config, store });

  const adminIndexPath = await registerStaticAdmin(app, config.adminDistDir);
  setFallbackNotFoundHandler(app, adminIndexPath);
  return app;
}

function mobileUpdatePolicy(config: ServerConfig): { minimumSupportedVersion?: string; updateURL?: string; message?: string } | undefined {
  const policy = {
    ...(config.mobileMinimumSupportedVersion ? { minimumSupportedVersion: config.mobileMinimumSupportedVersion } : {}),
    ...(config.mobileUpdateURL ? { updateURL: config.mobileUpdateURL } : {}),
    ...(config.mobileUpdateMessage ? { message: config.mobileUpdateMessage } : {})
  };
  return Object.keys(policy).length > 0 ? policy : undefined;
}

async function registerStaticAdmin(app: FastifyInstance, adminDistDir: string): Promise<string | undefined> {
  if (!fs.existsSync(adminDistDir)) {
    app.log.warn({ adminDistDir }, 'admin dist directory does not exist; static dashboard disabled');
    return undefined;
  }

  const indexPath = path.join(adminDistDir, 'index.html');
  const adminIndexPath = fs.existsSync(indexPath) ? indexPath : undefined;
  if (adminIndexPath) {
    app.get('/', async (_request, reply) => sendAdminIndex(reply, adminIndexPath));
    app.get('/index.html', async (_request, reply) => sendAdminIndex(reply, adminIndexPath));
  }

  const assetsDir = path.join(adminDistDir, 'assets');
  if (fs.existsSync(assetsDir)) {
    await app.register(fastifyStatic, {
      root: assetsDir,
      prefix: '/assets/',
      decorateReply: false,
      maxAge: '1y',
      immutable: true
    });
  }

  await app.register(fastifyStatic, {
    root: adminDistDir,
    prefix: '/',
    decorateReply: false
  });

  return adminIndexPath;
}

function setFallbackNotFoundHandler(app: FastifyInstance, adminIndexPath: string | undefined): void {
  app.setNotFoundHandler((request, reply) => {
    if (adminIndexPath && request.raw.method === 'GET' && acceptsHTML(request.headers.accept)) {
      return sendAdminIndex(reply, adminIndexPath);
    }
    return reply.header('cache-control', 'no-store').status(404).send({
      error: {
        code: 'not_found',
        message: 'Not found',
        requestId: request.id
      }
    });
  });
}

function sendAdminIndex(reply: FastifyReply, adminIndexPath: string): FastifyReply {
  return reply
    .type('text/html')
    .header('cache-control', 'no-store')
    .send(fs.createReadStream(adminIndexPath));
}

function acceptsHTML(accept: string | undefined): boolean {
  return Boolean(accept?.includes('text/html'));
}
