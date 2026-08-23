import { beforeAll, describe, expect, it } from "vitest";
import { apiRequest, ensureMigrated, registerUser } from "./helpers";

const OWNERSHIP = { ownership_pubkey: "test-pubkey", ownership_ciphertext: "test-ciphertext-blob" };

beforeAll(async () => {
  await ensureMigrated();
});

describe("personal bio", () => {
  it("persists trimmed Unicode-code-point-limited introductions and projects them", async () => {
    const { json } = await registerUser({ username: "biowriter", password: "password123", ...OWNERSHIP });
    const token = json.token as string;
    const actor = (json.user as { actor: string; bio: string | null }).actor;
    expect((json.user as { bio: string | null }).bio).toBeNull();

    const saved = await apiRequest("/api/me/bio", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ bio: "  我是 👋 用户  " }),
    });
    expect(saved.status).toBe(200);
    expect(await saved.json()).toEqual({ bio: "我是 👋 用户" });

    const profile = await apiRequest(`/api/users/${encodeURIComponent(actor)}`, { headers: { Authorization: `Bearer ${token}` } });
    expect((await profile.json() as { bio: string | null }).bio).toBe("我是 👋 用户");

    const cleared = await apiRequest("/api/me/bio", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ bio: "   " }),
    });
    expect(await cleared.json()).toEqual({ bio: null });
  });

  it("rejects more than 512 Unicode code points", async () => {
    const { json } = await registerUser({ username: "biolimit", password: "password123", ...OWNERSHIP });
    const response = await apiRequest("/api/me/bio", {
      method: "POST",
      headers: { Authorization: `Bearer ${json.token as string}` },
      body: JSON.stringify({ bio: "👋".repeat(513) }),
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "BIO_INVALID" });
  });
});
