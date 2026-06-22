#!/usr/bin/env node

import { execFile } from 'node:child_process';
import { createCipheriv, createECDH, createPrivateKey, createPublicKey, diffieHellman, hkdfSync, randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const defaultBaseURL = 'http://127.0.0.1:3000';
const defaultWorkspaceID = process.env.AGENT_TICK_WORKSPACE_ID ?? '';
const contentAlgorithm = 'aes-256-gcm';
const envelopeAlgorithm = 'p256-ecdh-hkdf-sha256+aes-256-gcm';

const scenarios = [
  {
    key: 'private-encryption',
    sessionTitle: 'Private encryption demo',
    clientName: 'Pi Coding Agent',
    requesterName: 'Social demo lane',
    host: 'demo-mac',
    workingDirectory: '/tmp/agent-tick-demo/private-encryption',
    activity: [
      {
        kind: 'status',
        state: 'working',
        message: 'Started preparing the private encryption release post demo.',
        nextStep: 'Inspect docs and create a private full-reply Status Update.',
        contextUsage: { tokens: 31800, contextWindow: 200000, percent: 15.9 },
      },
      {
        kind: 'tool',
        toolName: 'read',
        state: 'started',
        toolCallId: 'call_private_docs_read',
        summary: 'Reading private encryption docs',
      },
      {
        kind: 'tool',
        toolName: 'read',
        state: 'finished',
        outcome: 'success',
        toolCallId: 'call_private_docs_read',
        summary: 'Read private encryption trust-boundary docs',
        privateDetail: {
          input: 'projects/agent-tick/docs/private-encryption.md',
          outputPreview: 'Server-opaque storage/routing: device private keys stay on Approval Devices; the server stores encrypted payloads plus operational metadata.',
        },
      },
      {
        kind: 'status',
        state: 'working',
        message: 'User message',
        nextStep: 'Draft a founder-led post that explains Agent Tick before the encryption detail.',
        contextUsage: { tokens: 35200, contextWindow: 200000, percent: 17.6 },
        privatePlaintext: {
          schemaVersion: 1,
          kind: 'status_update',
          role: 'user',
          message: 'Create a social post about Agent Tick private encryption, but assume most readers do not know the product yet.',
          body: 'Start with the reason Agent Tick exists: remote steering for coding agents without turning the phone into a remote shell. Then explain source-available/self-hosting as the first trust layer, and private encryption as the new hosted trust-boundary improvement.',
          nextStep: 'Draft a post in Jordan’s voice.',
          presentation: { collapsedByDefault: true, contentFormat: 'markdown' },
        },
      },
      {
        kind: 'status',
        state: 'waiting',
        message: 'Assistant replied',
        nextStep: 'Review encrypted full reply',
        contextUsage: { tokens: 42100, contextWindow: 200000, percent: 21.05 },
        privatePlaintext: {
          schemaVersion: 1,
          kind: 'status_update',
          role: 'assistant',
          message: 'Drafted the private encryption post around remote steering without a remote shell.',
          body: 'I made Agent Tick to let devs steer their coding agents remotely, without turning their phone into a security risk of a remote shell. The trust a developer tool like this needs is huge, so it is source available, self-hostable, and now supports private encrypted Activity for Requests and Status Updates.',
          nextStep: 'Review the final wording and decide whether to publish on LinkedIn first.',
          presentation: { collapsedByDefault: true, contentFormat: 'markdown' },
        },
      },
      {
        kind: 'request',
        private: true,
        requestType: 'steering',
        title: 'Which private encryption post angle should I use?',
        body: 'The post can lead with the product context, the trust boundary, or the implementation details. I recommend opening with Agent Tick as a remote-steering middle ground, then explaining private encryption.',
        defaultChoice: 'product_context',
        choices: [
          { id: 'product_context', label: 'Start with remote steering vs remote shell', kind: 'approve', flags: ['favorite'], tags: ['best for new readers'] },
          { id: 'trust_boundary', label: 'Lead with source-available/self-hosting trust', kind: 'approve', flags: ['thorough'], tags: ['security angle'] },
          { id: 'crypto_details', label: 'Lead with device keys and envelope encryption', kind: 'approve', tags: ['technical'] },
          { id: 'stop', label: 'Stop; I want to rewrite it myself', kind: 'deny', flags: ['blocked'] },
        ],
      },
    ],
  },
  {
    key: 'release',
    sessionTitle: 'iOS release dry run',
    clientName: 'Pi Coding Agent',
    requesterName: 'Release lane',
    host: 'demo-mac',
    workingDirectory: '/tmp/agent-tick-demo/mobile',
    activity: [
      {
        kind: 'status',
        state: 'working',
        message: 'Checked the iOS release checklist and verified commit 8f4c2d1 is ready for a dry-run upload package.',
        nextStep: 'Ask before preparing the App Store upload notes.',
      },
      {
        kind: 'tool',
        toolName: 'bash',
        state: 'finished',
        outcome: 'success',
        toolCallId: 'call_release_check',
        summary: 'Ran iOS release preflight checks',
        privateDetail: {
          command: 'corepack pnpm --filter @agent-tick/mobile test --runInBand',
          outputPreview: 'Focused mobile release checks passed.',
        },
      },
      {
        kind: 'request',
        private: true,
        requestType: 'sanction',
        title: 'Approve preparing the iOS release dry-run package?',
        body: 'This only prepares local release notes and validates the upload bundle. It does not submit to App Store Connect, deploy, delete data, bill users, or contact customers.',
        command: 'corepack pnpm --filter @agent-tick/mobile lint && node scripts/prepare-ios-upload.mjs --dry-run',
        risk: 'low',
        defaultChoice: 'deny',
        choices: [
          { id: 'approve_dry_run', label: 'Approve dry run', kind: 'approve', flags: ['favorite', 'reversible', 'audit_relevant'], tags: ['local only'] },
          { id: 'deny', label: 'Deny', kind: 'deny', flags: ['safest'], tags: ['no action'] },
        ],
      },
    ],
  },
  {
    key: 'flaky-mobile',
    sessionTitle: 'Mobile test stabilization',
    clientName: 'Claude Code',
    requesterName: 'Mobile tests',
    host: 'demo-mac',
    workingDirectory: '/tmp/agent-tick-demo/mobile',
    activity: [
      {
        kind: 'status',
        state: 'blocked',
        message: 'The Session Stack transition test is flaky only on CI; local runs are passing.',
        nextStep: 'Pick whether to patch, instrument, or stop for manual inspection.',
      },
      {
        kind: 'tool',
        toolName: 'bash',
        state: 'finished',
        outcome: 'failed',
        toolCallId: 'call_flaky_ci_repro',
        summary: 'CI-only transition test failed again',
        privateDetail: {
          command: 'corepack pnpm --filter @agent-tick/mobile test SessionStack --runInBand',
          outputPreview: 'Expected opacity transition to settle before lane measurement, received intermediate frame.',
        },
      },
      {
        kind: 'request',
        requestType: 'steering',
        title: 'How should I handle the flaky Session Stack transition test?',
        body: 'I can keep the fix targeted, gather better evidence first, or stop so you can inspect the failure.',
        defaultChoice: 'stop',
        choices: [
          { id: 'deterministic_wait', label: 'Add deterministic wait and rerun focused test', kind: 'approve', flags: ['favorite', 'fastest'], tags: ['small patch'] },
          { id: 'instrument_trace', label: 'Instrument layout trace before changing behavior', kind: 'approve', flags: ['thorough'], tags: ['best evidence'] },
          { id: 'skip_followup', label: 'Skip temporarily and file a follow-up', kind: 'approve', tags: ['temporary'] },
          { id: 'stop', label: 'Stop; I want to inspect the failure first', kind: 'deny', flags: ['blocked'] },
        ],
      },
    ],
  },
  {
    key: 'webhook',
    sessionTitle: 'Stripe webhook entitlement pass',
    clientName: 'Claude Code',
    requesterName: 'Billing lane',
    host: 'demo-mac',
    workingDirectory: '/tmp/agent-tick-demo/server',
    activity: [
      {
        kind: 'status',
        state: 'working',
        message: 'Mapped checkout webhook events to the local entitlement store.',
        nextStep: 'Wire duplicate-event handling.',
      },
      {
        kind: 'tool',
        toolName: 'edit',
        state: 'finished',
        outcome: 'success',
        toolCallId: 'call_webhook_dedupe_edit',
        summary: 'Updated duplicate-event handling',
      },
      {
        kind: 'status',
        state: 'working',
        message: 'Finished wiring duplicate-event handling and started the targeted webhook tests.',
        nextStep: 'Check the admin dashboard flow after tests pass.',
      },
      {
        kind: 'status',
        state: 'waiting',
        message: 'Targeted webhook tests are running; next I will check the admin dashboard flow.',
        nextStep: 'Review duplicate-event assertions before touching dashboard copy.',
      },
    ],
  },
  {
    key: 'docs',
    sessionTitle: 'Setup docs cleanup',
    clientName: 'Pi Coding Agent',
    requesterName: 'Docs lane',
    host: 'demo-mac',
    workingDirectory: '/tmp/agent-tick-demo/docs',
    activity: [
      {
        kind: 'status',
        state: 'working',
        message: 'Updated hosted quick start copy and checked self-hosted pairing links.',
        nextStep: 'Run the docs link check.',
      },
      {
        kind: 'tool',
        toolName: 'bash',
        state: 'finished',
        outcome: 'success',
        toolCallId: 'call_docs_link_check',
        summary: 'Docs link check passed',
      },
      {
        kind: 'status',
        state: 'done',
        message: 'Docs cleanup finished; no product code changed.',
        nextStep: 'Ready for review.',
      },
    ],
  },
];

function usage() {
  return `Seed fake Agent Tick Session Stack data for mobile screenshots and social demos.

Usage:
  corepack pnpm --filter @agent-tick/mobile screenshots:seed-sessions -- [options]

Options:
  --base-url <url>       Agent Tick server URL. Defaults to AGENT_TICK_BASE_URL, AGENT_TICK_SERVER, signed-in CLI config, then ${defaultBaseURL}
  --token <token>        Agent Token. Defaults to AGENT_TICK_TOKEN, AGENT_TICK_AGENT_TOKEN, or signed-in CLI config
  --workspace-id <id>    Workspace header. Defaults to AGENT_TICK_WORKSPACE_ID when set
  --run-id <id>          Stable suffix for explicit Session IDs. Defaults to YYYYMMDD-HHMMSS
  --cli <path>           Installed Agent Tick CLI binary. Defaults to AGENT_TICK_CLI or agent-tick
  --scenario <key>       Seed one scenario only. Available: ${scenarios.map((scenario) => scenario.key).join(', ')}
  --privacy <mode>       private, plain, or auto. Defaults to auto: encrypt when recipient device keys are available, otherwise send safe plaintext demo content.
  --private              Shortcut for --privacy private. Fails if no eligible Approval Device key is registered.
  --plain                Shortcut for --privacy plain.
  --dry-run              Print every planned payload without sending it. Token is not printed.

Notes:
  The script uses the installed agent-tick CLI for Status Updates, Steering Requests,
  and Sanction Requests. Structured Tool Activity and private full-reply Status
  Update bodies use the HTTP API because they are integration surfaces, not
  first-class CLI commands today.
  --help                 Show this help

Examples:
  corepack pnpm --filter @agent-tick/mobile screenshots:seed-sessions -- --base-url https://app.agenttick.sh
  corepack pnpm --filter @agent-tick/mobile screenshots:seed-sessions -- --scenario private-encryption --private
`;
}

async function parseArgs(argv) {
  const cliConfig = await loadCLIConfig();
  const args = {
    baseURL: process.env.AGENT_TICK_BASE_URL ?? process.env.AGENT_TICK_SERVER ?? cliConfig.server ?? defaultBaseURL,
    token: process.env.AGENT_TICK_TOKEN ?? process.env.AGENT_TICK_AGENT_TOKEN ?? cliConfig.token ?? '',
    workspaceID: defaultWorkspaceID,
    runID: timestampRunID(new Date()),
    privacy: normalizePrivacy(process.env.AGENT_TICK_SEED_PRIVACY ?? 'auto'),
    cli: process.env.AGENT_TICK_CLI || 'agent-tick',
    scenario: '',
    dryRun: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--') continue;
    if (arg === '--help' || arg === '-h') {
      console.log(usage());
      process.exit(0);
    }
    if (arg === '--dry-run') {
      args.dryRun = true;
      continue;
    }
    if (arg === '--private') {
      args.privacy = 'private';
      continue;
    }
    if (arg === '--plain') {
      args.privacy = 'plain';
      continue;
    }
    if (arg === '--privacy') {
      args.privacy = normalizePrivacy(requiredValue(argv, ++index, arg));
      continue;
    }
    if (arg === '--scenario') {
      args.scenario = requiredValue(argv, ++index, arg);
      continue;
    }
    if (arg === '--cli') {
      args.cli = requiredValue(argv, ++index, arg);
      continue;
    }
    if (arg === '--base-url') {
      args.baseURL = requiredValue(argv, ++index, arg);
      continue;
    }
    if (arg === '--token') {
      args.token = requiredValue(argv, ++index, arg);
      continue;
    }
    if (arg === '--workspace-id') {
      args.workspaceID = requiredValue(argv, ++index, arg);
      continue;
    }
    if (arg === '--run-id') {
      args.runID = safeRunID(requiredValue(argv, ++index, arg));
      continue;
    }
    throw new Error(`Unknown option: ${arg}\n\n${usage()}`);
  }

  if (args.scenario && !scenarios.some((scenario) => scenario.key === args.scenario)) {
    throw new Error(`Unknown scenario: ${args.scenario}\nAvailable scenarios: ${scenarios.map((scenario) => scenario.key).join(', ')}`);
  }

  args.baseURL = normalizeBaseURL(args.baseURL);
  args.runID = safeRunID(args.runID);
  return args;
}

async function loadCLIConfig() {
  const configPath = process.env.AGENT_TICK_CONFIG || path.join(os.homedir(), '.config', 'agent-tick', 'config.json');
  try {
    const parsed = JSON.parse(await fs.readFile(configPath, 'utf8'));
    return {
      server: typeof parsed.server === 'string' ? parsed.server.trim() : '',
      token: typeof parsed.token === 'string' ? parsed.token.trim() : '',
    };
  } catch (error) {
    if (error?.code === 'ENOENT') return {};
    throw error;
  }
}

function requiredValue(argv, index, option) {
  const value = argv[index];
  if (!value || value.startsWith('--')) throw new Error(`${option} requires a value`);
  return value;
}

function normalizePrivacy(value) {
  const mode = String(value || '').trim().toLowerCase();
  if (mode === 'auto' || mode === 'plain' || mode === 'private') return mode;
  throw new Error(`Invalid privacy mode: ${value}. Expected auto, plain, or private.`);
}

function timestampRunID(now) {
  const pad = (value) => String(value).padStart(2, '0');
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

function safeRunID(value) {
  return String(value).trim().replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || timestampRunID(new Date());
}

function normalizeBaseURL(value) {
  const trimmed = String(value || '').trim();
  if (!trimmed) return defaultBaseURL;
  return trimmed.replace(/\/+$/, '');
}

function selectedScenarios(key) {
  return key ? scenarios.filter((scenario) => scenario.key === key) : scenarios;
}

function buildPlan(runID, scenarioKey = '') {
  return selectedScenarios(scenarioKey).map((scenario) => {
    const sessionId = `store-shots-${runID}-${scenario.key}`;
    const common = {
      threadId: sessionId,
      sessionId,
      session: { title: scenario.sessionTitle },
      metadata: { screenshotRun: runID, screenshotScenario: scenario.key },
    };
    return {
      key: scenario.key,
      sessionId,
      sessionTitle: scenario.sessionTitle,
      payloads: scenario.activity.map((item, index) => buildPayload({ scenario, common, item, index })),
    };
  });
}

function buildPayload({ scenario, common, item, index }) {
  if (item.kind === 'status') {
    return {
      endpoint: '/v1/status-updates',
      privateKind: item.privatePlaintext ? 'status' : undefined,
      privatePlaintext: item.privatePlaintext,
      body: {
        ...common,
        message: item.message,
        state: item.state,
        nextStep: item.nextStep,
        host: scenario.host,
        workingDirectory: scenario.workingDirectory,
        clientName: scenario.clientName,
        ...(item.contextUsage ? { contextUsage: item.contextUsage } : {}),
      },
    };
  }
  if (item.kind === 'tool') {
    return {
      endpoint: '/v1/tool-activities',
      privateKind: item.privateDetail ? 'tool' : undefined,
      privatePlaintext: item.privateDetail ? { schemaVersion: 1, kind: 'tool_activity', detail: item.privateDetail } : undefined,
      body: {
        threadId: common.threadId,
        sessionId: common.sessionId,
        turnId: `${common.sessionId}-turn-1`,
        toolCallId: item.toolCallId ?? `${common.sessionId}-tool-${index + 1}`,
        toolName: item.toolName,
        state: item.state,
        ...(item.outcome ? { outcome: item.outcome } : {}),
        ...(item.summary ? { summary: item.summary } : {}),
        metadata: common.metadata,
      },
    };
  }
  return {
    endpoint: '/v1/requests',
    privateKind: item.private ? 'request' : undefined,
    body: {
      ...common,
      requester: {
        name: scenario.requesterName,
        host: scenario.host,
        workingDirectory: scenario.workingDirectory,
        clientName: scenario.clientName,
      },
      requestType: item.requestType,
      title: item.title,
      body: item.body,
      ...(item.command ? { command: item.command } : {}),
      ...(item.risk ? { risk: item.risk } : {}),
      choices: item.choices,
      defaultChoice: item.defaultChoice,
    },
  };
}

async function preparePayload(args, payload, prepareCache) {
  if (!payload.privateKind || args.privacy === 'plain') return payload.body;

  const prepareEndpoint = payload.privateKind === 'request' ? '/v1/private-requests/prepare' : '/v1/private-status-updates/prepare';
  const prepareBody = payload.privateKind === 'request' ? { requestType: payload.body.requestType } : {};
  const cacheKey = `${prepareEndpoint}:${JSON.stringify(prepareBody)}`;
  let prepared = prepareCache.get(cacheKey);
  if (!prepared) {
    prepared = await postJSON(args, prepareEndpoint, prepareBody);
    prepareCache.set(cacheKey, prepared);
  }

  if (!prepared.deviceKeys?.length) {
    if (args.privacy === 'private') throw new Error(`${prepareEndpoint} returned no device keys. Open the Native App once so it registers a private encryption key, or rerun with --privacy auto/--plain.`);
    return payload.body;
  }

  if (payload.privateKind === 'request') return privateRequestInput(payload.body, prepared);
  return privateActivityInput(payload.body, payload.privatePlaintext, prepared);
}

function privateRequestInput(base, prepared) {
  const choices = base.choices?.length ? base.choices.map(normalizeChoice) : defaultChoices(base.requestType ?? 'sanction');
  const encryptedPayload = encryptPrivatePayload({
    title: base.title,
    ...(base.body ? { body: base.body } : {}),
    ...(base.command ? { command: base.command } : {}),
    choices,
    ...(base.session ? { session: base.session } : {}),
    requestType: base.requestType ?? 'sanction',
  }, prepared.deviceKeys);
  return {
    ...base,
    title: 'Private Request',
    body: undefined,
    command: undefined,
    choices: choices.map((choice) => ({ id: choice.id, kind: choice.kind, label: choice.kind === 'deny' ? 'Deny' : 'Approve' })),
    allowFreeformReply: false,
    contentMode: 'private',
    encryptedPayload,
    privateRecipientVersion: prepared.recipientVersion,
  };
}

function privateActivityInput(base, plaintext, prepared) {
  return {
    ...base,
    contentMode: 'private',
    encryptedPayload: encryptPrivatePayload(plaintext, prepared.deviceKeys),
    privateRecipientVersion: prepared.recipientVersion,
  };
}

function defaultChoices(requestType) {
  if (requestType === 'steering') return [{ id: 'option_a', label: 'Option A', kind: 'approve' }, { id: 'option_b', label: 'Option B', kind: 'approve' }, { id: 'cancel', label: 'Cancel', kind: 'deny' }];
  return [{ id: 'approve', label: 'Approve', kind: 'approve' }, { id: 'deny', label: 'Deny', kind: 'deny' }];
}

function normalizeChoice(choice) {
  return { ...choice, kind: choice.kind ?? 'approve' };
}

function encryptPrivatePayload(plaintext, deviceKeys) {
  const contentKey = randomBytes(32);
  const nonce = randomBytes(12);
  const serialized = Buffer.from(JSON.stringify(plaintext), 'utf8');
  const cipher = createCipheriv(contentAlgorithm, contentKey, nonce);
  const ciphertext = Buffer.concat([cipher.update(serialized), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    version: 1,
    algorithm: contentAlgorithm,
    nonce: b64(nonce),
    ciphertext: b64(ciphertext),
    tag: b64(tag),
    keyEnvelopes: deviceKeys.map((key) => wrapContentKey(contentKey, key)),
  };
}

function wrapContentKey(contentKey, deviceKey) {
  const recipientPublicKey = createPublicKey({ key: Buffer.from(deviceKey.publicKey, 'base64url'), format: 'der', type: 'spki' });
  const ephemeral = createECDH('prime256v1');
  ephemeral.generateKeys();
  const ephemeralPrivateKey = ephemeralKeyPairPrivateKey(ephemeral);
  const sharedSecret = diffieHellman({ privateKey: ephemeralPrivateKey, publicKey: recipientPublicKey });
  const wrappingKey = Buffer.from(hkdfSync('sha256', sharedSecret, Buffer.alloc(0), Buffer.from(`agent-tick-private-request:${deviceKey.deviceKeyId}`, 'utf8'), 32));
  const nonce = randomBytes(12);
  const cipher = createCipheriv(contentAlgorithm, wrappingKey, nonce);
  cipher.setAAD(Buffer.from(deviceKey.deviceKeyId, 'utf8'));
  const ciphertext = Buffer.concat([cipher.update(contentKey), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    deviceKeyId: deviceKey.deviceKeyId,
    algorithm: envelopeAlgorithm,
    ephemeralPublicKey: b64(ephemeralKeyPairPublicSpki(ephemeral)),
    nonce: b64(nonce),
    ciphertext: b64(ciphertext),
    tag: b64(tag),
  };
}

function ephemeralKeyPairPrivateKey(ecdh) {
  const publicKey = ecdh.getPublicKey(undefined, 'uncompressed');
  const jwk = {
    kty: 'EC',
    crv: 'P-256',
    x: b64(publicKey.subarray(1, 33)),
    y: b64(publicKey.subarray(33, 65)),
    d: b64(ecdh.getPrivateKey()),
  };
  return createPrivateKey({ key: jwk, format: 'jwk' });
}

function ephemeralKeyPairPublicSpki(ecdh) {
  const key = createPublicKey(ephemeralKeyPairPrivateKey(ecdh));
  return key.export({ format: 'der', type: 'spki' });
}

function b64(value) {
  return Buffer.from(value).toString('base64url');
}

async function postJSON({ baseURL, token, workspaceID }, endpoint, body) {
  const response = await fetch(`${baseURL}${endpoint}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      ...(workspaceID ? { 'x-agent-tick-workspace-id': workspaceID } : {}),
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  const parsed = text ? parseJSON(text) : null;
  if (!response.ok) {
    const detail = parsed ? JSON.stringify(parsed, null, 2) : text;
    throw new Error(`${endpoint} failed with HTTP ${response.status}\n${detail}`);
  }
  return parsed;
}

function parseJSON(text) {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function summarizeCreated(endpoint, result) {
  if (endpoint === '/v1/status-updates') return `${result?.statusId ?? result?.statusUpdate?.statusId ?? '(status created)'}${(result?.contentMode ?? result?.statusUpdate?.contentMode) === 'private' ? ' private' : ''}`;
  if (endpoint === '/v1/tool-activities') return `${result?.toolActivityId ?? '(tool activity created)'}${result?.contentMode === 'private' ? ' private' : ''}`;
  if (endpoint === '/v1/requests') return `${result?.request?.id ?? '(request created)'}${result?.request?.contentMode === 'private' ? ' private' : ''}`;
  return '(created)';
}

function shouldUseCLI(payload) {
  if (payload.endpoint === '/v1/requests') return true;
  return payload.endpoint === '/v1/status-updates' && !payload.privatePlaintext;
}

async function sendPayload(args, payload, prepareCache) {
  if (shouldUseCLI(payload)) return runAgentTickCLI(args, payload);
  const body = await preparePayload(args, payload, prepareCache);
  return postJSON(args, payload.endpoint, body);
}

async function runAgentTickCLI(args, payload) {
  const cliArgs = cliArgsForPayload(args, payload);
  const env = {
    ...process.env,
    AGENT_TICK_SERVER: args.baseURL,
    AGENT_TICK_TOKEN: args.token,
    ...(args.workspaceID ? { AGENT_TICK_WORKSPACE_ID: args.workspaceID } : {}),
  };
  const { stdout, stderr } = await execFileAsync(args.cli, cliArgs, { env, maxBuffer: 1024 * 1024 });
  if (stderr.trim()) process.stderr.write(stderr);
  return parseLastJSONLine(stdout) ?? { cli: stdout.trim() };
}

function cliArgsForPayload(args, payload) {
  const body = payload.body;
  const common = [
    '--server', args.baseURL,
    '--token', args.token,
    '--session', body.sessionId,
    '--session-title', body.session?.title ?? body.sessionId,
  ];
  const clientName = body.clientName ?? body.requester?.clientName;
  if (clientName) common.push('--client-name', clientName);
  common.push(...privacyCLIArgs(args, payload));

  if (payload.endpoint === '/v1/status-updates') {
    const cliArgs = ['send', 'status', ...common, '--state', body.state ?? 'working', '--json'];
    for (const [key, value] of Object.entries(body.metadata ?? {})) cliArgs.push('--metadata', `${key}=${value}`);
    if (body.nextStep) cliArgs.push('--next', body.nextStep);
    cliArgs.push(body.message);
    return cliArgs;
  }

  if (body.requestType === 'steering') {
    const cliArgs = ['send', 'steering', ...common, '--title', body.title, '--timeout', '0', '--json'];
    if (body.body) cliArgs.push('--body', body.body);
    for (const choice of body.choices ?? []) {
      cliArgs.push('--choice', choice.kind && choice.kind !== 'approve' ? `${choice.id}:${choice.kind}=${choice.label}` : `${choice.id}=${choice.label}`);
      for (const flag of choice.flags ?? []) cliArgs.push('--choice-flag', `${choice.id}=${flag}`);
      for (const tag of choice.tags ?? []) cliArgs.push('--choice-tag', `${choice.id}=${tag}`);
    }
    return cliArgs;
  }

  const cliArgs = ['send', 'sanction', ...common, '--title', body.title, '--timeout', '0', '--json'];
  if (body.body) cliArgs.push('--body', body.body);
  if (body.command) cliArgs.push('--command', body.command);
  for (const choice of body.choices ?? []) {
    const id = choice.kind === 'deny' ? 'deny' : 'approve';
    for (const flag of choice.flags ?? []) cliArgs.push('--choice-flag', `${id}=${flag}`);
    for (const tag of choice.tags ?? []) cliArgs.push('--choice-tag', `${id}=${tag}`);
  }
  return cliArgs;
}

function privacyCLIArgs(args, payload) {
  if (args.privacy === 'plain') return ['--plain'];
  if (args.privacy === 'private' || payload.privateKind) return ['--private'];
  return [];
}

function parseLastJSONLine(output) {
  const lines = output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      return JSON.parse(lines[index]);
    } catch {
      // Keep scanning: human-readable lines may precede JSON output.
    }
  }
  return null;
}

async function main() {
  const args = await parseArgs(process.argv.slice(2));
  const plan = buildPlan(args.runID, args.scenario);

  if (args.dryRun) {
    console.log(JSON.stringify({ baseURL: args.baseURL, workspaceID: args.workspaceID || undefined, token: args.token ? '(configured)' : '(missing)', runID: args.runID, privacy: args.privacy, cli: args.cli, sessions: plan }, null, 2));
    return;
  }

  if (!args.token) {
    throw new Error(`Missing Agent Token. Set AGENT_TICK_TOKEN or pass --token.\n\n${usage()}`);
  }

  console.log(`Seeding Agent Tick mobile screenshot/demo Sessions into ${args.baseURL}`);
  if (args.workspaceID) console.log(`Workspace: ${args.workspaceID}`);
  console.log(`Screenshot run: ${args.runID}`);
  console.log(`Privacy mode: ${args.privacy}`);
  console.log(`CLI: ${args.cli}`);

  const prepareCache = new Map();
  for (const session of plan) {
    console.log(`\n${session.sessionTitle}`);
    console.log(`  logical sessionId: ${session.sessionId}`);
    for (const payload of session.payloads) {
      const transport = shouldUseCLI(payload) ? 'cli' : 'api';
      const result = await sendPayload(args, payload, prepareCache);
      console.log(`  ${transport} ${payload.endpoint}: ${summarizeCreated(payload.endpoint, result)}`);
      await sleep(250);
    }
  }

  console.log('\nDone. Open the mobile app, pull to refresh if needed, and capture the Session Stack / Session Lane views.');
  console.log('Tip: use a fresh --run-id when you want a new top-of-stack dataset.');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
