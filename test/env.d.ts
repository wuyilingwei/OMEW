/// <reference types="@cloudflare/vitest-pool-workers/types" />
// `cloudflare:test`'s `env` export is typed as `Cloudflare.Env`, populated from
// server/worker-configuration.d.ts (generated) plus server/src/env.d.ts
// (DEV_TOKEN_SECRET augmentation) - nothing further to declare here.

// Lets test/helpers.ts import migration files as their raw SQL text (Vite's `?raw`
// import suffix) instead of duplicating the SQL as string literals.
declare module "*.sql?raw" {
  const content: string;
  export default content;
}
