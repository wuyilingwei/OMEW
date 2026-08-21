import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { RESERVED_USERNAMES, isReservedUsername } from "../server/src/reserved-usernames";
import { RESERVED_USERNAMES as WEB_RESERVED_USERNAMES } from "../web/src/utils/reservedUsernames";
import { apiRequest, ensureMigrated, registerUser } from "./helpers";

const OWNERSHIP = { ownership_pubkey: "test-pubkey", ownership_ciphertext: "test-ciphertext-blob" };

beforeAll(async () => {
  await ensureMigrated();
  env.ALLOW_ROOT = "1";
  env.ROOT_REQUIREMENTS = "";
});

describe("reserved username dictionary", () => {
  it("holds only separator-free lowercase entries, no duplicates", () => {
    for (const name of RESERVED_USERNAMES) expect(name).toMatch(/^[a-z0-9]+$/);
    expect(new Set(RESERVED_USERNAMES).size).toBe(RESERVED_USERNAMES.length);
  });

  it("stays identical to the web mirror", () => {
    expect([...WEB_RESERVED_USERNAMES]).toEqual([...RESERVED_USERNAMES]);
  });

  it("matches an exact entry and its separator variants", () => {
    expect(isReservedUsername("admin")).toBe(true);
    expect(isReservedUsername("ad-min")).toBe(true);
    expect(isReservedUsername("a_d_m_i_n")).toBe(true);
    expect(isReservedUsername("omew")).toBe(true);
  });

  it("leaves names that merely contain an entry alone", () => {
    expect(isReservedUsername("admin1")).toBe(false);
    expect(isReservedUsername("notadmin")).toBe(false);
    expect(isReservedUsername("administrators")).toBe(false);
    expect(isReservedUsername("rosmontis")).toBe(false);
  });
});

describe("registration filter", () => {
  it("rejects a reserved username with USERNAME_RESERVED", async () => {
    const { status, json } = await registerUser({ username: "admin", password: "password123", ...OWNERSHIP });
    expect(status).toBe(400);
    expect(json).toEqual({ error: "USERNAME_RESERVED" });
  });

  it("rejects a separator-padded reserved username", async () => {
    const { status, json } = await registerUser({ username: "sys_admin", password: "password123", ...OWNERSHIP });
    expect(status).toBe(400);
    expect(json).toEqual({ error: "USERNAME_RESERVED" });
  });

  it("normalizes case before filtering", async () => {
    const { status, json } = await registerUser({ username: "Admin", password: "password123", ...OWNERSHIP });
    expect(status).toBe(400);
    expect(json).toEqual({ error: "USERNAME_RESERVED" });
  });

  it("still accepts an unreserved username", async () => {
    const { status } = await registerUser({ username: "reservedtest1", password: "password123", ...OWNERSHIP });
    expect(status).toBe(200);
  });

  // Only registration is filtered: an account that predates the blocklist keeps
  // its name and can still log in.
  it("leaves an account registered before the blocklist usable", async () => {
    const created = await registerUser({ username: "reservedtest2", password: "password123", ...OWNERSHIP });
    expect(created.status).toBe(200);
    await env.DB.prepare("UPDATE users SET localpart = 'root' WHERE localpart = 'reservedtest2'").run();

    const res = await apiRequest("/api/login", {
      method: "POST",
      body: JSON.stringify({ username: "root", password: "password123" }),
    });
    expect(res.status).toBe(200);
  });
});
