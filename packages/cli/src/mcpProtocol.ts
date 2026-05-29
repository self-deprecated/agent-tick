import { Buffer } from 'node:buffer';

export type JsonRpcId = string | number | null;
export interface JsonRpcRequest {
  jsonrpc?: string;
  id?: JsonRpcId;
  method?: string;
  params?: unknown;
}
export type McpMessageTransport = 'framed' | 'jsonl';

export async function readMcpMessages(input: NodeJS.ReadableStream, onMessage: (request: JsonRpcRequest, transport: McpMessageTransport) => void): Promise<void> {
  let buffer: Buffer<ArrayBufferLike> = Buffer.alloc(0);
  for await (const chunk of input) {
    buffer = Buffer.concat([buffer, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)]);
    while (true) {
      const parsed = tryReadMcpMessage(buffer);
      if (!parsed) break;
      buffer = Buffer.isBuffer(parsed.rest) ? parsed.rest : Buffer.from(parsed.rest);
      await onMessage(JSON.parse(parsed.body) as JsonRpcRequest, parsed.transport);
    }
  }
}

export function tryReadMcpMessage(buffer: Uint8Array): { body: string; rest: Uint8Array; transport: McpMessageTransport } | undefined {
  const nodeBuffer = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  const framed = tryReadMcpFrame(nodeBuffer);
  if (framed) return { ...framed, transport: 'framed' };
  const jsonl = tryReadMcpJsonLine(nodeBuffer);
  if (jsonl) return { ...jsonl, transport: 'jsonl' };
  return undefined;
}

function tryReadMcpFrame(buffer: Buffer): { body: string; rest: Buffer } | undefined {
  const headerEnd = buffer.indexOf('\r\n\r\n');
  if (headerEnd === -1) return undefined;
  const header = buffer.subarray(0, headerEnd).toString('utf8');
  const contentLengthMatch = /^content-length:\s*(\d+)$/im.exec(header);
  if (!contentLengthMatch) throw new Error('MCP frame missing Content-Length header');
  const contentLength = Number(contentLengthMatch[1]);
  const bodyStart = headerEnd + 4;
  const bodyEnd = bodyStart + contentLength;
  if (buffer.length < bodyEnd) return undefined;
  return { body: buffer.subarray(bodyStart, bodyEnd).toString('utf8'), rest: buffer.subarray(bodyEnd) };
}

function tryReadMcpJsonLine(buffer: Buffer): { body: string; rest: Buffer } | undefined {
  const newline = buffer.indexOf('\n');
  if (newline === -1) return undefined;
  const line = buffer.subarray(0, newline).toString('utf8').trim();
  if (!line) return { body: '{}', rest: buffer.subarray(newline + 1) };
  if (!line.startsWith('{')) return undefined;
  return { body: line, rest: buffer.subarray(newline + 1) };
}

export function writeMcpMessage(output: NodeJS.WritableStream, message: unknown, transport: McpMessageTransport = 'framed'): void {
  const body = JSON.stringify(message);
  if (transport === 'jsonl') {
    output.write(`${body}\n`);
    return;
  }
  output.write(`Content-Length: ${Buffer.byteLength(body, 'utf8')}\r\n\r\n${body}`);
}
