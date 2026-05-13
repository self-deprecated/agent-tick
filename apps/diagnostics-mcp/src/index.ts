#!/usr/bin/env node
import process from 'node:process';
import { AgentTickStore } from '@agent-tick/db';

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: string | number | null;
  method: string;
  params?: unknown;
}

interface McpTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  call: (args: Record<string, unknown>) => Promise<{ content: Array<{ type: 'text'; text: string }> }>;
}

const VERSION = '0.1.0';
const databaseURL = optionValue('--database') ?? process.env.AGENT_TICK_DATABASE_URL ?? 'file:./agent-tick.db';
const store = AgentTickStore.open({ databaseURL });

process.on('exit', () => store.close());
process.on('SIGINT', () => process.exit(130));
process.on('SIGTERM', () => process.exit(143));

function listMobileDiagnostics(args: Record<string, unknown>): unknown[] {
  const limit = clampNumber(args.limit, 100, 1, 1000);
  const filters: string[] = [];
  const params: unknown[] = [];
  if (typeof args.organizationId === 'string' && args.organizationId.trim()) {
    filters.push('organization_id = ?');
    params.push(args.organizationId.trim());
  }
  if (typeof args.userId === 'string' && args.userId.trim()) {
    filters.push('user_id = ?');
    params.push(args.userId.trim());
  }
  if (typeof args.area === 'string' && args.area.trim()) {
    filters.push('area = ?');
    params.push(args.area.trim());
  }
  params.push(limit);
  const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
  const rows = store.db.prepare(`
    SELECT diagnostic_id, organization_id, user_id, device_id, level, area, message, metadata_json, created_at
    FROM mobile_diagnostics
    ${where}
    ORDER BY created_at DESC
    LIMIT ?
  `).all(...params) as MobileDiagnosticRow[];
  return rows.map(mapDiagnosticRow);
}

function summarizeDiagnostics(args: Record<string, unknown>): Record<string, unknown> {
  const rows = listMobileDiagnostics({ limit: clampNumber(args.limit, 500, 1, 2000) }) as Array<Record<string, unknown>>;
  return {
    total: rows.length,
    byUser: countBy(rows, 'userId'),
    byArea: countBy(rows, 'area'),
    byMessage: countBy(rows, 'message'),
    byLevel: countBy(rows, 'level'),
    newestAt: rows[0]?.createdAt,
    oldestAt: rows.at(-1)?.createdAt
  };
}

function countBy(rows: Array<Record<string, unknown>>, key: string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const row of rows) {
    const value = String(row[key] ?? '');
    counts[value] = (counts[value] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort((a, b) => b[1] - a[1]));
}

function mapDiagnosticRow(row: MobileDiagnosticRow): Record<string, unknown> {
  return {
    diagnosticId: row.diagnostic_id,
    organizationId: row.organization_id,
    userId: row.user_id,
    ...(row.device_id ? { deviceId: row.device_id } : {}),
    level: row.level,
    area: row.area,
    message: row.message,
    metadata: parseJSON(row.metadata_json),
    createdAt: row.created_at
  };
}

function parseJSON(raw: string | null): unknown {
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as JsonValue;
  } catch {
    return raw;
  }
}

function clampNumber(value: unknown, defaultValue: number, min: number, max: number): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return defaultValue;
  return Math.min(Math.max(Math.trunc(parsed), min), max);
}

function optionValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  const value = index === -1 ? undefined : process.argv[index + 1];
  return value?.trim() || undefined;
}

class MinimalMcpServer {
  readonly #tools: McpTool[];
  readonly #name: string;
  readonly #version: string;
  #buffer = Buffer.alloc(0);

  constructor(options: { name: string; version: string; tools: McpTool[] }) {
    this.#name = options.name;
    this.#version = options.version;
    this.#tools = options.tools;
  }

  run(): Promise<void> {
    process.stdin.on('data', (chunk: Buffer) => {
      this.#buffer = Buffer.concat([this.#buffer, chunk]);
      void this.#drain();
    });
    return new Promise((resolve) => process.stdin.on('end', resolve));
  }

  async #drain(): Promise<void> {
    for (;;) {
      const separator = this.#buffer.indexOf('\r\n\r\n');
      if (separator === -1) return;
      const header = this.#buffer.subarray(0, separator).toString('utf8');
      const contentLength = Number(/content-length:\s*(\d+)/i.exec(header)?.[1] ?? 0);
      if (!contentLength) {
        this.#buffer = this.#buffer.subarray(separator + 4);
        continue;
      }
      const bodyStart = separator + 4;
      const bodyEnd = bodyStart + contentLength;
      if (this.#buffer.length < bodyEnd) return;
      const raw = this.#buffer.subarray(bodyStart, bodyEnd).toString('utf8');
      this.#buffer = this.#buffer.subarray(bodyEnd);
      await this.#handle(raw).catch((error) => {
        const request = safeJsonParse(raw) as Partial<JsonRpcRequest> | undefined;
        this.#send({ jsonrpc: '2.0', id: request?.id ?? null, error: { code: -32603, message: error instanceof Error ? error.message : String(error) } });
      });
    }
  }

  async #handle(raw: string): Promise<void> {
    const request = JSON.parse(raw) as JsonRpcRequest;
    if (request.method === 'notifications/initialized') return;
    if (request.method === 'initialize') {
      this.#send({ jsonrpc: '2.0', id: request.id, result: { protocolVersion: '2024-11-05', serverInfo: { name: this.#name, version: this.#version }, capabilities: { tools: {} } } });
      return;
    }
    if (request.method === 'tools/list') {
      this.#send({ jsonrpc: '2.0', id: request.id, result: { tools: this.#tools.map(({ call: _call, ...tool }) => tool) } });
      return;
    }
    if (request.method === 'tools/call') {
      const params = request.params as { name?: string; arguments?: Record<string, unknown> } | undefined;
      const tool = this.#tools.find((candidate) => candidate.name === params?.name);
      if (!tool) throw new Error(`Unknown tool: ${params?.name ?? ''}`);
      this.#send({ jsonrpc: '2.0', id: request.id, result: await tool.call(params?.arguments ?? {}) });
      return;
    }
    this.#send({ jsonrpc: '2.0', id: request.id, error: { code: -32601, message: `Method not found: ${request.method}` } });
  }

  #send(message: unknown): void {
    const body = JSON.stringify(message);
    process.stdout.write(`Content-Length: ${Buffer.byteLength(body, 'utf8')}\r\n\r\n${body}`);
  }
}

function safeJsonParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

const server = new MinimalMcpServer({
  name: 'agent-tick-diagnostics-mcp',
  version: VERSION,
  tools: [
    {
      name: 'mobile_diagnostics',
      description: 'Read recent rows from the local Agent Tick mobile_diagnostics table. This talks directly to SQLite and does not expose an HTTP API.',
      inputSchema: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: 'Maximum rows to return. Default 100, max 1000.' },
          organizationId: { type: 'string', description: 'Optional organization id filter.' },
          userId: { type: 'string', description: 'Optional user id filter.' },
          area: { type: 'string', description: 'Optional diagnostic area filter, e.g. auth, button, navigation.' }
        },
        additionalProperties: false
      },
      call: async (args) => ({
        content: [{ type: 'text', text: JSON.stringify({ databaseURL, diagnostics: listMobileDiagnostics(args) }, null, 2) }]
      })
    },
    {
      name: 'diagnostics_summary',
      description: 'Summarize recent mobile diagnostics by user, area, message, and level from the local SQLite database.',
      inputSchema: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: 'Maximum source rows to inspect. Default 500, max 2000.' }
        },
        additionalProperties: false
      },
      call: async (args) => ({
        content: [{ type: 'text', text: JSON.stringify({ databaseURL, summary: summarizeDiagnostics(args) }, null, 2) }]
      })
    }
  ]
});

await server.run();

interface MobileDiagnosticRow {
  diagnostic_id: string;
  organization_id: string;
  user_id: string;
  device_id: string | null;
  level: string;
  area: string;
  message: string;
  metadata_json: string | null;
  created_at: string;
}
