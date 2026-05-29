import type { FastifyInstance } from 'fastify';
import { RegisterDeviceSchema, UpdateDeviceNameSchema, UpdateDevicePushTokenSchema } from '@self-deprecated/agent-tick-shared';
import type { AsyncAgentTickStore as AgentTickStore } from '@agent-tick/db';
import type { ServerConfig } from '../config.js';
import { requireHuman, requirePrivilegedHuman } from '../auth/context.js';
import { requireHostedPersonalRouting } from '../services/personalEntitlements.js';

export interface DeviceRoutesOptions {
  config: ServerConfig;
  store: AgentTickStore;
}

export async function registerDeviceRoutes(app: FastifyInstance, { config, store }: DeviceRoutesOptions): Promise<void> {
  app.get('/v1/devices', async (request) => {
    const auth = await requirePrivilegedHuman(request, config, store);
    return await store.listDevicesForUser(auth.userId ?? 'usr_default');
  });

  app.post('/v1/devices/register', async (request) => {
    const auth = await requireHuman(request, config, store);
    await requireHostedPersonalRouting(config, store, auth);
    const input = RegisterDeviceSchema.parse(request.body);
    const device = await store.registerDevice({
      userId: auth.userId ?? 'usr_default',
      deviceName: input.deviceName,
      ...(input.platform ? { platform: input.platform } : {}),
      ...(input.installationId ? { installationId: input.installationId } : {}),
      ...(input.expoPushToken ? { expoPushToken: input.expoPushToken } : {})
    });
    return { deviceId: device.deviceId };
  });

  app.patch('/v1/devices/:id', async (request, reply) => {
    const auth = await requireHuman(request, config, store);
    const { id } = request.params as { id: string };
    const input = UpdateDeviceNameSchema.parse(request.body);
    const device = await store.updateDeviceName(id, auth.userId ?? 'usr_default', input.name);
    if (!device) return reply.status(404).send({ error: { code: 'not_found', message: 'Device not found', requestId: request.id } });
    return device;
  });

  app.post('/v1/devices/:id/push-token', async (request, reply) => {
    const auth = await requireHuman(request, config, store);
    await requireHostedPersonalRouting(config, store, auth);
    const { id } = request.params as { id: string };
    const input = UpdateDevicePushTokenSchema.parse(request.body);
    const device = await store.updateDevicePushToken(id, auth.userId ?? 'usr_default', input.expoPushToken ?? input.token ?? '');
    if (!device) return reply.status(404).send({ error: { code: 'not_found', message: 'Device not found', requestId: request.id } });
    return device;
  });

  app.post('/v1/devices/:id/unpair', async (request, reply) => {
    const auth = await requireHuman(request, config, store);
    const { id } = request.params as { id: string };
    const device = await store.unregisterDevice(id, auth.userId ?? 'usr_default');
    if (!device) return reply.status(404).send({ error: { code: 'not_found', message: 'Device not found', requestId: request.id } });
    return device;
  });

  app.post('/v1/devices/:id/unregister', async (request, reply) => {
    const auth = await requireHuman(request, config, store);
    const { id } = request.params as { id: string };
    const device = await store.unregisterDevice(id, auth.userId ?? 'usr_default');
    if (!device) return reply.status(404).send({ error: { code: 'not_found', message: 'Device not found', requestId: request.id } });
    return device;
  });
}
