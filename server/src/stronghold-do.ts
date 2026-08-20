import { DurableObject } from "cloudflare:workers";
import { verifyToken } from "./auth";
import { synthesizeEffectivePermissions, type EffectivePermissions } from "./permissions";
import { typeToKind, type Role, type RoomType, type StrongholdTokenClaims } from "./types";

// proposal S4.1/S4.4: stronghold config + capability rules + authoritative member
// table + persisted tips aggregate, with a WS fan-out for tip.update pushes.

const TIP_FLUSH_MS = 1_500; // m0-protocol S3.3: tip.update coalesced, not per-message.

// `type` (not `interface`) so these structurally satisfy the SqlStorageValue
// index-signature constraint that sql.exec<T>() requires.
export type ConfigRow = {
  id: string;
  name: string;
  description: string | null;
  visibility: "public" | "private";
  icon: string | null;
  cover: string | null;
  allow_message_edit: number;
  allow_message_retract: number;
  edit_window_secs: number;
  owner_actor: string;
  created_at: number;
};

export type RoomRow = {
  res_id: string;
  type: RoomType;
  name: string;
  capabilities_json: string;
  restricted: number;
  position: number | null;
  archived: number;
  created_at: number;
};

export type MemberRow = {
  actor: string;
  role: Role;
  deny: number;
  restricted: number;
  banned_at: number | null;
  application_state: "pending" | "approved" | "rejected";
  joined_at: number;
};

export type BanRow = {
  actor: string;
  operator: string;
  banned_at: number;
};

// task 037: custom groups. perm_* are tri-state (-1 deny / 0 inherit / 1 allow),
// synthesized against a member's baseline by permissions.ts. position is the
// synthesis order (ascending) and doubles as UI sort order.
export type GroupRow = {
  id: string;
  name: string;
  color: string | null;
  position: number;
  perm_speak: number;
  perm_post: number;
  perm_reply: number;
  is_moderator: number;
};

interface TipAttachment {
  actor: string;
  stronghold: string;
}

export interface EditConfigSnapshot {
  allow_message_edit: boolean;
  allow_message_retract: boolean;
  edit_window_secs: number;
}

export class StrongholdDO extends DurableObject<Env> {
  // DOs created via getByName always carry their name back on ctx.id - used to
  // key the D1 membership index without an extra config read on every call.
  private readonly selfId: string;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.selfId = ctx.id.name ?? ctx.id.toString();
    ctx.blockConcurrencyWhile(async () => this.migrate());
  }

  // Best-effort side index (GET /api/me/strongholds) - the `member` table above
  // stays the sole authority for actual membership; a failed sync here just means
  // that endpoint under/over-reports until the next successful mutation.
  private async indexMember(actor: string): Promise<void> {
    await this.env.DB.prepare(
      "INSERT INTO stronghold_member_index (actor, stronghold_id) VALUES (?, ?) ON CONFLICT(actor, stronghold_id) DO NOTHING"
    ).bind(actor, this.selfId).run().catch(() => {});
  }

  private async unindexMember(actor: string): Promise<void> {
    await this.env.DB.prepare(
      "DELETE FROM stronghold_member_index WHERE actor = ? AND stronghold_id = ?"
    ).bind(actor, this.selfId).run().catch(() => {});
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
      CREATE TABLE IF NOT EXISTS ban (
        actor TEXT PRIMARY KEY, operator TEXT NOT NULL, banned_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS groups (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, color TEXT, position INTEGER NOT NULL,
        perm_speak INTEGER NOT NULL DEFAULT 0, perm_post INTEGER NOT NULL DEFAULT 0,
        perm_reply INTEGER NOT NULL DEFAULT 0, is_moderator INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS member_groups (
        actor TEXT NOT NULL, group_id TEXT NOT NULL, PRIMARY KEY (actor, group_id)
      );
    `);
    // Stronghold-level settings added after the config table already existed in
    // deployed strongholds - additive ALTER, guarded so it's a no-op once a DO
    // has already picked the columns up.
    this.addColumnIfMissing("config", "cover", "TEXT");
    this.addColumnIfMissing("config", "allow_message_edit", "INTEGER NOT NULL DEFAULT 1");
    this.addColumnIfMissing("config", "allow_message_retract", "INTEGER NOT NULL DEFAULT 1");
    this.addColumnIfMissing("config", "edit_window_secs", "INTEGER NOT NULL DEFAULT 300");
  }

  private addColumnIfMissing(table: string, column: string, definition: string): void {
    const cols = this.ctx.storage.sql.exec<{ name: string }>(`PRAGMA table_info(${table})`).toArray();
    if (!cols.some((c) => c.name === column)) {
      this.ctx.storage.sql.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }
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
      "INSERT INTO config (id, name, description, visibility, icon, cover, allow_message_edit, allow_message_retract, edit_window_secs, owner_actor, created_at) " +
        "VALUES (?, ?, ?, ?, ?, NULL, 1, 1, 300, ?, ?)",
      id, name, description ?? null, visibility, icon ?? null, ownerActor, createdAt
    );
    this.ctx.storage.sql.exec(
      "INSERT INTO member (actor, role, deny, restricted, application_state, joined_at) VALUES (?, 'owner', 0, 0, 'approved', ?)",
      ownerActor, createdAt
    );
    await this.indexMember(ownerActor);
    return {
      id, name, description: description ?? null, visibility, icon: icon ?? null, cover: null,
      allow_message_edit: 1, allow_message_retract: 1, edit_window_secs: 300,
      owner_actor: ownerActor, created_at: createdAt,
    };
  }

  async getConfig(): Promise<ConfigRow | null> {
    const rows = this.ctx.storage.sql.exec<ConfigRow>("SELECT * FROM config LIMIT 1").toArray();
    return rows[0] ?? null;
  }

  async updateConfig(
    patch: Partial<
      Pick<
        ConfigRow,
        "name" | "description" | "visibility" | "icon" | "cover" | "allow_message_edit" | "allow_message_retract" | "edit_window_secs"
      >
    >
  ): Promise<ConfigRow | null> {
    const current = await this.getConfig();
    if (!current) return null;
    const next = { ...current, ...patch };
    this.ctx.storage.sql.exec(
      "UPDATE config SET name = ?, description = ?, visibility = ?, icon = ?, cover = ?, " +
        "allow_message_edit = ?, allow_message_retract = ?, edit_window_secs = ? WHERE id = ?",
      next.name, next.description, next.visibility, next.icon, next.cover,
      next.allow_message_edit, next.allow_message_retract, next.edit_window_secs, next.id
    );
    // Push the edit-policy slice to every room DO this stronghold owns (DO-to-DO,
    // fire-and-forget) so RoomDO write paths never query D1/config on the hot
    // path - only StrongholdDO changes trigger a refresh.
    await this.pushEditConfigToRooms(next);
    return next;
  }

  private async pushEditConfigToRooms(config: ConfigRow): Promise<void> {
    const rooms = await this.listRooms();
    const snapshot: EditConfigSnapshot = {
      allow_message_edit: Boolean(config.allow_message_edit),
      allow_message_retract: Boolean(config.allow_message_retract),
      edit_window_secs: config.edit_window_secs,
    };
    await Promise.all(
      rooms.map((room) => {
        const roomRef = `${config.id}/${typeToKind(room.type)}/${room.res_id}`;
        const stub = this.env.ROOM_DO.getByName(roomRef);
        return stub.setEditConfig(snapshot).catch(() => {
          // best-effort push; the room DO's own query-back fallback (RoomDO
          // ensureEditConfig) covers a missed push on its next gated write.
        });
      })
    );
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
    await this.indexMember(actor);
    return { actor, role, deny: effectiveDeny, restricted: restricted ? 1 : 0, banned_at: null, application_state: "approved", joined_at: joinedAt };
  }

  async getMember(actor: string): Promise<MemberRow | null> {
    const rows = this.ctx.storage.sql.exec<MemberRow>("SELECT * FROM member WHERE actor = ?", actor).toArray();
    return rows[0] ?? null;
  }

  async listMembers(): Promise<MemberRow[]> {
    return this.ctx.storage.sql.exec<MemberRow>("SELECT * FROM member ORDER BY joined_at").toArray();
  }

  // proposal §9: deny bits only apply to `member`; role/deny changes here never
  // touch `owner` (ownership moves only through transferOwnership). Caller (api.ts)
  // is responsible for the "role change requires owner" / "DENY_ON_MOD" gating -
  // this just applies whatever role/deny the caller already validated.
  async updateMember(actor: string, patch: { role?: "mod" | "member"; deny?: number }): Promise<MemberRow | null> {
    const current = await this.getMember(actor);
    if (!current || current.role === "owner") return null;
    const role = patch.role ?? current.role;
    const deny = role === "mod" ? 0 : patch.deny ?? current.deny;
    this.ctx.storage.sql.exec("UPDATE member SET role = ?, deny = ? WHERE actor = ?", role, deny, actor);
    return { ...current, role, deny };
  }

  // Kick: revocable removal, the row is gone entirely (distinct from ban, which
  // keeps the row and sets banned_at - see banMember). Never targets `owner`.
  async removeMember(actor: string): Promise<boolean> {
    const current = await this.getMember(actor);
    if (!current || current.role === "owner") return false;
    this.ctx.storage.sql.exec("DELETE FROM member WHERE actor = ?", actor);
    await this.unindexMember(actor);
    return true;
  }

  async transferOwnership(fromActor: string, toActor: string): Promise<ConfigRow | null> {
    const config = await this.getConfig();
    const target = await this.getMember(toActor);
    if (!config || config.owner_actor !== fromActor || !target || target.role === "owner") return null;
    this.ctx.storage.sql.exec("UPDATE member SET role = 'owner', deny = 0 WHERE actor = ?", toActor);
    this.ctx.storage.sql.exec("UPDATE member SET role = 'member', deny = 0 WHERE actor = ?", fromActor);
    this.ctx.storage.sql.exec("UPDATE config SET owner_actor = ? WHERE id = ?", toActor, config.id);
    return { ...config, owner_actor: toActor };
  }

  // ---- bans (audit trail; member.banned_at stays the fast-path gate check) --------

  async banMember(actor: string, operator: string): Promise<MemberRow | null> {
    const target = await this.getMember(actor);
    if (!target || target.role === "owner") return null;
    const bannedAt = Date.now();
    this.ctx.storage.sql.exec("UPDATE member SET banned_at = ? WHERE actor = ?", bannedAt, actor);
    this.ctx.storage.sql.exec(
      "INSERT INTO ban (actor, operator, banned_at) VALUES (?, ?, ?) " +
        "ON CONFLICT(actor) DO UPDATE SET operator = excluded.operator, banned_at = excluded.banned_at",
      actor, operator, bannedAt
    );
    return { ...target, banned_at: bannedAt };
  }

  async unbanMember(actor: string): Promise<MemberRow | null> {
    const target = await this.getMember(actor);
    this.ctx.storage.sql.exec("UPDATE member SET banned_at = NULL WHERE actor = ?", actor);
    this.ctx.storage.sql.exec("DELETE FROM ban WHERE actor = ?", actor);
    return target ? { ...target, banned_at: null } : null;
  }

  async listBans(): Promise<BanRow[]> {
    return this.ctx.storage.sql.exec<BanRow>("SELECT * FROM ban ORDER BY banned_at DESC").toArray();
  }

  // ---- custom groups (task 037) ----------------------------------------------------
  // Stronghold-local; a member can hold several. position sets synthesis order
  // (permissions.ts) and doubles as display order. Built-in owner/mod and the
  // server_role owner/admin overlay (api.ts) never touch this table - groups
  // only ever affect a plain "member".

  async createGroup(
    name: string,
    color: string | null,
    permSpeak: number,
    permPost: number,
    permReply: number,
    isModerator: boolean
  ): Promise<GroupRow> {
    const id = crypto.randomUUID();
    const maxPos = this.ctx.storage.sql.exec<{ maxPos: number | null }>("SELECT MAX(position) AS maxPos FROM groups").toArray()[0];
    const position = (maxPos?.maxPos ?? -1) + 1;
    this.ctx.storage.sql.exec(
      "INSERT INTO groups (id, name, color, position, perm_speak, perm_post, perm_reply, is_moderator) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      id, name, color, position, permSpeak, permPost, permReply, isModerator ? 1 : 0
    );
    return { id, name, color, position, perm_speak: permSpeak, perm_post: permPost, perm_reply: permReply, is_moderator: isModerator ? 1 : 0 };
  }

  async listGroups(): Promise<GroupRow[]> {
    return this.ctx.storage.sql.exec<GroupRow>("SELECT * FROM groups ORDER BY position ASC").toArray();
  }

  async getGroup(id: string): Promise<GroupRow | null> {
    const rows = this.ctx.storage.sql.exec<GroupRow>("SELECT * FROM groups WHERE id = ?", id).toArray();
    return rows[0] ?? null;
  }

  async updateGroup(
    id: string,
    patch: Partial<Pick<GroupRow, "name" | "color" | "position" | "perm_speak" | "perm_post" | "perm_reply" | "is_moderator">>
  ): Promise<GroupRow | null> {
    const current = await this.getGroup(id);
    if (!current) return null;
    const next = { ...current, ...patch };
    this.ctx.storage.sql.exec(
      "UPDATE groups SET name = ?, color = ?, position = ?, perm_speak = ?, perm_post = ?, perm_reply = ?, is_moderator = ? WHERE id = ?",
      next.name, next.color, next.position, next.perm_speak, next.perm_post, next.perm_reply, next.is_moderator, id
    );
    return next;
  }

  // Cascades member_groups rows for this group - a deleted group can't leave
  // dangling assignments behind.
  async deleteGroup(id: string): Promise<boolean> {
    const current = await this.getGroup(id);
    if (!current) return false;
    this.ctx.storage.sql.exec("DELETE FROM member_groups WHERE group_id = ?", id);
    this.ctx.storage.sql.exec("DELETE FROM groups WHERE id = ?", id);
    return true;
  }

  async reorderGroups(positions: { id: string; position: number }[]): Promise<GroupRow[]> {
    for (const p of positions) {
      this.ctx.storage.sql.exec("UPDATE groups SET position = ? WHERE id = ?", p.position, p.id);
    }
    return this.listGroups();
  }

  // ---- member <-> group assignment --------------------------------------------------

  async addMemberToGroup(actor: string, groupId: string): Promise<boolean> {
    const member = await this.getMember(actor);
    const group = await this.getGroup(groupId);
    if (!member || !group) return false;
    this.ctx.storage.sql.exec(
      "INSERT INTO member_groups (actor, group_id) VALUES (?, ?) ON CONFLICT(actor, group_id) DO NOTHING",
      actor, groupId
    );
    return true;
  }

  async removeMemberFromGroup(actor: string, groupId: string): Promise<void> {
    this.ctx.storage.sql.exec("DELETE FROM member_groups WHERE actor = ? AND group_id = ?", actor, groupId);
  }

  async listMemberGroups(actor: string): Promise<GroupRow[]> {
    return this.ctx.storage.sql.exec<GroupRow>(
      "SELECT g.* FROM groups g JOIN member_groups mg ON mg.group_id = g.id WHERE mg.actor = ? ORDER BY g.position ASC",
      actor
    ).toArray();
  }

  // Batch variant for the members list endpoint (api.ts) - one query instead of
  // one per row. Every requested actor gets an entry, empty array if group-less.
  async listGroupsForMembers(actors: string[]): Promise<Record<string, GroupRow[]>> {
    const result: Record<string, GroupRow[]> = {};
    for (const actor of actors) result[actor] = [];
    if (actors.length === 0) return result;
    const placeholders = actors.map(() => "?").join(",");
    const rows = this.ctx.storage.sql
      .exec<GroupRow & { actor: string }>(
        `SELECT mg.actor AS actor, g.id, g.name, g.color, g.position, g.perm_speak, g.perm_post, g.perm_reply, g.is_moderator ` +
          `FROM member_groups mg JOIN groups g ON g.id = mg.group_id WHERE mg.actor IN (${placeholders}) ORDER BY g.position ASC`,
        ...actors
      )
      .toArray();
    for (const row of rows) {
      const { actor, ...group } = row;
      result[actor]!.push(group);
    }
    return result;
  }

  // ---- effective permission synthesis (task 037) ------------------------------------
  // Single source of truth shared by the HTTP permission gate and WS room-token
  // mint (both in api.ts) - see permissions.ts. null means no access at all (no
  // membership, or banned); server_role owner/admin overlay is applied by the
  // caller before ever reaching here (see api.ts's effectiveRole).

  async getEffective(actor: string): Promise<EffectivePermissions | null> {
    const member = await this.getMember(actor);
    if (!member || member.banned_at) return null;
    if (member.role !== "member") return { role: member.role, deny: 0 };
    const groups = await this.listMemberGroups(actor);
    return synthesizeEffectivePermissions("member", member.deny, groups);
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
