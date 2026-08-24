import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import {
  apiRequest,
  collectMessagesFor,
  connectRoom,
  ensureMigrated,
  itemCreateFrame,
  nextMessage,
  nextMessageOfType,
  postCreateFrame,
  replyCreateFrame,
  sessionToken,
} from "./helpers";

// Section real-ification: posts/replies over the existing WS item.create entry
// point, room-type-aware kind/shape validation, the bump throttle, and the
// read-only posts list/detail HTTP API.

beforeAll(async () => {
  await ensureMigrated();
});

let strongholdSeq = 0;
async function freshSectionStronghold(ownerActor: string): Promise<{ id: string; resId: string; roomRef: string }> {
  const id = `sec${Date.now()}${strongholdSeq++}`;
  const resId = "posts";
  const stub = env.STRONGHOLD_DO.getByName(id);
  await stub.initConfig(id, "Section Test", "public", ownerActor);
  await stub.createRoom(resId, "section", "Posts", ["text"], false);
  return { id, resId, roomRef: `${id}/sec/${resId}` };
}

describe("channel/section kind matrix", () => {
  it("section rejects a plain untitled message at the top level, accepts a titled post", async () => {
    const roomRef = "kindtest1/sec/general";
    const { ws } = await connectRoom(roomRef, "@kindpost1:local", "owner");

    ws.send(itemCreateFrame("m1", "no title here"));
    const err = await nextMessage(ws);
    expect(err).toMatchObject({ type: "error", code: "OMEW_KIND_INVALID_FOR_ROOM" });

    ws.send(postCreateFrame("m2", "A real post", "some body text"));
    const ack = await nextMessage(ws);
    expect(ack).toMatchObject({ type: "ack", status: "ok", client_id: "m2" });

    ws.close();
  });

  it("channel rejects a titled post and a bare reply, accepts a plain message", async () => {
    const roomRef = "kindtest2/ch/general";
    const { ws } = await connectRoom(roomRef, "@kindpost2:local", "owner");

    ws.send(postCreateFrame("m1", "A title", "text"));
    const err1 = await nextMessage(ws);
    expect(err1).toMatchObject({ type: "error", code: "OMEW_KIND_INVALID_FOR_ROOM" });

    ws.send(replyCreateFrame("m2", 1, "reply text"));
    const err2 = await nextMessage(ws);
    expect(err2).toMatchObject({ type: "error", code: "OMEW_KIND_INVALID_FOR_ROOM" });

    ws.send(itemCreateFrame("m3", "plain channel message"));
    const ack = await nextMessage(ws);
    expect(ack).toMatchObject({ type: "ack", status: "ok" });

    ws.close();
  });

  it("rejects a section post title over 64 chars", async () => {
    const roomRef = "kindtest3/sec/general";
    const { ws } = await connectRoom(roomRef, "@kindpost3:local", "owner");

    ws.send(postCreateFrame("m1", "x".repeat(65), "text"));
    const err = await nextMessage(ws);
    expect(err).toMatchObject({ type: "error", code: "OMEW_KIND_INVALID_FOR_ROOM" });

    ws.close();
  });
});

describe("post preview derivation", () => {
  it("derives an 80-char preview from the post text and stores it on the item body", async () => {
    const roomRef = "previewtest/sec/general";
    const { ws: author } = await connectRoom(roomRef, "@prevauthor1:local", "owner");
    const { ws: watcher } = await connectRoom(roomRef, "@prevwatcher1:local", "member");

    const longText = "a".repeat(120);
    author.send(postCreateFrame("m1", "Title", longText));
    await nextMessage(author);

    const batch = await nextMessageOfType(watcher, "batch");
    const items = batch.items as Array<Record<string, unknown>>;
    const body = items[0]!.body as { preview: string; text: string; title: string };
    expect(body.preview).toBe(longText.slice(0, 80));
    expect(body.preview).toHaveLength(80);
    expect(body.title).toBe("Title");

    author.close();
    watcher.close();
  });

  it("stores a plain-text Markdown preview on create", async () => {
    const roomRef = "markdownpreview/sec/general";
    const { ws } = await connectRoom(roomRef, "@markdownpreview:local", "owner");
    const { ws: watcher } = await connectRoom(roomRef, "@markdownpreviewwatcher:local", "member");

    ws.send(postCreateFrame("m1", "Title", "# Heading\n\n![cover](/media/a) **Bold** [link](https://example.com)"));
    await nextMessage(ws);

    const batch = await nextMessageOfType(watcher, "batch");
    const items = batch.items as Array<Record<string, unknown>>;
    expect((items[0]!.body as { preview: string }).preview).toBe("Heading cover Bold link");
    ws.close();
    watcher.close();
  });
});

describe("replies: one level only", () => {
  it("allows a single reply level, rejects replying to a reply with REPLY_DEPTH", async () => {
    const roomRef = "depthtest/sec/general";
    const { ws } = await connectRoom(roomRef, "@depthauthor1:local", "owner");

    ws.send(postCreateFrame("p1", "Thread", "body"));
    const postAck = await nextMessage(ws);
    const postSeq = postAck.seq as number;

    ws.send(replyCreateFrame("r1", postSeq, "first reply"));
    const replyAck = await nextMessage(ws);
    expect(replyAck).toMatchObject({ type: "ack", status: "ok" });
    const replySeq = replyAck.seq as number;

    // r1 also scheduled an immediate bump broadcast (this socket is a recipient
    // too) - it can interleave with the error response on this same connection.
    ws.send(replyCreateFrame("r2", replySeq, "nested reply"));
    const err = await nextMessageOfType(ws, "error");
    expect(err).toMatchObject({ type: "error", code: "OMEW_REPLY_DEPTH" });

    ws.close();
  });
});

describe("bump throttle", () => {
  it("bumps immediately for an isolated reply, then merges a rapid burst into one >=2s-later absolute snapshot", async () => {
    const roomRef = "bumptest/sec/general";
    const { ws: author } = await connectRoom(roomRef, "@bumpauthor1:local", "owner");
    const { ws: watcher } = await connectRoom(roomRef, "@bumpwatcher1:local", "member");

    author.send(postCreateFrame("p1", "Bump me", "body"));
    const postAck = await nextMessage(author);
    const postSeq = postAck.seq as number;
    await nextMessageOfType(watcher, "batch"); // the post's own item.create

    author.send(replyCreateFrame("r1", postSeq, "reply one"));
    await nextMessage(author); // ack
    const bump1 = await nextMessageOfType(watcher, "item.bump");
    expect(bump1).toMatchObject({ post_seq: postSeq, last_reply_seq: postSeq + 1, reply_count: 1 });

    // Two more replies land back to back, inside the 2s cooldown that just started.
    author.send(replyCreateFrame("r2", postSeq, "reply two"));
    await nextMessage(author);
    author.send(replyCreateFrame("r3", postSeq, "reply three"));
    await nextMessage(author);

    // batch frames for r2/r3 may arrive in this window - only assert no bump yet.
    const early = await collectMessagesFor(watcher, 300);
    expect(early.some((m) => m.type === "item.bump")).toBe(false);

    const later = await collectMessagesFor(watcher, 2200);
    const bumps = later.filter((m) => m.type === "item.bump");
    expect(bumps).toHaveLength(1);
    expect(bumps[0]).toMatchObject({ post_seq: postSeq, last_reply_seq: postSeq + 3, reply_count: 3 });

    author.close();
    watcher.close();
  }, 10_000);
});

describe("GET /api/stronghold/:id/rooms/:resId/posts", () => {
  it("lists posts by bumped_at desc, with cursor pagination", async () => {
    const owner = "@postlist1:local";
    const { id, resId, roomRef } = await freshSectionStronghold(owner);
    const { ws } = await connectRoom(roomRef, owner, "owner");

    ws.send(postCreateFrame("p1", "First", "first body"));
    const a1 = await nextMessage(ws);
    ws.send(postCreateFrame("p2", "Second", "second body"));
    const a2 = await nextMessage(ws);
    ws.send(postCreateFrame("p3", "Third", "third body"));
    const a3 = await nextMessage(ws);

    // Bump the first post back to the top by replying to it.
    ws.send(replyCreateFrame("r1", a1.seq as number, "bump it"));
    await nextMessage(ws);

    const token = await sessionToken(owner);
    const res = await apiRequest(`/api/stronghold/${id}/rooms/${resId}/posts?limit=2`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const page1 = (await res.json()) as { posts: Array<Record<string, unknown>>; next_cursor: string | null };
    expect(page1.posts.map((p) => p.post_seq)).toEqual([a1.seq, a3.seq]);
    expect(page1.posts[0]).toMatchObject({ title: "First", reply_count: 1 });
    expect(page1.next_cursor).toBeTypeOf("string");

    const page2Res = await apiRequest(
      `/api/stronghold/${id}/rooms/${resId}/posts?limit=2&after=${encodeURIComponent(page1.next_cursor!)}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const page2 = (await page2Res.json()) as { posts: Array<Record<string, unknown>>; next_cursor: string | null };
    expect(page2.posts.map((p) => p.post_seq)).toEqual([a2.seq]);
    expect(page2.next_cursor).toBeNull();

    ws.close();
  });

  it("lets a non-member preview public posts but still rejects a channel room", async () => {
    const owner = "@postlist2:local";
    const { id, resId } = await freshSectionStronghold(owner);
    const outsider = await sessionToken("@postlistoutsider1:local");

    const res = await apiRequest(`/api/stronghold/${id}/rooms/${resId}/posts`, {
      headers: { Authorization: `Bearer ${outsider}` },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ posts: [], next_cursor: null });

    const ownerToken = await sessionToken(owner);
    await env.STRONGHOLD_DO.getByName(id).createRoom("general", "channel", "General", ["text"], false);
    const chanRes = await apiRequest(`/api/stronghold/${id}/rooms/general/posts`, {
      headers: { Authorization: `Bearer ${ownerToken}` },
    });
    expect(chanRes.status).toBe(400);
    expect(await chanRes.json()).toEqual({ error: "ROOM_NOT_SECTION" });
  });
});

describe("GET /api/stronghold/:id/rooms/:resId/posts/:seq", () => {
  it("returns the post plus a seq-anchored reply page", async () => {
    const owner = "@postdetail1:local";
    const { id, resId, roomRef } = await freshSectionStronghold(owner);
    const { ws } = await connectRoom(roomRef, owner, "owner");

    ws.send(postCreateFrame("p1", "Thread", "opening text"));
    const postAck = await nextMessage(ws);
    const postSeq = postAck.seq as number;

    for (const text of ["r1", "r2", "r3"]) {
      ws.send(replyCreateFrame(text, postSeq, `reply ${text}`));
      // The first reply's bump can fire immediately and interleave on this same
      // connection - wait for the ack specifically, not just "any message".
      await nextMessageOfType(ws, "ack");
    }

    const token = await sessionToken(owner);
    const res = await apiRequest(`/api/stronghold/${id}/rooms/${resId}/posts/${postSeq}?limit=2`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      post: Record<string, unknown>;
      replies: Array<Record<string, unknown>>;
      next_before: number | null;
    };
    expect(body.post).toMatchObject({ post_seq: postSeq, title: "Thread", reply_count: 3 });
    expect(body.replies).toHaveLength(2);
    expect(body.replies[0]!.body).toMatchObject({ text: "reply r3" });
    expect(body.next_before).toBe(body.replies[1]!.seq);

    const page2 = await apiRequest(
      `/api/stronghold/${id}/rooms/${resId}/posts/${postSeq}?limit=2&before=${body.next_before}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const page2Body = (await page2.json()) as { replies: Array<Record<string, unknown>>; next_before: number | null };
    expect(page2Body.replies).toHaveLength(1);
    expect(page2Body.replies[0]!.body).toMatchObject({ text: "reply r1" });
    expect(page2Body.next_before).toBeNull();

    ws.close();
  });

  it("404s for a reply seq or an unknown seq", async () => {
    const owner = "@postdetail2:local";
    const { id, resId, roomRef } = await freshSectionStronghold(owner);
    const { ws } = await connectRoom(roomRef, owner, "owner");

    ws.send(postCreateFrame("p1", "Thread", "opening text"));
    const postAck = await nextMessage(ws);
    ws.send(replyCreateFrame("r1", postAck.seq as number, "a reply"));
    const replyAck = await nextMessage(ws);

    const token = await sessionToken(owner);
    const asReply = await apiRequest(`/api/stronghold/${id}/rooms/${resId}/posts/${replyAck.seq}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(asReply.status).toBe(404);

    const unknown = await apiRequest(`/api/stronghold/${id}/rooms/${resId}/posts/999999`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(unknown.status).toBe(404);

    ws.close();
  });
});

it("post media survives the list and detail projections", async () => {
  const owner = "@mediaposter:local";
  const { id, resId, roomRef } = await freshSectionStronghold(owner);
  const { ws } = await connectRoom(roomRef, owner, "owner");

  const media = [{ id: "m1", url: "/media/m1", mime: "image/webp" }];
  ws.send(JSON.stringify({ type: "item.create", client_id: "mp1", kind: "post", body: { title: "with pic", text: "look", media } }));
  const ack = await nextMessage(ws);
  expect(ack).toMatchObject({ type: "ack", status: "ok" });
  ws.close();

  const token = await sessionToken(owner);
  const listRes = await apiRequest(`/api/stronghold/${id}/rooms/${resId}/posts`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const list = (await listRes.json()) as { posts: Array<Record<string, unknown>> };
  expect(list.posts[0].media).toEqual(media);

  const detailRes = await apiRequest(`/api/stronghold/${id}/rooms/${resId}/posts/${ack.seq}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const detail = (await detailRes.json()) as { post: Record<string, unknown> };
  expect(detail.post.media).toEqual(media);
});
