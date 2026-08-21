import { DurableObject } from "cloudflare:workers";
import { verifyToken } from "./auth";
import { synthesizeEffectivePermissions, type EffectivePermissions, type ServerGroupPermInput } from "./permissions";
import { instanceDomain, typeToKind, type Role, type RoomType, type StrongholdTokenClaims } from "./types";
import { domainOfActor, localpartOfActor } from "./users";

// proposal S4.1/S4.4: stronghold config + capability rules + authoritative member
// table + persisted tips aggregate, with a WS fan-out for tip.update pushes.

const TIP_FLUSH_MS = 1_500; // m0-protocol S3.3: tip.update coalesced, not per-message.
const TOPIC_LIMIT = 32; // per-stronghold topic pool cap.

export type TopicMutationResult =
  | { ok: true; topic: TopicRow }
  | { ok: false; code: "ALREADY_EXISTS" | "TOPIC_LIMIT" | "NOT_FOUND" };

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
  slug: string;
};

export type TopicRow = {
  id: string;
  name: string;
  color: string | null;
  description: string | null;
  position: number;
  created_at: number;
};

export type RoomRow = {
  res_id: string;
  type: RoomType;
  name: string;
  description: string | null;
  capabilities_json: string;
  restricted: number;
  position: number | null;
  archived: number;
  created_at: number;
};

// Task 059: URL short-name derivation, shared by direct creation and
// application approval. Lowercase, non [a-z0-9] folds to '-', collapses runs,
// trims edges, caps at 32 - an all-non-ASCII name collapses to empty, which
// falls back to a random short string rather than an empty slug.
export function deriveSlugBase(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
  return base || crypto.randomUUID().replace(/-/g, "").slice(0, 8);
}

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

interface TipAttachment {
  actor: string;
  stronghold: string;
}

export interface EditConfigSnapshot {
  allow_message_edit: boolean;
  allow_message_retract: boolean;
  edit_window_secs: number;
}

// m0-protocol §7.3 revocation propagation: local-only DO-to-DO frame (never
// crosses federation, never occupies seq, never enters a dedupe table).
// `effect: "close"` is a hard kick (ban/remove); `effect: "update_deny"` is a
// live role/deny change - role/deny are pre-computed by StrongholdDO (via
// revokeActor, so groups are already folded in) so RoomDO never has to call
// back into StrongholdDO per revoke.
export interface MemberRevokePayload {
  actor: string;
  scope: string;
  effect: "close" | "update_deny";
  role?: Role;
  deny?: number;
}

// task 048 (m0-protocol §7.10a): D1 lookup of a local user's held server
// groups, position-ordered - the input shape synthesizeEffectivePermissions
// (permissions.ts) expects. Shared by StrongholdDO.revokeActor and api.ts's
// effectiveRole, the only two places that fold server groups into a role/deny.
export async function fetchServerGroupsForLocalpart(env: Env, localpart: string): Promise<ServerGroupPermInput[]> {
  const { results } = await env.DB.prepare(
    "SELECT g.position, g.allow_speak, g.allow_post, g.allow_reply, g.is_moderator " +
      "FROM user_server_groups usg JOIN server_groups g ON g.id = usg.group_id WHERE usg.localpart = ?"
  )
    .bind(localpart)
    .all<ServerGroupPermInput>();
  return results;
}

export class StrongholdDO extends DurableObject<Env> {
  // DOs created via getByName always carry their name back on ctx.id - used to
  // key the D1 membership index without an extra config read on every call.
  private readonly selfId: string;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.selfId = ctx.id.name ?? ctx.id.toString();
    ctx.blockConcurrencyWhile(async () => {
      this.migrate();
      await this.backfillSlug();
    });
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
      CREATE TABLE IF NOT EXISTS topic (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, color TEXT,
        position INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL
      );
    `);
    this.addColumnIfMissing("config", "slug", "TEXT");
    this.addColumnIfMissing("topic", "description", "TEXT");
    this.addColumnIfMissing("room", "description", "TEXT");
    // task 048: stronghold-local groups (task 037) moved to server-level D1
    // tables (server_groups/user_server_groups, migration 0009) - drop the
    // per-DO tables outright, no migration of their data.
    this.ctx.storage.sql.exec(`DROP TABLE IF EXISTS groups; DROP TABLE IF EXISTS member_groups;`);
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

  // task 059: strongholds created before the slug column existed have
  // slug = NULL - backfill with the stronghold's own id (already globally
  // unique) and best-effort mirror that into the D1 reverse index so
  // GET /api/resolve/:server/:slug finds them too. Runs every wake-up but is
  // a no-op past the first once every row has a slug.
  private async backfillSlug(): Promise<void> {
    const rows = this.ctx.storage.sql.exec<{ id: string; slug: string | null }>("SELECT id, slug FROM config").toArray();
    for (const row of rows) {
      if (row.slug) continue;
      this.ctx.storage.sql.exec("UPDATE config SET slug = ? WHERE id = ?", row.id, row.id);
      await this.env.DB.prepare(
        "INSERT INTO stronghold_slug_index (slug, stronghold_id) VALUES (?, ?) ON CONFLICT DO NOTHING"
      )
        .bind(row.id, row.id)
        .run()
        .catch(() => {});
    }
  }

  // ---- config -----------------------------------------------------------------

  async initConfig(
    id: string,
    name: string,
    visibility: "public" | "private",
    ownerActor: string,
    description?: string,
    icon?: string,
    slug?: string
  ): Promise<ConfigRow> {
    const existing = this.ctx.storage.sql.exec<ConfigRow>("SELECT * FROM config WHERE id = ?", id).toArray();
    if (existing.length > 0) return existing[0]!;
    const createdAt = Date.now();
    const resolvedSlug = slug ?? id;
    this.ctx.storage.sql.exec(
      "INSERT INTO config (id, name, description, visibility, icon, cover, allow_message_edit, allow_message_retract, edit_window_secs, owner_actor, created_at, slug) " +
        "VALUES (?, ?, ?, ?, ?, NULL, 1, 1, 300, ?, ?, ?)",
      id, name, description ?? null, visibility, icon ?? null, ownerActor, createdAt, resolvedSlug
    );
    this.ctx.storage.sql.exec(
      "INSERT INTO member (actor, role, deny, restricted, application_state, joined_at) VALUES (?, 'owner', 0, 0, 'approved', ?)",
      ownerActor, createdAt
    );
    await this.indexMember(ownerActor);
    return {
      id, name, description: description ?? null, visibility, icon: icon ?? null, cover: null,
      allow_message_edit: 1, allow_message_retract: 1, edit_window_secs: 300,
      owner_actor: ownerActor, created_at: createdAt, slug: resolvedSlug,
    };
  }

  // task 059: server admin-only slug rename (api.ts holds the D1-index
  // uniqueness check + gate; this just applies the already-resolved value).
  async updateSlug(newSlug: string): Promise<ConfigRow | null> {
    const current = await this.getConfig();
    if (!current) return null;
    this.ctx.storage.sql.exec("UPDATE config SET slug = ? WHERE id = ?", newSlug, current.id);
    return { ...current, slug: newSlug };
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

  // ---- revocation propagation (m0-protocol §7.3) --------------------------------
  // Same DO-to-DO fire-and-forget convention as pushEditConfigToRooms above: every
  // room DO this stronghold owns gets the frame, a failed push to one room never
  // blocks the others or the caller's own mutation.

  private async pushRevokeToRooms(payload: MemberRevokePayload): Promise<void> {
    // §7.3 covers stronghold-level WS tokens too ("MUST NOT rely on token
    // natural expiry"), so a hard revoke also tears down the actor's tips
    // sockets (§10.6) on this very DO. update_deny doesn't apply: the tips
    // channel grants no write access, role/deny changes can't affect it.
    if (payload.effect === "close") {
      this.closeTipSockets(payload.actor);
    }
    const rooms = await this.listRooms();
    await Promise.all(
      rooms.map((room) => {
        const roomRef = `${this.selfId}/${typeToKind(room.type)}/${room.res_id}`;
        const stub = this.env.ROOM_DO.getByName(roomRef);
        return stub.revokeMember(payload).catch(() => {});
      })
    );
  }

  private closeTipSockets(actor: string): void {
    for (const ws of this.ctx.getWebSockets("tips")) {
      const attachment = ws.deserializeAttachment() as TipAttachment | null;
      if (!attachment || attachment.actor !== actor) continue;
      try {
        ws.close(1008, "OMEW_SESSION_INVALID");
      } catch {
        // socket already gone.
      }
    }
  }

  // Recompute one actor's effective role/deny (server groups included, m0-protocol
  // §7.10a) and push it down to every room this stronghold owns. Public - task 048's
  // server-group admin routes (api.ts, against D1) call this per affected actor
  // after a group mutation, since that mutation happens outside any single
  // StrongholdDO. null means the actor no longer resolves to any access (not a
  // member, or banned) - banMember/removeMember already send their own "close"
  // for that transition, nothing to do here.
  async revokeActor(actor: string): Promise<void> {
    const member = await this.getMember(actor);
    if (!member || member.banned_at) return;
    let eff: EffectivePermissions;
    if (member.role !== "member") {
      eff = { role: member.role, deny: 0 };
    } else {
      // Guests (federated actors) have no users row and thus no server groups.
      const groups = domainOfActor(actor) === instanceDomain(this.env) ? await fetchServerGroupsForLocalpart(this.env, localpartOfActor(actor)) : [];
      eff = synthesizeEffectivePermissions("member", member.deny, groups);
    }
    await this.pushRevokeToRooms({ actor, scope: this.selfId, effect: "update_deny", role: eff.role, deny: eff.deny });
  }

  // ---- rooms --------------------------------------------------------------------

  async createRoom(
    resId: string,
    type: RoomType,
    name: string,
    capabilities: string[],
    restricted: boolean,
    position?: number,
    description?: string | null
  ): Promise<RoomRow> {
    const caps = capabilities.includes("text") ? capabilities : ["text", ...capabilities];
    const createdAt = Date.now();
    // listRooms orders by position first, so a room without one would sort ahead
    // of every explicitly ordered room - append it to the end instead.
    const maxPos = this.ctx.storage.sql.exec<{ maxpos: number | null }>("SELECT MAX(position) AS maxpos FROM room").one().maxpos;
    const pos = position ?? (maxPos ?? -1) + 1;
    const desc = description ?? null;
    this.ctx.storage.sql.exec(
      "INSERT INTO room (res_id, type, name, description, capabilities_json, restricted, position, archived, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)",
      resId, type, name, desc, JSON.stringify(caps), restricted ? 1 : 0, pos, createdAt
    );
    return { res_id: resId, type, name, description: desc, capabilities_json: JSON.stringify(caps), restricted: restricted ? 1 : 0, position: pos, archived: 0, created_at: createdAt };
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
    patch: { name?: string; description?: string | null; restricted?: boolean; position?: number; capabilities?: string[] }
  ): Promise<RoomRow | null> {
    const current = await this.getRoom(resId);
    if (!current) return null;
    const next = {
      ...current,
      name: patch.name ?? current.name,
      description: "description" in patch ? (patch.description ?? null) : current.description,
      restricted: patch.restricted != null ? (patch.restricted ? 1 : 0) : current.restricted,
      position: patch.position ?? current.position,
      capabilities_json: patch.capabilities ? JSON.stringify(patch.capabilities) : current.capabilities_json,
    };
    this.ctx.storage.sql.exec(
      "UPDATE room SET name = ?, description = ?, capabilities_json = ?, restricted = ?, position = ? WHERE res_id = ?",
      next.name, next.description, next.capabilities_json, next.restricted, next.position, resId
    );
    return next;
  }

  // proposal S3.6: room-ref res_id MUST NOT be recycled and next_seq MUST NOT reset,
  // so this only flags the room archived rather than deleting the row.
  async deleteRoom(resId: string): Promise<void> {
    this.ctx.storage.sql.exec("UPDATE room SET archived = 1 WHERE res_id = ?", resId);
    this.ctx.storage.sql.exec("DELETE FROM tip WHERE room_ref LIKE ?", `%/${resId}`);
  }

  // ---- topics (stronghold-wide post-tag pool, shared across sections) ----

  async listTopics(): Promise<TopicRow[]> {
    return this.ctx.storage.sql.exec<TopicRow>("SELECT * FROM topic ORDER BY position, created_at").toArray();
  }

  async countTopics(): Promise<number> {
    return this.ctx.storage.sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM topic").one().n;
  }

  async createTopic(id: string, name: string, color: string | null, description?: string | null): Promise<TopicMutationResult> {
    const dup = this.ctx.storage.sql.exec<{ id: string }>("SELECT id FROM topic WHERE name = ?", name).toArray();
    if (dup.length > 0) return { ok: false, code: "ALREADY_EXISTS" };
    if ((await this.countTopics()) >= TOPIC_LIMIT) return { ok: false, code: "TOPIC_LIMIT" };
    const createdAt = Date.now();
    const posRow = this.ctx.storage.sql.exec<{ maxpos: number | null }>("SELECT MAX(position) AS maxpos FROM topic").one();
    const position = (posRow.maxpos ?? -1) + 1;
    const desc = description ?? null;
    this.ctx.storage.sql.exec(
      "INSERT INTO topic (id, name, color, description, position, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      id, name, color, desc, position, createdAt
    );
    return { ok: true, topic: { id, name, color, description: desc, position, created_at: createdAt } };
  }

  async updateTopic(
    id: string,
    patch: { name?: string; color?: string | null; description?: string | null; position?: number }
  ): Promise<TopicMutationResult> {
    const rows = this.ctx.storage.sql.exec<TopicRow>("SELECT * FROM topic WHERE id = ?", id).toArray();
    const current = rows[0];
    if (!current) return { ok: false, code: "NOT_FOUND" };
    if (patch.name != null && patch.name !== current.name) {
      const dup = this.ctx.storage.sql
        .exec<{ id: string }>("SELECT id FROM topic WHERE name = ? AND id != ?", patch.name, id)
        .toArray();
      if (dup.length > 0) return { ok: false, code: "ALREADY_EXISTS" };
    }
    const next = {
      ...current,
      ...patch,
      description: "description" in patch ? (patch.description ?? null) : current.description,
    };
    this.ctx.storage.sql.exec(
      "UPDATE topic SET name = ?, color = ?, description = ?, position = ? WHERE id = ?",
      next.name, next.color, next.description, next.position, id
    );
    return { ok: true, topic: next };
  }

  async deleteTopic(id: string): Promise<boolean> {
    const existing = this.ctx.storage.sql.exec<{ id: string }>("SELECT id FROM topic WHERE id = ?", id).toArray();
    if (existing.length === 0) return false;
    this.ctx.storage.sql.exec("DELETE FROM topic WHERE id = ?", id);
    return true;
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
    if (rows[0]) return rows[0];
    return this.adoptLegacyActor(actor);
  }

  // The instance-domain migration (D1 0007) rewrote "@user:local" actors in D1
  // but per-DO SQLite rows were out of its reach, so strongholds created before
  // the domain was configured still key membership by the legacy actor. Lazily
  // rewrite every table that keys on the actor the first time the new-domain
  // actor shows up, then serve the row as if nothing happened.
  private adoptLegacyActor(actor: string): MemberRow | null {
    const m = /^@([^:]+):(.+)$/.exec(actor);
    if (!m || m[2] === "local") return null;
    const legacy = `@${m[1]}:local`;
    const rows = this.ctx.storage.sql.exec<MemberRow>("SELECT * FROM member WHERE actor = ?", legacy).toArray();
    if (!rows[0]) return null;
    const sql = this.ctx.storage.sql;
    sql.exec("UPDATE member SET actor = ? WHERE actor = ?", actor, legacy);
    sql.exec("UPDATE ban SET actor = ? WHERE actor = ?", actor, legacy);
    sql.exec("UPDATE config SET owner_actor = ? WHERE owner_actor = ?", actor, legacy);
    return { ...rows[0], actor };
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
    await this.revokeActor(actor);
    return { ...current, role, deny };
  }

  // Kick: revocable removal, the row is gone entirely (distinct from ban, which
  // keeps the row and sets banned_at - see banMember). Never targets `owner`.
  async removeMember(actor: string): Promise<boolean> {
    const current = await this.getMember(actor);
    if (!current || current.role === "owner") return false;
    this.ctx.storage.sql.exec("DELETE FROM member WHERE actor = ?", actor);
    await this.unindexMember(actor);
    await this.pushRevokeToRooms({ actor, scope: this.selfId, effect: "close" });
    return true;
  }

  async transferOwnership(fromActor: string, toActor: string): Promise<ConfigRow | null> {
    const config = await this.getConfig();
    const target = await this.getMember(toActor);
    if (!config || config.owner_actor !== fromActor || !target || target.role === "owner") return null;
    this.ctx.storage.sql.exec("UPDATE member SET role = 'owner', deny = 0 WHERE actor = ?", toActor);
    this.ctx.storage.sql.exec("UPDATE member SET role = 'member', deny = 0 WHERE actor = ?", fromActor);
    this.ctx.storage.sql.exec("UPDATE config SET owner_actor = ? WHERE id = ?", toActor, config.id);
    // Both actors' live attachments still carry the pre-transfer roles
    // (m0-protocol §7.3) - the demotion matters for enforcement, the promotion
    // is pushed for symmetry so a reconnect is never needed to pick it up.
    await Promise.all([this.revokeActor(fromActor), this.revokeActor(toActor)]);
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
    await this.pushRevokeToRooms({ actor, scope: this.selfId, effect: "close" });
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
