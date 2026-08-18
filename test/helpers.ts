import { env } from "cloudflare:test";
import { signToken } from "../server/src/auth";
import type { Role, RoomTokenClaims } from "../server/src/types";

// Must match vitest.config.ts's miniflare.bindings.DEV_TOKEN_SECRET.
export const TEST_SECRET = "test-secret-do-not-use-in-prod";

export async function connectRoom(
  roomRef: string,
  actor: string,
  role: Role = "owner",
  deny = 0
): Promise<{ ws: WebSocket; stub: DurableObjectStub<import("../server/src/room-do").RoomDO> }> {
  const claims: RoomTokenClaims = {
    v: 1,
    typ: "room",
    actor,
    room: roomRef,
    role,
    deny,
    exp: Math.floor(Date.now() / 1000) + 300,
    jti: crypto.randomUUID(),
  };
  const token = await signToken(claims, TEST_SECRET);
  const stub = env.ROOM_DO.getByName(roomRef);
  const res = await stub.fetch("http://do/ws", {
    headers: { Upgrade: "websocket", "Sec-WebSocket-Protocol": token },
  });
  const ws = res.webSocket;
  if (!ws) throw new Error("handshake did not return a websocket");
  ws.accept();
  return { ws, stub };
}

export function nextMessage(ws: WebSocket): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timed out waiting for message")), 5000);
    const handler = (event: MessageEvent) => {
      clearTimeout(timer);
      ws.removeEventListener("message", handler);
      resolve(JSON.parse(event.data as string));
    };
    ws.addEventListener("message", handler);
  });
}

export function itemCreateFrame(clientId: string, text: string): string {
  return JSON.stringify({ type: "item.create", client_id: clientId, kind: "post", body: { text } });
}
