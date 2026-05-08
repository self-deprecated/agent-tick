import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { AgentTickModeSchema, type AgentTickMode, type AuthProvider } from '@agent-tick/shared';

const ConfigSchema = z.object({
  mode: AgentTickModeSchema.default('single'),
  host: z.string().default('0.0.0.0'),
  port: z.coerce.number().int().positive().default(8787),
  publicURL: z.string().optional(),
  databaseURL: z.string().default('file:./agent-tick.db'),
  adminToken: z.string().optional(),
  adminDistDir: z.string().optional(),
  clerkPublishableKey: z.string().optional(),
  clerkSecretKey: z.string().optional(),
  clerkJwtKey: z.string().optional(),
  clerkAuthorizedParties: z.array(z.string()).default([]),
  maxActiveMembers: z.coerce.number().int().positive().optional()
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
    adminToken: env.AGENT_TICK_ADMIN_TOKEN ?? env.AGENT_TICK_TOKEN,
    adminDistDir: env.AGENT_TICK_ADMIN_DIST,
    clerkPublishableKey: env.AGENT_TICK_CLERK_PUBLISHABLE_KEY,
    clerkSecretKey: env.AGENT_TICK_CLERK_SECRET_KEY,
    clerkJwtKey: env.AGENT_TICK_CLERK_JWT_KEY,
    clerkAuthorizedParties: splitCSV(env.AGENT_TICK_CLERK_AUTHORIZED_PARTIES),
    maxActiveMembers: env.AGENT_TICK_MAX_ACTIVE_MEMBERS?.trim() || undefined
  });

  if (parsed.mode === 'clerk' && (!parsed.clerkPublishableKey || !parsed.clerkSecretKey)) {
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

function splitCSV(value: string | undefined): string[] {
  return value
    ?.split(',')
    .map((part) => part.trim())
    .filter(Boolean) ?? [];
}

function defaultAdminDistDir(): string {
  return fileURLToPath(new URL('../public/admin', import.meta.url));
}
