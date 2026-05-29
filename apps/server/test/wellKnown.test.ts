import { describe, expect, it } from 'vitest';
import { appleAppSiteAssociation } from '../src/wellKnown.js';

describe('well-known app association files', () => {
  it('associates the Apple app with hosted Agent Tick domains', () => {
    expect(appleAppSiteAssociation).toEqual({
      webcredentials: {
        apps: ['2559B88H6C.ai.selfdeprecated.agenttick']
      }
    });
  });
});
