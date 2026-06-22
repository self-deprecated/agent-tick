import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { createProgram } from '../src/index.js';

const envKeys = ['AGENT_TICK_PRIVATE_REQUESTS', 'AGENT_TICK_FEATURES_CONFIG'];
let restoreStdout: (() => void) | undefined;

afterEach(() => {
  restoreStdout?.();
  restoreStdout = undefined;
  for (const key of envKeys) delete process.env[key];
  process.exitCode = undefined;
});

describe('CLI Private Request command flow', () => {
  it('prepares, encrypts, and creates a Private Request for --private', async () => {
    const fixture = await privateRequestCommandFixture();
    try {
      await runSanctionCommand(fixture.url, ['--private']);

      expect(fixture.requests.map((request) => `${request.method} ${request.url}`)).toEqual([
        'POST /v1/private-requests/prepare',
        'POST /v1/requests'
      ]);
      const created = fixture.requests[1]!.body as Record<string, any>;
      expect(created).toMatchObject({ title: 'Private Request', contentMode: 'private', allowFreeformReply: false, privateRecipientVersion: 'version_1', metadata: { agentTickCliVersion: '1.4.0' } });
      expect(created.encryptedPayload.keyEnvelopes).toEqual([expect.objectContaining({ deviceKeyId: 'devkey_cli' })]);
      expect(JSON.stringify(created)).not.toContain('Secret CLI action');
      expect(JSON.stringify(created)).not.toContain('Hidden CLI body');
    } finally {
      await fixture.close();
    }
  });

  it('encrypts send status command content with --private', async () => {
    const fixture = await privateRequestCommandFixture();
    try {
      await runStatusUpdateCommand(fixture.url, ['--private']);

      expect(fixture.requests.map((request) => `${request.method} ${request.url}`)).toEqual([
        'POST /v1/private-status-updates/prepare',
        'POST /v1/status-updates'
      ]);
      const created = fixture.requests[1]!.body as Record<string, any>;
      expect(created).toMatchObject({ message: 'Private Status Update', state: 'working', contentMode: 'private', privateRecipientVersion: 'version_1', metadata: { agentTickCliVersion: '1.4.0' } });
      expect(created.nextStep).toBeUndefined();
      expect(created.encryptedPayload.keyEnvelopes).toEqual([expect.objectContaining({ deviceKeyId: 'devkey_cli' })]);
      expect(JSON.stringify(created)).not.toContain('Secret status detail');
      expect(JSON.stringify(created)).not.toContain('Hidden next step');
    } finally {
      await fixture.close();
    }
  });

  it('uses AGENT_TICK_PRIVATE_REQUESTS=always without the --private flag', async () => {
    process.env.AGENT_TICK_PRIVATE_REQUESTS = 'always';
    const fixture = await privateRequestCommandFixture();
    try {
      await runSanctionCommand(fixture.url, []);

      expect(fixture.requests.map((request) => `${request.method} ${request.url}`)).toEqual([
        'POST /v1/private-requests/prepare',
        'POST /v1/requests'
      ]);
      expect(fixture.requests[1]!.body).toMatchObject({ title: 'Private Request', contentMode: 'private' });
    } finally {
      await fixture.close();
    }
  });

  it('supports send namespace commands', async () => {
    const fixture = await privateRequestCommandFixture();
    try {
      await runStatusUpdateCommand(fixture.url, [], ['send', 'status']);
      await runSteeringCommand(fixture.url, [], ['send', 'steering']);
      await runSanctionCommand(fixture.url, [], ['send', 'sanction']);

      expect(fixture.requests.filter((request) => request.url === '/v1/status-updates')).toHaveLength(1);
      expect(fixture.requests.filter((request) => request.url === '/v1/requests')).toHaveLength(2);
    } finally {
      await fixture.close();
    }
  });

  it('uses saved private defaults and lets --plain override them for status updates', async () => {
    await writeFeaturePrivacyDefault('private');
    const fixture = await privateRequestCommandFixture();
    try {
      await runStatusUpdateCommand(fixture.url, [], ['send', 'status']);
      expect(fixture.requests.map((request) => `${request.method} ${request.url}`)).toEqual([
        'POST /v1/private-status-updates/prepare',
        'POST /v1/status-updates'
      ]);
      fixture.requests.length = 0;
      await runStatusUpdateCommand(fixture.url, ['--plain'], ['send', 'status']);
      expect(fixture.requests.map((request) => `${request.method} ${request.url}`)).toEqual(['POST /v1/status-updates']);
      expect(fixture.requests[0]!.body).toMatchObject({ message: 'Secret status detail' });
    } finally {
      await fixture.close();
    }
  });

  it('applies saved private defaults to send steering and send sanction', async () => {
    await writeFeaturePrivacyDefault('private');
    const fixture = await privateRequestCommandFixture();
    try {
      await runSteeringCommand(fixture.url, [], ['send', 'steering']);
      await runSanctionCommand(fixture.url, [], ['send', 'sanction']);

      expect(fixture.requests.map((request) => `${request.method} ${request.url}`)).toEqual([
        'POST /v1/private-requests/prepare',
        'POST /v1/requests',
        'POST /v1/private-requests/prepare',
        'POST /v1/requests'
      ]);
      const createdRequests = fixture.requests.filter((request) => request.url === '/v1/requests').map((request) => request.body as Record<string, any>);
      expect(createdRequests.every((request) => request.title === 'Private Request' && request.contentMode === 'private')).toBe(true);
      expect(JSON.stringify(createdRequests)).not.toContain('Secret steering choice');
      expect(JSON.stringify(createdRequests)).not.toContain('Secret CLI action');
    } finally {
      await fixture.close();
    }
  });

  it('lets --plain override legacy env private mode for all send commands', async () => {
    process.env.AGENT_TICK_PRIVATE_REQUESTS = 'always';
    const fixture = await privateRequestCommandFixture();
    try {
      await runStatusUpdateCommand(fixture.url, ['--plain'], ['send', 'status']);
      await runSteeringCommand(fixture.url, ['--plain'], ['send', 'steering']);
      await runSanctionCommand(fixture.url, ['--plain'], ['send', 'sanction']);

      expect(fixture.requests.map((request) => `${request.method} ${request.url}`)).toEqual([
        'POST /v1/status-updates',
        'POST /v1/requests',
        'POST /v1/requests'
      ]);
      expect(fixture.requests[0]!.body).toMatchObject({ message: 'Secret status detail' });
      expect(fixture.requests[1]!.body).toMatchObject({ title: 'Secret steering choice', contentMode: 'plain' });
      expect(fixture.requests[2]!.body).toMatchObject({ title: 'Secret CLI action', body: 'Hidden CLI body', contentMode: 'plain' });
    } finally {
      await fixture.close();
    }
  });

  it('rejects conflicting private and plain flags before sending Activity', async () => {
    const fixture = await privateRequestCommandFixture();
    try {
      await expect(createProgram().parseAsync([
        'send', 'status',
        '--server', fixture.url,
        '--token', 'agent_cli_private',
        '--private',
        '--plain',
        'Secret status detail'
      ], { from: 'user' })).rejects.toThrow(/choose only one of --private or --plain/);
      expect(fixture.requests).toEqual([]);
    } finally {
      await fixture.close();
    }
  });
});

async function writeFeaturePrivacyDefault(contentMode: 'plain' | 'private') {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-tick-private-default-'));
  const featuresPath = path.join(root, 'features.json');
  await fs.writeFile(featuresPath, JSON.stringify({ privacy: { defaultContentMode: contentMode } }));
  process.env.AGENT_TICK_FEATURES_CONFIG = featuresPath;
}

async function runStatusUpdateCommand(serverURL: string, extraArgs: string[], commandName = ['send', 'status']) {
  const writes: string[] = [];
  const originalWrite = process.stdout.write;
  process.stdout.write = ((chunk: string | Uint8Array) => {
    writes.push(String(chunk));
    return true;
  }) as typeof process.stdout.write;
  try {
    await createProgram().parseAsync([
      ...commandName,
      '--server', serverURL,
      '--token', 'agent_cli_private',
      '--next', 'Hidden next step',
      '--json',
      ...extraArgs,
      'Secret status detail',
    ], { from: 'user' });
  } finally {
    process.stdout.write = originalWrite;
    restoreStdout = undefined;
  }
  expect(writes.join('')).toContain('"event":"status_update"');
}

async function runSteeringCommand(serverURL: string, extraArgs: string[], commandName = ['send', 'steering']) {
  const writes: string[] = [];
  const originalWrite = process.stdout.write;
  process.stdout.write = ((chunk: string | Uint8Array) => {
    writes.push(String(chunk));
    return true;
  }) as typeof process.stdout.write;
  try {
    await createProgram().parseAsync([
      ...commandName,
      '--server', serverURL,
      '--token', 'agent_cli_private',
      '--title', 'Secret steering choice',
      '--choice', 'small=Small',
      '--choice', 'cancel:deny=Cancel',
      '--timeout', '0',
      '--json',
      ...extraArgs
    ], { from: 'user' });
  } finally {
    process.stdout.write = originalWrite;
    restoreStdout = undefined;
  }
  expect(writes.join('')).toContain('"event":"created"');
}

async function runSanctionCommand(serverURL: string, extraArgs: string[], commandName = ['send', 'sanction']) {
  const writes: string[] = [];
  const originalWrite = process.stdout.write;
  process.stdout.write = ((chunk: string | Uint8Array) => {
    writes.push(String(chunk));
    return true;
  }) as typeof process.stdout.write;
  try {
    await createProgram().parseAsync([
      ...commandName,
      '--server', serverURL,
      '--token', 'agent_cli_private',
      '--title', 'Secret CLI action',
      '--body', 'Hidden CLI body',
      '--timeout', '0',
      '--json',
      ...extraArgs
    ], { from: 'user' });
  } finally {
    process.stdout.write = originalWrite;
    restoreStdout = undefined;
  }
  expect(writes.join('')).toContain('"event":"created"');
}

async function privateRequestCommandFixture(): Promise<{ url: string; requests: Array<{ method: string; url: string; body: unknown; authorization?: string }>; close: () => Promise<void> }> {
  const { publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const publicKeySPKI = Buffer.from(publicKey.export({ format: 'der', type: 'spki' })).toString('base64url');
  const requests: Array<{ method: string; url: string; body: unknown; authorization?: string }> = [];
  const server = createServer(async (request, response) => {
    const body = await readBody(request);
    requests.push({ method: request.method ?? 'GET', url: request.url ?? '/', body, authorization: request.headers.authorization });
    response.setHeader('content-type', 'application/json');
    if ((request.url === '/v1/private-requests/prepare' || request.url === '/v1/private-status-updates/prepare') && request.method === 'POST') {
      response.end(JSON.stringify({
        contentMode: 'private',
        workspaceId: 'wsp_cli',
        required: false,
        recipientVersion: 'version_1',
        recipientUserIds: ['usr_cli'],
        unavailableRecipients: [],
        deviceKeys: [{
          deviceKeyId: 'devkey_cli',
          deviceId: 'dev_cli',
          userId: 'usr_cli',
          algorithm: 'p256-ecdh-hkdf-sha256',
          publicKey: publicKeySPKI,
          publicKeyFingerprint: 'fingerprint_cli',
          createdAt: '2026-06-12T00:00:00.000Z',
          updatedAt: '2026-06-12T00:00:00.000Z'
        }]
      }));
      return;
    }
    if (request.url === '/v1/status-updates' && request.method === 'POST') {
      const input = body as Record<string, any>;
      response.end(JSON.stringify({
        statusId: 'stat_cli_private',
        workspaceId: 'wsp_cli',
        threadId: input.threadId,
        sessionId: input.sessionId,
        message: input.message,
        state: input.state,
        nextStep: input.nextStep,
        host: input.host,
        workingDirectory: input.workingDirectory,
        clientName: input.clientName,
        metadata: input.metadata ?? {},
        contentMode: input.contentMode,
        encryptedPayload: input.encryptedPayload,
        privateRecipientVersion: input.privateRecipientVersion,
        recipientUserIds: ['usr_cli'],
        createdAt: '2026-06-12T00:00:00.000Z'
      }));
      return;
    }
    if (request.url === '/v1/requests' && request.method === 'POST') {
      const input = body as Record<string, any>;
      response.end(JSON.stringify({
        request: {
          id: 'req_cli_private',
          workspaceId: 'wsp_cli',
          requester: input.requester,
          requestType: input.requestType ?? 'sanction',
          deliveryKind: input.deliveryKind ?? 'routed_members',
          responsePolicy: input.responsePolicy ?? 'quorum',
          title: input.title,
          choices: input.choices ?? [],
          questions: input.questions ?? [],
          allowFreeformReply: input.allowFreeformReply ?? false,
          contentMode: input.contentMode ?? 'plain',
          encryptedPayload: input.encryptedPayload,
          privateRecipientVersion: input.privateRecipientVersion,
          status: 'pending',
          createdAt: '2026-06-12T00:00:00.000Z'
        }
      }));
      return;
    }
    response.statusCode = 404;
    response.end(JSON.stringify({ error: { code: 'not_found', message: 'not found' } }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('test server did not bind to a TCP port');
  return {
    url: `http://127.0.0.1:${address.port}`,
    requests,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  };
}

function readBody(request: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    request.on('error', reject);
    request.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      if (!text) return resolve(undefined);
      try {
        resolve(JSON.parse(text));
      } catch (error) {
        reject(error);
      }
    });
  });
}
