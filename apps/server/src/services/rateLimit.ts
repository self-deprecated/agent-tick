import crypto from 'node:crypto';
import { createClient, type RedisClientType } from 'redis';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ServerConfig } from '../config.js';

export interface RateLimitRule {
  windowMs: number;
  max: number;
}

export interface RateLimiter {
  check(key: string, rule: RateLimitRule, now?: number): Promise<{ allowed: true } | { allowed: false; retryAfterSeconds: number }>;
  ping?(): void | Promise<void>;
  close?(): void | Promise<void>;
}

export function createMemoryRateLimiter(): RateLimiter {
  const buckets = new Map<string, { windowStart: number; count: number }>();

  return {
    async check(key, rule, now = Date.now()) {
      const existing = buckets.get(key);
      const bucket = existing && now - existing.windowStart < rule.windowMs ? existing : { windowStart: now, count: 0 };
      bucket.count += 1;
      buckets.set(key, bucket);

      if (buckets.size > 1000) pruneRateLimitBuckets(buckets, now, rule.windowMs);

      if (bucket.count <= rule.max) return { allowed: true };
      const retryAfterSeconds = Math.max(1, Math.ceil((rule.windowMs - (now - bucket.windowStart)) / 1000));
      return { allowed: false, retryAfterSeconds };
    },
    ping: () => undefined
  };
}

export async function createRedisRateLimiter(redisURL: string): Promise<RateLimiter> {
  const client = createClient({ url: redisURL }) as RedisClientType;
  await client.connect();

  return {
    async check(key, rule) {
      const redisKey = `agent-tick:rate-limit:${key}`;
      const count = await client.incr(redisKey);
      if (count === 1) await client.pExpire(redisKey, rule.windowMs);
      if (count <= rule.max) return { allowed: true };

      const ttl = await client.pTTL(redisKey);
      const retryAfterSeconds = Math.max(1, Math.ceil(Math.max(ttl, 0) / 1000));
      return { allowed: false, retryAfterSeconds };
    },
    ping: async () => {
      await client.ping();
    },
    close: async () => {
      await client.quit();
    }
  };
}

export async function createConfiguredRateLimiter(options: { backend: 'memory' | 'redis'; redisURL?: string | undefined }): Promise<RateLimiter> {
  if (options.backend === 'redis') {
    if (!options.redisURL) throw new Error('AGENT_TICK_RATE_LIMIT_BACKEND=redis requires AGENT_TICK_REDIS_URL');
    return createRedisRateLimiter(options.redisURL);
  }
  return createMemoryRateLimiter();
}

export function registerRateLimitHook(app: FastifyInstance, config: ServerConfig, rateLimiter: RateLimiter = createMemoryRateLimiter()): void {
  app.addHook('preHandler', async (request, reply) => {
    const routePath = request.routeOptions.url ?? request.url.split('?', 1)[0] ?? request.url;
    const rule = rateLimitRule(request.method, routePath, config);
    if (!rule) return;

    const key = rateLimitKey(request, routePath);
    const result = await rateLimiter.check(key, rule);
    if (result.allowed) return;

    return reply
      .header('retry-after', String(result.retryAfterSeconds))
      .status(429)
      .send({ error: { code: 'rate_limited', message: 'Too many requests', requestId: request.id } });
  });
}

export function rateLimitRule(method: string, routePath: string, config: ServerConfig): RateLimitRule | null {
  const rule = (defaultMax: number) => ({ windowMs: config.rateLimitWindowMs, max: config.rateLimitMaxRequests ?? defaultMax });
  if (method === 'POST' && routePath === '/v1/requests') return rule(120);
  if (method === 'POST' && routePath === '/v1/devices/pair') return rule(30);
  if (method === 'POST' && routePath === '/v1/auth/mobile-session') return rule(60);
  if (method === 'POST' && routePath === '/v1/mobile-diagnostics') return rule(120);
  if (method === 'POST' && routePath === '/v1/external-approver-invites/:token/accept') return rule(30);
  if (method === 'POST' && routePath === '/v1/audience-channels/:id/subscribe') return rule(60);
  if (method === 'POST' && routePath === '/v1/audience-channels/:id/mute') return rule(60);
  if (method === 'POST' && routePath === '/v1/audience-channels/:id/unsubscribe') return rule(60);
  if (method === 'POST' && routePath === '/v1/audience-requests/:id/responses') return rule(120);
  if (method === 'POST' && routePath === '/v1/pairing-tokens') return rule(60);
  if (method === 'POST' && routePath === '/v1/events/ticket') return rule(60);
  if (method === 'GET' && routePath === '/v1/events/poll') return rule(240);
  return null;
}

function rateLimitKey(request: FastifyRequest, routePath: string): string {
  const bearer = bearerToken(request.headers.authorization);
  const subject = bearer ? `bearer:${hashToken(bearer)}` : `ip:${request.ip}`;
  return `${subject}:${request.method}:${routePath}`;
}

function bearerToken(header: string | undefined): string | null {
  const [scheme, token] = header?.split(/\s+/, 2) ?? [];
  if (scheme?.toLowerCase() !== 'bearer' || !token) return null;
  return token.trim();
}

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('base64url').slice(0, 32);
}

function pruneRateLimitBuckets(buckets: Map<string, { windowStart: number; count: number }>, now: number, windowMs: number): void {
  for (const [key, bucket] of buckets) {
    if (now - bucket.windowStart >= windowMs) buckets.delete(key);
  }
}
