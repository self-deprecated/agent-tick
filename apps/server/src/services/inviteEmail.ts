import type { ServerConfig } from '../config.js';

export interface InviteEmailDelivery {
  status: 'skipped' | 'sent' | 'failed';
  recipient?: string;
  sentAt?: string;
  message?: string;
}

export interface InviteEmailInput {
  email?: string;
}

export interface InviteEmailSender {
  sendInvite(input: InviteEmailInput): Promise<InviteEmailDelivery>;
}

export function createInviteEmailSender(_config: ServerConfig): InviteEmailSender {
  return { sendInvite: async (input) => ({ status: 'skipped', ...(input.email ? { recipient: input.email } : {}), message: 'Clerk-backed Shared Workspaces use Clerk invitations; manual self-hosted adds do not send invite email in v1.' }) };
}
