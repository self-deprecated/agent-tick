const clerkNoiseParams = new Set([
	'__clerk_status',
	'__clerk_created_session',
	'__clerk_db_jwt',
	'__clerk_handshake',
	'__clerk_synced',
	'created_session_id',
	'rotating_token_nonce',
	'provider',
	'strategy',
	'ticket'
]);

export function hasClerkRedirectCallback(url: string): boolean {
	const parsed = new URL(url);
	for (const key of clerkNoiseParams) {
		if (parsed.searchParams.has(key)) return true;
	}
	return false;
}

export function clerkRedirectTarget(url: string): string {
	const parsed = new URL(url);
	for (const key of clerkNoiseParams) parsed.searchParams.delete(key);
	if (isClerkHostedRoute(parsed.pathname)) parsed.pathname = '/';
	return parsed.toString();
}

function isClerkHostedRoute(pathname: string): boolean {
	return pathname === '/sign-in' || pathname.startsWith('/sign-in/') || pathname === '/sign-up' || pathname.startsWith('/sign-up/') || pathname === '/sso-callback' || pathname.startsWith('/sso-callback/');
}
