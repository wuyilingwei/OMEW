import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { apiRequest, ensureMigrated, registerUser } from "./helpers";

// Real user system (registration gate, invite codes, owner bootstrap, login,
// federation trust list) replacing the M1 dev-token stub. Instance policy
// (allow_root / root_requirements / trusted_identity_servers) is env config as
// of task 035 - see server/src/config.ts - so these tests set env vars directly
// instead of writing the old instance_config D1 table.

const OWNERSHIP = { ownership_pubkey: "test-pubkey", ownership_ciphertext: "test-ciphertext-blob" };

function setInstanceEnv(overrides: {
  allow_root?: boolean;
  root_requirements?: string[];
  trusted_identity_servers?: string[];
}): void {
  if (overrides.allow_root !== undefined) env.ALLOW_ROOT = overrides.allow_root ? "1" : "0";
  if (overrides.root_requirements) env.ROOT_REQUIREMENTS = overrides.root_requirements.join(",");
  if (overrides.trusted_identity_servers) env.TRUSTED_IDENTITY_SERVERS = overrides.trusted_identity_servers.join(",");
}

// Registers a fresh user and force-grants server_role=admin via D1, independent
// of whichever user this worker instance's natural "first registration"
// bootstrap already promoted to owner - keeps the invite-code tests decoupled
// from owner-bootstrap test ordering. Re-logs-in since server_role rides in the
// session token claim (§7.10) and the token minted at registration predates
// this promotion.
async function makeAdminToken(username: string): Promise<string> {
  setInstanceEnv({ allow_root: true, root_requirements: [] });
  const { status, json } = await registerUser({ username, password: "password123", ...OWNERSHIP });
  expect(status).toBe(200);
  await env.DB.prepare("UPDATE users SET server_role = 'admin' WHERE localpart = ?").bind(username).run();
  const loginRes = await apiRequest("/api/login", { method: "POST", body: JSON.stringify({ username, password: "password123" }) });
  return ((await loginRes.json()) as { token: string }).token;
}

beforeAll(async () => {
  await ensureMigrated();
});

describe("owner bootstrap", () => {
  it("makes only the first successfully registered user server_role=owner", async () => {
    // Defensive clean slate: this suite runs first in the file, but don't depend on
    // that - guarantee no pre-existing owner regardless of execution/storage order.
    await env.DB.prepare("DELETE FROM users").run();
    setInstanceEnv({ allow_root: true, root_requirements: [] });

    const first = await registerUser({ username: "bootowner1", password: "password123", ...OWNERSHIP });
    expect(first.status).toBe(200);
    const firstUser = first.json.user as Record<string, unknown>;
    expect(firstUser.server_role).toBe("owner");
    expect(firstUser.is_admin).toBe(true); // compat field

    const second = await registerUser({ username: "bootowner2", password: "password123", ...OWNERSHIP });
    expect(second.status).toBe(200);
    const secondUser = second.json.user as Record<string, unknown>;
    expect(secondUser.server_role).toBe("user");
    expect(secondUser.is_admin).toBe(false);
  });
});

describe("registration gate (allow_root)", () => {
  it("rejects registration with REGISTRATION_DISABLED when allow_root is off", async () => {
    setInstanceEnv({ allow_root: false, root_requirements: [] });
    const { status, json } = await registerUser({ username: "gatetest1", password: "password123", ...OWNERSHIP });
    expect(status).toBe(403);
    expect(json).toEqual({ error: "REGISTRATION_DISABLED" });
    setInstanceEnv({ allow_root: true });
  });

  it("allows registration and issues a session token once allow_root is on", async () => {
    setInstanceEnv({ allow_root: true, root_requirements: [] });
    const { status, json } = await registerUser({ username: "gatetest2", password: "password123", ...OWNERSHIP });
    expect(status).toBe(200);
    expect(json.token).toBeTypeOf("string");
    expect((json.user as Record<string, unknown>).username).toBe("gatetest2");
    expect((json.user as Record<string, unknown>).actor).toBe("@gatetest2:local");
  });

  it("rejects a malformed username with USERNAME_INVALID", async () => {
    setInstanceEnv({ allow_root: true, root_requirements: [] });
    const { status, json } = await registerUser({ username: "a!", password: "password123", ...OWNERSHIP });
    expect(status).toBe(400);
    expect(json).toEqual({ error: "USERNAME_INVALID" });
  });
});

describe("invite-code gated registration (root_requirements: code)", () => {
  it("rejects registration without a valid invite code", async () => {
    setInstanceEnv({ allow_root: true, root_requirements: ["code"] });
    const { status, json } = await registerUser({
      username: "codetest1",
      password: "password123",
      code: "not-a-real-code",
      ...OWNERSHIP,
    });
    expect(status).toBe(400);
    expect(json).toEqual({ error: "INVITE_INVALID" });
  });

  it("mints a code as admin, consumes it once end-to-end, then refuses reuse", async () => {
    const adminToken = await makeAdminToken("codeadmin1");
    setInstanceEnv({ allow_root: true, root_requirements: ["code"] });

    const mintRes = await apiRequest("/api/admin/invite-codes", {
      method: "POST",
      headers: { Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ count: 1 }),
    });
    expect(mintRes.status).toBe(201);
    const minted = (await mintRes.json()) as { codes: Array<{ code: string }> };
    const code = minted.codes[0]!.code;

    const listRes = await apiRequest("/api/admin/invite-codes", {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const listed = (await listRes.json()) as { codes: Array<{ code: string; used_by: string | null }> };
    expect(listed.codes.find((c) => c.code === code)?.used_by).toBeNull();

    const first = await registerUser({ username: "codetest2", password: "password123", code, ...OWNERSHIP });
    expect(first.status).toBe(200);

    const second = await registerUser({ username: "codetest3", password: "password123", code, ...OWNERSHIP });
    expect(second.status).toBe(400);
    expect(second.json).toEqual({ error: "INVITE_INVALID" });
  });

  it("rejects invite-code minting and listing from a non-admin session", async () => {
    setInstanceEnv({ allow_root: true, root_requirements: [] });
    const { json } = await registerUser({ username: "notadmin1", password: "password123", ...OWNERSHIP });
    const res = await apiRequest("/api/admin/invite-codes", {
      method: "POST",
      headers: { Authorization: `Bearer ${json.token}` },
      body: JSON.stringify({ count: 1 }),
    });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "ADMIN_REQUIRED" });
  });
});

describe("login", () => {
  it("returns identical AUTH_FAILED for a wrong password and a nonexistent user", async () => {
    setInstanceEnv({ allow_root: true, root_requirements: [] });
    const username = "logintest1";
    const reg = await registerUser({ username, password: "correct-password", ...OWNERSHIP });
    expect(reg.status).toBe(200);

    const wrongPassword = await apiRequest("/api/login", {
      method: "POST",
      body: JSON.stringify({ username, password: "wrong-password" }),
    });
    const noSuchUser = await apiRequest("/api/login", {
      method: "POST",
      body: JSON.stringify({ username: "does-not-exist-at-all", password: "whatever123" }),
    });

    expect(wrongPassword.status).toBe(401);
    expect(noSuchUser.status).toBe(401);
    expect(await wrongPassword.json()).toEqual({ error: "AUTH_FAILED" });
    expect(await noSuchUser.json()).toEqual({ error: "AUTH_FAILED" });
  });

  it("succeeds with correct credentials and issues a session token", async () => {
    const username = "logintest2";
    await registerUser({ username, password: "correct-password", ...OWNERSHIP });
    const res = await apiRequest("/api/login", {
      method: "POST",
      body: JSON.stringify({ username, password: "correct-password" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.token).toBeTypeOf("string");
    expect((body.user as Record<string, unknown>).username).toBe(username);
  });
});

describe("federation session trust list", () => {
  it("rejects an iss domain not on the trusted list", async () => {
    setInstanceEnv({ trusted_identity_servers: ["allowed.example"] });
    const res = await apiRequest("/federation/session", {
      method: "POST",
      body: JSON.stringify({ iss: "untrusted.example" }),
    });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "ORIGIN_NOT_TRUSTED" });
  });

  it("accepts an exact match and falls through to the M6 placeholder", async () => {
    setInstanceEnv({ trusted_identity_servers: ["allowed.example"] });
    const res = await apiRequest("/federation/session", {
      method: "POST",
      body: JSON.stringify({ iss: "allowed.example" }),
    });
    expect(res.status).toBe(501);
  });

  it("accepts any origin when the trusted list is a wildcard", async () => {
    setInstanceEnv({ trusted_identity_servers: ["*"] });
    const res = await apiRequest("/federation/session", {
      method: "POST",
      body: JSON.stringify({ iss: "anything.example" }),
    });
    expect(res.status).toBe(501);
  });
});
