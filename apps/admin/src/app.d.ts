export type AdminMode = 'single' | 'clerk';

export interface AdminConfig {
	mode: AdminMode;
	publicURL: string;
	authProvider?: 'local' | 'clerk';
	clerkPublishableKey?: string;
}

declare global {
	interface Window {
		__AGENT_TICK_ADMIN__?: Partial<AdminConfig>;
	}
}
