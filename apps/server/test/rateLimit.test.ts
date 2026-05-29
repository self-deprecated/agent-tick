import { describe, expect, it } from 'vitest';
import { rateLimitRule } from '../src/services/rateLimit.js';
import { loadConfig } from '../src/config.js';

const config = loadConfig({ AGENT_TICK_SERVER_URL: 'https://tick.example.test' });

describe('rateLimitRule', () => {
  it('limits external approver invite acceptance and audience participation routes', () => {
    expect(rateLimitRule('POST', '/v1/external-approver-invites/:token/accept', config)).toMatchObject({ max: 30 });
    expect(rateLimitRule('POST', '/v1/audience-channels/:id/subscribe', config)).toMatchObject({ max: 60 });
    expect(rateLimitRule('POST', '/v1/audience-channels/:id/mute', config)).toMatchObject({ max: 60 });
    expect(rateLimitRule('POST', '/v1/audience-channels/:id/unsubscribe', config)).toMatchObject({ max: 60 });
    expect(rateLimitRule('POST', '/v1/audience-requests/:id/responses', config)).toMatchObject({ max: 120 });
  });
});
