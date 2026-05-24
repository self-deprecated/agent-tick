import type { RequestRecord } from '@agent-tick/shared';
import type { AsyncAgentTickStore as AgentTickStore } from '@agent-tick/db';
import type { ServerConfig } from '../config.js';

export interface RequestNotifier {
  notifyRequestCreated(request: RequestRecord): Promise<void>;
}

export interface ExpoPushNotifierOptions {
  store: AgentTickStore;
  fetch?: typeof fetch;
  endpoint?: string;
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
}

export function createRequestNotifier({ store, config, fetch: fetchImpl }: RequestNotifierOptions): RequestNotifier {
  const notifiers = config.mode === 'clerk' ? [createExpoPushNotifier({ store, ...(fetchImpl ? { fetch: fetchImpl } : {}) })] : [];
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

export function createExpoPushNotifier({ store, fetch: fetchImpl = globalThis.fetch, endpoint = 'https://exp.host/--/api/v2/push/send' }: ExpoPushNotifierOptions): RequestNotifier {
  return {
    async notifyRequestCreated(request) {
      if (!fetchImpl) return;
      const devices = await store.listPushDevicesForRequestRecipients(request.id);
      const targets = unique(devices.map((device) => device.expoPushToken).filter((token): token is string => Boolean(token)));
      if (!targets.length) return;
      const response = await fetchImpl(endpoint, {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify(targets.map((to) => ({
          to,
          title: 'Agent Tick',
          body: 'Agent Tick needs your attention.',
          data: { requestId: request.id, workspaceId: request.workspaceId, type: 'request', encrypted: Boolean(request.encryptedPayload) }
        })))
      });
      if (!response.ok) throw new Error(`expo push request failed: ${response.status}`);
      const ticketErrors = await expoPushTicketErrors(response);
      if (ticketErrors.length) throw new Error(`expo push ticket failed: ${ticketErrors.join('; ')}`);
    }
  };
}

async function expoPushTicketErrors(response: Response): Promise<string[]> {
  const body = await response.json().catch(() => undefined) as { data?: unknown } | undefined;
  if (!body || !Array.isArray(body.data)) return [];
  return body.data.flatMap((ticket) => {
    if (!ticket || typeof ticket !== 'object') return [];
    const record = ticket as { status?: unknown; message?: unknown; details?: { error?: unknown } };
    if (record.status !== 'error') return [];
    const errorCode = typeof record.details?.error === 'string' ? record.details.error : 'unknown';
    const message = typeof record.message === 'string' ? record.message : 'unknown Expo push error';
    return [`${errorCode}: ${message}`];
  });
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
