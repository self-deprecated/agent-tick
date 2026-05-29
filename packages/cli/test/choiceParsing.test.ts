import { describe, expect, it } from 'vitest';
import { inferredChoiceKind, parseChoices, slugifyChoiceId } from '../src/choiceParsing.js';

describe('CLI choice parsing policy', () => {
  it('parses choices, default deny fallback, flags, and tags from a dedicated module', () => {
    expect(parseChoices(
      ['Ship it', 'reject:deny=Stop'],
      ['ship_it=favorite'],
      ['ship_it=fast-path']
    )).toEqual([
      { id: 'ship_it', label: 'Ship it', kind: 'approve', flags: ['favorite'], tags: ['fast-path'] },
      { id: 'reject', label: 'Stop', kind: 'deny' }
    ]);
    expect(parseChoices(['Option A'])).toEqual([
      { id: 'option_a', label: 'Option A', kind: 'approve' },
      { id: 'cancel', label: 'Cancel / do not answer', kind: 'deny' }
    ]);
  });

  it('normalizes labels and infers deny choices consistently', () => {
    expect(slugifyChoiceId('  Ship / deploy!  ')).toBe('ship_deploy');
    expect(inferredChoiceKind('No')).toBe('deny');
    expect(inferredChoiceKind('Proceed')).toBe('approve');
  });
});
