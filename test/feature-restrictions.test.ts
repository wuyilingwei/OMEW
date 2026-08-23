import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { apiRequest, connectRoom, ensureMigrated, itemCreateFrame, nextMessage, sessionToken } from "./helpers";

let sequence = 0;

async function stronghold(owner: string): Promise<{ id: string; chat: string; posts: string }> {
  const id = `restrictions${Date.now()}${sequence++}`;
  const stub = env.STRONGHOLD_DO.getByName(id);
  await stub.initConfig(id, "Restrictions", "public", owner);
  await stub.createRoom("chat", "channel", "Chat", ["text"], false);
  await stub.createRoom("posts", "section", "Posts", ["text"], false);
  return { id, chat: `${id}/ch/chat`, posts: `${id}/sec/posts` };
}

function sectionPost(clientId: string, text = "body"): string {
  return JSON.stringify({ type: "item.create", client_id: clientId, kind: "post", body: { title: "Title", text } });
}

beforeAll(async () => {
  await ensureMigrated();
});

describe("stronghold feature restrictions", () => {
  it("returns both layers and only the actual stronghold owner can set an owner policy", async () => {
    const owner = "@featureowner:local";
    const mod = "@featuremod:local";
    const serverAdmin = "@featureserveradmin:local";
    const created = await stronghold(owner);
    await env.STRONGHOLD_DO.getByName(created.id).addMember(mod, "mod");
    const ownerToken = await sessionToken(owner);
    const modToken = await sessionToken(mod);
    const adminToken = await sessionToken(serverAdmin, "admin");

    const initial = await apiRequest(`/api/stronghold/${created.id}/feature-restrictions`, { headers: { Authorization: `Bearer ${modToken}` } });
    expect(initial.status).toBe(200);
    expect(await initial.json()).toMatchObject({
      chat: { owner: { paused: false, expires_at: null }, server: { mode: "inherit", expires_at: null }, effective: { paused: false } },
      posts: { effective: { paused: false } },
    });

    const byMod = await apiRequest(`/api/stronghold/${created.id}/feature-restrictions/owner`, {
      method: "PATCH", headers: { Authorization: `Bearer ${modToken}` }, body: JSON.stringify({ feature: "chat", paused: true }),
    });
    expect(byMod.status).toBe(403);
    const byServerAdmin = await apiRequest(`/api/stronghold/${created.id}/feature-restrictions/owner`, {
      method: "PATCH", headers: { Authorization: `Bearer ${adminToken}` }, body: JSON.stringify({ feature: "chat", paused: true }),
    });
    expect(byServerAdmin.status).toBe(403);
    const byOrdinaryOwner = await apiRequest(`/api/stronghold/${created.id}/feature-restrictions/server`, {
      method: "PATCH", headers: { Authorization: `Bearer ${ownerToken}` }, body: JSON.stringify({ feature: "chat", mode: "force_pause" }),
    });
    expect(byOrdinaryOwner.status).toBe(403);

    const paused = await apiRequest(`/api/stronghold/${created.id}/feature-restrictions/owner`, {
      method: "PATCH", headers: { Authorization: `Bearer ${ownerToken}` }, body: JSON.stringify({ feature: "chat", paused: true, expires_at: Date.now() + 60_000 }),
    });
    expect(paused.status).toBe(200);
    expect(await paused.json()).toMatchObject({ chat: { owner: { paused: true }, effective: { paused: true } } });
  });

  it("enforces chat and post pauses in already connected RoomDO sockets without allocating a sequence", async () => {
    const owner = "@featurewriterowner:local";
    const actor = "@featurewriter:local";
    const created = await stronghold(owner);
    const ownerToken = await sessionToken(owner);
    const chat = await connectRoom(created.chat, actor, "member");
    const posts = await connectRoom(created.posts, actor, "member");

    await apiRequest(`/api/stronghold/${created.id}/feature-restrictions/owner`, {
      method: "PATCH", headers: { Authorization: `Bearer ${ownerToken}` }, body: JSON.stringify({ feature: "chat", paused: true }),
    });
    chat.ws.send(itemCreateFrame("chat-paused", "no"));
    expect(await nextMessage(chat.ws)).toMatchObject({ type: "error", code: "OMEW_FEATURE_RESTRICTED", message: "chat is temporarily paused" });

    await apiRequest(`/api/stronghold/${created.id}/feature-restrictions/owner`, {
      method: "PATCH", headers: { Authorization: `Bearer ${ownerToken}` }, body: JSON.stringify({ feature: "chat", paused: false }),
    });
    chat.ws.send(itemCreateFrame("chat-open", "yes"));
    expect(await nextMessage(chat.ws)).toMatchObject({ type: "ack", status: "ok", seq: 1 });

    await apiRequest(`/api/stronghold/${created.id}/feature-restrictions/owner`, {
      method: "PATCH", headers: { Authorization: `Bearer ${ownerToken}` }, body: JSON.stringify({ feature: "posts", paused: true }),
    });
    posts.ws.send(sectionPost("post-paused"));
    expect(await nextMessage(posts.ws)).toMatchObject({ type: "error", code: "OMEW_FEATURE_RESTRICTED", message: "posts is temporarily paused" });

    await apiRequest(`/api/stronghold/${created.id}/feature-restrictions/owner`, {
      method: "PATCH", headers: { Authorization: `Bearer ${ownerToken}` }, body: JSON.stringify({ feature: "posts", paused: false }),
    });
    posts.ws.send(sectionPost("post-open"));
    const postAck = await nextMessage(posts.ws);
    expect(postAck).toMatchObject({ type: "ack", status: "ok", seq: 1 });
    await apiRequest(`/api/stronghold/${created.id}/feature-restrictions/owner`, {
      method: "PATCH", headers: { Authorization: `Bearer ${ownerToken}` }, body: JSON.stringify({ feature: "posts", paused: true }),
    });
    posts.ws.send(JSON.stringify({ type: "item.create", client_id: "reply-paused", kind: "reply", parent_seq: postAck.seq, body: { text: "reply" } }));
    expect(await nextMessage(posts.ws)).toMatchObject({ type: "error", code: "OMEW_FEATURE_RESTRICTED", message: "posts is temporarily paused" });
    await apiRequest(`/api/stronghold/${created.id}/feature-restrictions/owner`, {
      method: "PATCH", headers: { Authorization: `Bearer ${ownerToken}` }, body: JSON.stringify({ feature: "posts", paused: false }),
    });
    posts.ws.send(JSON.stringify({ type: "item.create", client_id: "reply-open", kind: "reply", parent_seq: postAck.seq, body: { text: "reply" } }));
    expect(await nextMessage(posts.ws)).toMatchObject({ type: "ack", status: "ok", seq: 2 });
    chat.ws.close();
    posts.ws.close();
  });

  it("lets a server admin force allow or force pause, while expiry falls back to the owner policy on a cached RoomDO snapshot", async () => {
    const owner = "@featureprecedenceowner:local";
    const admin = "@featureprecedenceadmin:local";
    const actor = "@featureprecedencewriter:local";
    const created = await stronghold(owner);
    const ownerToken = await sessionToken(owner);
    const adminToken = await sessionToken(admin, "admin");
    const room = await connectRoom(created.chat, actor, "member");

    await apiRequest(`/api/stronghold/${created.id}/feature-restrictions/owner`, {
      method: "PATCH", headers: { Authorization: `Bearer ${ownerToken}` }, body: JSON.stringify({ feature: "chat", paused: true }),
    });
    const allow = await apiRequest(`/api/stronghold/${created.id}/feature-restrictions/server`, {
      method: "PATCH", headers: { Authorization: `Bearer ${adminToken}` }, body: JSON.stringify({ feature: "chat", mode: "force_allow" }),
    });
    expect(allow.status).toBe(200);
    expect(await allow.json()).toMatchObject({ chat: { effective: { paused: false } } });
    room.ws.send(itemCreateFrame("allowed", "allowed"));
    expect(await nextMessage(room.ws)).toMatchObject({ type: "ack", status: "ok" });

    const expiry = Date.now() + 20;
    const pause = await apiRequest(`/api/stronghold/${created.id}/feature-restrictions/server`, {
      method: "PATCH", headers: { Authorization: `Bearer ${adminToken}` }, body: JSON.stringify({ feature: "chat", mode: "force_pause", expires_at: expiry }),
    });
    expect(pause.status).toBe(200);
    room.ws.send(itemCreateFrame("forced", "no"));
    expect(await nextMessage(room.ws)).toMatchObject({ type: "error", code: "OMEW_FEATURE_RESTRICTED", message: "chat is temporarily paused" });
    await new Promise((resolve) => setTimeout(resolve, 30));
    room.ws.send(itemCreateFrame("fallback", "still owner paused"));
    expect(await nextMessage(room.ws)).toMatchObject({ type: "error", code: "OMEW_FEATURE_RESTRICTED", message: "chat is temporarily paused" });
    room.ws.close();
  });

  it("makes an expired owner pause fall back to allow in the GET effective state", async () => {
    const owner = "@featureownerexpiry:local";
    const created = await stronghold(owner);
    const token = await sessionToken(owner);
    const set = await apiRequest(`/api/stronghold/${created.id}/feature-restrictions/owner`, {
      method: "PATCH", headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify({ feature: "posts", paused: true, expires_at: Date.now() + 20 }),
    });
    expect(set.status).toBe(200);
    await new Promise((resolve) => setTimeout(resolve, 30));
    const read = await apiRequest(`/api/stronghold/${created.id}/feature-restrictions`, { headers: { Authorization: `Bearer ${token}` } });
    expect(await read.json()).toMatchObject({ posts: { owner: { paused: true }, effective: { paused: false } } });
  });

  it("initializes a newly created room with the current restriction snapshot", async () => {
    const owner = "@featurenewroomowner:local";
    const id = `restrictions-new${Date.now()}${sequence++}`;
    const stub = env.STRONGHOLD_DO.getByName(id);
    await stub.initConfig(id, "Restrictions", "public", owner);
    const token = await sessionToken(owner);
    const configured = await apiRequest(`/api/stronghold/${id}/feature-restrictions/owner`, {
      method: "PATCH", headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify({ feature: "chat", paused: true }),
    });
    expect(configured.status).toBe(200);
    await stub.createRoom("later", "channel", "Later", ["text"], false);
    const room = await connectRoom(`${id}/ch/later`, "@featurenewroomwriter:local", "member");
    room.ws.send(itemCreateFrame("blocked-in-new-room", "no"));
    expect(await nextMessage(room.ws)).toMatchObject({ type: "error", code: "OMEW_FEATURE_RESTRICTED", message: "chat is temporarily paused" });
    room.ws.close();
  });

  it("refreshes an old RoomDO snapshot from StrongholdDO instead of permanently bypassing a missed push", async () => {
    const owner = "@featurequerybackowner:local";
    const created = await stronghold(owner);
    const room = await connectRoom(created.chat, "@featurequerybackwriter:local", "member");
    room.ws.send(itemCreateFrame("cached-allow", "yes"));
    expect(await nextMessage(room.ws)).toMatchObject({ type: "ack", status: "ok" });

    await env.DB.prepare(
      "INSERT INTO stronghold_feature_overrides (stronghold_id, feature, mode, expires_at, updated_by, updated_at) VALUES (?, 'chat', 'force_pause', NULL, ?, ?)"
    ).bind(created.id, owner, Date.now()).run();
    room.ws.send(itemCreateFrame("queryback-blocked", "no"));
    expect(await nextMessage(room.ws)).toMatchObject({ type: "error", code: "OMEW_FEATURE_RESTRICTED", message: "chat is temporarily paused" });
    room.ws.close();
  });
});
