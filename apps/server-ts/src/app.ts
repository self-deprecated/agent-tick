import fs from 'node:fs';
import path from 'node:path';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import type { ServerConfig } from './config.js';

export interface BuildAppOptions {
  config: ServerConfig;
}

export async function buildApp({ config }: BuildAppOptions): Promise<FastifyInstance> {
  const app = Fastify({
    logger: true,
    genReqId: (request) => request.headers['x-request-id']?.toString() ?? crypto.randomUUID()
  });

  app.setErrorHandler((error, request, reply) => {
    const statusCode = statusCodeForError(error);
    request.log.error({ err: error, statusCode }, 'request failed');
    void reply.status(statusCode).send({
      error: {
        code: statusCode >= 500 ? 'internal_error' : 'bad_request',
        message: statusCode >= 500 ? 'Internal server error' : messageForError(error),
        requestId: request.id
      }
    });
  });

  app.get('/healthz', async () => ({ status: 'ok' as const, time: new Date().toISOString() }));

  app.get('/v1/auth/config', async () => ({
    mode: config.mode,
    authProvider: config.authProvider,
    publicURL: config.publicURL,
    clerkPublishableKey: config.mode === 'clerk' ? config.clerkPublishableKey : undefined
  }));

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

function messageForError(error: unknown): string {
  return error instanceof Error ? error.message : 'Request failed';
}
