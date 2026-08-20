import { beforeAll, describe, expect, it } from "vitest";
import { apiRequest, ensureMigrated, registerUser } from "./helpers";

// Task 034: POST /api/me/password - authenticated password change, same
// strength floor as registration, old-password verification, no forced
// revocation of the user's other outstanding sessions (v1, documented in api.ts).

const OWNERSHIP = { ownership_pubkey: "test-pubkey", ownership_ciphertext: "test-ciphertext-blob" };

beforeAll(async () => {
  await ensureMigrated();
});

async function login(username: string, password: string): Promise<number> {
  const res = await apiRequest("/api/login", { method: "POST", body: JSON.stringify({ username, password }) });
  return res.status;
}

async function loginWithToken(username: string, password: string): Promise<{ status: number; token: string }> {
  const res = await apiRequest("/api/login", { method: "POST", body: JSON.stringify({ username, password }) });
  const body = (await res.json()) as { token?: string };
  return { status: res.status, token: body.token ?? "" };
}

describe("POST /api/me/password", () => {
  it("requires authentication", async () => {
    const res = await apiRequest("/api/me/password", {
      method: "POST",
      body: JSON.stringify({ old_password: "whatever123", new_password: "newpassword123" }),
    });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "AUTH_REQUIRED" });
  });

  it("rejects a wrong old password with 401 AUTH_FAILED and leaves the password unchanged", async () => {
    const username = "pwchange1";
    const { json } = await registerUser({ username, password: "correct-password", ...OWNERSHIP });
    const token = json.token as string;

    const res = await apiRequest("/api/me/password", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ old_password: "wrong-password", new_password: "newpassword123" }),
    });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "AUTH_FAILED" });

    expect(await login(username, "correct-password")).toBe(200);
  });

  it("rejects a weak new password with 400 PASSWORD_INVALID", async () => {
    const username = "pwchange2";
    const { json } = await registerUser({ username, password: "correct-password", ...OWNERSHIP });
    const token = json.token as string;

    const res = await apiRequest("/api/me/password", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ old_password: "correct-password", new_password: "short" }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "PASSWORD_INVALID" });

    expect(await login(username, "correct-password")).toBe(200);
  });

  it("succeeds end-to-end: old password stops working, new password logs in", async () => {
    const username = "pwchange3";
    const { json } = await registerUser({ username, password: "old-password-1", ...OWNERSHIP });
    const token = json.token as string;

    const res = await apiRequest("/api/me/password", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ old_password: "old-password-1", new_password: "new-password-2" }),
    });
    expect(res.status).toBe(204);

    expect(await login(username, "old-password-1")).toBe(401);
    expect(await login(username, "new-password-2")).toBe(200);
  });

  // m0-protocol §7.9a: custody ciphertext re-wrap alongside a password
  // change, submitted as an optional `new_ownership_ciphertext`.
  it("atomically updates pw_hash and ownership_ciphertext when new_ownership_ciphertext is provided", async () => {
    const username = "pwchange4";
    const { json } = await registerUser({ username, password: "old-password-1", ...OWNERSHIP });
    const token = json.token as string;

    const res = await apiRequest("/api/me/password", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        old_password: "old-password-1",
        new_password: "new-password-2",
        new_ownership_ciphertext: "resealed-ciphertext-blob",
      }),
    });
    expect(res.status).toBe(204);

    expect(await login(username, "old-password-1")).toBe(401);
    const newToken = await loginWithToken(username, "new-password-2");
    expect(newToken.status).toBe(200);

    const ownershipRes = await apiRequest("/api/me/ownership", {
      headers: { Authorization: `Bearer ${newToken.token}` },
    });
    expect(ownershipRes.status).toBe(200);
    expect(await ownershipRes.json()).toEqual({
      ownership_pubkey: OWNERSHIP.ownership_pubkey,
      ownership_ciphertext: "resealed-ciphertext-blob",
    });
  });

  it("leaves ownership_ciphertext untouched when new_ownership_ciphertext is omitted (independent custody passphrase)", async () => {
    const username = "pwchange5";
    const { json } = await registerUser({ username, password: "old-password-1", ...OWNERSHIP });
    const token = json.token as string;

    const res = await apiRequest("/api/me/password", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ old_password: "old-password-1", new_password: "new-password-2" }),
    });
    expect(res.status).toBe(204);

    const newToken = await loginWithToken(username, "new-password-2");
    const ownershipRes = await apiRequest("/api/me/ownership", {
      headers: { Authorization: `Bearer ${newToken.token}` },
    });
    expect(await ownershipRes.json()).toEqual({
      ownership_pubkey: OWNERSHIP.ownership_pubkey,
      ownership_ciphertext: OWNERSHIP.ownership_ciphertext,
    });
  });

  it("rejects an oversized new_ownership_ciphertext with 400 OWNERSHIP_CIPHERTEXT_INVALID and leaves both unchanged", async () => {
    const username = "pwchange6";
    const { json } = await registerUser({ username, password: "old-password-1", ...OWNERSHIP });
    const token = json.token as string;

    const oversized = "a".repeat(8 * 1024 + 1);
    const res = await apiRequest("/api/me/password", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ old_password: "old-password-1", new_password: "new-password-2", new_ownership_ciphertext: oversized }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "OWNERSHIP_CIPHERTEXT_INVALID" });

    // password unchanged either
    expect(await login(username, "old-password-1")).toBe(200);
  });

  it("rejects an empty-string new_ownership_ciphertext with 400 OWNERSHIP_CIPHERTEXT_INVALID", async () => {
    const username = "pwchange7";
    const { json } = await registerUser({ username, password: "old-password-1", ...OWNERSHIP });
    const token = json.token as string;

    const res = await apiRequest("/api/me/password", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ old_password: "old-password-1", new_password: "new-password-2", new_ownership_ciphertext: "" }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "OWNERSHIP_CIPHERTEXT_INVALID" });
  });
});

describe("GET /api/me/ownership", () => {
  it("requires authentication", async () => {
    const res = await apiRequest("/api/me/ownership");
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "AUTH_REQUIRED" });
  });

  it("returns the caller's own ownership_pubkey and ownership_ciphertext", async () => {
    const username = "ownget1";
    const { json } = await registerUser({ username, password: "correct-password", ...OWNERSHIP });
    const token = json.token as string;

    const res = await apiRequest("/api/me/ownership", { headers: { Authorization: `Bearer ${token}` } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(OWNERSHIP);
  });
});
