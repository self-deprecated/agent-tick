import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export interface ClientConfig {
  server: string;
  token: string;
}

export async function loadClientConfig(env: NodeJS.ProcessEnv = process.env): Promise<Partial<ClientConfig>> {
  const configPath = clientConfigPath(env);
  try {
    const raw = await fs.readFile(configPath, 'utf8');
    const parsed = JSON.parse(raw) as Partial<ClientConfig>;
    return {
      server: normalizeServer(parsed.server ?? ''),
      token: (parsed.token ?? '').trim()
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw error;
  }
}

export async function saveClientConfig(config: ClientConfig, env: NodeJS.ProcessEnv = process.env): Promise<string> {
  const configPath = clientConfigPath(env);
  await fs.mkdir(path.dirname(configPath), { recursive: true, mode: 0o700 });
  await fs.writeFile(
    configPath,
    `${JSON.stringify({ server: normalizeServer(config.server), token: config.token.trim() }, null, 2)}\n`,
    { mode: 0o600 }
  );
  return configPath;
}

export async function resolveServerAndToken(options: { server?: string; token?: string }, env: NodeJS.ProcessEnv = process.env): Promise<ClientConfig> {
  const config = await loadClientConfig(env);
  const server = normalizeServer(options.server ?? env.AGENT_TICK_SERVER ?? config.server ?? 'http://localhost:8787');
  const token = (options.token ?? env.AGENT_TICK_TOKEN ?? config.token ?? '').trim();
  if (!token) throw new Error('Agent token is required. Run `agent-tick setup --server <url> --token <token>` or set AGENT_TICK_TOKEN.');
  return { server, token };
}

export function clientConfigPath(env: NodeJS.ProcessEnv = process.env): string {
  if (env.AGENT_TICK_CONFIG) return env.AGENT_TICK_CONFIG;
  return path.join(os.homedir(), '.config', 'agent-tick', 'config.json');
}

function normalizeServer(server: string): string {
  return server.trim().replace(/\/+$/, '');
}
