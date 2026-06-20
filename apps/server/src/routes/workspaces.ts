import type { FastifyInstance } from 'fastify';
import { AddWorkspaceMemberSchema, CreateSharedWorkspaceSchema, UpdateWorkspaceSchema } from '@self-deprecated/agent-tick-shared';
import type { AsyncAgentTickStore as AgentTickStore } from '@agent-tick/db';
import type { ServerConfig } from '../config.js';
import { requireHuman, requirePrivilegedHuman, requireWorkspaceAdmin } from '../auth/context.js';

export interface WorkspaceRoutesOptions {
  config: ServerConfig;
  store: AgentTickStore;
}

export async function registerWorkspaceRoutes(app: FastifyInstance, { config, store }: WorkspaceRoutesOptions): Promise<void> {
  app.get('/v1/workspaces', async (request) => {
    const auth = await requireHuman(request, config, store);
    return store.listWorkspacesForUser(auth.userId ?? 'usr_default');
  });

  app.post('/v1/workspaces', async (request, reply) => {
    const auth = await requirePrivilegedHuman(request, config, store);
    if (config.authProvider === 'clerk' && !config.testAuth) {
      return reply.status(409).send({ error: { code: 'clerk_organization_required', message: 'Hosted Shared Workspaces are created through Clerk organization management.', requestId: request.id } });
    }
    const input = CreateSharedWorkspaceSchema.parse(request.body);
    return store.createSharedWorkspaceForUser(auth.userId ?? 'usr_default', input.name);
  });

  app.patch('/v1/workspaces/:id', async (request, reply) => {
    const auth = await requireWorkspaceAdmin(request, config, store);
    const { id } = request.params as { id: string };
    if (id !== auth.workspaceId) return reply.status(403).send({ error: { code: 'forbidden', message: 'Select the Workspace before changing it', requestId: request.id } });
    if (auth.role !== 'owner') return reply.status(403).send({ error: { code: 'forbidden', message: 'Workspace Owner role required', requestId: request.id } });
    const input = UpdateWorkspaceSchema.parse(request.body);
    if (config.privateRequestsPolicy === 'forced' && input.privateRequestsRequired === false) {
      return reply.status(409).send({ error: { code: 'private_required_forced', message: 'Private Requests are required server-wide and cannot be disabled for this Workspace', requestId: request.id } });
    }
    const workspace = await store.updateWorkspace(id, input);
    if (!workspace) return reply.status(404).send({ error: { code: 'not_found', message: 'Workspace not found', requestId: request.id } });
    return workspace;
  });

  app.get('/v1/workspaces/:id/members', async (request, reply) => {
    const auth = await requireHuman(request, config, store);
    const { id } = request.params as { id: string };
    const membership = await store.workspaceMembershipForUser(auth.userId ?? 'usr_default', id);
    if (!membership) return reply.status(403).send({ error: { code: 'forbidden', message: 'Workspace membership required', requestId: request.id } });
    if (membership.memberKind === 'external_approver') return reply.status(403).send({ error: { code: 'forbidden', message: 'Internal Workspace member required', requestId: request.id } });
    const members = await store.listWorkspaceMembers(id);
    return await Promise.all(members.map(async (member) => {
      const availability = await store.getAvailability(member.userId, id);
      return {
        ...member,
        ...(availability ? { availabilityState: availability.state, lastSeenAt: availability.lastSeenAt } : {})
      };
    }));
  });

  app.post('/v1/workspaces/:id/members', async (request, reply) => {
    const auth = await requireWorkspaceAdmin(request, config, store);
    const { id } = request.params as { id: string };
    if (id !== auth.workspaceId) return reply.status(403).send({ error: { code: 'forbidden', message: 'Select the Workspace before changing membership', requestId: request.id } });
    const input = AddWorkspaceMemberSchema.parse(request.body);
    return store.addWorkspaceMemberByEmail(id, input.email, input.role, undefined, input.memberKind);
  });
}
