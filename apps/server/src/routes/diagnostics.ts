import type { FastifyInstance } from 'fastify';
import type { AsyncAgentTickStore as AgentTickStore } from '@agent-tick/db';
import type { ServerConfig } from '../config.js';
import { requireWorkspaceAdmin } from '../auth/context.js';

export interface DiagnosticsRoutesOptions {
  config: ServerConfig;
  store: AgentTickStore;
}

/**
 * Admin-only Activity write-path canary. Exercises the real Activity write path
 * inside a rolled-back transaction (no persisted rows, no notifications) so Ops
 * can prove the server can create Activity — catching schema drift and
 * write-path regressions that `/readyz` does not. Reports pass/fail separately
 * from readiness: 200 on pass, 503 with a safe classification on failure.
 */
export async function registerDiagnosticsRoutes(app: FastifyInstance, { config, store }: DiagnosticsRoutesOptions): Promise<void> {
  app.post('/v1/diagnostics/activity-write-canary', async (request, reply) => {
    await requireWorkspaceAdmin(request, config, store);
    const result = await store.runActivityWriteCanary();
    if (result.ok) {
      request.log.info('activity write-path canary passed');
      return { ok: true as const, requestId: request.id };
    }
    request.log.error({ code: result.code }, 'activity write-path canary failed');
    return reply.status(503).send({ ok: false as const, code: result.code, requestId: request.id });
  });
}
