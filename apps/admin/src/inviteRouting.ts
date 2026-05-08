export function inviteTokenFromLocation(pathname: string, hash: string): string {
	return tokenFromPath(pathname) ?? tokenFromPath(hash.replace(/^#\/?/, '/')) ?? '';
}

function tokenFromPath(path: string): string | null {
	const match = path.match(/(?:^|\/)invite\/([^/?#]+)/);
	if (!match?.[1]) return null;
	try {
		return decodeURIComponent(match[1]);
	} catch {
		return match[1];
	}
}
