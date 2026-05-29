import type { FastifyInstance } from 'fastify';
import { CreateAudienceChannelSchema } from '@self-deprecated/agent-tick-shared';
import type { AsyncAgentTickStore as AgentTickStore } from '@agent-tick/db';
import type { ServerConfig } from '../config.js';
import { requireHuman, requireWorkspaceAdmin } from '../auth/context.js';

export async function registerAudienceChannelRoutes(app: FastifyInstance, { config, store }: { config: ServerConfig; store: AgentTickStore }): Promise<void> {
  app.get('/v1/audience-channels', async (request) => {
    const auth = await requireHuman(request, config, store);
    const workspaceId = workspaceFilter(request.query, auth.workspaceId);
    const membership = await store.workspaceMembershipForUser(auth.userId ?? 'usr_default', workspaceId);
    if (!membership || membership.memberKind === 'external_approver') throw httpError(403, 'forbidden', 'Internal Workspace member required');
    return store.listAudienceChannels(workspaceId);
  });

  app.post('/v1/audience-channels', async (request) => {
    const auth = await requireWorkspaceAdmin(request, config, store);
    const input = CreateAudienceChannelSchema.parse(request.body);
    if (input.workspaceId !== auth.workspaceId) throw httpError(403, 'forbidden', 'Select the Workspace before creating Audience Channels');
    return store.createAudienceChannel(input, auth.userId ?? 'usr_default');
  });

  app.get('/v1/audience-channels/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const channel = await store.getAudienceChannel(id);
    if (!channel) return reply.status(404).send({ error: { code: 'not_found', message: 'Audience Channel not found', requestId: request.id } });
    return channel;
  });

  app.post('/v1/audience-channels/:id/subscribe', async (request, reply) => {
    const auth = await requireHuman(request, config, store);
    const { id } = request.params as { id: string };
    const channel = await store.getAudienceChannel(id);
    if (!channel) return reply.status(404).send({ error: { code: 'not_found', message: 'Audience Channel not found', requestId: request.id } });
    return store.setAudienceSubscription(id, auth.userId ?? 'usr_default', 'active');
  });

  app.post('/v1/audience-channels/:id/mute', async (request, reply) => {
    const auth = await requireHuman(request, config, store);
    const { id } = request.params as { id: string };
    const channel = await store.getAudienceChannel(id);
    if (!channel) return reply.status(404).send({ error: { code: 'not_found', message: 'Audience Channel not found', requestId: request.id } });
    return store.setAudienceSubscription(id, auth.userId ?? 'usr_default', 'muted');
  });

  app.post('/v1/audience-channels/:id/unsubscribe', async (request, reply) => {
    const auth = await requireHuman(request, config, store);
    const { id } = request.params as { id: string };
    const channel = await store.getAudienceChannel(id);
    if (!channel) return reply.status(404).send({ error: { code: 'not_found', message: 'Audience Channel not found', requestId: request.id } });
    return store.setAudienceSubscription(id, auth.userId ?? 'usr_default', 'removed');
  });
}

function workspaceFilter(query: unknown, fallback: string): string {
  const value = (query as { workspaceId?: unknown }).workspaceId;
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function httpError(statusCode: number, code: string, message: string): Error & { statusCode: number; code: string } {
  const error = new Error(message) as Error & { statusCode: number; code: string };
  error.statusCode = statusCode;
  error.code = code;
  return error;
}
