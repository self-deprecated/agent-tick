export const SEMANTIC_STATUS_UPDATE_STATES = ['working', 'waiting', 'blocked', 'done', 'failed'] as const;
export type SemanticStatusUpdateState = typeof SEMANTIC_STATUS_UPDATE_STATES[number];
export type StatusUpdateStateBehavior = 'semantic' | 'display_only';

export function semanticStatusUpdateState(state: string): SemanticStatusUpdateState | undefined {
  return (SEMANTIC_STATUS_UPDATE_STATES as readonly string[]).includes(state) ? state as SemanticStatusUpdateState : undefined;
}

export function statusUpdateStateBehavior(state: string): StatusUpdateStateBehavior {
  return semanticStatusUpdateState(state) ? 'semantic' : 'display_only';
}
