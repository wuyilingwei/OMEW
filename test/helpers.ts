import { env } from "cloudflare:test";
import worker from "../server/src/api";
import { signToken } from "../server/src/auth";
import type { Role, RoomTokenClaims, SessionTokenClaims } from "../server/src/types";
import migration0001 from "../server/migrations/0001_init.sql?raw";
import migration0002 from "../server/migrations/0002_user_system.sql?raw";

// Must match vitest.config.ts's miniflare.bindings.DEV_TOKEN_SECRET.
export const TEST_SECRET = "test-secret-do-not-use-in-prod";

// vitest.config.ts doesn't wire up the usual readD1Migrations/applyD1Migrations
// setup (that needs a Node-side config change, out of scope for /test), so tests
// that touch D1 apply the migration files themselves - once per worker instance.
function splitStatements(sql: string): string[] {
  return sql
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n")
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
}

export async function ensureMigrated(): Promise<void> {
  const marker = await env.DB.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'instance_config'"
  ).first();
  if (marker) return;
  for (const sql of [migration0001, migration0002]) {
    for (const statement of splitStatements(sql)) {
      await env.DB.prepare(statement).run();
    }
  }
}

export function apiRequest(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  return worker.fetch(new Request(`http://local${path}`, { ...init, headers }), env);
}

export async function registerUser(
  body: Record<string, unknown>
): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await apiRequest("/api/register", { method: "POST", body: JSON.stringify(body) });
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

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

export function itemUpdateFrame(targetSeq: number, text: string): string {
  return JSON.stringify({ type: "item.update", target_seq: targetSeq, body: { text } });
}

export function itemDeleteFrame(targetSeq: number, reason?: string): string {
  return JSON.stringify({ type: "item.delete", target_seq: targetSeq, reason });
}

// Mints a bearer session token directly (bypasses /api/register + D1) - mirrors
// connectRoom's direct RoomTokenClaims signing, for tests that only care about
// StrongholdDO/RoomDO authorization mechanics rather than the full user system.
export async function sessionToken(actor: string): Promise<string> {
  const claims: SessionTokenClaims = {
    v: 1,
    typ: "session",
    actor,
    exp: Math.floor(Date.now() / 1000) + 300,
    jti: crypto.randomUUID(),
  };
  return signToken(claims, TEST_SECRET);
}
