import type { MembershipRequestRecord } from './api';

export interface InviteAcceptState {
	inviteAccepted: MembershipRequestRecord | null;
	inviteAcceptStatus: 'idle' | 'loading' | 'ready' | 'error';
	inviteFlowError: string;
}

export function inviteAcceptStarted(): InviteAcceptState {
	return { inviteAccepted: null, inviteAcceptStatus: 'loading', inviteFlowError: '' };
}
