import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { apiRequest, ensureMigrated, registerUser } from "./helpers";

// Real user system (registration gate, invite codes, admin bootstrap, login,
// federation trust list) replacing the M1 dev-token stub.

const OWNERSHIP = { ownership_pubkey: "test-pubkey", ownership_ciphertext: "test-ciphertext-blob" };

interface InstanceConfigRow {
  allow_root: number;
  root_requirements: string;
  trusted_identity_servers: string;
}

async function setInstanceConfig(overrides: {
  allow_root?: boolean;
  root_requirements?: string[];
  trusted_identity_servers?: string[];
}): Promise<void> {
  const current = await env.DB.prepare(
    "SELECT allow_root, root_requirements, trusted_identity_servers FROM instance_config WHERE id = 1"
  ).first<InstanceConfigRow>();
  const allowRoot = overrides.allow_root ?? Boolean(current!.allow_root);
  const rootRequirements = overrides.root_requirements ?? (JSON.parse(current!.root_requirements) as string[]);
  const trustedServers =
    overrides.trusted_identity_servers ?? (JSON.parse(current!.trusted_identity_servers) as string[]);
  await env.DB.prepare(
    "UPDATE instance_config SET allow_root = ?, root_requirements = ?, trusted_identity_servers = ? WHERE id = 1"
  )
    .bind(allowRoot ? 1 : 0, JSON.stringify(rootRequirements), JSON.stringify(trustedServers))
    .run();
}

// Registers a fresh user and force-grants is_admin, independent of whichever user
// this worker instance's natural "first registration" bootstrap already promoted -
// keeps the invite-code tests decoupled from admin-bootstrap test ordering.
async function makeAdminToken(username: string): Promise<string> {
  await setInstanceConfig({ allow_root: true, root_requirements: [] });
  const { status, json } = await registerUser({ username, password: "password123", ...OWNERSHIP });
  expect(status).toBe(200);
  await env.DB.prepare("UPDATE users SET is_admin = 1 WHERE localpart = ?").bind(username).run();
  return json.token as string;
}

beforeAll(async () => {
  await ensureMigrated();
});

describe("admin bootstrap", () => {
  it("makes only the first successfully registered user an admin", async () => {
    // Defensive clean slate: this suite runs first in the file, but don't depend on
    // that - guarantee no pre-existing admin regardless of execution/storage order.
    await env.DB.prepare("DELETE FROM users").run();
    await setInstanceConfig({ allow_root: true, root_requirements: [] });

    const first = await registerUser({ username: "bootadmin1", password: "password123", ...OWNERSHIP });
    expect(first.status).toBe(200);
    expect((first.json.user as Record<string, unknown>).is_admin).toBe(true);

    const second = await registerUser({ username: "bootadmin2", password: "password123", ...OWNERSHIP });
    expect(second.status).toBe(200);
    expect((second.json.user as Record<string, unknown>).is_admin).toBe(false);
  });
});

describe("registration gate (allow_root)", () => {
  it("rejects registration with REGISTRATION_DISABLED when allow_root is off", async () => {
    await setInstanceConfig({ allow_root: false, root_requirements: [] });
    const { status, json } = await registerUser({ username: "gatetest1", password: "password123", ...OWNERSHIP });
    expect(status).toBe(403);
    expect(json).toEqual({ error: "REGISTRATION_DISABLED" });
  });

  it("allows registration and issues a session token once allow_root is on", async () => {
    await setInstanceConfig({ allow_root: true, root_requirements: [] });
    const { status, json } = await registerUser({ username: "gatetest2", password: "password123", ...OWNERSHIP });
    expect(status).toBe(200);
    expect(json.token).toBeTypeOf("string");
    expect((json.user as Record<string, unknown>).username).toBe("gatetest2");
    expect((json.user as Record<string, unknown>).actor).toBe("@gatetest2:local");
  });

  it("rejects a malformed username with USERNAME_INVALID", async () => {
    await setInstanceConfig({ allow_root: true, root_requirements: [] });
    const { status, json } = await registerUser({ username: "a!", password: "password123", ...OWNERSHIP });
    expect(status).toBe(400);
    expect(json).toEqual({ error: "USERNAME_INVALID" });
  });
});

describe("invite-code gated registration (root_requirements: [code])", () => {
  it("rejects registration without a valid invite code", async () => {
    await setInstanceConfig({ allow_root: true, root_requirements: ["code"] });
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
    await setInstanceConfig({ allow_root: true, root_requirements: ["code"] });

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
    await setInstanceConfig({ allow_root: true, root_requirements: [] });
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
    await setInstanceConfig({ allow_root: true, root_requirements: [] });
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
    await setInstanceConfig({ trusted_identity_servers: ["allowed.example"] });
    const res = await apiRequest("/federation/session", {
      method: "POST",
      body: JSON.stringify({ iss: "untrusted.example" }),
    });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "ORIGIN_NOT_TRUSTED" });
  });

  it("accepts an exact match and falls through to the M6 placeholder", async () => {
    await setInstanceConfig({ trusted_identity_servers: ["allowed.example"] });
    const res = await apiRequest("/federation/session", {
      method: "POST",
      body: JSON.stringify({ iss: "allowed.example" }),
    });
    expect(res.status).toBe(501);
  });

  it("accepts any origin when the trusted list is a wildcard", async () => {
    await setInstanceConfig({ trusted_identity_servers: ["*"] });
    const res = await apiRequest("/federation/session", {
      method: "POST",
      body: JSON.stringify({ iss: "anything.example" }),
    });
    expect(res.status).toBe(501);
  });
});
