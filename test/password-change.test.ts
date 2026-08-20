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
});
