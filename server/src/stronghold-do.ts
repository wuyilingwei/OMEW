import { DurableObject } from "cloudflare:workers";
import { verifyToken } from "./auth";
import type { Role, RoomType, StrongholdTokenClaims } from "./types";

// proposal S4.1/S4.4: stronghold config + capability rules + authoritative member
// table + persisted tips aggregate, with a WS fan-out for tip.update pushes.

const TIP_FLUSH_MS = 1_500; // m0-protocol S3.3: tip.update coalesced, not per-message.

// `type` (not `interface`) so these structurally satisfy the SqlStorageValue
// index-signature constraint that sql.exec<T>() requires.
type ConfigRow = {
  id: string;
  name: string;
  description: string | null;
  visibility: "public" | "private";
  icon: string | null;
  owner_actor: string;
  created_at: number;
};

type RoomRow = {
  res_id: string;
  type: RoomType;
  name: string;
  capabilities_json: string;
  restricted: number;
  position: number | null;
  archived: number;
  created_at: number;
};

type MemberRow = {
  actor: string;
  role: Role;
  deny: number;
  restricted: number;
  banned_at: number | null;
  application_state: "pending" | "approved" | "rejected";
  joined_at: number;
};

interface TipAttachment {
  actor: string;
  stronghold: string;
}

export class StrongholdDO extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => this.migrate());
  }

  private migrate(): void {
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS config (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT,
        visibility TEXT NOT NULL, icon TEXT, owner_actor TEXT NOT NULL, created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS room (
        res_id TEXT PRIMARY KEY, type TEXT NOT NULL, name TEXT NOT NULL,
        capabilities_json TEXT NOT NULL, restricted INTEGER NOT NULL DEFAULT 0,
        position INTEGER, archived INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS member (
        actor TEXT PRIMARY KEY, role TEXT NOT NULL DEFAULT 'member',
        deny INTEGER NOT NULL DEFAULT 0, restricted INTEGER NOT NULL DEFAULT 0,
        banned_at INTEGER, application_state TEXT NOT NULL DEFAULT 'approved', joined_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS tip (
        room_ref TEXT PRIMARY KEY, latest_seq INTEGER NOT NULL, ts INTEGER NOT NULL
      );
    `);
  }

  // ---- config -----------------------------------------------------------------

  async initConfig(
    id: string,
    name: string,
    visibility: "public" | "private",
    ownerActor: string,
    description?: string,
    icon?: string
  ): Promise<ConfigRow> {
    const existing = this.ctx.storage.sql.exec<ConfigRow>("SELECT * FROM config WHERE id = ?", id).toArray();
    if (existing.length > 0) return existing[0]!;
    const createdAt = Date.now();
    this.ctx.storage.sql.exec(
      "INSERT INTO config (id, name, description, visibility, icon, owner_actor, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      id, name, description ?? null, visibility, icon ?? null, ownerActor, createdAt
    );
    this.ctx.storage.sql.exec(
      "INSERT INTO member (actor, role, deny, restricted, application_state, joined_at) VALUES (?, 'owner', 0, 0, 'approved', ?)",
      ownerActor, createdAt
    );
    return { id, name, description: description ?? null, visibility, icon: icon ?? null, owner_actor: ownerActor, created_at: createdAt };
  }

  async getConfig(): Promise<ConfigRow | null> {
    const rows = this.ctx.storage.sql.exec<ConfigRow>("SELECT * FROM config LIMIT 1").toArray();
    return rows[0] ?? null;
  }

  async updateConfig(patch: Partial<Pick<ConfigRow, "name" | "description" | "visibility" | "icon">>): Promise<ConfigRow | null> {
    const current = await this.getConfig();
    if (!current) return null;
    const next = { ...current, ...patch };
    this.ctx.storage.sql.exec(
      "UPDATE config SET name = ?, description = ?, visibility = ?, icon = ? WHERE id = ?",
      next.name, next.description, next.visibility, next.icon, next.id
    );
    return next;
  }

  // ---- rooms --------------------------------------------------------------------

  async createRoom(resId: string, type: RoomType, name: string, capabilities: string[], restricted: boolean, position?: number): Promise<RoomRow> {
    const caps = capabilities.includes("text") ? capabilities : ["text", ...capabilities];
    const createdAt = Date.now();
    this.ctx.storage.sql.exec(
      "INSERT INTO room (res_id, type, name, capabilities_json, restricted, position, archived, created_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?)",
      resId, type, name, JSON.stringify(caps), restricted ? 1 : 0, position ?? null, createdAt
    );
    return { res_id: resId, type, name, capabilities_json: JSON.stringify(caps), restricted: restricted ? 1 : 0, position: position ?? null, archived: 0, created_at: createdAt };
  }

  async listRooms(): Promise<RoomRow[]> {
    return this.ctx.storage.sql.exec<RoomRow>("SELECT * FROM room WHERE archived = 0 ORDER BY position, created_at").toArray();
  }

  async getRoom(resId: string): Promise<RoomRow | null> {
    const rows = this.ctx.storage.sql.exec<RoomRow>("SELECT * FROM room WHERE res_id = ?", resId).toArray();
    return rows[0] ?? null;
  }

  async updateRoom(
    resId: string,
    patch: { name?: string; restricted?: boolean; position?: number; capabilities?: string[] }
  ): Promise<RoomRow | null> {
    const current = await this.getRoom(resId);
    if (!current) return null;
    const next = {
      ...current,
      name: patch.name ?? current.name,
      restricted: patch.restricted != null ? (patch.restricted ? 1 : 0) : current.restricted,
      position: patch.position ?? current.position,
      capabilities_json: patch.capabilities ? JSON.stringify(patch.capabilities) : current.capabilities_json,
    };
    this.ctx.storage.sql.exec(
      "UPDATE room SET name = ?, capabilities_json = ?, restricted = ?, position = ? WHERE res_id = ?",
      next.name, next.capabilities_json, next.restricted, next.position, resId
    );
    return next;
  }

  // proposal S3.6: room-ref res_id MUST NOT be recycled and next_seq MUST NOT reset,
  // so this only flags the room archived rather than deleting the row.
  async deleteRoom(resId: string): Promise<void> {
    this.ctx.storage.sql.exec("UPDATE room SET archived = 1 WHERE res_id = ?", resId);
    this.ctx.storage.sql.exec("DELETE FROM tip WHERE room_ref LIKE ?", `%/${resId}`);
  }

  // ---- members --------------------------------------------------------------------
  // dev-only convenience for M1: no federation join_request flow yet (M6), so
  // membership is granted directly by an owner/mod through the API layer.

  async addMember(actor: string, role: Role = "member", deny = 0, restricted = false): Promise<MemberRow> {
    const joinedAt = Date.now();
    const effectiveDeny = role === "owner" || role === "mod" ? 0 : deny;
    this.ctx.storage.sql.exec(
      "INSERT INTO member (actor, role, deny, restricted, application_state, joined_at) VALUES (?, ?, ?, ?, 'approved', ?) " +
        "ON CONFLICT(actor) DO UPDATE SET role = excluded.role, deny = excluded.deny, restricted = excluded.restricted",
      actor, role, effectiveDeny, restricted ? 1 : 0, joinedAt
    );
    return { actor, role, deny: effectiveDeny, restricted: restricted ? 1 : 0, banned_at: null, application_state: "approved", joined_at: joinedAt };
  }

  async getMember(actor: string): Promise<MemberRow | null> {
    const rows = this.ctx.storage.sql.exec<MemberRow>("SELECT * FROM member WHERE actor = ?", actor).toArray();
    return rows[0] ?? null;
  }

  async listMembers(): Promise<MemberRow[]> {
    return this.ctx.storage.sql.exec<MemberRow>("SELECT * FROM member ORDER BY joined_at").toArray();
  }

  // ---- tips (S3.3 / S4.4) -----------------------------------------------------------

  // Called by RoomDO after each commit. Absolute + idempotent: only advances.
  async reportTip(roomRef: string, latestSeq: number): Promise<void> {
    const ts = Date.now();
    this.ctx.storage.sql.exec(
      "INSERT INTO tip (room_ref, latest_seq, ts) VALUES (?, ?, ?) " +
        "ON CONFLICT(room_ref) DO UPDATE SET latest_seq = excluded.latest_seq, ts = excluded.ts " +
        "WHERE excluded.latest_seq > tip.latest_seq",
      roomRef, latestSeq, ts
    );
    const alarm = await this.ctx.storage.getAlarm();
    if (alarm == null) {
      await this.ctx.storage.setAlarm(Date.now() + TIP_FLUSH_MS);
    }
  }

  async getTips(): Promise<{ room_ref: string; latest_seq: number; ts: number }[]> {
    return this.ctx.storage.sql.exec<{ room_ref: string; latest_seq: number; ts: number }>("SELECT * FROM tip").toArray();
  }

  async alarm(): Promise<void> {
    const tips = await this.getTips();
    const payload = JSON.stringify({ type: "tip.update", entries: tips });
    for (const ws of this.ctx.getWebSockets("tips")) {
      try {
        ws.send(payload);
      } catch {
        continue;
      }
    }
  }

  // ---- tips WS ------------------------------------------------------------------

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("expected websocket", { status: 426 });
    }
    const protocolHeader = request.headers.get("Sec-WebSocket-Protocol");
    if (!protocolHeader) {
      return new Response("missing token", { status: 401 });
    }
    const token = protocolHeader.trim();
    const claims = await verifyToken<StrongholdTokenClaims>(token, this.env.DEV_TOKEN_SECRET);
    if (!claims || claims.typ !== "stronghold") {
      return new Response("invalid token", { status: 401 });
    }

    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    this.ctx.acceptWebSocket(server, ["tips"]);
    const attachment: TipAttachment = { actor: claims.actor, stronghold: claims.stronghold };
    server.serializeAttachment(attachment);

    // First-frame snapshot so a freshly (re)connected client doesn't wait for the
    // next coalesced flush to see current unread state.
    const tips = await this.getTips();
    server.send(JSON.stringify({ type: "tip.update", entries: tips }));

    return new Response(null, { status: 101, webSocket: client, headers: { "Sec-WebSocket-Protocol": token } });
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    try {
      // Reserved codes (e.g. 1005, reported when the client closed without one)
      // MUST NOT be echoed back explicitly - fall back to a plain close.
      ws.close(code, reason);
    } catch {
      ws.close();
    }
  }

  async webSocketError(): Promise<void> {
    // nothing durable to clean up.
  }

  async webSocketMessage(): Promise<void> {
    // tips channel is push-only in M1; client frames are ignored.
  }
}
