import type { ApprovalRequest } from '@agent-tick/shared';
import type { AsyncAgentTickStore as AgentTickStore } from '@agent-tick/db';
import type { ServerConfig } from '../config.js';

export interface ApprovalNotifier {
  notifyApprovalCreated(request: ApprovalRequest): Promise<void>;
}

export interface ExpoPushNotifierOptions {
  store: AgentTickStore;
  fetch?: typeof fetch;
  endpoint?: string;
}

export interface WebhookApprovalNotifierOptions {
  url: string;
  publicURL?: string;
  fetch?: typeof fetch;
}

export interface ApprovalNotifierOptions {
  store: AgentTickStore;
  config: ServerConfig;
  fetch?: typeof fetch;
}

export function createApprovalNotifier({ store, config, fetch: fetchImpl }: ApprovalNotifierOptions): ApprovalNotifier {
  const notifiers = config.mode === 'clerk' ? [createExpoPushNotifier({ store, ...(fetchImpl ? { fetch: fetchImpl } : {}) })] : [];
  if (config.approvalNotificationWebhookURL) {
    notifiers.push(
      createWebhookApprovalNotifier({
        url: config.approvalNotificationWebhookURL,
        ...(config.publicURL ? { publicURL: config.publicURL } : {}),
        ...(fetchImpl ? { fetch: fetchImpl } : {})
      })
    );
  }
  return createCompositeApprovalNotifier(notifiers);
}

export function createCompositeApprovalNotifier(notifiers: ApprovalNotifier[]): ApprovalNotifier {
  return {
    async notifyApprovalCreated(request) {
      const results = await Promise.allSettled(notifiers.map((notifier) => notifier.notifyApprovalCreated(request)));
      const rejected = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
      if (rejected) throw rejected.reason;
    }
  };
}

export function createExpoPushNotifier({ store, fetch: fetchImpl = globalThis.fetch, endpoint = 'https://exp.host/--/api/v2/push/send' }: ExpoPushNotifierOptions): ApprovalNotifier {
  return {
    async notifyApprovalCreated(request) {
      if (!fetchImpl) return;
      const devices = await store.listPushDevicesForApprovalRecipients(request.id);
      const targets = devices.map((device) => device.expoPushToken).filter((token): token is string => Boolean(token));
      if (!targets.length) return;
      await fetchImpl(endpoint, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(
          targets.map((to) => ({
            to,
            title: 'Agent Tick',
            body: 'Agent Tick needs your attention.',
            data: { requestId: request.id, organizationId: request.organizationId, type: 'approval_request', encrypted: Boolean(request.encryptedPayload) }
          }))
        )
      });
    }
  };
}

export function createWebhookApprovalNotifier({ url, publicURL, fetch: fetchImpl = globalThis.fetch }: WebhookApprovalNotifierOptions): ApprovalNotifier {
  return {
    async notifyApprovalCreated(request) {
      if (!fetchImpl) return;
      const response = await fetchImpl(url, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          type: 'approval.created',
          organizationId: request.organizationId,
          request: request.encryptedPayload
            ? {
                id: request.id,
                encrypted: true,
                requester: request.requester,
                risk: request.risk,
                createdAt: request.createdAt
              }
            : {
                id: request.id,
                title: request.title,
                body: request.body,
                command: request.command,
                requester: request.requester,
                risk: request.risk,
                metadata: request.metadata,
                createdAt: request.createdAt
              },
          ...(publicURL ? { url: `${publicURL.replace(/\/+$/, '')}/approvals/${encodeURIComponent(request.id)}` } : {})
        })
      });
      if (!response.ok) throw new Error(`approval notification webhook failed: ${response.status}`);
    }
  };
}
