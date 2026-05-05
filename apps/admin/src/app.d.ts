export type AdminMode = 'single' | 'user';

export interface AdminConfig {
	mode: AdminMode;
	publicURL: string;
}

declare global {
	interface Window {
		__AGENT_TICK_ADMIN__?: Partial<AdminConfig>;
	}
}
