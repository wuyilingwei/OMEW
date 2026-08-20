import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { ensureMigrated, registerUser } from "./helpers";

// Task 033: INSTANCE_DOMAIN wrangler var drives the domain half of a freshly
// registered actor. vitest.config.ts pins the default test env to "local" (every
// other test file's @user:local assertions depend on that), so this file
// exercises the real derivation path by overriding env.INSTANCE_DOMAIN directly
// for the duration of a single test, then restoring it.

const OWNERSHIP = { ownership_pubkey: "test-pubkey", ownership_ciphertext: "test-ciphertext-blob" };

beforeAll(async () => {
  await ensureMigrated();
});

describe("actor domain derivation", () => {
  it("uses the 'local' placeholder by default (vitest.config.ts test fixture)", async () => {
    const { status, json } = await registerUser({ username: "domaintest1", password: "password123", ...OWNERSHIP });
    expect(status).toBe(200);
    expect((json.user as Record<string, unknown>).actor).toBe("@domaintest1:local");
  });

  it("reflects INSTANCE_DOMAIN when the deployment configures one", async () => {
    const original = env.INSTANCE_DOMAIN;
    try {
      env.INSTANCE_DOMAIN = "omew.wuyilingwei.com";
      const { status, json } = await registerUser({ username: "domaintest2", password: "password123", ...OWNERSHIP });
      expect(status).toBe(200);
      expect((json.user as Record<string, unknown>).actor).toBe("@domaintest2:omew.wuyilingwei.com");
    } finally {
      env.INSTANCE_DOMAIN = original;
    }
  });
});
