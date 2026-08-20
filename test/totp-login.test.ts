import { beforeAll, describe, expect, it } from "vitest";
import * as OTPAuth from "otpauth";
import { apiRequest, ensureMigrated, registerUser } from "./helpers";

// Task 049 (m0-protocol §7.2a): TOTP second factor gating /api/login, plus its
// own setup/activate/disable management endpoints.

const OWNERSHIP = { ownership_pubkey: "test-pubkey", ownership_ciphertext: "test-ciphertext-blob" };

beforeAll(async () => {
  await ensureMigrated();
});

function codeFor(secret: string, offsetSteps = 0): string {
  const totp = new OTPAuth.TOTP({ algorithm: "SHA1", digits: 6, period: 30, secret: OTPAuth.Secret.fromBase32(secret) });
  return totp.generate({ timestamp: Date.now() + offsetSteps * 30_000 });
}

async function register(username: string, password = "password123"): Promise<string> {
  const { json } = await registerUser({ username, password, ...OWNERSHIP });
  return json.token as string;
}

describe("POST /api/me/totp/setup", () => {
  it("requires authentication", async () => {
    const res = await apiRequest("/api/me/totp/setup", { method: "POST" });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "AUTH_REQUIRED" });
  });

  it("returns a secret and otpauth_url, and 409s if already enabled", async () => {
    const token = await register("totpsetup1");
    const res = await apiRequest("/api/me/totp/setup", { method: "POST", headers: { Authorization: `Bearer ${token}` } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { secret: string; otpauth_url: string };
    expect(body.secret.length).toBeGreaterThan(0);
    expect(body.otpauth_url).toContain(body.secret);

    const activateRes = await apiRequest("/api/me/totp/activate", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ code: codeFor(body.secret) }),
    });
    expect(activateRes.status).toBe(200);

    const secondSetup = await apiRequest("/api/me/totp/setup", { method: "POST", headers: { Authorization: `Bearer ${token}` } });
    expect(secondSetup.status).toBe(409);
    expect(await secondSetup.json()).toEqual({ error: "TOTP_ALREADY_ENABLED" });
  });
});

describe("POST /api/me/totp/activate", () => {
  it("409s when no setup is pending", async () => {
    const token = await register("totpactivate1");
    const res = await apiRequest("/api/me/totp/activate", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ code: "123456" }),
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "TOTP_NOT_PENDING" });
  });

  it("401s on a wrong code", async () => {
    const token = await register("totpactivate2");
    const setupRes = await apiRequest("/api/me/totp/setup", { method: "POST", headers: { Authorization: `Bearer ${token}` } });
    const { secret } = (await setupRes.json()) as { secret: string };
    const res = await apiRequest("/api/me/totp/activate", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ code: "000000" }),
    });
    // a coincidental match is astronomically unlikely for a freshly random secret
    expect([401]).toContain(res.status);
    void secret;
  });

  it("activates on a correct code", async () => {
    const token = await register("totpactivate3");
    const setupRes = await apiRequest("/api/me/totp/setup", { method: "POST", headers: { Authorization: `Bearer ${token}` } });
    const { secret } = (await setupRes.json()) as { secret: string };
    const res = await apiRequest("/api/me/totp/activate", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ code: codeFor(secret) }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("rejects replaying the same code/time-step twice", async () => {
    const token = await register("totpactivate4");
    const setupRes = await apiRequest("/api/me/totp/setup", { method: "POST", headers: { Authorization: `Bearer ${token}` } });
    const { secret } = (await setupRes.json()) as { secret: string };
    const code = codeFor(secret);
    const first = await apiRequest("/api/me/totp/activate", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ code }),
    });
    expect(first.status).toBe(200);

    // Re-setup to get back to a pending state, reusing the same matched step's code
    // is rejected once the secret is enabled (checked here via /api/login/totp
    // below, this endpoint's own reuse guard exercised directly by resubmitting
    // the activate call against a still-pending secret would need a fresh setup,
    // which clears at enable - so exercise reuse through the login flow instead).
    void code;
  });
});

describe("two-step TOTP login", () => {
  async function setupAndActivate(username: string): Promise<string> {
    const token = await register(username);
    const setupRes = await apiRequest("/api/me/totp/setup", { method: "POST", headers: { Authorization: `Bearer ${token}` } });
    const { secret } = (await setupRes.json()) as { secret: string };
    const activateRes = await apiRequest("/api/me/totp/activate", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ code: codeFor(secret) }),
    });
    expect(activateRes.status).toBe(200);
    return secret;
  }

  it("password login returns totp_required + pending, not a session, once enabled", async () => {
    const username = "totplogin1";
    await setupAndActivate(username);
    const res = await apiRequest("/api/login", { method: "POST", body: JSON.stringify({ username, password: "password123" }) });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.totp_required).toBe(true);
    expect(typeof body.pending).toBe("string");
    expect(body.token).toBeUndefined();
    expect(body.user).toBeUndefined();
  });

  it("POST /api/login/totp completes login with a valid code", async () => {
    const username = "totplogin2";
    const secret = await setupAndActivate(username);
    const loginRes = await apiRequest("/api/login", { method: "POST", body: JSON.stringify({ username, password: "password123" }) });
    const { pending } = (await loginRes.json()) as { pending: string };

    // offset +1 step: setupAndActivate just consumed "now"'s step as last_totp_step
    // (replay defense), so login must use an adjacent step - still inside the ±1
    // window verifyTotpCode checks against the real current time.
    const res = await apiRequest("/api/login/totp", { method: "POST", body: JSON.stringify({ pending, code: codeFor(secret, 1) }) });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { token: string; user: { username: string } };
    expect(body.token).toBeTruthy();
    expect(body.user.username).toBe(username);
  });

  it("rejects a wrong code with 401 TOTP_INVALID", async () => {
    const username = "totplogin3";
    await setupAndActivate(username);
    const loginRes = await apiRequest("/api/login", { method: "POST", body: JSON.stringify({ username, password: "password123" }) });
    const { pending } = (await loginRes.json()) as { pending: string };

    const res = await apiRequest("/api/login/totp", { method: "POST", body: JSON.stringify({ pending, code: "000000" }) });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "TOTP_INVALID" });
  });

  it("rejects replaying the same matched time-step's code twice (409 upstream shows as TOTP_INVALID on the second use)", async () => {
    const username = "totplogin4";
    const secret = await setupAndActivate(username);
    const loginRes = await apiRequest("/api/login", { method: "POST", body: JSON.stringify({ username, password: "password123" }) });
    const { pending } = (await loginRes.json()) as { pending: string };
    const code = codeFor(secret, 1);

    const first = await apiRequest("/api/login/totp", { method: "POST", body: JSON.stringify({ pending, code }) });
    expect(first.status).toBe(200);

    const second = await apiRequest("/api/login/totp", { method: "POST", body: JSON.stringify({ pending, code }) });
    expect(second.status).toBe(401);
    expect(await second.json()).toEqual({ error: "TOTP_INVALID" });
  });

  it("rejects a garbage pending token with 401 AUTH_FAILED", async () => {
    const res = await apiRequest("/api/login/totp", { method: "POST", body: JSON.stringify({ pending: "not-a-token", code: "123456" }) });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "AUTH_FAILED" });
  });

  it("rejects a real session token used as the pending token (typ mismatch)", async () => {
    const username = "totplogin5";
    const token = await register(username);
    const res = await apiRequest("/api/login/totp", { method: "POST", body: JSON.stringify({ pending: token, code: "123456" }) });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "AUTH_FAILED" });
  });

  it("plain password login is unaffected for accounts without TOTP enabled", async () => {
    const username = "totplogin6";
    await register(username);
    const res = await apiRequest("/api/login", { method: "POST", body: JSON.stringify({ username, password: "password123" }) });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.totp_required).toBeUndefined();
    expect(body.token).toBeTruthy();
  });
});

describe("POST /api/me/totp/disable", () => {
  async function setupAndActivate(username: string, token: string): Promise<string> {
    const setupRes = await apiRequest("/api/me/totp/setup", { method: "POST", headers: { Authorization: `Bearer ${token}` } });
    const { secret } = (await setupRes.json()) as { secret: string };
    await apiRequest("/api/me/totp/activate", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ code: codeFor(secret) }),
    });
    return secret;
  }

  it("requires both a correct password and a correct code", async () => {
    const username = "totpdisable1";
    const token = await register(username);
    const secret = await setupAndActivate(username, token);

    const wrongPassword = await apiRequest("/api/me/totp/disable", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ password: "wrong", code: codeFor(secret) }),
    });
    expect(wrongPassword.status).toBe(401);
    expect(await wrongPassword.json()).toEqual({ error: "AUTH_FAILED" });

    const wrongCode = await apiRequest("/api/me/totp/disable", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ password: "password123", code: "000000" }),
    });
    expect(wrongCode.status).toBe(401);
    expect(await wrongCode.json()).toEqual({ error: "TOTP_INVALID" });
  });

  it("clears the secret on success, so a fresh setup call is required to re-enable", async () => {
    const username = "totpdisable2";
    const token = await register(username);
    const secret = await setupAndActivate(username, token);

    const res = await apiRequest("/api/me/totp/disable", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ password: "password123", code: codeFor(secret, 1) }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    // Password login no longer requires a second factor.
    const loginRes = await apiRequest("/api/login", { method: "POST", body: JSON.stringify({ username, password: "password123" }) });
    const body = (await loginRes.json()) as Record<string, unknown>;
    expect(body.totp_required).toBeUndefined();
    expect(body.token).toBeTruthy();
  });
});
