import type { FastifyInstance } from 'fastify';
import type { AsyncAgentTickStore as AgentTickStore } from '@agent-tick/db';
import type { OnboardingStatus } from '@self-deprecated/agent-tick-shared';
import type { ServerConfig } from '../config.js';
import { requirePrivilegedHuman } from '../auth/context.js';

export interface OnboardingRoutesOptions {
  config: ServerConfig;
  store: AgentTickStore;
}

export async function registerOnboardingRoutes(app: FastifyInstance, { config, store }: OnboardingRoutesOptions): Promise<void> {
  app.get('/v1/onboarding', async (request): Promise<OnboardingStatus> => {
    const auth = await requirePrivilegedHuman(request, config, store);
    const agentTokens = (await store.listAgentTokens(auth.workspaceId)).filter((token) => !token.revokedAt);
    const registeredDevices = (await store.listDevicesForUser(auth.userId ?? 'usr_default')).filter((device) => !device.unregisteredAt);
    const pushReadyDevices = registeredDevices.filter((device) => Boolean(device.expoPushToken));
    const connectedAgents = agentTokens.filter((token) => Boolean(token.lastCheckInAt || token.lastActivityAt));
    const hasAgentToken = agentTokens.length > 0;
    const hasAgentCheckIn = connectedAgents.length > 0;
    const hasMobileDevice = pushReadyDevices.length > 0;
    const stage = !hasAgentToken
      ? 'needs_agent_token'
      : !hasAgentCheckIn
        ? 'needs_agent_check_in'
        : !hasMobileDevice
          ? 'needs_mobile_app'
          : 'ready';
    return {
      stage,
      hasAgentToken,
      hasAgentCheckIn,
      hasMobileDevice,
      activeAgentTokenCount: agentTokens.length,
      connectedAgentCount: connectedAgents.length,
      activeMobileDeviceCount: pushReadyDevices.length
    };
  });
}
