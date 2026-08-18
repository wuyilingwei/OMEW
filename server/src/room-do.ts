import { DurableObject } from "cloudflare:workers";
import { verifyToken } from "./auth";
import {
  DENY_CHANNEL_SPEAK,
  DENY_SECTION_POST,
  DENY_SECTION_REPLY,
  HOME_DOMAIN,
  type RoomTokenClaims,
} from "./types";

// proposal S4.2: Channel and Section share this implementation; a channel is the
// degenerate case where every item has parent_seq IS NULL. Kind (ch|sec) is carried
// in the room-ref, not stored separately here - it only matters for the deny-bit
// rule below and is read off the WS token's `room` claim at handshake time.

// proposal S4.1: this instance's own domain is not yet wired up (no federation in
// M1) - envelopes are stamped with a fixed local origin until M5/M6.
const HOME_ORIGIN = HOME_DOMAIN;

const BATCH_WINDOW_MS = 80;
const HISTORY_DEFAULT_LIMIT = 50;
const HISTORY_MAX_LIMIT = 200;
const RESYNC_GAP_LIMIT = 500;

const RATE_LIMIT_CAPACITY = 20;
const RATE_LIMIT_REFILL_PER_SEC = 5;

interface Attachment {
  actor: string;
  room: string; // room-ref, e.g. "<stronghold>/ch/<resId>"
  role: "owner" | "mod" | "member";
  deny: number;
  last_seq: number;
}

// `type` (not `interface`) so it structurally satisfies the SqlStorageValue
// index-signature constraint that sql.exec<T>() requires.
type ItemRow = {
  seq: number;
  parent_seq: number | null;
  root_seq: number | null;
  actor: string;
  origin: string;
  client_id: string;
  kind: string;
  ts: number;
  body: string;
};

interface PendingEntry {
  senderWs: WebSocket;
  frame: Record<string, unknown>;
}

export class RoomDO extends DurableObject<Env> {
  private pendingBatch: PendingEntry[] = [];
  private batchTimer: ReturnType<typeof setTimeout> | null = null;
  private rateBuckets = new Map<string, { tokens: number; last: number }>();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => this.migrate());
  }

  private migrate(): void {
    const sql = this.ctx.storage.sql;
    // proposal S5.1 schema, verbatim table shapes. `meta` is the one addition:
    // next_seq MUST be persisted independently of the item table (S5.2) so
    // archiving rows never lets seq regress.
    sql.exec(`
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS item (
        seq INTEGER PRIMARY KEY,
        parent_seq INTEGER, root_seq INTEGER,
        actor TEXT NOT NULL, origin TEXT NOT NULL, client_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        ts INTEGER NOT NULL, body TEXT NOT NULL,
        UNIQUE(origin, client_id)
      );
      CREATE INDEX IF NOT EXISTS idx_root ON item(root_seq, seq);
      CREATE TABLE IF NOT EXISTS tombstone (seq INTEGER PRIMARY KEY, actor TEXT, ts INTEGER, reason TEXT);
      CREATE TABLE IF NOT EXISTS edit (target_seq INTEGER PRIMARY KEY, seq INTEGER, body TEXT, edited_at INTEGER);
      CREATE TABLE IF NOT EXISTS dedupe_local (origin TEXT, client_id TEXT, seq INTEGER, ts INTEGER, PRIMARY KEY(origin, client_id));
      CREATE TABLE IF NOT EXISTS dedupe_fed (origin TEXT, envelope_id TEXT, ts INTEGER, PRIMARY KEY(origin, envelope_id));
      CREATE TABLE IF NOT EXISTS subscription (peer TEXT PRIMARY KEY, expires_at INTEGER);
    `);
    sql.exec(`INSERT OR IGNORE INTO meta (key, value) VALUES ('next_seq', 1)`);
  }

  // S5.1/S5.2: next_seq lives only here, bumped atomically with the RETURNING trick
  // (single synchronous sql.exec, no await - coalesced with whatever write follows).
  private allocateSeq(): number {
    const row = this.ctx.storage.sql
      .exec<{ seq: number }>(
        "UPDATE meta SET value = value + 1 WHERE key = 'next_seq' RETURNING value - 1 AS seq"
      )
      .one();
    return row.seq;
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("expected websocket", { status: 426 });
    }
    const protocolHeader = request.headers.get("Sec-WebSocket-Protocol");
    if (!protocolHeader) {
      return new Response("missing token", { status: 401 });
    }
    const token = protocolHeader.trim();
    const claims = await verifyToken<RoomTokenClaims>(token, this.env.DEV_TOKEN_SECRET);
    if (!claims || claims.typ !== "room") {
      return new Response("invalid token", { status: 401 });
    }

    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    this.ctx.acceptWebSocket(server);
    const attachment: Attachment = {
      actor: claims.actor,
      room: claims.room,
      role: claims.role,
      deny: claims.deny,
      last_seq: 0,
    };
    server.serializeAttachment(attachment);

    return new Response(null, {
      status: 101,
      webSocket: client,
      headers: { "Sec-WebSocket-Protocol": token },
    });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message !== "string") return;
    const attachment = ws.deserializeAttachment() as Attachment | null;
    if (!attachment) {
      ws.close(1011, "no attachment");
      return;
    }

    if (!this.takeRateToken(attachment.actor)) {
      this.sendError(ws, "OMEW_RATE_LIMITED", "too many messages");
      return;
    }

    let frame: Record<string, unknown>;
    try {
      frame = JSON.parse(message);
    } catch {
      this.sendError(ws, "OMEW_MALFORMED", "invalid json");
      return;
    }

    switch (frame.type) {
      case "item.create":
        this.handleItemCreate(ws, attachment, frame);
        return;
      case "item.update":
        this.handleItemUpdate(ws, attachment, frame);
        return;
      case "item.delete":
        this.handleItemDelete(ws, attachment, frame);
        return;
      case "resync":
        this.handleResync(ws, frame);
        return;
      default:
        // m0-protocol S13.2: unknown types are silently ignored, no error frame.
        return;
    }
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    try {
      // Echo the close so the Hibernation API completes the handshake on our side.
      // Reserved codes (e.g. 1005 "no status received", reported when the client
      // closed without one) MUST NOT be sent explicitly - fall back to a plain close.
      ws.close(code, reason);
    } catch {
      ws.close();
    }
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    // Hibernation API surfaces the failure; nothing durable to clean up since
    // attachment/session state lives only on the socket itself.
  }

  // ---- item.* handlers -----------------------------------------------------

  private handleItemCreate(ws: WebSocket, attachment: Attachment, frame: Record<string, unknown>): void {
    const clientId = String(frame.client_id ?? "");
    const kind = String(frame.kind ?? "");
    const parentSeq = frame.parent_seq == null ? null : Number(frame.parent_seq);
    const body = frame.body;

    if (!clientId || clientId.length > 64) {
      this.sendError(ws, "OMEW_MALFORMED", "bad client_id");
      return;
    }
    if (kind !== "post" && kind !== "reply") {
      // m0-protocol S3.2: unknown kind is treated like unknown type - ignored, not an error.
      this.sendAck(ws, { status: "ignored", client_id: clientId, reason: "unknown_kind" });
      return;
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      this.sendError(ws, "OMEW_MALFORMED", "body must be an object");
      return;
    }
    const b = body as Record<string, unknown>;
    if (!b.text && !b.media && !b.quote) {
      this.sendError(ws, "OMEW_MALFORMED", "body needs text, media or quote");
      return;
    }

    const roomKind = attachment.room.split("/")[1]; // "ch" | "sec"
    const requiredBit = parentSeq != null
      ? DENY_SECTION_REPLY
      : roomKind === "sec"
        ? DENY_SECTION_POST
        : DENY_CHANNEL_SPEAK;
    if (attachment.deny & requiredBit) {
      this.sendError(ws, "OMEW_FORBIDDEN", "denied by member state");
      return;
    }

    const existing = this.ctx.storage.sql
      .exec<{ seq: number }>(
        "SELECT seq FROM dedupe_local WHERE origin = ? AND client_id = ?",
        HOME_ORIGIN,
        clientId
      )
      .toArray();
    if (existing.length > 0) {
      this.sendAck(ws, { status: "duplicate", client_id: clientId, seq: existing[0]!.seq });
      return;
    }

    let rootSeq: number | null = null;
    if (parentSeq != null) {
      const parent = this.ctx.storage.sql
        .exec<ItemRow>("SELECT * FROM item WHERE seq = ?", parentSeq)
        .toArray();
      if (parent.length === 0) {
        this.sendError(ws, "OMEW_TARGET_NOT_FOUND", "parent not found");
        return;
      }
      if (parent[0]!.parent_seq != null) {
        this.sendError(ws, "OMEW_REPLY_DEPTH", "reply depth exceeds one level");
        return;
      }
      rootSeq = parent[0]!.seq;
    }

    const ts = Date.now();
    const seq = this.allocateSeq();
    rootSeq = rootSeq ?? seq;
    const bodyJson = JSON.stringify(body);
    this.ctx.storage.sql.exec(
      "INSERT INTO item (seq, parent_seq, root_seq, actor, origin, client_id, kind, ts, body) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      seq, parentSeq, rootSeq, attachment.actor, HOME_ORIGIN, clientId, kind, ts, bodyJson
    );
    this.ctx.storage.sql.exec(
      "INSERT INTO dedupe_local (origin, client_id, seq, ts) VALUES (?, ?, ?, ?)",
      HOME_ORIGIN, clientId, seq, ts
    );

    this.sendAck(ws, { status: "ok", client_id: clientId, seq });
    this.enqueueBroadcast(ws, {
      type: "item.create",
      seq, parent_seq: parentSeq, root_seq: rootSeq,
      actor: attachment.actor, kind, ts, body,
    });
    this.reportTip(attachment.room, seq);
  }

  private handleItemUpdate(ws: WebSocket, attachment: Attachment, frame: Record<string, unknown>): void {
    const targetSeq = Number(frame.target_seq);
    const body = frame.body;
    if (!Number.isFinite(targetSeq) || !body || typeof body !== "object") {
      this.sendError(ws, "OMEW_MALFORMED", "bad item.update");
      return;
    }

    const target = this.ctx.storage.sql
      .exec<ItemRow>("SELECT * FROM item WHERE seq = ?", targetSeq)
      .toArray();
    if (target.length === 0) {
      this.sendError(ws, "OMEW_TARGET_NOT_FOUND", "target not found");
      return;
    }
    const tomb = this.ctx.storage.sql
      .exec<{ seq: number }>("SELECT seq FROM tombstone WHERE seq = ?", targetSeq)
      .toArray();
    if (tomb.length > 0) {
      this.sendError(ws, "OMEW_ITEM_DELETED", "target already deleted");
      return;
    }
    if (target[0]!.actor !== attachment.actor) {
      this.sendError(ws, "OMEW_FORBIDDEN", "only the author may edit");
      return;
    }

    const editedAt = Date.now();
    const seq = this.allocateSeq();
    const bodyJson = JSON.stringify(body);
    this.ctx.storage.sql.exec(
      "INSERT INTO edit (target_seq, seq, body, edited_at) VALUES (?, ?, ?, ?) " +
        "ON CONFLICT(target_seq) DO UPDATE SET seq = excluded.seq, body = excluded.body, edited_at = excluded.edited_at",
      targetSeq, seq, bodyJson, editedAt
    );

    this.sendAck(ws, { status: "ok", target_seq: targetSeq, seq });
    this.enqueueBroadcast(ws, { type: "item.update", seq, target_seq: targetSeq, body, edited_at: editedAt });
    this.reportTip(attachment.room, seq);
  }

  private handleItemDelete(ws: WebSocket, attachment: Attachment, frame: Record<string, unknown>): void {
    const targetSeq = Number(frame.target_seq);
    const reason = frame.reason == null ? undefined : String(frame.reason);
    if (!Number.isFinite(targetSeq)) {
      this.sendError(ws, "OMEW_MALFORMED", "bad item.delete");
      return;
    }

    const alreadyTombstoned = this.ctx.storage.sql
      .exec<{ seq: number }>("SELECT seq FROM tombstone WHERE seq = ?", targetSeq)
      .toArray();
    if (alreadyTombstoned.length > 0) {
      // m0-protocol S3.2: repeated item.delete is an idempotent no-op, not an error.
      this.sendAck(ws, { status: "ok", target_seq: targetSeq });
      return;
    }

    const target = this.ctx.storage.sql
      .exec<ItemRow>("SELECT * FROM item WHERE seq = ?", targetSeq)
      .toArray();
    if (target.length === 0) {
      this.sendError(ws, "OMEW_TARGET_NOT_FOUND", "target not found");
      return;
    }

    const isAuthor = target[0]!.actor === attachment.actor;
    const isModerator = attachment.role === "mod" || attachment.role === "owner";
    if (!isAuthor && !isModerator) {
      this.sendError(ws, "OMEW_FORBIDDEN", "not author or moderator");
      return;
    }
    const byRole: "author" | "mod" | "owner" = isAuthor ? "author" : (attachment.role as "mod" | "owner");

    const ts = Date.now();
    const seq = this.allocateSeq();
    this.ctx.storage.sql.exec(
      "INSERT INTO tombstone (seq, actor, ts, reason) VALUES (?, ?, ?, ?)",
      targetSeq, attachment.actor, ts, reason ?? null
    );

    this.sendAck(ws, { status: "ok", target_seq: targetSeq, seq });
    this.enqueueBroadcast(ws, { type: "item.delete", seq, target_seq: targetSeq, reason, by_role: byRole });
    this.reportTip(attachment.room, seq);
  }

  // S4.4: RoomDO -> StrongholdDO after each commit; fire-and-forget, never blocks
  // the ack/broadcast path. StrongholdDO persists before its own coalesced flush.
  private reportTip(roomRef: string, seq: number): void {
    const strongholdId = roomRef.split("/")[0]!;
    const stub = this.env.STRONGHOLD_DO.getByName(strongholdId);
    this.ctx.waitUntil(stub.reportTip(roomRef, seq).catch(() => {}));
  }

  // S5.3 resync: gap <= 500 replays directly, larger gaps defer to the history API.
  private handleResync(ws: WebSocket, frame: Record<string, unknown>): void {
    const fromSeq = Number(frame.from_seq);
    if (!Number.isFinite(fromSeq)) {
      this.sendError(ws, "OMEW_MALFORMED", "bad resync");
      return;
    }
    const nextSeq = this.ctx.storage.sql
      .exec<{ value: number }>("SELECT value FROM meta WHERE key = 'next_seq'")
      .one().value;
    const currentMax = nextSeq - 1;
    const gap = currentMax - fromSeq;
    if (gap <= 0) return;

    if (gap > RESYNC_GAP_LIMIT) {
      try {
        ws.send(JSON.stringify({ type: "resync_gap", gap: true, from: fromSeq, to: currentMax }));
      } catch {
        // socket already gone; nothing to clean up.
      }
      return;
    }

    const rows = this.ctx.storage.sql
      .exec<ItemRow & { edit_body: string | null; edited_at: number | null; tomb_seq: number | null }>(
        `SELECT i.*, e.body AS edit_body, e.edited_at, t.seq AS tomb_seq
         FROM item i
         LEFT JOIN edit e ON e.target_seq = i.seq
         LEFT JOIN tombstone t ON t.seq = i.seq
         WHERE i.seq > ? ORDER BY i.seq ASC`,
        fromSeq
      )
      .toArray();

    const items = rows
      .filter((r) => r.tomb_seq == null)
      .map((r) => ({
        type: "item.create" as const,
        seq: r.seq,
        parent_seq: r.parent_seq,
        root_seq: r.root_seq,
        actor: r.actor,
        kind: r.kind,
        ts: r.ts,
        body: JSON.parse(r.edit_body ?? r.body),
      }));
    try {
      ws.send(JSON.stringify({ type: "batch", items }));
    } catch {
      // socket already gone.
    }
  }

  // ---- ack / batch broadcast -------------------------------------------------

  private sendAck(ws: WebSocket, ack: Record<string, unknown>): void {
    try {
      ws.send(JSON.stringify({ type: "ack", ...ack }));
    } catch {
      // socket already gone; the client will resend on reconnect.
      return;
    }
    if (typeof ack.seq === "number") {
      this.bumpLastSeq(ws, ack.seq);
    }
  }

  private sendError(ws: WebSocket, code: string, message: string): void {
    try {
      ws.send(JSON.stringify({ type: "error", code, message }));
    } catch {
      // ignore.
    }
  }

  private bumpLastSeq(ws: WebSocket, seq: number): void {
    const attachment = ws.deserializeAttachment() as Attachment | null;
    if (!attachment) return;
    if (seq > attachment.last_seq) {
      attachment.last_seq = seq;
      ws.serializeAttachment(attachment);
    }
  }

  // S4.3/S5.2: commit already happened by the time this is called; ack was already
  // sent synchronously above. This only queues the fan-out to everyone else, batched
  // in a window that exists solely while there is something pending to flush.
  private enqueueBroadcast(senderWs: WebSocket, frame: Record<string, unknown>): void {
    this.pendingBatch.push({ senderWs, frame });
    if (this.batchTimer == null) {
      this.batchTimer = setTimeout(() => this.flushBatch(), BATCH_WINDOW_MS);
    }
  }

  private flushBatch(): void {
    this.batchTimer = null;
    if (this.pendingBatch.length === 0) return;
    const batch = this.pendingBatch;
    this.pendingBatch = [];

    for (const ws of this.ctx.getWebSockets()) {
      const frames = batch.filter((e) => e.senderWs !== ws).map((e) => e.frame);
      if (frames.length === 0) continue;
      try {
        ws.send(JSON.stringify({ type: "batch", items: frames }));
      } catch {
        continue;
      }
      const maxSeq = frames.reduce((max, f) => {
        const seq = f.seq;
        return typeof seq === "number" && seq > max ? seq : max;
      }, -1);
      if (maxSeq >= 0) this.bumpLastSeq(ws, maxSeq);
    }
  }

  // S9: token bucket per actor, not per connection.
  private takeRateToken(actor: string): boolean {
    const now = Date.now();
    const bucket = this.rateBuckets.get(actor) ?? { tokens: RATE_LIMIT_CAPACITY, last: now };
    const elapsedSec = (now - bucket.last) / 1000;
    bucket.tokens = Math.min(RATE_LIMIT_CAPACITY, bucket.tokens + elapsedSec * RATE_LIMIT_REFILL_PER_SEC);
    bucket.last = now;
    if (bucket.tokens < 1) {
      this.rateBuckets.set(actor, bucket);
      return false;
    }
    bucket.tokens -= 1;
    this.rateBuckets.set(actor, bucket);
    return true;
  }

  // ---- history RPC ------------------------------------------------------------

  // S5.3: pagination is seq-anchored, never timestamp-anchored.
  async getHistory(beforeSeq: number | null, limit: number): Promise<unknown[]> {
    const cappedLimit = Math.max(1, Math.min(limit || HISTORY_DEFAULT_LIMIT, HISTORY_MAX_LIMIT));
    const rows = beforeSeq == null
      ? this.ctx.storage.sql
          .exec<ItemRow & { edit_body: string | null; edited_at: number | null; tomb_seq: number | null }>(
            `SELECT i.*, e.body AS edit_body, e.edited_at, t.seq AS tomb_seq
             FROM item i
             LEFT JOIN edit e ON e.target_seq = i.seq
             LEFT JOIN tombstone t ON t.seq = i.seq
             ORDER BY i.seq DESC LIMIT ?`,
            cappedLimit
          )
          .toArray()
      : this.ctx.storage.sql
          .exec<ItemRow & { edit_body: string | null; edited_at: number | null; tomb_seq: number | null }>(
            `SELECT i.*, e.body AS edit_body, e.edited_at, t.seq AS tomb_seq
             FROM item i
             LEFT JOIN edit e ON e.target_seq = i.seq
             LEFT JOIN tombstone t ON t.seq = i.seq
             WHERE i.seq < ? ORDER BY i.seq DESC LIMIT ?`,
            beforeSeq, cappedLimit
          )
          .toArray();

    return rows
      .filter((r) => r.tomb_seq == null)
      .map((r) => ({
        seq: r.seq,
        parent_seq: r.parent_seq,
        root_seq: r.root_seq,
        actor: r.actor,
        kind: r.kind,
        ts: r.ts,
        body: JSON.parse(r.edit_body ?? r.body),
        edited_at: r.edited_at ?? undefined,
      }));
  }
}
