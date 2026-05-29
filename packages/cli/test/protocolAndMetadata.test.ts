import { describe, expect, it } from 'vitest';
import { metadataEntriesFromRecord, parseMetadata, statusUpdateMetadata } from '../src/metadata.js';
import { tryReadMcpMessage } from '../src/mcpProtocol.js';

describe('CLI protocol and metadata modules', () => {
  it('parses CLI metadata and status metadata in a dedicated module', () => {
    expect(parseMetadata(['area=billing', 'empty='])).toEqual({ area: 'billing', empty: '' });
    expect(metadataEntriesFromRecord({ area: 'billing', priority: 'high' })).toEqual(['area=billing', 'priority=high']);
    expect(statusUpdateMetadata({ metadata: ['area=billing'], importance: 'high', notify: true })).toEqual({
      area: 'billing',
      agentTickImportance: 'high',
      agentTickNotify: 'true'
    });
    expect(() => parseMetadata(['broken'])).toThrow(/invalid metadata/);
  });

  it('reads framed and jsonl MCP messages in a dedicated protocol module', () => {
    const framed = Buffer.from('Content-Length: 11\r\n\r\n{"ok":true}tail');
    expect(tryReadMcpMessage(framed)).toMatchObject({ body: '{"ok":true}', transport: 'framed' });

    const jsonl = Buffer.from('{"jsonrpc":"2.0"}\nnext');
    expect(tryReadMcpMessage(jsonl)).toMatchObject({ body: '{"jsonrpc":"2.0"}', transport: 'jsonl' });
  });
});
