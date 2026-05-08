import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [svelte()],
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
