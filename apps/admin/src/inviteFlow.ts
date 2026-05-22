export interface FocusedInviteRecord {
	requestId: string;
	status: string;
}

export interface InviteAcceptState {
	inviteAccepted: FocusedInviteRecord | null;
	inviteAcceptStatus: 'idle' | 'loading' | 'ready' | 'error';
	inviteFlowError: string;
}

export interface InviteContinuationInput {
	inviteToken: string;
	hasAcceptedInvite: boolean;
	autoAcceptAttempted: boolean;
	authProvider?: string;
	clerkSignedIn: boolean;
}

export function inviteAcceptStarted(): InviteAcceptState {
	return { inviteAccepted: null, inviteAcceptStatus: 'loading', inviteFlowError: '' };
}

export function shouldContinueInviteAcceptance(input: InviteContinuationInput): boolean {
	if (!input.inviteToken || input.hasAcceptedInvite || input.autoAcceptAttempted) return false;
	if (input.authProvider === 'clerk' && !input.clerkSignedIn) return false;
	return true;
}
