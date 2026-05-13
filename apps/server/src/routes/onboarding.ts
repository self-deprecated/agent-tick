import type { FastifyInstance } from 'fastify';
import type { AsyncAgentTickStore as AgentTickStore } from '@agent-tick/db';
import type { OnboardingStatus } from '@agent-tick/shared';
import type { ServerConfig } from '../config.js';
import { requirePrivilegedHuman } from '../auth/context.js';

export interface OnboardingRoutesOptions {
  config: ServerConfig;
  store: AgentTickStore;
}

export async function registerOnboardingRoutes(app: FastifyInstance, { config, store }: OnboardingRoutesOptions): Promise<void> {
  app.get('/v1/onboarding', async (request): Promise<OnboardingStatus> => {
    const auth = await requirePrivilegedHuman(request, config, store);
    const agentTokens = (await store.listAgentTokens(auth.organizationId)).filter((token) => !token.revokedAt);
    const devices = (await store.listDevicesForUser(auth.userId ?? 'usr_default')).filter((device) => !device.unregisteredAt);
    const connectedAgents = agentTokens.filter((token) => Boolean(token.lastRequestAt));
    const hasAgentToken = agentTokens.length > 0;
    const hasCliHeartbeat = connectedAgents.length > 0;
    const hasMobileDevice = devices.length > 0;
    const stage = !hasAgentToken
      ? 'needs_agent_token'
      : !hasCliHeartbeat
        ? 'needs_cli_setup'
        : !hasMobileDevice
          ? 'needs_mobile_app'
          : 'ready_for_first_request';

    return {
      stage,
      hasAgentToken,
      hasCliHeartbeat,
      hasMobileDevice,
      canUseWebApprovals: stage === 'ready_for_first_request',
      activeAgentTokenCount: agentTokens.length,
      connectedAgentCount: connectedAgents.length,
      activeMobileDeviceCount: devices.length
    };
  });
}
