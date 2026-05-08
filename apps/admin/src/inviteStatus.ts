export function inviteAcceptedMessage(status: string): string {
	if (status === 'approved' || status === 'joined' || status === 'already_member') return 'Invite accepted. You now have access to this organization.';
	if (status === 'pending_approval') return 'Request sent. An organization admin needs to approve your access before you can use this organization.';
	if (status === 'rejected') return 'Your request to join this organization was rejected.';
	return 'Invite status changed. Refresh your dashboard for the latest access state.';
}
