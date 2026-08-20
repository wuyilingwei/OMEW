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
        bindings: {
          // Test-only fixture value, not a production secret - see server/.dev.vars.example.
          DEV_TOKEN_SECRET: "test-secret-do-not-use-in-prod",
          // Pins the default test env to the "local" placeholder (matching every
          // existing @user:local assertion) rather than wrangler.jsonc's real
          // INSTANCE_DOMAIN - instance-domain.test.ts overrides this per-test to
          // exercise the actual derivation path.
          INSTANCE_DOMAIN: "local",
        },
      },
    }),
  ],
});
