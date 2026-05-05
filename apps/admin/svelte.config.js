import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('svelte/compiler').CompileOptions} */
const compilerOptions = {
	runes: true
};

/** @type {import('@sveltejs/vite-plugin-svelte').SvelteConfig} */
const config = {
	compilerOptions,
	preprocess: vitePreprocess()
};

export default config;
