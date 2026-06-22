const plausibleHost = 'https://analytics.selfdeprecated.ai';
const plausibleScriptId = 'agent-tick-plausible';
export const analyticsOptOutKey = 'agent_tick_analytics_opt_out';

type PlausibleEvent = 'onboarding_started' | 'onboarding_completed' | 'paywall_viewed' | 'setup_completed';

declare global {
	interface Window {
		plausible?: ((eventName: string, options?: { props?: Record<string, string> }) => void) & { q?: unknown[] };
	}
}

export function initPlausibleAnalytics(domain = 'app.agenttick.sh'): void {
	if (typeof window === 'undefined' || typeof document === 'undefined') return;
	if (analyticsOptedOut()) return;
	if (document.getElementById(plausibleScriptId)) return;

	window.plausible = window.plausible ?? function plausibleShim(...args: unknown[]) {
		(window.plausible!.q ??= []).push(args);
	};

	const script = document.createElement('script');
	script.id = plausibleScriptId;
	script.defer = true;
	script.dataset.domain = domain;
	script.src = `${plausibleHost}/js/script.js`;
	document.head.appendChild(script);
}

export function trackPlausibleEvent(eventName: PlausibleEvent, props: Record<string, string | undefined> = {}): void {
	if (typeof window === 'undefined' || analyticsOptedOut()) return;
	const cleanProps = Object.fromEntries(Object.entries(props).filter((entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1] !== ''));
	window.plausible?.(eventName, Object.keys(cleanProps).length ? { props: cleanProps } : undefined);
}

export function trackPlausibleEventOncePerSession(eventName: PlausibleEvent, props: Record<string, string | undefined> = {}): void {
	if (typeof window === 'undefined' || analyticsOptedOut()) return;
	const key = `agent_tick_analytics_event_${eventName}`;
	try {
		if (window.sessionStorage.getItem(key) === '1') return;
		window.sessionStorage.setItem(key, '1');
	} catch {
		// If storage is unavailable, still allow the coarse event to be sent once per page execution.
	}
	trackPlausibleEvent(eventName, props);
}

export function analyticsOptedOut(): boolean {
	if (typeof window === 'undefined') return true;
	try {
		return window.localStorage.getItem(analyticsOptOutKey) === 'true' || window.localStorage.getItem('plausible_ignore') === 'true';
	} catch {
		return true;
	}
}

export function setAnalyticsOptOut(optedOut: boolean): void {
	if (typeof window === 'undefined') return;
	try {
		if (optedOut) {
			window.localStorage.setItem(analyticsOptOutKey, 'true');
			window.localStorage.setItem('plausible_ignore', 'true');
			if (typeof document !== 'undefined') document.getElementById(plausibleScriptId)?.remove();
			return;
		}
		window.localStorage.removeItem(analyticsOptOutKey);
		window.localStorage.removeItem('plausible_ignore');
	} catch {
		// If storage is unavailable, leave the runtime default as privacy-preserving.
	}
}
