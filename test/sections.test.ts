import { env, runInDurableObject } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { apiRequest, connectRoom, ensureMigrated, nextMessage, sessionToken } from "./helpers";
import type { RoomDO } from "../server/src/room-do";
import type { StrongholdDO } from "../server/src/stronghold-do";

beforeAll(async () => {
  await ensureMigrated();
});

let sequence = 0;
async function freshStronghold(owner: string): Promise<string> {
  const id = `section${Date.now()}${sequence++}`;
  await env.STRONGHOLD_DO.getByName(id).initConfig(id, "Section Test", "public", owner);
  return id;
}

function postFrame(clientId: string, title: string, text: string, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({ type: "item.create", client_id: clientId, kind: "post", body: { title, text, ...extra } });
}

describe("section room management", () => {
  it("keeps room rename, description validation, and last-room protection", async () => {
    const owner = "@sectionowner:local";
    const id = await freshStronghold(owner);
    const stub = env.STRONGHOLD_DO.getByName(id);
    await stub.createRoom("general", "channel", "General", ["text"], false);
    await stub.createRoom("random", "channel", "Random", ["text"], false);
    const token = await sessionToken(owner);

    const renamed = await apiRequest(`/api/stronghold/${id}/rooms/general`, {
      method: "PATCH", headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify({ name: "Renamed", description: "  chat  " }),
    });
    expect(renamed.status).toBe(200);
    expect(await renamed.json()).toMatchObject({ name: "Renamed", description: "chat" });

    const overlong = await apiRequest(`/api/stronghold/${id}/rooms/general`, {
      method: "PATCH", headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify({ description: "x".repeat(65) }),
    });
    expect(overlong.status).toBe(400);

    expect((await apiRequest(`/api/stronghold/${id}/rooms/random`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } })).status).toBe(204);
    const last = await apiRequest(`/api/stronghold/${id}/rooms/general`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
    expect(last.status).toBe(409);
    expect(await last.json()).toEqual({ error: "LAST_ROOM_OF_TYPE" });
  });
});

describe("post contract without tags", () => {
  it("drops legacy tag tables when either durable object migrates", async () => {
    const stronghold = env.STRONGHOLD_DO.getByName(`legacy-stronghold-${Date.now()}`);
    await runInDurableObject(stronghold, async (instance: StrongholdDO, state: DurableObjectState) => {
      state.storage.sql.exec("CREATE TABLE topic (id TEXT PRIMARY KEY)");
      (instance as unknown as { migrate(): void }).migrate();
      expect(state.storage.sql.exec("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'topic'").toArray()).toEqual([]);
    });

    const room = env.ROOM_DO.getByName(`legacy-room-${Date.now()}`);
    await runInDurableObject(room, async (instance: RoomDO, state: DurableObjectState) => {
      state.storage.sql.exec("CREATE TABLE post_topic (post_seq INTEGER, topic_id TEXT)");
      (instance as unknown as { migrate(): void }).migrate();
      expect(state.storage.sql.exec("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'post_topic'").toArray()).toEqual([]);
    });
  });

  it("does not expose tag routes, fields, or query filtering", async () => {
    const owner = "@sectionpost:local";
    const id = await freshStronghold(owner);
    await env.STRONGHOLD_DO.getByName(id).createRoom("posts", "section", "Posts", ["text"], false);
    const token = await sessionToken(owner);

    for (const method of ["GET", "POST", "PATCH", "DELETE"]) {
      const response = await apiRequest(`/api/stronghold/${id}/topics`, { method, headers: { Authorization: `Bearer ${token}` }, body: method === "POST" ? "{}" : undefined });
      expect(response.status).toBe(404);
    }

    const { ws } = await connectRoom(`${id}/sec/posts`, owner, "owner");
    ws.send(postFrame("legacy-tag", "Title", "Body", { topics: ["legacy"] }));
    const rejected = await nextMessage(ws);
    expect(rejected).toMatchObject({ type: "error", code: "OMEW_MALFORMED" });
    ws.close();

    const list = await apiRequest(`/api/stronghold/${id}/rooms/posts/posts?topic=legacy`, { headers: { Authorization: `Bearer ${token}` } });
    expect(list.status).toBe(200);
    const page = (await list.json()) as { posts: Array<Record<string, unknown>> };
    expect(page.posts).toHaveLength(0);
  });
});
