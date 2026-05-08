import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      '@agent-tick/sdk': fileURLToPath(new URL('../sdk/src/index.ts', import.meta.url)),
      '@agent-tick/shared': fileURLToPath(new URL('../shared/src/index.ts', import.meta.url))
    }
  },
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts']
  }
});
