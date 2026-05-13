import type { FastifyInstance } from 'fastify';
import { CreateMobileDiagnosticsSchema } from '@agent-tick/shared';
import type { AsyncAgentTickStore as AgentTickStore } from '@agent-tick/db';
import type { ServerConfig } from '../config.js';
import { requireHuman } from '../auth/context.js';

export interface MobileDiagnosticsRoutesOptions {
  config: ServerConfig;
  store: AgentTickStore;
}

export async function registerMobileDiagnosticsRoutes(app: FastifyInstance, { config, store }: MobileDiagnosticsRoutesOptions): Promise<void> {
  app.post('/v1/mobile-diagnostics', async (request) => {
    const auth = await requireHuman(request, config, store);
    const input = CreateMobileDiagnosticsSchema.parse(request.body);
    const contextMetadata = {
      appVersion: input.appVersion,
      platform: input.platform,
      deviceModel: input.deviceModel,
      serverURL: input.serverURL,
      authMode: input.authMode,
      connectionStatus: input.connectionStatus,
      pushStatus: input.pushStatus,
      notificationStatus: input.notificationStatus,
      currentScreen: input.currentScreen,
      lastErrorMessage: input.lastErrorMessage
    };
    const events = input.events.map((event) => ({
      organizationId: auth.organizationId,
      userId: auth.userId ?? 'usr_default',
      ...(auth.deviceId ? { deviceId: auth.deviceId } : {}),
      level: event.level,
      area: event.area,
      message: event.message,
      createdAt: event.at,
      metadata: pruneUndefined({ ...contextMetadata, ...(event.metadata ?? {}) })
    }));
    return { accepted: await store.recordMobileDiagnostics(events) };
  });

}

function pruneUndefined(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, field]) => field !== undefined));
}
