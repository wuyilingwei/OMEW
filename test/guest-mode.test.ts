import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { apiRequest, connectRoom, ensureMigrated, loginAs, nextMessage, postCreateFrame, registerUser } from "./helpers";

// Task 034: unauthenticated guest reads on public strongholds, gated by the
// allow_guest_browsing instance policy - env config as of task 035 (see
// server/src/config.ts), no longer the instance_config D1 column - and the
// public directory endpoint the same policy gates. Write paths are untouched
// and stay login-only regardless of the policy.

let strongholdSeq = 0;
async function freshStronghold(
  ownerActor: string,
  visibility: "public" | "private" = "public"
): Promise<{ id: string; sectionResId: string; channelResId: string }> {
  const id = `guest${Date.now()}${strongholdSeq++}`;
  const stub = env.STRONGHOLD_DO.getByName(id);
  await stub.initConfig(id, "Guest Test Stronghold", visibility, ownerActor, "a test stronghold");
  await stub.createRoom("lobby", "channel", "Lobby", ["text"], false);
  await stub.createRoom("posts", "section", "Posts", ["text"], false);
  return { id, sectionResId: "posts", channelResId: "lobby" };
}

function setGuestBrowsing(allow: boolean): void {
  env.ALLOW_GUEST_BROWSING = allow ? "1" : "0";
}

beforeAll(async () => {
  await ensureMigrated();
});

describe("guest read access matrix", () => {
  it("public stronghold + policy on: config/rooms/posts/post-detail/history all succeed with no token", async () => {
    await setGuestBrowsing(true);
    const owner = "@guestowner1:local";
    const { id, sectionResId, channelResId } = await freshStronghold(owner, "public");

    const { ws } = await connectRoom(`${id}/sec/${sectionResId}`, owner, "owner");
    ws.send(postCreateFrame("g1", "A guest-visible post", "body text"));
    const ack = (await nextMessage(ws)) as { seq: number };
    ws.close();

    const configRes = await apiRequest(`/api/stronghold/${id}/config`);
    expect(configRes.status).toBe(200);
    expect((await configRes.json()) as Record<string, unknown>).toMatchObject({ id, visibility: "public" });

    const roomsRes = await apiRequest(`/api/stronghold/${id}/rooms`);
    expect(roomsRes.status).toBe(200);
    const rooms = (await roomsRes.json()) as Array<{ id: string }>;
    expect(rooms.some((r) => r.id === sectionResId)).toBe(true);
    expect(rooms.some((r) => r.id === channelResId)).toBe(true);

    const postsRes = await apiRequest(`/api/stronghold/${id}/rooms/${sectionResId}/posts`);
    expect(postsRes.status).toBe(200);

    const postDetailRes = await apiRequest(`/api/stronghold/${id}/rooms/${sectionResId}/posts/${ack.seq}`);
    expect(postDetailRes.status).toBe(200);
    const detail = (await postDetailRes.json()) as { post: { post_seq: number } };
    expect(detail.post.post_seq).toBe(ack.seq);

    const historyRes = await apiRequest(`/stronghold/${id}/rooms/${channelResId}/history`);
    expect(historyRes.status).toBe(200);
  });

  it("private stronghold: unauthenticated reads are 401 regardless of the guest policy", async () => {
    await setGuestBrowsing(true);
    const owner = "@guestowner2:local";
    const { id, sectionResId, channelResId } = await freshStronghold(owner, "private");

    expect((await apiRequest(`/api/stronghold/${id}/config`)).status).toBe(401);
    expect((await apiRequest(`/api/stronghold/${id}/rooms`)).status).toBe(401);
    expect((await apiRequest(`/api/stronghold/${id}/rooms/${sectionResId}/posts`)).status).toBe(401);
    const historyRes = await apiRequest(`/stronghold/${id}/rooms/${channelResId}/history`);
    expect(historyRes.status).toBe(401);
    expect(await historyRes.json()).toEqual({ error: { code: "OMEW_SESSION_INVALID", message: "auth required" } });
  });

  it("public stronghold + policy off: unauthenticated reads are 401", async () => {
    await setGuestBrowsing(false);
    const owner = "@guestowner3:local";
    const { id, sectionResId, channelResId } = await freshStronghold(owner, "public");

    const configRes = await apiRequest(`/api/stronghold/${id}/config`);
    expect(configRes.status).toBe(401);
    expect(await configRes.json()).toEqual({ error: "AUTH_REQUIRED" });
    expect((await apiRequest(`/api/stronghold/${id}/rooms`)).status).toBe(401);
    expect((await apiRequest(`/api/stronghold/${id}/rooms/${sectionResId}/posts`)).status).toBe(401);
    expect((await apiRequest(`/stronghold/${id}/rooms/${channelResId}/history`)).status).toBe(401);

    await setGuestBrowsing(true);
  });

  it("a restricted room is hidden from the guest room list and 404s for guest posts/history", async () => {
    await setGuestBrowsing(true);
    const owner = "@guestowner4:local";
    const { id } = await freshStronghold(owner, "public");
    const stub = env.STRONGHOLD_DO.getByName(id);
    await stub.createRoom("secret", "section", "Secret", ["text"], true);

    const roomsRes = await apiRequest(`/api/stronghold/${id}/rooms`);
    const rooms = (await roomsRes.json()) as Array<{ id: string }>;
    expect(rooms.some((r) => r.id === "secret")).toBe(false);

    expect((await apiRequest(`/api/stronghold/${id}/rooms/secret/posts`)).status).toBe(404);
    expect((await apiRequest(`/stronghold/${id}/rooms/secret/history`)).status).toBe(404);
  });
});

describe("guest write access", () => {
  it("write endpoints stay login-only even on a public stronghold with the policy on", async () => {
    await setGuestBrowsing(true);
    const owner = "@guestowner5:local";
    const { id } = await freshStronghold(owner, "public");

    const createRoomRes = await apiRequest(`/api/stronghold/${id}/rooms`, {
      method: "POST",
      body: JSON.stringify({ name: "New Room" }),
    });
    expect(createRoomRes.status).toBe(401);

    const patchRes = await apiRequest(`/api/stronghold/${id}/config`, {
      method: "PATCH",
      body: JSON.stringify({ description: "hijacked" }),
    });
    expect(patchRes.status).toBe(401);

    const joinRes = await apiRequest(`/api/stronghold/${id}/join`, { method: "POST" });
    expect(joinRes.status).toBe(401);
  });
});

describe("GET /api/directory", () => {
  it("lists public strongholds with id/name/description/cover/member_count when the policy is on", async () => {
    await setGuestBrowsing(true);
    const owner = "@directoryowner1:local";
    const { id } = await freshStronghold(owner, "public");
    const privateOne = await freshStronghold("@directoryowner1b:local", "private");

    const res = await apiRequest("/api/directory");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { strongholds: Array<Record<string, unknown>> };
    const entry = body.strongholds.find((s) => s.id === id);
    expect(entry).toMatchObject({ id, name: "Guest Test Stronghold", description: "a test stronghold", cover: null, member_count: 1 });
    expect(body.strongholds.some((s) => s.id === privateOne.id)).toBe(false);
  });

  it("returns 404 when the guest policy is off", async () => {
    await setGuestBrowsing(false);
    const res = await apiRequest("/api/directory");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "NOT_FOUND" });
    await setGuestBrowsing(true);
  });
});

describe("admin instance config: allow_guest_browsing is env, not runtime-writable", () => {
  it("GET reflects the env value; it also appears in the public GET /api/instance/config subset", async () => {
    await env.DB.prepare("DELETE FROM users WHERE localpart = ?").bind("guestadmin1").run();
    const reg = await registerUser({
      username: "guestadmin1",
      password: "password123",
      ownership_pubkey: "test-pubkey",
      ownership_ciphertext: "test-ciphertext-blob",
    });
    expect(reg.status).toBe(200);
    await env.DB.prepare("UPDATE users SET server_role = 'admin' WHERE localpart = ?").bind("guestadmin1").run();
    const token = await loginAs("guestadmin1");

    setGuestBrowsing(false);
    const getRes = await apiRequest("/api/admin/instance/config", { headers: { Authorization: `Bearer ${token}` } });
    expect((await getRes.json() as Record<string, unknown>).allow_guest_browsing).toBe(false);

    const publicRes = await apiRequest("/api/instance/config");
    expect((await publicRes.json() as Record<string, unknown>).allow_guest_browsing).toBe(false);

    setGuestBrowsing(true);
  });

  it("PATCH 409s with POLICY_IS_ENV instead of writing allow_guest_browsing", async () => {
    await env.DB.prepare("DELETE FROM users WHERE localpart = ?").bind("guestadmin2").run();
    const reg = await registerUser({
      username: "guestadmin2",
      password: "password123",
      ownership_pubkey: "test-pubkey",
      ownership_ciphertext: "test-ciphertext-blob",
    });
    await env.DB.prepare("UPDATE users SET server_role = 'admin' WHERE localpart = ?").bind("guestadmin2").run();
    const token = await loginAs("guestadmin2");

    const res = await apiRequest("/api/admin/instance/config", {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ allow_guest_browsing: false }),
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "POLICY_IS_ENV" });
  });
});
