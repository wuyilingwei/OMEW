import { beforeAll, describe, expect, it, vi } from "vitest";
import { apiRequest, ensureMigrated, registerUser } from "./helpers";

// Task 049 (m0-protocol §7.2a): WebAuthn passkey management + passkey login.
// verifyRegistrationResponse/verifyAuthenticationResponse do real cryptographic
// assertion verification against genuine authenticator output, which nothing in
// this test suite can fabricate - those two are mocked so the tests exercise the
// actual glue logic (challenge-token issuance/verification, D1 persistence,
// ownership gating, counter-regression rejection) for real.
vi.mock("@simplewebauthn/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@simplewebauthn/server")>();
  return {
    ...actual,
    verifyRegistrationResponse: vi.fn(),
    verifyAuthenticationResponse: vi.fn(),
  };
});

import { verifyAuthenticationResponse, verifyRegistrationResponse } from "@simplewebauthn/server";

const OWNERSHIP = { ownership_pubkey: "test-pubkey", ownership_ciphertext: "test-ciphertext-blob" };

beforeAll(async () => {
  await ensureMigrated();
});

async function register(username: string, password = "password123"): Promise<string> {
  const { json } = await registerUser({ username, password, ...OWNERSHIP });
  return json.token as string;
}

function mockRegistrationVerified(credentialId: string, publicKey = "cGs") {
  vi.mocked(verifyRegistrationResponse).mockResolvedValueOnce({
    verified: true,
    registrationInfo: {
      credential: {
        id: credentialId,
        publicKey: new TextEncoder().encode(publicKey),
        counter: 0,
        transports: undefined,
      },
    },
  } as unknown as Awaited<ReturnType<typeof verifyRegistrationResponse>>);
}

describe("GET /api/me/passkeys", () => {
  it("requires authentication", async () => {
    const res = await apiRequest("/api/me/passkeys");
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "AUTH_REQUIRED" });
  });

  it("starts empty for a fresh account", async () => {
    const token = await register("pkeylist1");
    const res = await apiRequest("/api/me/passkeys", { headers: { Authorization: `Bearer ${token}` } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ passkeys: [] });
  });
});

describe("POST /api/me/passkeys/options", () => {
  it("requires authentication", async () => {
    const res = await apiRequest("/api/me/passkeys/options", { method: "POST" });
    expect(res.status).toBe(401);
  });

  it("returns registration options and a challenge_token", async () => {
    const token = await register("pkeyopt1");
    const res = await apiRequest("/api/me/passkeys/options", { method: "POST", headers: { Authorization: `Bearer ${token}` } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { options: { challenge: string; rp: { id: string } }; challenge_token: string };
    expect(body.options.challenge).toBeTruthy();
    expect(body.options.rp.id).toBe("localhost");
    expect(typeof body.challenge_token).toBe("string");
  });
});

describe("POST /api/me/passkeys", () => {
  it("rejects a missing/invalid challenge_token with 401", async () => {
    const token = await register("pkeyreg1");
    const res = await apiRequest("/api/me/passkeys", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ name: "my key", challenge_token: "garbage", response: {} }),
    });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "AUTH_REQUIRED" });
  });

  it("rejects a challenge_token minted for a different actor", async () => {
    const tokenA = await register("pkeyreg2a");
    const tokenB = await register("pkeyreg2b");
    const optionsRes = await apiRequest("/api/me/passkeys/options", { method: "POST", headers: { Authorization: `Bearer ${tokenA}` } });
    const { challenge_token } = (await optionsRes.json()) as { challenge_token: string };

    const res = await apiRequest("/api/me/passkeys", {
      method: "POST",
      headers: { Authorization: `Bearer ${tokenB}` },
      body: JSON.stringify({ name: "my key", challenge_token, response: {} }),
    });
    expect(res.status).toBe(401);
  });

  it("rejects an empty name with 400 PAYLOAD_INVALID", async () => {
    const token = await register("pkeyreg3");
    const optionsRes = await apiRequest("/api/me/passkeys/options", { method: "POST", headers: { Authorization: `Bearer ${token}` } });
    const { challenge_token } = (await optionsRes.json()) as { challenge_token: string };

    const res = await apiRequest("/api/me/passkeys", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ name: "  ", challenge_token, response: {} }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "PAYLOAD_INVALID" });
  });

  it("400s when verification fails", async () => {
    const token = await register("pkeyreg4");
    const optionsRes = await apiRequest("/api/me/passkeys/options", { method: "POST", headers: { Authorization: `Bearer ${token}` } });
    const { challenge_token } = (await optionsRes.json()) as { challenge_token: string };
    vi.mocked(verifyRegistrationResponse).mockResolvedValueOnce({ verified: false } as unknown as Awaited<ReturnType<typeof verifyRegistrationResponse>>);

    const res = await apiRequest("/api/me/passkeys", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ name: "my key", challenge_token, response: {} }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "PASSKEY_VERIFY_FAILED" });
  });

  it("persists a credential on success and lists/renames/deletes it, gated by ownership", async () => {
    const token = await register("pkeyreg5");
    const otherToken = await register("pkeyreg5-other");
    const optionsRes = await apiRequest("/api/me/passkeys/options", { method: "POST", headers: { Authorization: `Bearer ${token}` } });
    const { challenge_token } = (await optionsRes.json()) as { challenge_token: string };
    mockRegistrationVerified("cred-abc-123");

    const createRes = await apiRequest("/api/me/passkeys", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ name: "my laptop", challenge_token, response: {} }),
    });
    expect(createRes.status).toBe(200);
    const created = (await createRes.json()) as { id: string; name: string; created_at: number };
    expect(created.id).toBe("cred-abc-123");
    expect(created.name).toBe("my laptop");

    const listRes = await apiRequest("/api/me/passkeys", { headers: { Authorization: `Bearer ${token}` } });
    expect(await listRes.json()).toEqual({ passkeys: [{ id: "cred-abc-123", name: "my laptop", created_at: created.created_at }] });

    // another account can't rename or delete it
    const foreignPatch = await apiRequest(`/api/me/passkeys/${created.id}`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${otherToken}` },
      body: JSON.stringify({ name: "stolen" }),
    });
    expect(foreignPatch.status).toBe(404);
    const foreignDelete = await apiRequest(`/api/me/passkeys/${created.id}`, { method: "DELETE", headers: { Authorization: `Bearer ${otherToken}` } });
    expect(foreignDelete.status).toBe(404);

    const rename = await apiRequest(`/api/me/passkeys/${created.id}`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ name: "renamed key" }),
    });
    expect(rename.status).toBe(200);
    expect(((await rename.json()) as { name: string }).name).toBe("renamed key");

    const del = await apiRequest(`/api/me/passkeys/${created.id}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
    expect(del.status).toBe(200);
    expect(await del.json()).toEqual({ ok: true });

    const finalList = await apiRequest("/api/me/passkeys", { headers: { Authorization: `Bearer ${token}` } });
    expect(await finalList.json()).toEqual({ passkeys: [] });
  });

  it("409s on re-registering the same credential id", async () => {
    const token = await register("pkeyreg6");
    const optionsRes = await apiRequest("/api/me/passkeys/options", { method: "POST", headers: { Authorization: `Bearer ${token}` } });
    const { challenge_token } = (await optionsRes.json()) as { challenge_token: string };
    mockRegistrationVerified("cred-dup-1");
    const first = await apiRequest("/api/me/passkeys", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ name: "key one", challenge_token, response: {} }),
    });
    expect(first.status).toBe(200);

    const optionsRes2 = await apiRequest("/api/me/passkeys/options", { method: "POST", headers: { Authorization: `Bearer ${token}` } });
    const { challenge_token: challengeToken2 } = (await optionsRes2.json()) as { challenge_token: string };
    mockRegistrationVerified("cred-dup-1");
    const second = await apiRequest("/api/me/passkeys", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ name: "key two", challenge_token: challengeToken2, response: {} }),
    });
    expect(second.status).toBe(409);
    expect(await second.json()).toEqual({ error: "PASSKEY_ALREADY_REGISTERED" });
  });
});

describe("passkey login", () => {
  async function addPasskey(token: string, credentialId: string): Promise<void> {
    const optionsRes = await apiRequest("/api/me/passkeys/options", { method: "POST", headers: { Authorization: `Bearer ${token}` } });
    const { challenge_token } = (await optionsRes.json()) as { challenge_token: string };
    mockRegistrationVerified(credentialId);
    const res = await apiRequest("/api/me/passkeys", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ name: "device", challenge_token, response: {} }),
    });
    expect(res.status).toBe(200);
  }

  it("POST /api/login/passkey/options returns discoverable options with no bound actor", async () => {
    const res = await apiRequest("/api/login/passkey/options", { method: "POST" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { options: { challenge: string; allowCredentials?: unknown[] }; challenge_token: string };
    expect(body.options.challenge).toBeTruthy();
    expect(typeof body.challenge_token).toBe("string");
  });

  it("rejects an invalid/garbage challenge_token with 401 AUTH_FAILED", async () => {
    const res = await apiRequest("/api/login/passkey", {
      method: "POST",
      body: JSON.stringify({ challenge_token: "garbage", response: { id: "whatever" } }),
    });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "AUTH_FAILED" });
  });

  it("rejects an unknown credential id with 401 AUTH_FAILED", async () => {
    const optionsRes = await apiRequest("/api/login/passkey/options", { method: "POST" });
    const { challenge_token } = (await optionsRes.json()) as { challenge_token: string };
    const res = await apiRequest("/api/login/passkey", {
      method: "POST",
      body: JSON.stringify({ challenge_token, response: { id: "no-such-credential" } }),
    });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "AUTH_FAILED" });
  });

  it("issues a session on a verified assertion with counter advancing", async () => {
    const token = await register("pkeylogin1");
    await addPasskey(token, "cred-login-1");

    const optionsRes = await apiRequest("/api/login/passkey/options", { method: "POST" });
    const { challenge_token } = (await optionsRes.json()) as { challenge_token: string };
    vi.mocked(verifyAuthenticationResponse).mockResolvedValueOnce({
      verified: true,
      authenticationInfo: { newCounter: 1 },
    } as unknown as Awaited<ReturnType<typeof verifyAuthenticationResponse>>);

    const res = await apiRequest("/api/login/passkey", {
      method: "POST",
      body: JSON.stringify({ challenge_token, response: { id: "cred-login-1" } }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { token: string; user: { username: string } };
    expect(body.token).toBeTruthy();
    expect(body.user.username).toBe("pkeylogin1");
  });

  it("rejects a counter regression (cloned authenticator) and leaves the stored counter untouched", async () => {
    const token = await register("pkeylogin2");
    await addPasskey(token, "cred-login-2");

    // First a legitimate use bumps the counter to 5.
    const opts1 = await apiRequest("/api/login/passkey/options", { method: "POST" });
    const { challenge_token: ct1 } = (await opts1.json()) as { challenge_token: string };
    vi.mocked(verifyAuthenticationResponse).mockResolvedValueOnce({
      verified: true,
      authenticationInfo: { newCounter: 5 },
    } as unknown as Awaited<ReturnType<typeof verifyAuthenticationResponse>>);
    const first = await apiRequest("/api/login/passkey", { method: "POST", body: JSON.stringify({ challenge_token: ct1, response: { id: "cred-login-2" } }) });
    expect(first.status).toBe(200);

    // A second assertion reporting a lower counter than stored is a clone signal.
    const opts2 = await apiRequest("/api/login/passkey/options", { method: "POST" });
    const { challenge_token: ct2 } = (await opts2.json()) as { challenge_token: string };
    vi.mocked(verifyAuthenticationResponse).mockResolvedValueOnce({
      verified: true,
      authenticationInfo: { newCounter: 3 },
    } as unknown as Awaited<ReturnType<typeof verifyAuthenticationResponse>>);
    const second = await apiRequest("/api/login/passkey", { method: "POST", body: JSON.stringify({ challenge_token: ct2, response: { id: "cred-login-2" } }) });
    expect(second.status).toBe(401);
    expect(await second.json()).toEqual({ error: "AUTH_FAILED" });

    // A legitimate follow-up above the stored counter (5) still works - proves
    // the regressed attempt didn't get persisted as the new baseline.
    const opts3 = await apiRequest("/api/login/passkey/options", { method: "POST" });
    const { challenge_token: ct3 } = (await opts3.json()) as { challenge_token: string };
    vi.mocked(verifyAuthenticationResponse).mockResolvedValueOnce({
      verified: true,
      authenticationInfo: { newCounter: 6 },
    } as unknown as Awaited<ReturnType<typeof verifyAuthenticationResponse>>);
    const third = await apiRequest("/api/login/passkey", { method: "POST", body: JSON.stringify({ challenge_token: ct3, response: { id: "cred-login-2" } }) });
    expect(third.status).toBe(200);
  });

  it("rejects replaying the same (challenge_token, response) pair a second time", async () => {
    const token = await register("pkeylogin3");
    await addPasskey(token, "cred-login-3");

    const opts = await apiRequest("/api/login/passkey/options", { method: "POST" });
    const { challenge_token } = (await opts.json()) as { challenge_token: string };
    vi.mocked(verifyAuthenticationResponse).mockResolvedValue({
      verified: true,
      authenticationInfo: { newCounter: 1 },
    } as unknown as Awaited<ReturnType<typeof verifyAuthenticationResponse>>);

    const first = await apiRequest("/api/login/passkey", {
      method: "POST",
      body: JSON.stringify({ challenge_token, response: { id: "cred-login-3" } }),
    });
    expect(first.status).toBe(200);

    const replay = await apiRequest("/api/login/passkey", {
      method: "POST",
      body: JSON.stringify({ challenge_token, response: { id: "cred-login-3" } }),
    });
    expect(replay.status).toBe(401);
    expect(await replay.json()).toEqual({ error: "AUTH_FAILED" });
  });
});
