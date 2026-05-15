import { fileURLToPath } from 'node:url';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [svelte()],
	resolve: {
		alias: {
			'@agent-tick/i18n': fileURLToPath(new URL('../../packages/i18n/src/index.ts', import.meta.url))
		}
	},
	build: {
		emptyOutDir: true,
		outDir: '../server/public/admin',
		sourcemap: false
	},
	server: {
		port: 5173,
		proxy: {
			'/v1': 'http://localhost:8787'
		}
	}
});
