export function inviteAcceptedMessage(status: string): string {
	if (status === 'approved' || status === 'joined' || status === 'already_member') return 'Invite accepted. You now have access to this Workspace.';
	if (status === 'pending') return 'Request sent. A Workspace Owner needs to accept your access before you can use this Workspace.';
	if (status === 'rejected') return 'Your request to join this Workspace was rejected.';
	return 'Invite status changed. Refresh your dashboard for the latest access state.';
}
