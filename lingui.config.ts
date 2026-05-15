import { defineConfig } from "@lingui/cli";
import { babelExtractor } from "@lingui/cli/api/extractors/babel";

export default defineConfig({
  sourceLocale: "en",
  locales: ["en", "da", "de", "fr", "es", "zh"],
  catalogs: [
    {
      path: "<rootDir>/packages/i18n/src/locales/{locale}/messages",
      include: ["apps/mobile", "apps/admin/src"],
      exclude: ["**/*.test.ts", "**/*.test.tsx", "**/*.test.mjs", "**/node_modules/**"],
    },
  ],
  extractors: [babelExtractor],
});
