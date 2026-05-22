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
  if (config.approvalNotificationWebhookURL) {
    notifiers.push(createWebhookRequestNotifier({ url: config.approvalNotificationWebhookURL, ...(config.publicURL ? { publicURL: config.publicURL } : {}), ...(fetchImpl ? { fetch: fetchImpl } : {}) }));
  }
  return createCompositeRequestNotifier(notifiers);
}

export const createApprovalNotifier = createRequestNotifier;
export type ApprovalNotifier = RequestNotifier;

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
      const targets = devices.map((device) => device.expoPushToken).filter((token): token is string => Boolean(token));
      if (!targets.length) return;
      await fetchImpl(endpoint, {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify(targets.map((to) => ({
          to,
          title: 'Agent Tick',
          body: 'Agent Tick needs your attention.',
          data: { requestId: request.id, workspaceId: request.workspaceId, type: 'request', encrypted: Boolean(request.encryptedPayload) }
        })))
      });
    }
  };
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
