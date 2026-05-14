#!/usr/bin/env node
import { spawn } from 'node:child_process';

const proxyUrl = process.env.MCP_PROXY_URL || process.argv[2];
if (!proxyUrl) {
  console.error('MCP_PROXY_URL or first argument is required');
  process.exit(2);
}

const proxyCommand = process.env.MCP_PROXY_COMMAND || 'nix';
const proxyArgs = process.env.MCP_PROXY_COMMAND
  ? [proxyUrl]
  : ['shell', 'nixpkgs#mcp-proxy', '-c', 'mcp-proxy', proxyUrl];
const child = spawn(proxyCommand, proxyArgs, {
  stdio: ['pipe', 'pipe', 'ignore']
});

let input = Buffer.alloc(0);
process.stdin.on('data', (chunk) => {
  input = Buffer.concat([input, chunk]);
  drainInput();
});
process.stdin.on('end', () => child.stdin.end());

function drainInput() {
  for (;;) {
    const headerEnd = input.indexOf('\r\n\r\n');
    const newlineEnd = input.indexOf('\n');
    if (headerEnd === -1 && newlineEnd === -1) return;

    if (headerEnd !== -1 && (newlineEnd === -1 || headerEnd < newlineEnd)) {
      const header = input.subarray(0, headerEnd).toString('utf8');
      const length = Number(/content-length:\s*(\d+)/i.exec(header)?.[1] ?? 0);
      if (!length) {
        input = input.subarray(headerEnd + 4);
        continue;
      }
      const bodyStart = headerEnd + 4;
      const bodyEnd = bodyStart + length;
      if (input.length < bodyEnd) return;
      const body = input.subarray(bodyStart, bodyEnd).toString('utf8');
      input = input.subarray(bodyEnd);
      child.stdin.write(`${body}\n`);
      continue;
    }

    const body = input.subarray(0, newlineEnd).toString('utf8').trim();
    input = input.subarray(newlineEnd + 1);
    if (body) child.stdin.write(`${body}\n`);
  }
}

let output = '';
child.stdout.on('data', (chunk) => {
  output += chunk.toString('utf8');
  drainOutput();
});

function drainOutput() {
  for (;;) {
    const newline = output.indexOf('\n');
    if (newline === -1) return;
    const line = output.slice(0, newline).trim();
    output = output.slice(newline + 1);
    if (!line) continue;
    const body = line;
    process.stdout.write(`Content-Length: ${Buffer.byteLength(body, 'utf8')}\r\n\r\n${body}`);
  }
}

child.on('exit', (code, signal) => {
  process.exit(code ?? (signal ? 1 : 0));
});
