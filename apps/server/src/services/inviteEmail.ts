import type { OrganizationInviteRecord } from '@agent-tick/db';
import type { InviteEmailDelivery } from '@agent-tick/shared';
import type { ServerConfig } from '../config.js';

export interface InviteEmailInput {
  invite: OrganizationInviteRecord;
  organizationName: string | undefined;
  url: string | undefined;
}

export interface InviteEmailSender {
  sendInvite(input: InviteEmailInput): Promise<InviteEmailDelivery>;
}

export function createInviteEmailSender(config: ServerConfig): InviteEmailSender {
  return new WebhookInviteEmailSender(config.inviteEmailWebhookURL);
}

class WebhookInviteEmailSender implements InviteEmailSender {
  constructor(private readonly webhookURL: string | undefined) {}

  async sendInvite(input: InviteEmailInput): Promise<InviteEmailDelivery> {
    const recipient = input.invite.email?.trim().toLowerCase();
    if (!recipient) return { status: 'skipped', message: 'Invite has no exact email recipient' };
    if (!input.url) return { status: 'skipped', recipient, message: 'AGENT_TICK_PUBLIC_URL is required to email invite links' };
    if (!this.webhookURL) return { status: 'skipped', recipient, message: 'Invite email webhook is not configured' };

    const response = await fetch(this.webhookURL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        type: 'organization_invite',
        to: recipient,
        inviteId: input.invite.inviteId,
        organizationId: input.invite.organizationId,
        organizationName: input.organizationName,
        role: input.invite.role,
        approvalRequired: input.invite.approvalRequired,
        expiresAt: input.invite.expiresAt,
        url: input.url
      })
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      return { status: 'failed', recipient, message: `Invite email webhook failed with ${response.status}${text ? `: ${text.slice(0, 200)}` : ''}` };
    }

    return { status: 'sent', recipient, sentAt: new Date().toISOString() };
  }
}
