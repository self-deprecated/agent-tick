import type { ApprovalRequest } from '@agent-tick/shared';
import type { AgentTickStore } from '@agent-tick/db';

export interface ApprovalNotifier {
  notifyApprovalCreated(request: ApprovalRequest): Promise<void>;
}

export interface ExpoPushNotifierOptions {
  store: AgentTickStore;
  fetch?: typeof fetch;
  endpoint?: string;
}

export function createExpoPushNotifier({ store, fetch: fetchImpl = globalThis.fetch, endpoint = 'https://exp.host/--/api/v2/push/send' }: ExpoPushNotifierOptions): ApprovalNotifier {
  return {
    async notifyApprovalCreated(request) {
      if (!fetchImpl || !request.organizationId) return;
      const devices = store.listPushDevicesForOrganization(request.organizationId);
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
            title: request.title,
            body: request.body ?? request.command ?? 'Approval requested',
            data: { requestId: request.id, type: 'approval_request' }
          }))
        )
      });
    }
  };
}
