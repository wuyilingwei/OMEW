import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { signToken } from "../server/src/auth";
import type { RoomTokenClaims, StrongholdTokenClaims } from "../server/src/types";
import { connectRoom, itemCreateFrame, nextMessage, TEST_SECRET } from "./helpers";

// proposal S4.3 / m0-protocol S5.2: commit order MUST be SQLite commit -> immediate
// single ack to the sender -> batched broadcast to everyone else within the merge
// window. This exercises that whole round trip over real WebSocket handshakes
// against RoomDO, not just the internal seq bookkeeping.
describe("RoomDO WS send -> ack -> broadcast", () => {
  it("acks the sender immediately and batches the broadcast to other connections", async () => {
    const roomRef = "wstest/ch/general";
    const { ws: sender } = await connectRoom(roomRef, "@alice:local", "owner");
    const { ws: other } = await connectRoom(roomRef, "@bob:local", "member");

    sender.send(itemCreateFrame("m1", "hello room"));

    const ack = await nextMessage(sender);
    expect(ack).toMatchObject({ type: "ack", status: "ok", client_id: "m1", seq: 1 });

    const batch = await nextMessage(other);
    expect(batch.type).toBe("batch");
    const items = batch.items as Array<Record<string, unknown>>;
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      type: "item.create",
      seq: 1,
      actor: "@alice:local",
      kind: "post",
      body: { text: "hello room" },
    });

    sender.close();
    other.close();
  });

  it("coalesces multiple messages within one window into a single batch frame", async () => {
    const roomRef = "wstest/ch/coalesce";
    const { ws: sender } = await connectRoom(roomRef, "@alice:local", "owner");
    const { ws: other } = await connectRoom(roomRef, "@bob:local", "member");

    sender.send(itemCreateFrame("m1", "one"));
    sender.send(itemCreateFrame("m2", "two"));
    await nextMessage(sender); // ack for m1
    await nextMessage(sender); // ack for m2

    const batch = await nextMessage(other);
    expect(batch.type).toBe("batch");
    expect((batch.items as unknown[]).length).toBe(2);

    sender.close();
    other.close();
  });

  it("rejects a handshake without a token", async () => {
    const stub = env.ROOM_DO.getByName("wstest/ch/no-token");
    const res = await stub.fetch("http://do/ws", { headers: { Upgrade: "websocket" } });
    expect(res.status).toBe(401);
  });

  it("rejects a room token replayed against a different RoomDO", async () => {
    const claims: RoomTokenClaims = {
      v: 1,
      typ: "room",
      actor: "@scope-room:local",
      room: "wstest/ch/source",
      role: "owner",
      deny: 0,
      exp: Math.floor(Date.now() / 1000) + 300,
      jti: crypto.randomUUID(),
    };
    const token = await signToken(claims, TEST_SECRET);
    const target = env.ROOM_DO.getByName("wstest/ch/target");
    const res = await target.fetch("http://do/ws", {
      headers: { Upgrade: "websocket", "Sec-WebSocket-Protocol": token },
    });

    expect(res.status).toBe(401);
    expect(res.webSocket).toBeNull();
  });

  it("rejects a tips token replayed against a different StrongholdDO", async () => {
    const claims: StrongholdTokenClaims = {
      v: 1,
      typ: "stronghold",
      actor: "@scope-tips:local",
      stronghold: "scope-source",
      role: "member",
      exp: Math.floor(Date.now() / 1000) + 300,
      jti: crypto.randomUUID(),
    };
    const token = await signToken(claims, TEST_SECRET);
    const target = env.STRONGHOLD_DO.getByName("scope-target");
    const res = await target.fetch("http://do/ws", {
      headers: { Upgrade: "websocket", "Sec-WebSocket-Protocol": token },
    });

    expect(res.status).toBe(401);
    expect(res.webSocket).toBeNull();
  });
});
