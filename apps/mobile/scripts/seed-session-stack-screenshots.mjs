#!/usr/bin/env node

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const defaultBaseURL = 'http://127.0.0.1:3000';
const defaultWorkspaceID = process.env.AGENT_TICK_WORKSPACE_ID ?? '';

const scenarios = [
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
        kind: 'request',
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
        kind: 'status',
        state: 'done',
        message: 'Docs cleanup finished; no product code changed.',
        nextStep: 'Ready for review.',
      },
    ],
  },
];

function usage() {
  return `Seed fake Agent Tick Session Stack data for mobile screenshots.

Usage:
  corepack pnpm --filter @agent-tick/mobile screenshots:seed-sessions -- [options]

Options:
  --base-url <url>       Agent Tick server URL. Defaults to AGENT_TICK_BASE_URL, AGENT_TICK_SERVER, signed-in CLI config, then ${defaultBaseURL}
  --token <token>        Agent Token. Defaults to AGENT_TICK_TOKEN, AGENT_TICK_AGENT_TOKEN, or signed-in CLI config
  --workspace-id <id>    Workspace header. Defaults to AGENT_TICK_WORKSPACE_ID when set
  --run-id <id>          Stable suffix for explicit Session IDs. Defaults to YYYYMMDD-HHMMSS
  --dry-run              Print every payload without sending it. Token is not printed.
  --help                 Show this help

Example:
  corepack pnpm --filter @agent-tick/mobile screenshots:seed-sessions -- --base-url https://app.agenttick.sh
`;
}

async function parseArgs(argv) {
  const cliConfig = await loadCLIConfig();
  const args = {
    baseURL: process.env.AGENT_TICK_BASE_URL ?? process.env.AGENT_TICK_SERVER ?? cliConfig.server ?? defaultBaseURL,
    token: process.env.AGENT_TICK_TOKEN ?? process.env.AGENT_TICK_AGENT_TOKEN ?? cliConfig.token ?? '',
    workspaceID: defaultWorkspaceID,
    runID: timestampRunID(new Date()),
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

function buildPlan(runID) {
  return scenarios.map((scenario) => {
    const sessionId = `store-shots-${runID}-${scenario.key}`;
    const common = {
      sessionId,
      session: { title: scenario.sessionTitle },
      metadata: { screenshotRun: runID, screenshotScenario: scenario.key },
    };
    return {
      key: scenario.key,
      sessionId,
      sessionTitle: scenario.sessionTitle,
      payloads: scenario.activity.map((item) => {
        if (item.kind === 'status') {
          return {
            endpoint: '/v1/status-updates',
            body: {
              ...common,
              message: item.message,
              state: item.state,
              nextStep: item.nextStep,
              host: scenario.host,
              workingDirectory: scenario.workingDirectory,
              clientName: scenario.clientName,
            },
          };
        }
        return {
          endpoint: '/v1/requests',
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
      }),
    };
  });
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
  if (endpoint === '/v1/status-updates') return result?.statusId ?? '(status created)';
  if (endpoint === '/v1/requests') return result?.request?.id ?? '(request created)';
  return '(created)';
}

async function main() {
  const args = await parseArgs(process.argv.slice(2));
  const plan = buildPlan(args.runID);

  if (args.dryRun) {
    console.log(JSON.stringify({ baseURL: args.baseURL, workspaceID: args.workspaceID || undefined, token: args.token ? '(configured)' : '(missing)', runID: args.runID, sessions: plan }, null, 2));
    return;
  }

  if (!args.token) {
    throw new Error(`Missing Agent Token. Set AGENT_TICK_TOKEN or pass --token.\n\n${usage()}`);
  }

  console.log(`Seeding Agent Tick mobile screenshot Sessions into ${args.baseURL}`);
  if (args.workspaceID) console.log(`Workspace: ${args.workspaceID}`);
  console.log(`Screenshot run: ${args.runID}`);

  for (const session of plan) {
    console.log(`\n${session.sessionTitle}`);
    console.log(`  logical sessionId: ${session.sessionId}`);
    for (const payload of session.payloads) {
      const result = await postJSON(args, payload.endpoint, payload.body);
      console.log(`  ${payload.endpoint}: ${summarizeCreated(payload.endpoint, result)}`);
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
