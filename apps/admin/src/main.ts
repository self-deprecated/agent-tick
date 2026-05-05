import { mount } from 'svelte';
import App from './App.svelte';
import type { AdminConfig, AdminMode } from './app';
import './styles.css';

const target = document.getElementById('app');
if (!target) {
	throw new Error('Agent Tick admin mount target was not found');
}

const config = normaliseConfig(window.__AGENT_TICK_ADMIN__);

mount(App, {
	target,
	props: { config }
});

function normaliseConfig(input: Partial<AdminConfig> | undefined): AdminConfig {
	return {
		mode: input?.mode === 'user' ? 'user' : ('single' satisfies AdminMode),
		publicURL: input?.publicURL?.trim() || window.location.origin
	};
}
