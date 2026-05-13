import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { AgentTickModeSchema, type AgentTickMode, type AuthProvider } from '@agent-tick/shared';

const ConfigSchema = z.object({
  mode: AgentTickModeSchema.default('single'),
  host: z.string().default('0.0.0.0'),
  port: z.coerce.number().int().positive().default(8787),
  publicURL: z.string().optional(),
  databaseURL: z.string().default('file:./agent-tick.db'),
  databaseMigrateOnStart: z.boolean().default(true),
  adminToken: z.string().optional(),
  adminDistDir: z.string().optional(),
  clerkPublishableKey: z.string().optional(),
  clerkSecretKey: z.string().optional(),
  clerkJwtKey: z.string().optional(),
  clerkAuthorizedParties: z.array(z.string()).default([]),
  sessionSecret: z.string().optional(),
  maxActiveMembers: z.coerce.number().int().positive().optional(),
  inviteEmailWebhookURL: z.string().url().optional(),
  approvalNotificationWebhookURL: z.string().url().optional(),
  approvalRetentionDays: z.coerce.number().int().nonnegative().optional(),
  auditRetentionDays: z.coerce.number().int().nonnegative().optional(),
  unregisteredDeviceRetentionDays: z.coerce.number().int().nonnegative().optional(),
  expiredInviteRetentionDays: z.coerce.number().int().nonnegative().optional(),
  retentionCleanupEnabled: z.boolean().default(true),
  retentionCleanupIntervalMinutes: z.coerce.number().int().positive().default(60),
  rateLimitWindowMs: z.coerce.number().int().positive().default(60_000),
  rateLimitMaxRequests: z.coerce.number().int().positive().optional(),
  redisURL: z.string().url().optional(),
  eventBusBackend: z.enum(['memory', 'redis']).default('memory'),
  rateLimitBackend: z.enum(['memory', 'redis']).default('memory'),
  testAuth: z.boolean().default(false)
});

export type ServerConfig = Omit<z.infer<typeof ConfigSchema>, 'adminDistDir'> & {
  authProvider: AuthProvider;
  adminDistDir: string;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const parsed = ConfigSchema.parse({
    mode: env.AGENT_TICK_MODE ?? 'single',
    host: env.AGENT_TICK_HOST ?? env.HOST ?? '0.0.0.0',
    port: env.AGENT_TICK_PORT ?? env.PORT ?? 8787,
    publicURL: env.AGENT_TICK_PUBLIC_URL,
    databaseURL: env.AGENT_TICK_DATABASE_URL ?? env.AGENT_TICK_DATA ?? 'file:./agent-tick.db',
    databaseMigrateOnStart: booleanEnv(env.AGENT_TICK_DATABASE_MIGRATE_ON_START, true),
    adminToken: env.AGENT_TICK_ADMIN_TOKEN ?? env.AGENT_TICK_TOKEN,
    adminDistDir: env.AGENT_TICK_ADMIN_DIST,
    clerkPublishableKey: env.AGENT_TICK_CLERK_PUBLISHABLE_KEY,
    clerkSecretKey: env.AGENT_TICK_CLERK_SECRET_KEY,
    clerkJwtKey: env.AGENT_TICK_CLERK_JWT_KEY,
    clerkAuthorizedParties: splitCSV(env.AGENT_TICK_CLERK_AUTHORIZED_PARTIES),
    sessionSecret: optionalEnv(env.AGENT_TICK_SESSION_SECRET),
    maxActiveMembers: optionalEnv(env.AGENT_TICK_MAX_ACTIVE_MEMBERS),
    inviteEmailWebhookURL: optionalEnv(env.AGENT_TICK_INVITE_EMAIL_WEBHOOK_URL),
    approvalNotificationWebhookURL: optionalEnv(env.AGENT_TICK_APPROVAL_NOTIFICATION_WEBHOOK_URL),
    approvalRetentionDays: optionalEnv(env.AGENT_TICK_APPROVAL_RETENTION_DAYS),
    auditRetentionDays: optionalEnv(env.AGENT_TICK_AUDIT_RETENTION_DAYS),
    unregisteredDeviceRetentionDays: optionalEnv(env.AGENT_TICK_UNREGISTERED_DEVICE_RETENTION_DAYS),
    expiredInviteRetentionDays: optionalEnv(env.AGENT_TICK_EXPIRED_INVITE_RETENTION_DAYS),
    retentionCleanupEnabled: booleanEnv(env.AGENT_TICK_RETENTION_CLEANUP_ENABLED, true),
    retentionCleanupIntervalMinutes: optionalEnv(env.AGENT_TICK_RETENTION_CLEANUP_INTERVAL_MINUTES),
    rateLimitWindowMs: optionalEnv(env.AGENT_TICK_RATE_LIMIT_WINDOW_MS),
    rateLimitMaxRequests: optionalEnv(env.AGENT_TICK_RATE_LIMIT_MAX_REQUESTS),
    redisURL: optionalEnv(env.AGENT_TICK_REDIS_URL),
    eventBusBackend: env.AGENT_TICK_EVENT_BUS_BACKEND ?? (env.AGENT_TICK_REDIS_URL ? 'redis' : 'memory'),
    rateLimitBackend: env.AGENT_TICK_RATE_LIMIT_BACKEND ?? (env.AGENT_TICK_REDIS_URL ? 'redis' : 'memory'),
    testAuth: env.AGENT_TICK_TEST_AUTH === '1' || env.AGENT_TICK_TEST_AUTH === 'true'
  });

  if (parsed.mode === 'clerk' && !parsed.testAuth && (!parsed.clerkPublishableKey || !parsed.clerkSecretKey)) {
    throw new Error('AGENT_TICK_MODE=clerk requires AGENT_TICK_CLERK_PUBLISHABLE_KEY and AGENT_TICK_CLERK_SECRET_KEY');
  }

  return {
    ...parsed,
    authProvider: authProviderForMode(parsed.mode),
    adminDistDir: parsed.adminDistDir ?? defaultAdminDistDir()
  };
}

export function authProviderForMode(mode: AgentTickMode): AuthProvider {
  return mode === 'clerk' ? 'clerk' : 'local';
}

function optionalEnv(value: string | undefined): string | undefined {
  return value?.trim() || undefined;
}

function booleanEnv(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined || value.trim() === '') return defaultValue;
  return value === '1' || value.toLowerCase() === 'true' || value.toLowerCase() === 'yes';
}

function splitCSV(value: string | undefined): string[] {
  return value
    ?.split(',')
    .map((part) => part.trim())
    .filter(Boolean) ?? [];
}

function defaultAdminDistDir(): string {
  return fileURLToPath(new URL('../public/admin', import.meta.url));
}
