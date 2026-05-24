import type { RequestRecord } from '@agent-tick/shared';
import type { AsyncAgentTickStore as AgentTickStore } from '@agent-tick/db';
import type { ServerConfig } from '../config.js';

export interface RequestNotifier {
  notifyRequestCreated(request: RequestRecord): Promise<void>;
}

export interface NotificationLogger {
  info?(bindings: Record<string, unknown>, msg?: string): void;
  warn?(bindings: Record<string, unknown>, msg?: string): void;
  error?(bindings: Record<string, unknown>, msg?: string): void;
}

export interface ExpoPushNotifierOptions {
  store: AgentTickStore;
  fetch?: typeof fetch;
  endpoint?: string;
  logger?: NotificationLogger;
}

export interface WebhookRequestNotifierOptions {
  url: string;
  publicURL?: string;
  fetch?: typeof fetch;
}

export interface RequestNotifierOptions {
  store: AgentTickStore;
  config: ServerConfig;
  fetch?: typeof fetch;
  logger?: NotificationLogger;
}

export function createRequestNotifier({ store, config, fetch: fetchImpl, logger }: RequestNotifierOptions): RequestNotifier {
  const notifiers = config.mode === 'clerk' ? [createExpoPushNotifier({ store, ...(fetchImpl ? { fetch: fetchImpl } : {}), ...(logger ? { logger } : {}) })] : [];
  if (config.requestNotificationWebhookURL) {
    notifiers.push(createWebhookRequestNotifier({ url: config.requestNotificationWebhookURL, ...(config.publicURL ? { publicURL: config.publicURL } : {}), ...(fetchImpl ? { fetch: fetchImpl } : {}) }));
  }
  return createCompositeRequestNotifier(notifiers);
}

export function createCompositeRequestNotifier(notifiers: RequestNotifier[]): RequestNotifier {
  return {
    async notifyRequestCreated(request) {
      const results = await Promise.allSettled(notifiers.map((notifier) => notifier.notifyRequestCreated(request)));
      const rejected = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
      if (rejected) throw rejected.reason;
    }
  };
}

export function createExpoPushNotifier({ store, fetch: fetchImpl = globalThis.fetch, endpoint = 'https://exp.host/--/api/v2/push/send', logger }: ExpoPushNotifierOptions): RequestNotifier {
  return {
    async notifyRequestCreated(request) {
      if (!fetchImpl) return;
      const devices = await store.listPushDevicesForRequestRecipients(request.id);
      const targets = unique(devices.map((device) => device.expoPushToken).filter((token): token is string => Boolean(token)));
      if (!targets.length) {
        logger?.info?.({ requestId: request.id }, 'expo push skipped: no active push targets');
        return;
      }
      const started = Date.now();
      const response = await fetchImpl(endpoint, {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify(targets.map((to) => ({
          to,
          title: 'Agent Tick',
          body: 'Agent Tick needs your attention.',
          sound: 'default',
          priority: 'high',
          channelId: 'agent-tick-requests',
          data: { requestId: request.id, workspaceId: request.workspaceId, type: 'request', encrypted: Boolean(request.encryptedPayload) }
        })))
      });
      const responseBody = await response.json().catch(() => undefined) as ExpoPushResponse | undefined;
      const elapsedMs = Date.now() - started;
      if (!response.ok) {
        logger?.error?.({ requestId: request.id, targetCount: targets.length, statusCode: response.status, elapsedMs, expoErrors: responseBody?.errors }, 'expo push request failed');
        throw new Error(`expo push request failed: ${response.status}`);
      }
      const summary = expoPushTicketSummary(responseBody);
      logger?.info?.({ requestId: request.id, targetCount: targets.length, ticketIds: summary.ticketIds, elapsedMs }, 'expo push accepted');
      if (summary.ticketErrors.length) throw new Error(`expo push ticket failed: ${summary.ticketErrors.join('; ')}`);
    }
  };
}

type ExpoPushResponse = {
  data?: unknown;
  errors?: unknown;
};

function expoPushTicketSummary(body: ExpoPushResponse | undefined): { ticketIds: string[]; ticketErrors: string[] } {
  if (!body || !Array.isArray(body.data)) return { ticketIds: [], ticketErrors: [] };
  return body.data.reduce<{ ticketIds: string[]; ticketErrors: string[] }>((summary, ticket) => {
    if (!ticket || typeof ticket !== 'object') return summary;
    const record = ticket as { status?: unknown; id?: unknown; message?: unknown; details?: { error?: unknown } };
    if (record.status === 'ok' && typeof record.id === 'string') summary.ticketIds.push(record.id);
    if (record.status === 'error') {
      const errorCode = typeof record.details?.error === 'string' ? record.details.error : 'unknown';
      const message = typeof record.message === 'string' ? record.message : 'unknown Expo push error';
      summary.ticketErrors.push(`${errorCode}: ${message}`);
    }
    return summary;
  }, { ticketIds: [], ticketErrors: [] });
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values));
}

export function createWebhookRequestNotifier({ url, publicURL, fetch: fetchImpl = globalThis.fetch }: WebhookRequestNotifierOptions): RequestNotifier {
  return {
    async notifyRequestCreated(request) {
      if (!fetchImpl) return;
      const response = await fetchImpl(url, {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'request.created',
          workspaceId: request.workspaceId,
          request: request.encryptedPayload
            ? { id: request.id, encrypted: true, requester: request.requester, risk: request.risk, createdAt: request.createdAt }
            : { id: request.id, title: request.title, body: request.body, command: request.command, requester: request.requester, risk: request.risk, metadata: request.metadata, createdAt: request.createdAt },
          ...(publicURL ? { url: `${publicURL.replace(/\/+$/, '')}/activity?request=${encodeURIComponent(request.id)}` } : {})
        })
      });
      if (!response.ok) throw new Error(`request notification webhook failed: ${response.status}`);
    }
  };
}
