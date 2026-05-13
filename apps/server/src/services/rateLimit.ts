import type { FastifyInstance } from 'fastify';
import type { ServerConfig } from '../config.js';

export interface RateLimitRule {
  windowMs: number;
  max: number;
}

export interface RateLimiter {
  check(key: string, rule: RateLimitRule, now?: number): { allowed: true } | { allowed: false; retryAfterSeconds: number };
}

export function createMemoryRateLimiter(): RateLimiter {
  const buckets = new Map<string, { windowStart: number; count: number }>();

  return {
    check(key, rule, now = Date.now()) {
      const existing = buckets.get(key);
      const bucket = existing && now - existing.windowStart < rule.windowMs ? existing : { windowStart: now, count: 0 };
      bucket.count += 1;
      buckets.set(key, bucket);

      if (buckets.size > 1000) pruneRateLimitBuckets(buckets, now, rule.windowMs);

      if (bucket.count <= rule.max) return { allowed: true };
      const retryAfterSeconds = Math.max(1, Math.ceil((rule.windowMs - (now - bucket.windowStart)) / 1000));
      return { allowed: false, retryAfterSeconds };
    }
  };
}

export function registerRateLimitHook(app: FastifyInstance, config: ServerConfig, rateLimiter: RateLimiter = createMemoryRateLimiter()): void {
  app.addHook('preHandler', async (request, reply) => {
    const routePath = request.routeOptions.url ?? request.url.split('?', 1)[0] ?? request.url;
    const rule = rateLimitRule(request.method, routePath, config);
    if (!rule) return;

    const key = `${request.ip}:${request.method}:${routePath}`;
    const result = rateLimiter.check(key, rule);
    if (result.allowed) return;

    return reply
      .header('retry-after', String(result.retryAfterSeconds))
      .status(429)
      .send({ error: { code: 'rate_limited', message: 'Too many requests', requestId: request.id } });
  });
}

export function rateLimitRule(method: string, routePath: string, config: ServerConfig): RateLimitRule | null {
  const rule = (defaultMax: number) => ({ windowMs: config.rateLimitWindowMs, max: config.rateLimitMaxRequests ?? defaultMax });
  if (method === 'GET' && routePath === '/v1/invites/:token') return rule(30);
  if (method === 'POST' && routePath === '/v1/invites/:token/accept') return rule(30);
  if (method === 'POST' && routePath === '/v1/devices/pair') return rule(30);
  if (method === 'POST' && routePath === '/v1/auth/mobile-session') return rule(60);
  if (method === 'POST' && routePath === '/v1/mobile-diagnostics') return rule(120);
  if (method === 'POST' && routePath === '/v1/pairing-tokens') return rule(60);
  if (method === 'POST' && routePath === '/v1/events/ticket') return rule(60);
  if (method === 'GET' && routePath === '/v1/events/poll') return rule(240);
  return null;
}

function pruneRateLimitBuckets(buckets: Map<string, { windowStart: number; count: number }>, now: number, windowMs: number): void {
  for (const [key, bucket] of buckets) {
    if (now - bucket.windowStart >= windowMs) buckets.delete(key);
  }
}
