import { afterEach, describe, expect, it, vi } from 'vitest';
import { AgentTickStore } from '@agent-tick/db';
import { loadConfig } from '../src/config.js';
import { clearClerkProfileCacheForTests, verifyClerkSession } from '../src/auth/clerk.js';

const clerkMocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  verifyToken: vi.fn()
}));

vi.mock('@clerk/backend', () => ({
  createClerkClient: vi.fn(() => ({ users: { getUser: clerkMocks.getUser } })),
  verifyToken: clerkMocks.verifyToken
}));

let store: AgentTickStore | undefined;

afterEach(() => {
  store?.close();
  store = undefined;
  clearClerkProfileCacheForTests();
  vi.clearAllMocks();
  vi.useRealTimers();
});

function testStore(): AgentTickStore {
  const next = AgentTickStore.open({ databaseURL: ':memory:' });
  next.migrate();
  next.ensureSingleTenantDefaults('2026-05-08T00:00:00.000Z');
  store = next;
  return next;
}

describe('Clerk authentication', () => {
  it('caches Clerk user profile lookups for verified sessions', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-08T00:00:00.000Z'));
    clerkMocks.verifyToken.mockResolvedValue({ sub: 'user_123', iss: 'https://clerk.example', sid: 'sess_123' });
    clerkMocks.getUser.mockResolvedValue({
      id: 'user_123',
      firstName: 'Ada',
      lastName: 'Lovelace',
      username: null,
      primaryEmailAddressId: 'email_123',
      emailAddresses: [{ id: 'email_123', emailAddress: 'ada@example.com', verification: { status: 'verified' } }]
    });
    const config = loadConfig({
      AGENT_TICK_MODE: 'clerk',
      AGENT_TICK_CLERK_PUBLISHABLE_KEY: 'pk_test_123',
      AGENT_TICK_CLERK_SECRET_KEY: 'sk_test_secret'
    });
    const db = testStore();
    const token = 'header.payload.signature';

    await expect(verifyClerkSession(token, config, db)).resolves.toMatchObject({ userId: expect.stringMatching(/^usr_/), providerSubject: 'user_123' });
    await expect(verifyClerkSession(token, config, db)).resolves.toMatchObject({ providerSubject: 'user_123' });
    expect(clerkMocks.getUser).toHaveBeenCalledTimes(1);

    vi.setSystemTime(new Date('2026-05-08T00:01:01.000Z'));
    await verifyClerkSession(token, config, db);
    expect(clerkMocks.getUser).toHaveBeenCalledTimes(2);
  });
});
