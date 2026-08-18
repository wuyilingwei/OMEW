import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
  },
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./server/wrangler.jsonc" },
      miniflare: {
        // Test-only fixture value, not a production secret - see server/.dev.vars.example.
        bindings: { DEV_TOKEN_SECRET: "test-secret-do-not-use-in-prod" },
      },
    }),
  ],
});
