import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import type { AgentTickEnv } from './sessionIdentity.js';

const agentTickModes = ['afk', 'pass-through'] as const;
export type AgentTickMode = typeof agentTickModes[number];
const claudeRoutingPolicies = ['off', 'afk', 'always'] as const;
export type ClaudeRoutingPolicy = typeof claudeRoutingPolicies[number];
export interface AgentTickState {
  mode: AgentTickMode;
  claude?: {
    steering?: ClaudeRoutingPolicy;
    sanctions?: ClaudeRoutingPolicy;
  };
}

export function agentTickStatePath(env: AgentTickEnv = process.env): string {
  if (env.AGENT_TICK_STATE) return env.AGENT_TICK_STATE;
  return path.join(os.homedir(), '.config', 'agent-tick', 'state.json');
}

export function normalizeAgentTickMode(value: string): AgentTickMode {
  const mode = value.trim().toLowerCase();
  if (mode === 'afk') return 'afk';
  if (mode === 'pass-through' || mode === 'passthrough') return 'pass-through';
  throw new Error(`unknown Agent Tick mode: ${value}. Expected afk or pass-through.`);
}

export async function loadAgentTickMode(env: AgentTickEnv = process.env): Promise<AgentTickMode> {
  const envMode = env.AGENT_TICK_MODE;
  if (envMode) return normalizeAgentTickMode(envMode);
  return (await loadAgentTickState(env)).mode;
}

export async function saveAgentTickMode(value: string, env: AgentTickEnv = process.env): Promise<AgentTickMode> {
  const mode = normalizeAgentTickMode(value);
  await saveAgentTickState({ ...(await loadAgentTickState(env)), mode }, env);
  return mode;
}

export async function loadAgentTickState(env: AgentTickEnv = process.env): Promise<AgentTickState> {
  try {
    const parsed = JSON.parse(await fs.readFile(agentTickStatePath(env), 'utf8')) as { mode?: unknown; claude?: unknown };
    const mode = typeof parsed.mode === 'string' ? normalizeAgentTickMode(parsed.mode) : 'pass-through';
    const claude = isPlainObject(parsed.claude) ? parseClaudeRoutingState(parsed.claude) : undefined;
    return { mode, ...(claude && Object.keys(claude).length ? { claude } : {}) };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { mode: 'pass-through' };
    throw error;
  }
}

export async function saveAgentTickState(state: AgentTickState, env: AgentTickEnv = process.env): Promise<void> {
  const statePath = agentTickStatePath(env);
  await fs.mkdir(path.dirname(statePath), { recursive: true, mode: 0o700 });
  await fs.writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
}

function parseClaudeRoutingState(value: Record<string, unknown>): NonNullable<AgentTickState['claude']> {
  const claude: NonNullable<AgentTickState['claude']> = {};
  if (typeof value.steering === 'string') claude.steering = normalizeClaudeRoutingPolicy(value.steering);
  if (typeof value.sanctions === 'string') claude.sanctions = normalizeClaudeRoutingPolicy(value.sanctions);
  return claude;
}

export function normalizeClaudeRoutingPolicy(value: string): ClaudeRoutingPolicy {
  const policy = value.trim().toLowerCase();
  if (claudeRoutingPolicies.includes(policy as ClaudeRoutingPolicy)) return policy as ClaudeRoutingPolicy;
  throw new Error(`unknown Claude Code routing policy: ${value}. Expected off, afk, or always.`);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
