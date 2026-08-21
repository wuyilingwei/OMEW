import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import {
  apiRequest,
  connectRoom,
  ensureMigrated,
  nextMessage,
  postCreateFrame,
  replyCreateFrame,
  sessionToken,
} from "./helpers";

// stronghold-wide topic pool (post tags) + room management (rename/delete) +
// topic-filtered post listing. Mirrors stronghold-management.test.ts /
// section-posts.test.ts helpers and conventions.

beforeAll(async () => {
  await ensureMigrated();
});

let strongholdSeq = 0;
async function freshStronghold(ownerActor: string): Promise<string> {
  const id = `topic${Date.now()}${strongholdSeq++}`;
  const stub = env.STRONGHOLD_DO.getByName(id);
  await stub.initConfig(id, "Topic Test", "public", ownerActor);
  return id;
}

function postFrame(clientId: string, title: string, text: string, topics?: string[]): string {
  return JSON.stringify({
    type: "item.create",
    client_id: clientId,
    kind: "post",
    body: { title, text, ...(topics ? { topics } : {}) },
  });
}

describe("topic CRUD", () => {
  it("owner creates, lists, renames, and deletes a topic", async () => {
    const owner = "@topicowner1:local";
    const id = await freshStronghold(owner);
    const token = await sessionToken(owner);

    const createRes = await apiRequest(`/api/stronghold/${id}/topics`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ name: "Announce", color: "#345bac" }),
    });
    expect(createRes.status).toBe(201);
    const topic = (await createRes.json()) as { id: string; name: string; color: string | null; position: number };
    expect(topic).toMatchObject({ name: "Announce", color: "#345bac", position: 0 });

    const listRes = await apiRequest(`/api/stronghold/${id}/topics`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const list = (await listRes.json()) as Array<Record<string, unknown>>;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: topic.id, name: "Announce" });

    const patchRes = await apiRequest(`/api/stronghold/${id}/topics/${topic.id}`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ name: "Renamed", position: 5 }),
    });
    expect(patchRes.status).toBe(200);
    expect(await patchRes.json()).toMatchObject({ name: "Renamed", position: 5 });

    const deleteRes = await apiRequest(`/api/stronghold/${id}/topics/${topic.id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(deleteRes.status).toBe(204);

    const emptyListRes = await apiRequest(`/api/stronghold/${id}/topics`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(await emptyListRes.json()).toEqual([]);
  });

  it("rejects a non-owner/mod with FORBIDDEN", async () => {
    const owner = "@topicowner2:local";
    const id = await freshStronghold(owner);
    const stub = env.STRONGHOLD_DO.getByName(id);
    await stub.addMember("@topicmember2:local", "member");
    const memberToken = await sessionToken("@topicmember2:local");

    const res = await apiRequest(`/api/stronghold/${id}/topics`, {
      method: "POST",
      headers: { Authorization: `Bearer ${memberToken}` },
      body: JSON.stringify({ name: "Nope" }),
    });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "FORBIDDEN" });
  });

  it("rejects a duplicate name with ALREADY_EXISTS", async () => {
    const owner = "@topicowner3:local";
    const id = await freshStronghold(owner);
    const token = await sessionToken(owner);

    await apiRequest(`/api/stronghold/${id}/topics`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ name: "Dup" }),
    });
    const res = await apiRequest(`/api/stronghold/${id}/topics`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ name: "Dup" }),
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "ALREADY_EXISTS" });
  });

  it("rejects a name over 16 chars with MALFORMED", async () => {
    const owner = "@topicowner4:local";
    const id = await freshStronghold(owner);
    const token = await sessionToken(owner);

    const res = await apiRequest(`/api/stronghold/${id}/topics`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ name: "x".repeat(17) }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "MALFORMED" });
  });

  it("rejects the 33rd topic with TOPIC_LIMIT", async () => {
    const owner = "@topicowner5:local";
    const id = await freshStronghold(owner);
    const token = await sessionToken(owner);

    for (let i = 0; i < 32; i++) {
      const res = await apiRequest(`/api/stronghold/${id}/topics`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: JSON.stringify({ name: `t${i}` }),
      });
      expect(res.status).toBe(201);
    }
    const overflow = await apiRequest(`/api/stronghold/${id}/topics`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ name: "overflow" }),
    });
    expect(overflow.status).toBe(409);
    expect(await overflow.json()).toEqual({ error: "TOPIC_LIMIT" });
  });
});

describe("topic description", () => {
  it("round-trips a description through create + patch", async () => {
    const owner = "@topicdesc1:local";
    const id = await freshStronghold(owner);
    const token = await sessionToken(owner);

    const createRes = await apiRequest(`/api/stronghold/${id}/topics`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ name: "Guide", description: "  how-to posts  " }),
    });
    expect(createRes.status).toBe(201);
    const topic = (await createRes.json()) as { id: string; description: string | null; post_count: number };
    expect(topic.description).toBe("how-to posts");
    expect(topic.post_count).toBe(0);

    const patchRes = await apiRequest(`/api/stronghold/${id}/topics/${topic.id}`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ description: null }),
    });
    expect(patchRes.status).toBe(200);
    expect((await patchRes.json()) as { description: string | null }).toMatchObject({ description: null });
  });

  it("rejects a description over 64 chars with MALFORMED", async () => {
    const owner = "@topicdesc2:local";
    const id = await freshStronghold(owner);
    const token = await sessionToken(owner);

    const res = await apiRequest(`/api/stronghold/${id}/topics`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ name: "Over", description: "x".repeat(65) }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "MALFORMED" });
  });
});

describe("room rename/delete", () => {
  it("owner renames a room via PATCH", async () => {
    const owner = "@roomowner1:local";
    const id = await freshStronghold(owner);
    const stub = env.STRONGHOLD_DO.getByName(id);
    await stub.createRoom("general", "channel", "General", ["text"], false);
    const token = await sessionToken(owner);

    const res = await apiRequest(`/api/stronghold/${id}/rooms/general`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ name: "Renamed Room" }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      id: "general",
      name: "Renamed Room",
      type: "channel",
      description: null,
      capabilities: ["text", "reactions"],
    });
  });

  it("round-trips a room description and rejects one over 64 chars", async () => {
    const owner = "@roomowner4:local";
    const id = await freshStronghold(owner);
    const stub = env.STRONGHOLD_DO.getByName(id);
    await stub.createRoom("general", "channel", "General", ["text"], false);
    const token = await sessionToken(owner);

    const okRes = await apiRequest(`/api/stronghold/${id}/rooms/general`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ description: "  general chat  " }),
    });
    expect(okRes.status).toBe(200);
    expect((await okRes.json()) as { description: string | null }).toMatchObject({ description: "general chat" });

    const tooLong = await apiRequest(`/api/stronghold/${id}/rooms/general`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ description: "x".repeat(65) }),
    });
    expect(tooLong.status).toBe(400);
    expect(await tooLong.json()).toEqual({ error: "MALFORMED" });
  });

  it("rejects a non-owner/mod PATCH with FORBIDDEN", async () => {
    const owner = "@roomowner2:local";
    const id = await freshStronghold(owner);
    const stub = env.STRONGHOLD_DO.getByName(id);
    await stub.createRoom("general", "channel", "General", ["text"], false);
    await stub.addMember("@roommember2:local", "member");
    const memberToken = await sessionToken("@roommember2:local");

    const res = await apiRequest(`/api/stronghold/${id}/rooms/general`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${memberToken}` },
      body: JSON.stringify({ name: "Nope" }),
    });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "FORBIDDEN" });
  });

  it("deletes a room when another of the same type remains, but blocks deleting the last one", async () => {
    const owner = "@roomowner3:local";
    const id = await freshStronghold(owner);
    const stub = env.STRONGHOLD_DO.getByName(id);
    await stub.createRoom("general", "channel", "General", ["text"], false);
    await stub.createRoom("random", "channel", "Random", ["text"], false);
    const token = await sessionToken(owner);

    const firstDelete = await apiRequest(`/api/stronghold/${id}/rooms/random`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(firstDelete.status).toBe(204);

    const lastDelete = await apiRequest(`/api/stronghold/${id}/rooms/general`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(lastDelete.status).toBe(409);
    expect(await lastDelete.json()).toEqual({ error: "LAST_ROOM_OF_TYPE" });
  });
});

describe("posts carry topics through projection and filtering", () => {
  it("round-trips topics via listPosts/getPost (projection whitelist)", async () => {
    const owner = "@topicpost1:local";
    const id = await freshStronghold(owner);
    const stub = env.STRONGHOLD_DO.getByName(id);
    await stub.createRoom("posts", "section", "Posts", ["text"], false);
    const t1 = await stub.createTopic("t1", "News", null);
    const t2 = await stub.createTopic("t2", "Chat", null);
    if (!t1.ok || !t2.ok) throw new Error("setup failed");

    const roomRef = `${id}/sec/posts`;
    const { ws } = await connectRoom(roomRef, owner, "owner");
    ws.send(postFrame("p1", "Tagged", "body text", [t1.topic.id, t2.topic.id]));
    const ack = await nextMessage(ws);
    expect(ack).toMatchObject({ type: "ack", status: "ok" });
    ws.close();

    const token = await sessionToken(owner);
    const listRes = await apiRequest(`/api/stronghold/${id}/rooms/posts/posts`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const list = (await listRes.json()) as { posts: Array<Record<string, unknown>> };
    expect(list.posts[0]!.topics).toEqual([t1.topic.id, t2.topic.id]);

    const detailRes = await apiRequest(`/api/stronghold/${id}/rooms/posts/posts/${ack.seq}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const detail = (await detailRes.json()) as { post: Record<string, unknown> };
    expect(detail.post.topics).toEqual([t1.topic.id, t2.topic.id]);
  });

  it("rejects a non-string-array topics field and more than 5 topics", async () => {
    const owner = "@topicpost2:local";
    const id = await freshStronghold(owner);
    const stub = env.STRONGHOLD_DO.getByName(id);
    await stub.createRoom("posts", "section", "Posts", ["text"], false);
    const roomRef = `${id}/sec/posts`;
    const { ws } = await connectRoom(roomRef, owner, "owner");

    ws.send(JSON.stringify({ type: "item.create", client_id: "bad1", kind: "post", body: { title: "T", text: "x", topics: [1, 2] } }));
    const err1 = await nextMessage(ws);
    expect(err1).toMatchObject({ type: "error", code: "OMEW_MALFORMED" });

    ws.send(postFrame("bad2", "T", "x", ["a", "b", "c", "d", "e", "f"]));
    const err2 = await nextMessage(ws);
    expect(err2).toMatchObject({ type: "error", code: "OMEW_MALFORMED" });

    ws.close();
  });

  it("?topic= filters listPosts to posts carrying that topic, cursor pagination intact", async () => {
    const owner = "@topicfilter1:local";
    const id = await freshStronghold(owner);
    const stub = env.STRONGHOLD_DO.getByName(id);
    await stub.createRoom("posts", "section", "Posts", ["text"], false);
    const tA = await stub.createTopic("ta", "A", null);
    const tB = await stub.createTopic("tb", "B", null);
    if (!tA.ok || !tB.ok) throw new Error("setup failed");

    const roomRef = `${id}/sec/posts`;
    const { ws } = await connectRoom(roomRef, owner, "owner");

    ws.send(postFrame("p1", "First", "body", [tA.topic.id]));
    const a1 = await nextMessage(ws);
    ws.send(postFrame("p2", "Second", "body", [tB.topic.id]));
    await nextMessage(ws);
    ws.send(postFrame("p3", "Third", "body", [tA.topic.id]));
    const a3 = await nextMessage(ws);
    ws.close();

    const token = await sessionToken(owner);
    const res = await apiRequest(`/api/stronghold/${id}/rooms/posts/posts?topic=${tA.topic.id}&limit=1`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const page1 = (await res.json()) as { posts: Array<Record<string, unknown>>; next_cursor: string | null };
    expect(page1.posts.map((p) => p.post_seq)).toEqual([a3.seq]);
    expect(page1.next_cursor).toBeTypeOf("string");

    const page2Res = await apiRequest(
      `/api/stronghold/${id}/rooms/posts/posts?topic=${tA.topic.id}&limit=1&after=${encodeURIComponent(page1.next_cursor!)}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const page2 = (await page2Res.json()) as { posts: Array<Record<string, unknown>>; next_cursor: string | null };
    expect(page2.posts.map((p) => p.post_seq)).toEqual([a1.seq]);
    expect(page2.next_cursor).toBeNull();
  });
});

describe("post_count statistics", () => {
  it("rooms list: section post_count increments on post, decrements on retract; channel carries no post_count", async () => {
    const owner = "@postcount1:local";
    const id = await freshStronghold(owner);
    const stub = env.STRONGHOLD_DO.getByName(id);
    await stub.createRoom("general", "channel", "General", ["text"], false);
    await stub.createRoom("posts", "section", "Posts", ["text"], false);
    const token = await sessionToken(owner);

    const before = (await (
      await apiRequest(`/api/stronghold/${id}/rooms`, { headers: { Authorization: `Bearer ${token}` } })
    ).json()) as Array<Record<string, unknown>>;
    expect(before.find((r) => r.id === "posts")).toMatchObject({ post_count: 0 });
    expect(before.find((r) => r.id === "general")).not.toHaveProperty("post_count");

    const roomRef = `${id}/sec/posts`;
    const { ws } = await connectRoom(roomRef, owner, "owner");
    ws.send(postFrame("pc1", "Counted", "body"));
    const ack = await nextMessage(ws);
    ws.close();

    const afterPost = (await (
      await apiRequest(`/api/stronghold/${id}/rooms`, { headers: { Authorization: `Bearer ${token}` } })
    ).json()) as Array<Record<string, unknown>>;
    expect(afterPost.find((r) => r.id === "posts")).toMatchObject({ post_count: 1 });

    await apiRequest(`/api/stronghold/${id}/rooms/posts/items/${ack.seq}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });

    const afterRetract = (await (
      await apiRequest(`/api/stronghold/${id}/rooms`, { headers: { Authorization: `Bearer ${token}` } })
    ).json()) as Array<Record<string, unknown>>;
    expect(afterRetract.find((r) => r.id === "posts")).toMatchObject({ post_count: 0 });
  });

  it("topics list: post_count reflects tagged, non-retracted posts across all section rooms", async () => {
    const owner = "@postcount2:local";
    const id = await freshStronghold(owner);
    const stub = env.STRONGHOLD_DO.getByName(id);
    await stub.createRoom("posts", "section", "Posts", ["text"], false);
    const topic = await stub.createTopic("pc-topic", "Tagged", null);
    if (!topic.ok) throw new Error("setup failed");
    const token = await sessionToken(owner);

    const roomRef = `${id}/sec/posts`;
    const { ws } = await connectRoom(roomRef, owner, "owner");
    ws.send(postFrame("pc2", "Tagged post", "body", [topic.topic.id]));
    const ack = await nextMessage(ws);
    ws.close();

    const afterPost = (await (
      await apiRequest(`/api/stronghold/${id}/topics`, { headers: { Authorization: `Bearer ${token}` } })
    ).json()) as Array<{ id: string; post_count: number }>;
    expect(afterPost.find((t) => t.id === topic.topic.id)?.post_count).toBe(1);

    await apiRequest(`/api/stronghold/${id}/rooms/posts/items/${ack.seq}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });

    const afterRetract = (await (
      await apiRequest(`/api/stronghold/${id}/topics`, { headers: { Authorization: `Bearer ${token}` } })
    ).json()) as Array<{ id: string; post_count: number }>;
    expect(afterRetract.find((t) => t.id === topic.topic.id)?.post_count).toBe(0);
  });
});
