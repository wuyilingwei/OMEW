import { describe, expect, it } from "vitest";
import { apiRequest, ensureMigrated, registerUser } from "./helpers";
import { env } from "cloudflare:test";

const OWNERSHIP = { ownership_pubkey: "activity-pubkey", ownership_ciphertext: "activity-ciphertext" };

describe("成员最近活跃投影", () => {
  it("登录会记录本地用户活动并由成员 API 投影", async () => {
    await ensureMigrated();
    const username = `activity${Date.now().toString(36)}`;
    const registered = await registerUser({ username, password: "password123", ...OWNERSHIP });
    expect(registered.status).toBe(200);
    const token = registered.json.token as string;

    const stronghold = await apiRequest("/api/strongholds", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ name: "Activity roster test" }),
    });
    expect(stronghold.status).toBe(201);
    const { id } = (await stronghold.json()) as { id: string };

    const user = await env.DB.prepare("SELECT last_active_at FROM users WHERE localpart = ?")
      .bind(username)
      .first<{ last_active_at: number | null }>();
    expect(user?.last_active_at).toEqual(expect.any(Number));

    const members = await apiRequest(`/api/stronghold/${id}/members?tab=all`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(members.status).toBe(200);
    const body = (await members.json()) as { entries: Array<{ actor: string; last_active_at: number | null }> };
    expect(body.entries.find((entry) => entry.actor.includes(username))?.last_active_at).toEqual(expect.any(Number));
  });
});
