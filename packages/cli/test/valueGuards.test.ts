import { describe, expect, it } from 'vitest';
import { isPlainObject, mcpErrorMessage, optionalString, optionalStringRecord, requiredString } from '../src/valueGuards.js';

describe('CLI value guard helpers', () => {
  it('normalizes and validates MCP argument strings from a dedicated module', () => {
    expect(optionalString(' value ')).toBe('value');
    expect(optionalString('   ')).toBeUndefined();
    expect(requiredString(' value ', 'field')).toBe('value');
    expect(() => requiredString(undefined, 'field')).toThrow(/field is required/);
  });

  it('detects plain objects and string records for MCP args/errors', () => {
    expect(isPlainObject({ ok: true })).toBe(true);
    expect(isPlainObject([])).toBe(false);
    expect(optionalStringRecord({ a: 'one', b: 2 })).toEqual({ a: 'one' });
    expect(optionalStringRecord({ b: 2 })).toBeUndefined();
    expect(mcpErrorMessage({ message: 'failed' })).toBe('failed');
    expect(mcpErrorMessage(123)).toBe('123');
  });
});
