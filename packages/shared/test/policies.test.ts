import { describe, expect, it } from 'vitest';
import {
  READ_ONLY_GRACE_DAYS,
  addDays,
  hostedPersonalStatus
} from '../src/billingPolicy.js';
import {
  SEMANTIC_STATUS_UPDATE_STATES,
  semanticStatusUpdateState,
  statusUpdateStateBehavior
} from '../src/statusPolicy.js';
import {
  deriveSessionSummaryTitle,
  isRedundantWaitingStatusUpdateAfterRequest,
  sessionMetadataTitle
} from '../src/sessionActivityPolicy.js';
import {
  ChoiceListSchema,
  QuestionSchema,
  ResponsePayloadSchema
} from '../src/requestPayloadSchemas.js';

describe('shared policy modules', () => {
  it('exports billing lifecycle helpers from a dedicated policy module', () => {
    expect(READ_ONLY_GRACE_DAYS).toBe(30);
    expect(addDays('2026-05-01T00:00:00.000Z', 7)).toBe('2026-05-08T00:00:00.000Z');
    expect(hostedPersonalStatus({
      userId: 'usr_1',
      trialStartedAt: '2026-05-01T00:00:00.000Z',
      createdAt: '2026-05-01T00:00:00.000Z',
      updatedAt: '2026-05-01T00:00:00.000Z'
    }, new Date('2026-05-10T00:00:00.000Z')).lifecycle).toBe('fresh');
  });

  it('exports status state policy helpers from a dedicated policy module', () => {
    expect(SEMANTIC_STATUS_UPDATE_STATES).toEqual(['working', 'waiting', 'blocked', 'done', 'failed']);
    expect(semanticStatusUpdateState('done')).toBe('done');
    expect(semanticStatusUpdateState('waiting_for_ci')).toBeUndefined();
    expect(statusUpdateStateBehavior('waiting_for_ci')).toBe('display_only');
  });

  it('exports request payload schemas from a dedicated module', () => {
    expect(ChoiceListSchema.parse([{ id: 'approve', label: 'Approve' }, { id: 'approve', label: 'Approve again' }])).toEqual([
      { id: 'approve', label: 'Approve', kind: 'approve' },
      { id: 'approve_2', label: 'Approve again', kind: 'approve' }
    ]);
    expect(QuestionSchema.parse({ question: 'Choose?', options: [{ label: 'A' }] })).toMatchObject({ question: 'Choose?', multiSelect: false });
    expect(ResponsePayloadSchema.parse({ choiceId: 'approve' })).toEqual({ choiceId: 'approve' });
  });

  it('exports session activity presentation policy from a dedicated module', () => {
    expect(sessionMetadataTitle({ label: 'Fallback label', title: '  Release prep  ' })).toBe('Release prep');
    expect(deriveSessionSummaryTitle([
      {
        kind: 'status_update',
        id: 'stat_1',
        workspaceId: 'wsp_1',
        createdAt: '2026-05-08T00:00:00.000Z',
        statusUpdate: {
          statusId: 'stat_1',
          workspaceId: 'wsp_1',
          message: 'Running checks',
          state: 'working',
          createdAt: '2026-05-08T00:00:00.000Z'
        }
      }
    ])).toBe('Running checks');
    expect(isRedundantWaitingStatusUpdateAfterRequest(
      { statusId: 'stat_2', workspaceId: 'wsp_1', message: 'Waiting', state: 'waiting', createdAt: '2026-05-08T00:00:02.000Z' },
      { id: 'req_1', workspaceId: 'wsp_1', requester: { name: 'agent' }, title: 'Approve?', choices: [], status: 'pending', createdAt: '2026-05-08T00:00:00.000Z' }
    )).toBe(true);
  });
});
