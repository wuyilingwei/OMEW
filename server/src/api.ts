import { createHash } from "node:crypto";
import { dummyPasswordFields, hashPassword, newJti, signToken, verifyPassword, verifyToken } from "./auth";
import { getInstanceConfig } from "./config";
import { handleInbox } from "./inbox";
import type { EffectivePermissions } from "./permissions";
import type { ConfigRow, GroupRow, MemberRow } from "./stronghold-do";
import {
  instanceDomain,
  typeToKind,
  type Role,
  type RoomTokenClaims,
  type RoomType,
  type ServerRole,
  type SessionTokenClaims,
  type StrongholdTokenClaims,
} from "./types";
import {
  domainOfActor,
  generateInviteCode,
  isOriginTrusted,
  isValidEmail,
  isValidUsername,
  localpartOfActor,
  normalizeUsername,
  toPublicUser,
} from "./users";

export { RoomDO } from "./room-do";
export { StrongholdDO } from "./stronghold-do";

const SESSION_TOKEN_TTL_S = 24 * 60 * 60; // m0-protocol S7.2: session token lifetime MUST <= 24h.
const ROOM_TOKEN_TTL_S = 300; // m0-protocol S7.3: room/stronghold WS token exp MUST <= 300s.
const MAX_BODY_BYTES = 64 * 1024;
const USERS_PAGE_SIZE = 50;

const RES_ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;

function cors(): HeadersInit {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...cors() },
  });
}

function errorResponse(status: number, code: string, message: string): Response {
  return json({ error: { code, message } }, status);
}

// The /api/* and /federation/session contract is fixed (web is built against it in
// parallel) as a flat `{error: "CODE"}` - deliberately not the nested
// `{error:{code,message}}` shape used by the older routes above.
function apiError(status: number, code: string): Response {
  return json({ error: code }, status);
}

async function readJsonBody(request: Request): Promise<Record<string, unknown> | null> {
  const len = request.headers.get("Content-Length");
  if (len && Number(len) > MAX_BODY_BYTES) return null;
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) return null;
  if (!text) return {};
  try {
    const parsed = JSON.parse(text);
    return typeof parsed === "object" && parsed !== null ? parsed : null;
  } catch {
    return null;
  }
}

// Full session claims - used wherever the server-role overlay (m0-protocol
// §7.10) matters. server_role rides in the token itself (types.ts) rather than
// a per-request DB read, so a role change only takes effect for a session's
// holder once that session's own TTL expires - same tradeoff v1 already makes
// for every other session claim (see /api/me/password's note).
async function requireSession(request: Request, env: Env): Promise<SessionTokenClaims | Response> {
  const header = request.headers.get("Authorization");
  if (!header?.startsWith("Bearer ")) return apiError(401, "AUTH_REQUIRED");
  const claims = await verifyToken<SessionTokenClaims>(header.slice(7), env.DEV_TOKEN_SECRET);
  if (!claims || claims.typ !== "session") return apiError(401, "AUTH_REQUIRED");
  return claims;
}

// Thin actor-only wrapper over requireSession for the many routes that don't
// need server_role.
async function requireActor(request: Request, env: Env): Promise<string | null> {
  const session = await requireSession(request, env);
  return session instanceof Response ? null : session.actor;
}

// Server-level admin gate (m0-protocol §7.10): server_owner or server_admin.
// Replaces the old is_admin-column requireAdmin - "admin" here means "at least
// server_admin", owner always passes too.
async function requireServerRole(
  request: Request,
  env: Env,
  min: "admin" | "owner"
): Promise<{ actor: string; serverRole: ServerRole } | Response> {
  const session = await requireSession(request, env);
  if (session instanceof Response) return session;
  const ok = min === "owner" ? session.server_role === "owner" : session.server_role === "owner" || session.server_role === "admin";
  if (!ok) return apiError(403, "ADMIN_REQUIRED");
  return { actor: session.actor, serverRole: session.server_role };
}

// m0-protocol §7.10: server_owner/server_admin get owner-equivalent permissions
// in every stronghold, independent of actual membership - except ownership
// transfer, which stays gated on real ownership or server_owner specifically
// (handled at the transfer endpoint, not here). null means no access at all:
// no real membership (and no overlay), or banned with no overlay.
function overlayRole(serverRole: ServerRole, member: MemberRow | null): Role | null {
  if (serverRole === "owner" || serverRole === "admin") return "owner";
  if (!member || member.banned_at) return null;
  return member.role;
}

// task 037: overlayRole's group-aware counterpart - the one function every
// tier-gated route and the WS room-token mint call to get a member's actual
// effective role/deny once their custom groups are folded in (StrongholdDO's
// getEffective, backed by permissions.ts). Short-circuits the DO call entirely
// for the server_role owner/admin overlay, same as overlayRole did.
async function effectiveRole(
  env: Env,
  strongholdId: string,
  serverRole: ServerRole,
  actor: string
): Promise<EffectivePermissions | null> {
  if (serverRole === "owner" || serverRole === "admin") return { role: "owner", deny: 0 };
  const stub = env.STRONGHOLD_DO.getByName(strongholdId);
  return stub.getEffective(actor);
}

function match(pattern: string, path: string): Record<string, string> | null {
  const patternParts = pattern.split("/").filter(Boolean);
  const pathParts = path.split("/").filter(Boolean);
  if (patternParts.length !== pathParts.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < patternParts.length; i++) {
    const p = patternParts[i]!;
    const v = pathParts[i]!;
    if (p.startsWith(":")) {
      params[p.slice(1)] = decodeURIComponent(v);
    } else if (p !== v) {
      return null;
    }
  }
  return params;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: cors() });
    }

    if (url.pathname === "/inbox" || url.pathname.startsWith("/inbox/")) {
      return handleInbox(request, env);
    }

    try {
      return await route(request, env, url);
    } catch (err) {
      console.error(JSON.stringify({ level: "error", message: "unhandled api error", error: String(err) }));
      return errorResponse(500, "OMEW_INTERNAL", "internal error");
    }
  },
};

async function route(request: Request, env: Env, url: URL): Promise<Response> {
  const path = url.pathname;
  const method = request.method;

  // ---- instance identity policy + registration/login (real user system) ---------

  if (method === "GET" && path === "/api/instance/config") {
    const config = await getInstanceConfig(env);
    return json({
      allow_root: config.allow_root,
      root_requirements: config.root_requirements,
      // Policy value only (open/restricted/application) - enough for the client
      // to shape its "create stronghold" entry point; creators/peers stay admin-only.
      stronghold_creation: config.stronghold_creation_policy,
      allow_guest_browsing: config.allow_guest_browsing,
    });
  }

  // Task 034: unauthenticated public-stronghold discovery. When the policy is
  // off the endpoint itself acts not-found rather than an empty list, matching
  // "you need to be logged in" 401s used elsewhere for a disabled read path -
  // there is no logged-in variant of this endpoint to fall back to either way.
  if (method === "GET" && path === "/api/directory") {
    const config = await getInstanceConfig(env);
    if (!config.allow_guest_browsing) return apiError(404, "NOT_FOUND");
    return json({ strongholds: await listPublicDirectory(env) });
  }

  if (method === "POST" && path === "/api/register") {
    const body = await readJsonBody(request);
    if (!body) return apiError(413, "PAYLOAD_INVALID");

    const config = await getInstanceConfig(env);
    if (!config.allow_root) return apiError(403, "REGISTRATION_DISABLED");

    const username = normalizeUsername(String(body.username ?? ""));
    if (!isValidUsername(username)) return apiError(400, "USERNAME_INVALID");

    const ownershipPubkey = typeof body.ownership_pubkey === "string" ? body.ownership_pubkey : "";
    const ownershipCiphertext = typeof body.ownership_ciphertext === "string" ? body.ownership_ciphertext : "";
    if (!ownershipPubkey || !ownershipCiphertext) return apiError(400, "OWNERSHIP_KEY_REQUIRED");

    const password = String(body.password ?? "");
    if (password.length < 8) return apiError(400, "PASSWORD_INVALID");

    const existing = await env.DB.prepare("SELECT localpart FROM users WHERE localpart = ?").bind(username).first();
    if (existing) return apiError(409, "USERNAME_TAKEN");

    const requiresCode = config.root_requirements.includes("code");
    const requiresEmail = config.root_requirements.includes("email");
    const requiresPhone = config.root_requirements.includes("phone");

    const code = String(body.code ?? "");
    if (requiresCode) {
      if (!code) return apiError(400, "INVITE_INVALID");
      const invite = await env.DB.prepare("SELECT code FROM invite_codes WHERE code = ? AND used_by IS NULL")
        .bind(code)
        .first();
      if (!invite) return apiError(400, "INVITE_INVALID");
    }

    const emailInput = typeof body.email === "string" ? body.email.trim() : "";
    if (requiresEmail && !emailInput) return apiError(400, "EMAIL_INVALID");
    if (emailInput && !isValidEmail(emailInput)) return apiError(400, "EMAIL_INVALID");
    const email = emailInput || null;

    // v1 has no SMS channel; "phone" stays a valid root_requirements enum member
    // (reserved for a future release) but can never be satisfied today.
    if (requiresPhone) return apiError(400, "PHONE_UNSUPPORTED");

    // TODO: once an Email Service binding is configured, send a verification email
    // here and leave email_verified=0 until it's confirmed. Until then registration
    // is never blocked on verification.

    const { hash, salt } = await hashPassword(password);
    const actor = `@${username}:${instanceDomain(env)}`;
    const now = Date.now();

    const statements = [
      env.DB.prepare(
        "INSERT INTO users (localpart, display_name, status, created_at, pw_hash, pw_salt, email, email_verified, ownership_pubkey, ownership_ciphertext) VALUES (?, ?, 'active', ?, ?, ?, ?, 0, ?, ?)"
      ).bind(username, username, now, hash, salt, email, ownershipPubkey, ownershipCiphertext),
    ];
    const codeConsumeIndex = requiresCode ? statements.length : -1;
    if (requiresCode) {
      statements.push(
        env.DB.prepare("UPDATE invite_codes SET used_by = ?, used_at = ? WHERE code = ? AND used_by IS NULL")
          .bind(username, now, code)
      );
    }
    // m0-protocol §7.10: server_owner is unique, defaults to the first local
    // registration. Atomic first-mover claim: only the registration that
    // observes zero existing owners gets to set server_role='owner', so
    // concurrent first registrations can't both win.
    const ownerBootstrapIndex = statements.length;
    statements.push(
      env.DB.prepare(
        "UPDATE users SET server_role = 'owner' WHERE localpart = ? AND (SELECT COUNT(*) FROM users WHERE server_role = 'owner') = 0"
      ).bind(username)
    );

    let results: Awaited<ReturnType<typeof env.DB.batch>>;
    try {
      results = await env.DB.batch(statements);
    } catch {
      return apiError(409, "USERNAME_TAKEN");
    }

    if (requiresCode && results[codeConsumeIndex]!.meta.changes !== 1) {
      // Lost a race for the invite code between the pre-check and the batch commit;
      // undo the user we just created rather than admit them without a valid invite.
      await env.DB.prepare("DELETE FROM users WHERE localpart = ?").bind(username).run();
      return apiError(400, "INVITE_INVALID");
    }
    const serverRole: ServerRole = results[ownerBootstrapIndex]!.meta.changes === 1 ? "owner" : "user";

    const token = await issueSessionToken(actor, serverRole, env);
    const user = toPublicUser({ localpart: username, server_role: serverRole, email, email_verified: 0 }, actor);
    return json({ token, user });
  }

  if (method === "POST" && path === "/api/login") {
    const body = await readJsonBody(request);
    if (!body) return apiError(413, "PAYLOAD_INVALID");
    const username = normalizeUsername(String(body.username ?? ""));
    const password = String(body.password ?? "");

    const user = await env.DB.prepare(
      "SELECT localpart, pw_hash, pw_salt, status, server_role, email, email_verified FROM users WHERE localpart = ?"
    )
      .bind(username)
      .first<{
        localpart: string;
        pw_hash: string | null;
        pw_salt: string | null;
        status: string;
        server_role: ServerRole;
        email: string | null;
        email_verified: number;
      }>();

    // Always pay the same PBKDF2 cost whether or not the account exists, and never
    // distinguish "no such user" from "wrong password" in the response - both are
    // AUTH_FAILED, so login timing/response can't be used to enumerate usernames.
    const dummy = dummyPasswordFields();
    const valid = await verifyPassword(password, user?.pw_hash ?? dummy.hash, user?.pw_salt ?? dummy.salt);
    if (!user || !valid || user.status !== "active") {
      return apiError(401, "AUTH_FAILED");
    }

    const actor = `@${username}:${instanceDomain(env)}`;
    const token = await issueSessionToken(actor, user.server_role, env);
    return json({ token, user: toPublicUser(user, actor) });
  }

  // ---- account: change password ----------------------------------------------------

  if (method === "POST" && path === "/api/me/password") {
    const actor = await requireActor(request, env);
    if (!actor) return apiError(401, "AUTH_REQUIRED");
    const body = await readJsonBody(request);
    if (!body) return apiError(413, "PAYLOAD_INVALID");

    const oldPassword = String(body.old_password ?? "");
    const newPassword = String(body.new_password ?? "");
    // Same strength check as registration (users.ts has no separate policy for it).
    if (newPassword.length < 8) return apiError(400, "PASSWORD_INVALID");

    const localpart = localpartOfActor(actor);
    const user = await env.DB.prepare("SELECT pw_hash, pw_salt FROM users WHERE localpart = ?")
      .bind(localpart)
      .first<{ pw_hash: string | null; pw_salt: string | null }>();
    // Same constant-cost-regardless-of-outcome shape as /api/login.
    const dummy = dummyPasswordFields();
    const valid = await verifyPassword(oldPassword, user?.pw_hash ?? dummy.hash, user?.pw_salt ?? dummy.salt);
    if (!user || !valid) return apiError(401, "AUTH_FAILED");

    const { hash, salt } = await hashPassword(newPassword);
    await env.DB.prepare("UPDATE users SET pw_hash = ?, pw_salt = ? WHERE localpart = ?")
      .bind(hash, salt, localpart)
      .run();
    // v1: no server-side session revocation list exists, so this user's other
    // outstanding session tokens stay valid until their own 24h TTL expiry rather
    // than being force-invalidated here.
    return new Response(null, { status: 204, headers: cors() });
  }

  // ---- instance admin --------------------------------------------------------------
  // Policy fields (m0-protocol §7.9) are deployment env config as of task 035 -
  // GET reflects the env-derived values read-only, PATCH always 409s. The
  // instance_config D1 table/columns are left in place unread (archival).

  if (method === "GET" && path === "/api/admin/instance/config") {
    const gate = await requireServerRole(request, env, "admin");
    if (gate instanceof Response) return gate;
    return json({ ...getInstanceConfig(env), source: "env" });
  }

  if (method === "PATCH" && path === "/api/admin/instance/config") {
    const gate = await requireServerRole(request, env, "admin");
    if (gate instanceof Response) return gate;
    return apiError(409, "POLICY_IS_ENV");
  }

  if (method === "POST" && path === "/api/admin/invite-codes") {
    const gate = await requireServerRole(request, env, "admin");
    if (gate instanceof Response) return gate;
    const body = await readJsonBody(request);
    if (!body) return apiError(413, "PAYLOAD_INVALID");
    const count = body.count === undefined ? 1 : Number(body.count);
    if (!Number.isInteger(count) || count < 1 || count > 100) return apiError(400, "COUNT_INVALID");

    const now = Date.now();
    const codes = Array.from({ length: count }, () => generateInviteCode());
    await env.DB.batch(
      codes.map((code) =>
        env.DB.prepare("INSERT INTO invite_codes (code, created_by, created_at) VALUES (?, ?, ?)")
          .bind(code, gate.actor, now)
      )
    );
    return json(
      { codes: codes.map((code) => ({ code, created_by: gate.actor, created_at: now, used_by: null, used_at: null })) },
      201
    );
  }

  if (method === "GET" && path === "/api/admin/invite-codes") {
    const gate = await requireServerRole(request, env, "admin");
    if (gate instanceof Response) return gate;
    const { results } = await env.DB.prepare(
      "SELECT code, created_by, created_at, used_by, used_at FROM invite_codes ORDER BY created_at DESC"
    ).all();
    return json({ codes: results });
  }

  // ---- server-level role appointment (m0-protocol §7.10, server_owner only) -------

  if (method === "GET" && path === "/api/admin/users") {
    const gate = await requireServerRole(request, env, "owner");
    if (gate instanceof Response) return gate;
    const after = url.searchParams.get("after");
    const { results } = await env.DB.prepare(
      "SELECT localpart, server_role, created_at FROM users WHERE localpart > ? ORDER BY localpart LIMIT ?"
    )
      .bind(after ?? "", USERS_PAGE_SIZE + 1)
      .all<{ localpart: string; server_role: ServerRole; created_at: number }>();
    const hasMore = results.length > USERS_PAGE_SIZE;
    const page = hasMore ? results.slice(0, USERS_PAGE_SIZE) : results;
    return json({ users: page, next_cursor: hasMore ? page[page.length - 1]!.localpart : null });
  }

  const userRoleMatch = match("/api/admin/users/:localpart", path);
  if (userRoleMatch && method === "PATCH") {
    const gate = await requireServerRole(request, env, "owner");
    if (gate instanceof Response) return gate;
    const body = await readJsonBody(request);
    if (!body) return apiError(413, "PAYLOAD_INVALID");
    if (body.server_role !== "admin" && body.server_role !== "user") return apiError(400, "ROLE_INVALID");
    // server_owner is unique and non-transferable through this endpoint - can't
    // touch its own row (the only row that could be "owner"), and can't create
    // a second one.
    if (userRoleMatch.localpart === localpartOfActor(gate.actor)) return apiError(400, "ROLE_INVALID");

    const result = await env.DB.prepare("UPDATE users SET server_role = ? WHERE localpart = ? AND server_role != 'owner'")
      .bind(body.server_role, userRoleMatch.localpart!)
      .run();
    if (result.meta.changes === 0) return apiError(404, "NOT_FOUND");
    return json({ localpart: userRoleMatch.localpart, server_role: body.server_role });
  }

  // ---- media upload, retrieval, deletion and storage quota ------------------------

  if (method === "POST" && path === "/api/media") {
    return handleMediaUpload(request, env);
  }

  const mediaGetMatch = match("/media/:id", path);
  if (mediaGetMatch && method === "GET") {
    const actor = await requireActor(request, env);
    if (!actor) return apiError(401, "AUTH_REQUIRED");
    const row = await env.DB.prepare("SELECT mime, r2_key FROM media WHERE id = ?")
      .bind(mediaGetMatch.id!)
      .first<{ mime: string; r2_key: string }>();
    if (!row) return apiError(404, "NOT_FOUND");
    const object = await env.MEDIA.get(row.r2_key);
    if (!object) return apiError(404, "NOT_FOUND");
    return new Response(object.body, {
      headers: {
        "Content-Type": row.mime,
        "Cache-Control": "public, max-age=31536000, immutable",
        ...cors(),
      },
    });
  }

  const mediaDeleteMatch = match("/api/media/:id", path);
  if (mediaDeleteMatch && method === "DELETE") {
    const session = await requireSession(request, env);
    if (session instanceof Response) return session;
    const row = await env.DB.prepare("SELECT owner_actor, r2_key, size FROM media WHERE id = ?")
      .bind(mediaDeleteMatch.id!)
      .first<{ owner_actor: string; r2_key: string; size: number }>();
    if (!row) return apiError(404, "NOT_FOUND");
    const isElevated = session.server_role === "owner" || session.server_role === "admin";
    if (row.owner_actor !== session.actor && !isElevated) return apiError(403, "FORBIDDEN");
    await env.MEDIA.delete(row.r2_key);
    await env.DB.prepare("DELETE FROM media WHERE id = ?").bind(mediaDeleteMatch.id!).run();
    return new Response(null, { status: 204, headers: cors() });
  }

  if (method === "GET" && path === "/api/me/storage") {
    const actor = await requireActor(request, env);
    if (!actor) return apiError(401, "AUTH_REQUIRED");
    const config = await getInstanceConfig(env);
    const used = await mediaUsage(env, actor);
    return json({ used, quota: config.user_storage_quota_bytes, max_file: config.max_file_bytes });
  }

  // ---- emote packs & emotes (v1: instance-level, admin-managed; each emote wraps
  // an existing media row) - :pack:name: rendering is a web-side concern, not this
  // API's ----------------------------------------------------------------------

  if (method === "GET" && path === "/api/emotes") {
    const actor = await requireActor(request, env);
    if (!actor) return apiError(401, "AUTH_REQUIRED");
    return json({ packs: await listEmotePacks(env) });
  }

  if (method === "POST" && path === "/api/admin/emote-packs") {
    const gate = await requireServerRole(request, env, "admin");
    if (gate instanceof Response) return gate;
    const body = await readJsonBody(request);
    if (!body) return apiError(413, "PAYLOAD_INVALID");
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!isValidEmoteName(name)) return apiError(400, "PACK_NAME_INVALID");

    const id = crypto.randomUUID();
    const now = Date.now();
    try {
      await env.DB.prepare("INSERT INTO emote_packs (id, name, created_by, created_at) VALUES (?, ?, ?, ?)")
        .bind(id, name, gate.actor, now)
        .run();
    } catch {
      return apiError(409, "PACK_NAME_TAKEN");
    }
    return json({ id, name, created_by: gate.actor, created_at: now, emotes: [] }, 201);
  }

  const emotePackDeleteMatch = match("/api/admin/emote-packs/:id", path);
  if (emotePackDeleteMatch && method === "DELETE") {
    const gate = await requireServerRole(request, env, "admin");
    if (gate instanceof Response) return gate;
    const pack = await env.DB.prepare("SELECT id FROM emote_packs WHERE id = ?").bind(emotePackDeleteMatch.id!).first();
    if (!pack) return apiError(404, "NOT_FOUND");
    // Cascades the pack's emote rows only - the underlying media rows/objects
    // outlive the pack (proposal §11: asset lifecycle stays with 017's pipeline).
    await env.DB.batch([
      env.DB.prepare("DELETE FROM emotes WHERE pack_id = ?").bind(emotePackDeleteMatch.id!),
      env.DB.prepare("DELETE FROM emote_packs WHERE id = ?").bind(emotePackDeleteMatch.id!),
    ]);
    return new Response(null, { status: 204, headers: cors() });
  }

  const emoteCreateMatch = match("/api/admin/emote-packs/:id/emotes", path);
  if (emoteCreateMatch && method === "POST") {
    const gate = await requireServerRole(request, env, "admin");
    if (gate instanceof Response) return gate;
    const pack = await env.DB.prepare("SELECT id FROM emote_packs WHERE id = ?").bind(emoteCreateMatch.id!).first();
    if (!pack) return apiError(404, "NOT_FOUND");
    const body = await readJsonBody(request);
    if (!body) return apiError(413, "PAYLOAD_INVALID");
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!isValidEmoteName(name)) return apiError(400, "EMOTE_NAME_INVALID");
    const mediaId = typeof body.media_id === "string" ? body.media_id : "";
    const media = await env.DB.prepare("SELECT id FROM media WHERE id = ?").bind(mediaId).first();
    if (!media) return apiError(400, "MEDIA_NOT_FOUND");

    const id = crypto.randomUUID();
    const now = Date.now();
    try {
      await env.DB.prepare("INSERT INTO emotes (id, pack_id, name, media_id, created_at) VALUES (?, ?, ?, ?, ?)")
        .bind(id, emoteCreateMatch.id!, name, mediaId, now)
        .run();
    } catch {
      return apiError(409, "EMOTE_NAME_TAKEN");
    }
    return json({ id, name, media_id: mediaId, url: `/media/${mediaId}` }, 201);
  }

  const emoteDeleteMatch = match("/api/admin/emotes/:id", path);
  if (emoteDeleteMatch && method === "DELETE") {
    const gate = await requireServerRole(request, env, "admin");
    if (gate instanceof Response) return gate;
    const result = await env.DB.prepare("DELETE FROM emotes WHERE id = ?").bind(emoteDeleteMatch.id!).run();
    if (result.meta.changes === 0) return apiError(404, "NOT_FOUND");
    return new Response(null, { status: 204, headers: cors() });
  }

  const emoteExportMatch = match("/api/admin/emote-packs/:id/export", path);
  if (emoteExportMatch && method === "GET") {
    const gate = await requireServerRole(request, env, "admin");
    if (gate instanceof Response) return gate;
    const pack = await env.DB.prepare("SELECT id, name FROM emote_packs WHERE id = ?")
      .bind(emoteExportMatch.id!)
      .first<{ id: string; name: string }>();
    if (!pack) return apiError(404, "NOT_FOUND");
    const { results } = await env.DB.prepare("SELECT name, media_id FROM emotes WHERE pack_id = ? ORDER BY created_at ASC")
      .bind(emoteExportMatch.id!)
      .all<{ name: string; media_id: string }>();
    return json({
      format: "omew-emotes/v1",
      pack: { name: pack.name },
      emotes: results.map((r) => ({ name: r.name, media_id: r.media_id })),
      metadata: { exported_at: Date.now() },
    });
  }

  if (method === "POST" && path === "/api/admin/emote-packs/import") {
    const gate = await requireServerRole(request, env, "admin");
    if (gate instanceof Response) return gate;
    const body = await readJsonBody(request);
    if (!body) return apiError(413, "PAYLOAD_INVALID");
    if (body.format !== "omew-emotes/v1") return apiError(400, "FORMAT_INVALID");
    const packField = body.pack as Record<string, unknown> | undefined;
    const packName = typeof packField?.name === "string" ? packField.name.trim() : "";
    if (!isValidEmoteName(packName)) return apiError(400, "PACK_NAME_INVALID");
    const entries = Array.isArray(body.emotes) ? body.emotes : [];

    const packId = crypto.randomUUID();
    const now = Date.now();
    try {
      await env.DB.prepare("INSERT INTO emote_packs (id, name, created_by, created_at) VALUES (?, ?, ?, ?)")
        .bind(packId, packName, gate.actor, now)
        .run();
    } catch {
      return apiError(409, "PACK_NAME_TAKEN");
    }

    const imported: { id: string; name: string; media_id: string; url: string }[] = [];
    const skipped: { name: unknown; media_id: unknown; reason: string }[] = [];
    const seenNames = new Set<string>();

    for (const raw of entries) {
      const entry = (raw ?? {}) as Record<string, unknown>;
      const name = typeof entry.name === "string" ? entry.name.trim() : "";
      const mediaId = typeof entry.media_id === "string" ? entry.media_id : "";
      if (!isValidEmoteName(name)) {
        skipped.push({ name: entry.name, media_id: entry.media_id, reason: "NAME_INVALID" });
        continue;
      }
      if (seenNames.has(name)) {
        skipped.push({ name, media_id: entry.media_id, reason: "NAME_DUPLICATE" });
        continue;
      }
      const media = await env.DB.prepare("SELECT id FROM media WHERE id = ?").bind(mediaId).first();
      if (!media) {
        skipped.push({ name, media_id: entry.media_id, reason: "MEDIA_NOT_FOUND" });
        continue;
      }
      seenNames.add(name);
      const emoteId = crypto.randomUUID();
      await env.DB.prepare("INSERT INTO emotes (id, pack_id, name, media_id, created_at) VALUES (?, ?, ?, ?, ?)")
        .bind(emoteId, packId, name, mediaId, now)
        .run();
      imported.push({ id: emoteId, name, media_id: mediaId, url: `/media/${mediaId}` });
    }

    return json({ pack: { id: packId, name: packName, emotes: imported }, skipped }, 201);
  }

  // ---- federation session (m0-protocol S7.2) - trust-list gate only, M6 does the rest ----

  if (method === "POST" && path === "/federation/session") {
    const body = await readJsonBody(request);
    if (!body) return apiError(413, "PAYLOAD_INVALID");
    // §7.1: the assertion's `iss` is the requesting identity server's domain.
    const iss = typeof body.iss === "string" ? body.iss : "";
    if (!iss) return apiError(400, "MALFORMED");

    const config = await getInstanceConfig(env);
    if (!isOriginTrusted(config, iss)) return apiError(403, "ORIGIN_NOT_TRUSTED");

    // Trusted origin: assertion signature/aud/jti/exp verification, guest identity
    // upsert and session issuance (§7.1-7.3) are M6 scope. Shape exists (same
    // placeholder convention as inbox.ts's 501) - only the trust-list gate is real.
    return apiError(501, "NOT_IMPLEMENTED");
  }

  // ---- stronghold CRUD ----------------------------------------------------------

  if (method === "POST" && path === "/stronghold") {
    const actor = await requireActor(request, env);
    if (!actor) return errorResponse(401, "OMEW_SESSION_INVALID", "auth required");
    const body = await readJsonBody(request);
    if (!body) return errorResponse(413, "OMEW_ENVELOPE_TOO_LARGE", "body too large or malformed");
    const id = String(body.id ?? "");
    const name = String(body.name ?? "");
    const visibility = body.visibility === "private" ? "private" : "public";
    if (!RES_ID_RE.test(id) || !name) return errorResponse(400, "OMEW_MALFORMED", "invalid id or name");
    const stub = env.STRONGHOLD_DO.getByName(id);
    const config = await stub.initConfig(id, name, visibility, actor, asOptionalString(body.description), asOptionalString(body.icon));
    return json(config, 201);
  }

  let m = match("/stronghold/:id", path);
  if (m && method === "GET") {
    const stub = env.STRONGHOLD_DO.getByName(m.id!);
    const config = await stub.getConfig();
    if (!config) return errorResponse(404, "OMEW_NOT_FOUND", "stronghold not found");
    if (config.visibility === "private") {
      const denied = await requireMembership(request, env, m.id!);
      if (denied) return denied;
    }
    return json(config);
  }
  if (m && method === "PATCH") {
    const gate = await requireRole(request, env, m.id!, ["owner", "mod"]);
    if (gate instanceof Response) return gate;
    const body = await readJsonBody(request);
    if (!body) return errorResponse(413, "OMEW_ENVELOPE_TOO_LARGE", "body too large or malformed");
    const stub = env.STRONGHOLD_DO.getByName(m.id!);
    const updated = await stub.updateConfig({
      name: asOptionalString(body.name),
      description: asOptionalString(body.description),
      visibility: body.visibility === "private" || body.visibility === "public" ? body.visibility : undefined,
      icon: asOptionalString(body.icon),
    });
    if (!updated) return errorResponse(404, "OMEW_NOT_FOUND", "stronghold not found");
    return json(updated);
  }

  m = match("/stronghold/:id/rooms", path);
  if (m && method === "POST") {
    const gate = await requireRole(request, env, m.id!, ["owner", "mod"]);
    if (gate instanceof Response) return gate;
    const body = await readJsonBody(request);
    if (!body) return errorResponse(413, "OMEW_ENVELOPE_TOO_LARGE", "body too large or malformed");
    const resId = String(body.res_id ?? "");
    const type = body.type === "section" ? "section" : "channel";
    const name = String(body.name ?? "");
    if (!RES_ID_RE.test(resId) || !name) return errorResponse(400, "OMEW_MALFORMED", "invalid res_id or name");
    const capabilities = Array.isArray(body.capabilities) ? body.capabilities.map(String) : [];
    const stub = env.STRONGHOLD_DO.getByName(m.id!);
    if (await stub.getRoom(resId)) return errorResponse(409, "OMEW_ALREADY_EXISTS", "res_id taken");
    const room = await stub.createRoom(resId, type, name, capabilities, Boolean(body.restricted), asOptionalNumber(body.position));
    return json(room, 201);
  }
  if (m && method === "GET") {
    const stub = env.STRONGHOLD_DO.getByName(m.id!);
    const config = await stub.getConfig();
    if (!config) return errorResponse(404, "OMEW_NOT_FOUND", "stronghold not found");
    if (config.visibility === "private") {
      const denied = await requireMembership(request, env, m.id!);
      if (denied) return denied;
    }
    return json(await stub.listRooms());
  }

  m = match("/stronghold/:id/rooms/:resId", path);
  if (m && method === "PATCH") {
    const gate = await requireRole(request, env, m.id!, ["owner", "mod"]);
    if (gate instanceof Response) return gate;
    const body = await readJsonBody(request);
    if (!body) return errorResponse(413, "OMEW_ENVELOPE_TOO_LARGE", "body too large or malformed");
    const stub = env.STRONGHOLD_DO.getByName(m.id!);
    const updated = await stub.updateRoom(m.resId!, {
      name: asOptionalString(body.name),
      restricted: typeof body.restricted === "boolean" ? body.restricted : undefined,
      position: asOptionalNumber(body.position),
      capabilities: Array.isArray(body.capabilities) ? body.capabilities.map(String) : undefined,
    });
    if (!updated) return errorResponse(404, "OMEW_NOT_FOUND", "room not found");
    return json(updated);
  }
  if (m && method === "DELETE") {
    const gate = await requireRole(request, env, m.id!, ["owner", "mod"]);
    if (gate instanceof Response) return gate;
    const stub = env.STRONGHOLD_DO.getByName(m.id!);
    await stub.deleteRoom(m.resId!);
    return new Response(null, { status: 204, headers: cors() });
  }

  // ---- members (dev convenience: no join_request flow yet, see stronghold-do.ts) --

  m = match("/stronghold/:id/members", path);
  if (m && method === "POST") {
    const gate = await requireRole(request, env, m.id!, ["owner", "mod"]);
    if (gate instanceof Response) return gate;
    const body = await readJsonBody(request);
    if (!body) return errorResponse(413, "OMEW_ENVELOPE_TOO_LARGE", "body too large or malformed");
    const targetActor = String(body.actor ?? "");
    if (!targetActor.startsWith("@")) return errorResponse(400, "OMEW_MALFORMED", "invalid actor");
    const role: Role = body.role === "mod" ? "mod" : body.role === "owner" ? "owner" : "member";
    const stub = env.STRONGHOLD_DO.getByName(m.id!);
    const member = await stub.addMember(targetActor, role, Number(body.deny ?? 0), Boolean(body.restricted));
    return json(member, 201);
  }
  if (m && method === "GET") {
    const gate = await requireRole(request, env, m.id!, ["owner", "mod", "member"]);
    if (gate instanceof Response) return gate;
    const stub = env.STRONGHOLD_DO.getByName(m.id!);
    return json(await stub.listMembers());
  }

  // ---- stronghold + room creation, join/leave, my-strongholds --------------------
  // Same /api/* flat {error:CODE} shape as the settings/member surface below.
  // Distinct from the /stronghold/* dev-convenience routes further up: those take
  // an explicit id/res_id and full capability/position controls; these generate
  // ids and default to a bare {name, type} so a real client can create things
  // without inventing a slug.

  if (method === "POST" && path === "/api/strongholds") {
    const session = await requireSession(request, env);
    if (session instanceof Response) return session;
    const actor = session.actor;
    const body = await readJsonBody(request);
    if (!body) return apiError(413, "PAYLOAD_INVALID");
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) return apiError(400, "MALFORMED");
    const visibility = body.visibility === "private" ? "private" : "public";
    const description = asOptionalString(body.description);

    // m0-protocol §7.9: creation policy gate. server_owner/server_admin always
    // take the direct path, regardless of policy - they don't file applications
    // against themselves (§7.10 owner-equivalent standing).
    const config = await getInstanceConfig(env);
    const isElevated = session.server_role === "owner" || session.server_role === "admin";
    if (!isElevated && config.stronghold_creation_policy === "restricted" && !config.stronghold_creators.includes(actor)) {
      return apiError(403, "CREATION_RESTRICTED");
    }
    if (!isElevated && config.stronghold_creation_policy === "application") {
      const applicationId = crypto.randomUUID();
      const now = Date.now();
      await env.DB.prepare(
        "INSERT INTO stronghold_applications (id, actor, name, description, visibility, state, created_at) VALUES (?, ?, ?, ?, ?, 'pending', ?)"
      )
        .bind(applicationId, actor, name, description ?? null, visibility, now)
        .run();
      return json({ application_id: applicationId, state: "pending" }, 202);
    }

    const created = await createStrongholdWithDefaults(env, name, visibility, actor, description);
    return json(toApiConfig(created), 201);
  }

  if (method === "GET" && path === "/api/me/stronghold-applications") {
    const actor = await requireActor(request, env);
    if (!actor) return apiError(401, "AUTH_REQUIRED");
    const { results } = await env.DB.prepare(
      "SELECT id, actor, name, description, visibility, state, created_at, decided_by, decided_at " +
        "FROM stronghold_applications WHERE actor = ? ORDER BY created_at DESC"
    )
      .bind(actor)
      .all();
    return json({ applications: results });
  }

  if (method === "GET" && path === "/api/admin/stronghold-applications") {
    const gate = await requireServerRole(request, env, "admin");
    if (gate instanceof Response) return gate;
    const state = url.searchParams.get("state");
    if (state && state !== "pending" && state !== "approved" && state !== "rejected") return apiError(400, "STATE_INVALID");
    const { results } = state
      ? await env.DB.prepare(
          "SELECT id, actor, name, description, visibility, state, created_at, decided_by, decided_at " +
            "FROM stronghold_applications WHERE state = ? ORDER BY created_at DESC"
        )
          .bind(state)
          .all()
      : await env.DB.prepare(
          "SELECT id, actor, name, description, visibility, state, created_at, decided_by, decided_at " +
            "FROM stronghold_applications ORDER BY created_at DESC"
        ).all();
    return json({ applications: results });
  }

  const applicationDecideMatch = match("/api/admin/stronghold-applications/:id", path);
  if (applicationDecideMatch && method === "PATCH") {
    const gate = await requireServerRole(request, env, "admin");
    if (gate instanceof Response) return gate;
    const body = await readJsonBody(request);
    if (!body) return apiError(413, "PAYLOAD_INVALID");
    if (body.state !== "approved" && body.state !== "rejected") return apiError(400, "STATE_INVALID");

    const application = await env.DB.prepare(
      "SELECT id, actor, name, description, visibility, state FROM stronghold_applications WHERE id = ?"
    )
      .bind(applicationDecideMatch.id!)
      .first<{ id: string; actor: string; name: string; description: string | null; visibility: "public" | "private"; state: string }>();
    if (!application) return apiError(404, "NOT_FOUND");

    const now = Date.now();
    // Conditional UPDATE (not a separate read-then-write) so two concurrent
    // decisions on the same application can't both win.
    const decided = await env.DB.prepare(
      "UPDATE stronghold_applications SET state = ?, decided_by = ?, decided_at = ? WHERE id = ? AND state = 'pending'"
    )
      .bind(body.state, gate.actor, now, applicationDecideMatch.id!)
      .run();
    if (decided.meta.changes === 0) return apiError(409, "ALREADY_DECIDED");

    if (body.state === "rejected") {
      return json({ id: application.id, state: "rejected" });
    }
    const created = await createStrongholdWithDefaults(
      env,
      application.name,
      application.visibility,
      application.actor,
      application.description ?? undefined
    );
    return json({ id: application.id, state: "approved", stronghold: toApiConfig(created) });
  }

  m = match("/api/stronghold/:id/rooms", path);
  if (m && method === "POST") {
    const session = await requireSession(request, env);
    if (session instanceof Response) return session;
    const stub = env.STRONGHOLD_DO.getByName(m.id!);
    const eff = await effectiveRole(env, m.id!, session.server_role, session.actor);
    if (!eff || (eff.role !== "owner" && eff.role !== "mod")) return apiError(403, "FORBIDDEN");

    const body = await readJsonBody(request);
    if (!body) return apiError(413, "PAYLOAD_INVALID");
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) return apiError(400, "MALFORMED");
    const type: RoomType = body.type === "section" ? "section" : "channel";

    const resId = generateResId();
    const room = await stub.createRoom(resId, type, name, ["text"], false);
    return json(room, 201);
  }
  // Task 034: the only other room listing under the /api/* flat-shape surface is
  // embedded per-actor in GET /api/me/strongholds (auth-only, "my strongholds") -
  // this is the by-id equivalent, open to a guest on a public stronghold.
  if (m && method === "GET") {
    const gate = await resolveGuestOrMember(request, env, m.id!);
    if (gate instanceof Response) return gate;
    const stub = env.STRONGHOLD_DO.getByName(m.id!);
    const rooms = await stub.listRooms();
    const visible = gate.kind === "guest" ? rooms.filter((r) => !r.restricted) : rooms;
    return json(visible.map((r) => ({ id: r.res_id, name: r.name, type: r.type })));
  }

  m = match("/api/stronghold/:id/join", path);
  if (m && method === "POST") {
    const actor = await requireActor(request, env);
    if (!actor) return apiError(401, "AUTH_REQUIRED");
    const stub = env.STRONGHOLD_DO.getByName(m.id!);
    const config = await stub.getConfig();
    if (!config) return apiError(404, "NOT_FOUND");

    const existing = await stub.getMember(actor);
    if (existing) {
      if (existing.banned_at) return apiError(403, "FORBIDDEN");
      const [profiles, groups] = await Promise.all([actorProfiles(env, [actor]), stub.listMemberGroups(actor)]);
      return json(toMemberEntry(existing, profiles.get(actor), groups));
    }
    // §7.2/§9 placeholder: private strongholds need a join_request flow (M6-era
    // federation feature); until then this is the explicit "not implemented yet"
    // signal rather than a silent 403 FORBIDDEN.
    if (config.visibility === "private") return apiError(403, "JOIN_REQUIRES_APPLICATION");

    const member = await stub.addMember(actor, "member", 0, false);
    const profiles = await actorProfiles(env, [actor]);
    return json(toMemberEntry(member, profiles.get(actor)), 201);
  }

  m = match("/api/stronghold/:id/leave", path);
  if (m && method === "POST") {
    const actor = await requireActor(request, env);
    if (!actor) return apiError(401, "AUTH_REQUIRED");
    const stub = env.STRONGHOLD_DO.getByName(m.id!);
    const member = await stub.getMember(actor);
    if (!member) return apiError(404, "NOT_FOUND");
    if (member.role === "owner") return apiError(400, "OWNER_MUST_TRANSFER");
    await stub.removeMember(actor);
    return new Response(null, { status: 204, headers: cors() });
  }

  if (method === "GET" && path === "/api/me/strongholds") {
    const actor = await requireActor(request, env);
    if (!actor) return apiError(401, "AUTH_REQUIRED");
    const { results } = await env.DB.prepare("SELECT stronghold_id FROM stronghold_member_index WHERE actor = ?")
      .bind(actor)
      .all<{ stronghold_id: string }>();
    const nodes = await Promise.all(
      results.map(async (row) => {
        const stub = env.STRONGHOLD_DO.getByName(row.stronghold_id);
        const [config, rooms] = await Promise.all([stub.getConfig(), stub.listRooms()]);
        if (!config) return null;
        return {
          id: config.id,
          name: config.name,
          cover: config.cover,
          rooms: rooms.map((room) => ({ id: room.res_id, name: room.name, type: room.type })),
        };
      })
    );
    return json(nodes.filter((n): n is NonNullable<typeof n> => n != null));
  }

  // ---- stronghold settings & member management --------------------------------
  // /api/stronghold/* surface: flat {error:CODE} shape, matching /api/register et
  // al. above - distinct from the /stronghold/* dev-convenience routes above it, which
  // are untouched and keep serving stronghold/room creation, WS tokens and upgrades.

  m = match("/api/stronghold/:id/config", path);
  if (m && method === "GET") {
    const gate = await resolveGuestOrMember(request, env, m.id!);
    if (gate instanceof Response) return gate;
    return json(toApiConfig(gate.config));
  }
  if (m && method === "PATCH") {
    const session = await requireSession(request, env);
    if (session instanceof Response) return session;
    const stub = env.STRONGHOLD_DO.getByName(m.id!);
    const eff = await effectiveRole(env, m.id!, session.server_role, session.actor);
    if (!eff || (eff.role !== "owner" && eff.role !== "mod")) return apiError(403, "FORBIDDEN");
    const body = await readJsonBody(request);
    if (!body) return apiError(413, "PAYLOAD_INVALID");
    // §9 / proposal: visibility is owner-only, every other config field is owner/mod.
    if ("visibility" in body && eff.role !== "owner") return apiError(403, "FORBIDDEN");

    const patch: Partial<
      Pick<ConfigRow, "description" | "visibility" | "cover" | "allow_message_edit" | "allow_message_retract" | "edit_window_secs">
    > = {};
    if ("description" in body) {
      if (body.description !== null && typeof body.description !== "string") return apiError(400, "CONFIG_INVALID");
      patch.description = body.description as string | null;
    }
    if ("cover" in body) {
      if (body.cover !== null && typeof body.cover !== "string") return apiError(400, "CONFIG_INVALID");
      patch.cover = body.cover as string | null;
    }
    if ("visibility" in body) {
      if (body.visibility !== "public" && body.visibility !== "private") return apiError(400, "CONFIG_INVALID");
      patch.visibility = body.visibility;
    }
    if ("allow_message_edit" in body) {
      if (typeof body.allow_message_edit !== "boolean") return apiError(400, "CONFIG_INVALID");
      patch.allow_message_edit = body.allow_message_edit ? 1 : 0;
    }
    if ("allow_message_retract" in body) {
      if (typeof body.allow_message_retract !== "boolean") return apiError(400, "CONFIG_INVALID");
      patch.allow_message_retract = body.allow_message_retract ? 1 : 0;
    }
    if ("edit_window_secs" in body) {
      if (typeof body.edit_window_secs !== "number" || !Number.isInteger(body.edit_window_secs) || body.edit_window_secs < 0) {
        return apiError(400, "CONFIG_INVALID");
      }
      patch.edit_window_secs = body.edit_window_secs;
    }

    const updated = await stub.updateConfig(patch);
    if (!updated) return apiError(404, "NOT_FOUND");
    return json(toApiConfig(updated));
  }

  m = match("/api/stronghold/:id/members", path);
  if (m && method === "GET") {
    const session = await requireSession(request, env);
    if (session instanceof Response) return session;
    const stub = env.STRONGHOLD_DO.getByName(m.id!);
    const requester = await stub.getMember(session.actor);
    if (!overlayRole(session.server_role, requester)) return apiError(403, "FORBIDDEN");

    const tab = url.searchParams.get("tab") ?? "all";
    if (tab !== "all" && tab !== "restricted" && tab !== "banned") return apiError(400, "TAB_INVALID");
    const after = url.searchParams.get("after");

    const all = await stub.listMembers();
    const filtered =
      tab === "banned"
        ? all.filter((entry) => entry.banned_at != null)
        : tab === "restricted"
          ? all.filter((entry) => entry.banned_at == null && entry.deny !== 0)
          : all.filter((entry) => entry.banned_at == null);

    const { page, next_cursor } = paginateMembers(filtered, after);
    const actors = page.map((entry) => entry.actor);
    const [profiles, groupsByActor] = await Promise.all([actorProfiles(env, actors), stub.listGroupsForMembers(actors)]);
    const entries = page.map((entry) => toMemberEntry(entry, profiles.get(entry.actor), groupsByActor[entry.actor]));
    return json({ entries, next_cursor });
  }

  m = match("/api/stronghold/:id/members/:actor", path);
  if (m && method === "PATCH") {
    const session = await requireSession(request, env);
    if (session instanceof Response) return session;
    const stub = env.STRONGHOLD_DO.getByName(m.id!);
    const eff = await effectiveRole(env, m.id!, session.server_role, session.actor);
    if (!eff || (eff.role !== "owner" && eff.role !== "mod")) return apiError(403, "FORBIDDEN");

    const body = await readJsonBody(request);
    if (!body) return apiError(413, "PAYLOAD_INVALID");

    const target = await stub.getMember(m.actor!);
    if (!target) return apiError(404, "NOT_FOUND");
    if (target.role === "owner") return apiError(403, "FORBIDDEN");

    let role: "mod" | "member" | undefined;
    if ("role" in body) {
      // §9: appointing/dismissing a mod is owner-only.
      if (eff.role !== "owner") return apiError(403, "FORBIDDEN");
      if (body.role !== "mod" && body.role !== "member") return apiError(400, "ROLE_INVALID");
      role = body.role;
    }

    let deny: number | undefined;
    if ("deny" in body) {
      if (typeof body.deny !== "number" || !Number.isInteger(body.deny) || body.deny < 0) return apiError(400, "CONFIG_INVALID");
      deny = body.deny;
      // §9: deny only ever applies to a `member`. Denying a mod - whether or not
      // this same request also tries to demote them - MUST fail; the caller has
      // to demote first in a separate request, then apply deny in a second one.
      if (deny !== 0 && target.role === "mod") return apiError(400, "DENY_ON_MOD");
    }

    const updated = await stub.updateMember(m.actor!, { role, deny });
    if (!updated) return apiError(404, "NOT_FOUND");
    const [profiles, groups] = await Promise.all([actorProfiles(env, [updated.actor]), stub.listMemberGroups(updated.actor)]);
    return json(toMemberEntry(updated, profiles.get(updated.actor), groups));
  }
  if (m && method === "DELETE") {
    const session = await requireSession(request, env);
    if (session instanceof Response) return session;
    const stub = env.STRONGHOLD_DO.getByName(m.id!);
    const eff = await effectiveRole(env, m.id!, session.server_role, session.actor);
    if (!eff || (eff.role !== "owner" && eff.role !== "mod")) return apiError(403, "FORBIDDEN");

    const target = await stub.getMember(m.actor!);
    if (!target) return apiError(404, "NOT_FOUND");
    if (target.role === "owner") return apiError(403, "FORBIDDEN");
    if (target.role === "mod" && eff.role !== "owner") return apiError(403, "FORBIDDEN");

    await stub.removeMember(m.actor!);
    return new Response(null, { status: 204, headers: cors() });
  }

  // ---- custom groups (task 037) ----------------------------------------------------
  // Stronghold-local groups: multi-membership, position-ordered tri-state perms
  // (speak/post/reply) + a moderator flag, synthesized by permissions.ts and
  // shared with the WS room-token mint. Same owner/mod (or server owner/admin
  // overlay, via effectiveRole) gate as the rest of this management surface.

  m = match("/api/stronghold/:id/groups", path);
  if (m && method === "GET") {
    const session = await requireSession(request, env);
    if (session instanceof Response) return session;
    const eff = await effectiveRole(env, m.id!, session.server_role, session.actor);
    if (!eff || (eff.role !== "owner" && eff.role !== "mod")) return apiError(403, "FORBIDDEN");
    const stub = env.STRONGHOLD_DO.getByName(m.id!);
    return json({ groups: (await stub.listGroups()).map(toApiGroup) });
  }
  if (m && method === "POST") {
    const session = await requireSession(request, env);
    if (session instanceof Response) return session;
    const eff = await effectiveRole(env, m.id!, session.server_role, session.actor);
    if (!eff || (eff.role !== "owner" && eff.role !== "mod")) return apiError(403, "FORBIDDEN");
    const body = await readJsonBody(request);
    if (!body) return apiError(413, "PAYLOAD_INVALID");

    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!isValidGroupName(name)) return apiError(400, "GROUP_NAME_INVALID");
    const color = parseOptionalColor(body.color);
    if (color === INVALID_COLOR) return apiError(400, "GROUP_COLOR_INVALID");
    const permSpeak = parseTriState(body.perm_speak);
    const permPost = parseTriState(body.perm_post);
    const permReply = parseTriState(body.perm_reply);
    if (permSpeak === null || permPost === null || permReply === null) return apiError(400, "GROUP_PERM_INVALID");

    const stub = env.STRONGHOLD_DO.getByName(m.id!);
    const group = await stub.createGroup(name, color, permSpeak, permPost, permReply, Boolean(body.is_moderator));
    if (typeof body.position === "number" && Number.isInteger(body.position)) {
      const repositioned = await stub.updateGroup(group.id, { position: body.position });
      return json(toApiGroup(repositioned!), 201);
    }
    return json(toApiGroup(group), 201);
  }
  if (m && method === "PATCH") {
    // Bulk reorder - the individual-group PATCH below (:gid) also accepts a
    // `position` field for a one-at-a-time move.
    const session = await requireSession(request, env);
    if (session instanceof Response) return session;
    const eff = await effectiveRole(env, m.id!, session.server_role, session.actor);
    if (!eff || (eff.role !== "owner" && eff.role !== "mod")) return apiError(403, "FORBIDDEN");
    const body = await readJsonBody(request);
    if (!body) return apiError(413, "PAYLOAD_INVALID");
    if (!Array.isArray(body.positions)) return apiError(400, "PAYLOAD_INVALID");

    const positions: { id: string; position: number }[] = [];
    for (const raw of body.positions) {
      const entry = (raw ?? {}) as Record<string, unknown>;
      if (typeof entry.id !== "string" || typeof entry.position !== "number" || !Number.isInteger(entry.position)) {
        return apiError(400, "PAYLOAD_INVALID");
      }
      positions.push({ id: entry.id, position: entry.position });
    }
    const stub = env.STRONGHOLD_DO.getByName(m.id!);
    const groups = await stub.reorderGroups(positions);
    return json({ groups: groups.map(toApiGroup) });
  }

  m = match("/api/stronghold/:id/groups/:gid", path);
  if (m && method === "PATCH") {
    const session = await requireSession(request, env);
    if (session instanceof Response) return session;
    const eff = await effectiveRole(env, m.id!, session.server_role, session.actor);
    if (!eff || (eff.role !== "owner" && eff.role !== "mod")) return apiError(403, "FORBIDDEN");
    const body = await readJsonBody(request);
    if (!body) return apiError(413, "PAYLOAD_INVALID");

    const patch: Partial<Pick<GroupRow, "name" | "color" | "position" | "perm_speak" | "perm_post" | "perm_reply" | "is_moderator">> = {};
    if ("name" in body) {
      const name = typeof body.name === "string" ? body.name.trim() : "";
      if (!isValidGroupName(name)) return apiError(400, "GROUP_NAME_INVALID");
      patch.name = name;
    }
    if ("color" in body) {
      const color = parseOptionalColor(body.color);
      if (color === INVALID_COLOR) return apiError(400, "GROUP_COLOR_INVALID");
      patch.color = color;
    }
    if ("position" in body) {
      if (typeof body.position !== "number" || !Number.isInteger(body.position)) return apiError(400, "PAYLOAD_INVALID");
      patch.position = body.position;
    }
    if ("perm_speak" in body) {
      const v = parseTriState(body.perm_speak);
      if (v === null) return apiError(400, "GROUP_PERM_INVALID");
      patch.perm_speak = v;
    }
    if ("perm_post" in body) {
      const v = parseTriState(body.perm_post);
      if (v === null) return apiError(400, "GROUP_PERM_INVALID");
      patch.perm_post = v;
    }
    if ("perm_reply" in body) {
      const v = parseTriState(body.perm_reply);
      if (v === null) return apiError(400, "GROUP_PERM_INVALID");
      patch.perm_reply = v;
    }
    if ("is_moderator" in body) {
      patch.is_moderator = body.is_moderator ? 1 : 0;
    }

    const stub = env.STRONGHOLD_DO.getByName(m.id!);
    const updated = await stub.updateGroup(m.gid!, patch);
    if (!updated) return apiError(404, "NOT_FOUND");
    return json(toApiGroup(updated));
  }
  if (m && method === "DELETE") {
    const session = await requireSession(request, env);
    if (session instanceof Response) return session;
    const eff = await effectiveRole(env, m.id!, session.server_role, session.actor);
    if (!eff || (eff.role !== "owner" && eff.role !== "mod")) return apiError(403, "FORBIDDEN");
    const stub = env.STRONGHOLD_DO.getByName(m.id!);
    const removed = await stub.deleteGroup(m.gid!);
    if (!removed) return apiError(404, "NOT_FOUND");
    return new Response(null, { status: 204, headers: cors() });
  }

  m = match("/api/stronghold/:id/members/:actor/groups/:gid", path);
  if (m && method === "PUT") {
    const session = await requireSession(request, env);
    if (session instanceof Response) return session;
    const eff = await effectiveRole(env, m.id!, session.server_role, session.actor);
    if (!eff || (eff.role !== "owner" && eff.role !== "mod")) return apiError(403, "FORBIDDEN");
    const stub = env.STRONGHOLD_DO.getByName(m.id!);
    const target = await stub.getMember(m.actor!);
    if (!target) return apiError(404, "NOT_FOUND");
    if (target.role === "owner") return apiError(403, "FORBIDDEN");
    const added = await stub.addMemberToGroup(m.actor!, m.gid!);
    if (!added) return apiError(404, "NOT_FOUND");
    return new Response(null, { status: 204, headers: cors() });
  }
  if (m && method === "DELETE") {
    const session = await requireSession(request, env);
    if (session instanceof Response) return session;
    const eff = await effectiveRole(env, m.id!, session.server_role, session.actor);
    if (!eff || (eff.role !== "owner" && eff.role !== "mod")) return apiError(403, "FORBIDDEN");
    const stub = env.STRONGHOLD_DO.getByName(m.id!);
    await stub.removeMemberFromGroup(m.actor!, m.gid!);
    return new Response(null, { status: 204, headers: cors() });
  }

  m = match("/api/stronghold/:id/bans", path);
  if (m && method === "GET") {
    const session = await requireSession(request, env);
    if (session instanceof Response) return session;
    const eff = await effectiveRole(env, m.id!, session.server_role, session.actor);
    if (!eff || (eff.role !== "owner" && eff.role !== "mod")) return apiError(403, "FORBIDDEN");
    const stub = env.STRONGHOLD_DO.getByName(m.id!);
    const entries = await stub.listBans();
    return json({ entries });
  }

  m = match("/api/stronghold/:id/bans/:actor", path);
  if (m && method === "PUT") {
    const session = await requireSession(request, env);
    if (session instanceof Response) return session;
    const stub = env.STRONGHOLD_DO.getByName(m.id!);
    const eff = await effectiveRole(env, m.id!, session.server_role, session.actor);
    if (!eff || (eff.role !== "owner" && eff.role !== "mod")) return apiError(403, "FORBIDDEN");

    const target = await stub.getMember(m.actor!);
    if (!target) return apiError(404, "NOT_FOUND");
    if (target.role === "owner") return apiError(403, "FORBIDDEN");
    if (target.role === "mod" && eff.role !== "owner") return apiError(403, "FORBIDDEN");

    const banned = await stub.banMember(m.actor!, session.actor);
    if (!banned) return apiError(404, "NOT_FOUND");
    return json({ actor: banned.actor, operator: session.actor, banned_at: banned.banned_at });
  }
  if (m && method === "DELETE") {
    const session = await requireSession(request, env);
    if (session instanceof Response) return session;
    const eff = await effectiveRole(env, m.id!, session.server_role, session.actor);
    if (!eff || (eff.role !== "owner" && eff.role !== "mod")) return apiError(403, "FORBIDDEN");
    const stub = env.STRONGHOLD_DO.getByName(m.id!);

    await stub.unbanMember(m.actor!);
    return new Response(null, { status: 204, headers: cors() });
  }

  m = match("/api/stronghold/:id/transfer", path);
  if (m && method === "POST") {
    // m0-protocol §7.10: the one permission gate the server_owner/server_admin
    // overlay does NOT extend to - only the real stronghold owner or the actual
    // server_owner (not server_admin) may transfer ownership.
    const session = await requireSession(request, env);
    if (session instanceof Response) return session;
    const stub = env.STRONGHOLD_DO.getByName(m.id!);
    const requester = await stub.getMember(session.actor);
    const isRealOwner = requester != null && !requester.banned_at && requester.role === "owner";
    if (!isRealOwner && session.server_role !== "owner") return apiError(403, "FORBIDDEN");

    const body = await readJsonBody(request);
    if (!body) return apiError(413, "PAYLOAD_INVALID");
    const to = typeof body.to === "string" ? body.to : "";
    if (!to) return apiError(400, "MALFORMED");

    const config = await stub.getConfig();
    if (!config) return apiError(404, "NOT_FOUND");
    const updated = await stub.transferOwnership(config.owner_actor, to);
    if (!updated) return apiError(400, "TARGET_NOT_MEMBER");
    return json(toApiConfig(updated));
  }

  // ---- room item edit/retract ("edit"/"retract" HTTP entry points; the WS frame
  // types stay item.update/item.delete per m0-protocol S5.4 namespacing) ----------

  m = match("/api/stronghold/:id/rooms/:resId/items/:seq", path);
  if (m && method === "PATCH") {
    const session = await requireSession(request, env);
    if (session instanceof Response) return session;
    const strongholdStub = env.STRONGHOLD_DO.getByName(m.id!);
    const member = await strongholdStub.getMember(session.actor);
    // Editing someone else's item is author-only regardless of role (room-do.ts) -
    // the server-role overlay only needs to clear this membership/ban gate, not
    // grant any extra edit rights.
    if (!overlayRole(session.server_role, member)) return apiError(403, "FORBIDDEN");
    const room = await strongholdStub.getRoom(m.resId!);
    if (!room) return apiError(404, "NOT_FOUND");
    const seq = Number(m.seq);
    if (!Number.isFinite(seq)) return apiError(400, "MALFORMED");
    const body = await readJsonBody(request);
    if (!body) return apiError(413, "PAYLOAD_INVALID");

    const roomRef = `${m.id!}/${typeToKind(room.type)}/${m.resId!}`;
    const roomStub = env.ROOM_DO.getByName(roomRef);
    const result = await roomStub.editItem(session.actor, roomRef, seq, body.content);
    if (!result.ok) return apiError(roomErrorStatus(result.code), result.code);
    return json({ seq: result.seq, target_seq: seq });
  }
  if (m && method === "DELETE") {
    const session = await requireSession(request, env);
    if (session instanceof Response) return session;
    const strongholdStub = env.STRONGHOLD_DO.getByName(m.id!);
    // task 037: retract's moderator-override check (room-do.ts) needs the
    // group-synthesized effective role, not just the raw member row.
    const eff = await effectiveRole(env, m.id!, session.server_role, session.actor);
    if (!eff) return apiError(403, "FORBIDDEN");
    const room = await strongholdStub.getRoom(m.resId!);
    if (!room) return apiError(404, "NOT_FOUND");
    const seq = Number(m.seq);
    if (!Number.isFinite(seq)) return apiError(400, "MALFORMED");

    const roomRef = `${m.id!}/${typeToKind(room.type)}/${m.resId!}`;
    const roomStub = env.ROOM_DO.getByName(roomRef);
    const result = await roomStub.retractItem(session.actor, eff.role, roomRef, seq);
    if (!result.ok) return apiError(roomErrorStatus(result.code), result.code);
    return json({ seq: result.seq, target_seq: seq });
  }

  // ---- user profile lookup (登录可读) --------------------------------------------

  m = match("/api/users/:actor", path);
  if (m && method === "GET") {
    const requester = await requireActor(request, env);
    if (!requester) return apiError(401, "AUTH_REQUIRED");
    const target = m.actor!;
    if (!target.startsWith("@") || !target.includes(":")) return apiError(400, "MALFORMED");

    if (domainOfActor(target) === instanceDomain(env)) {
      const row = await env.DB.prepare("SELECT display_name, created_at FROM users WHERE localpart = ?")
        .bind(localpartOfActor(target))
        .first<{ display_name: string; created_at: number }>();
      if (!row) return apiError(404, "NOT_FOUND");
      return json({ actor: target, display_name: row.display_name, avatar: null, created_at: row.created_at, is_guest: false });
    }

    const row = await env.DB.prepare(
      "SELECT display_name, avatar, first_seen_at, registered_origin FROM guest_identity WHERE actor = ?"
    )
      .bind(target)
      .first<{ display_name: string | null; avatar: string | null; first_seen_at: number; registered_origin: string }>();
    if (!row) return apiError(404, "NOT_FOUND");
    return json({
      actor: target,
      display_name: row.display_name ?? target,
      avatar: row.avatar,
      created_at: row.first_seen_at,
      is_guest: true,
      home_domain: row.registered_origin,
    });
  }

  // ---- WS token minting (m0-protocol S7.3 / S9) ------------------------------------

  m = match("/stronghold/:id/rooms/:resId/token", path);
  if (m && method === "POST") {
    const session = await requireSession(request, env);
    if (session instanceof Response) return errorResponse(401, "OMEW_SESSION_INVALID", "auth required");
    const strongholdStub = env.STRONGHOLD_DO.getByName(m.id!);
    // task 037: role/deny baked into the token are the group-synthesized
    // effective values (permissions.ts) - RoomDO itself is unchanged, it just
    // reads whatever role/deny the token carries.
    const eff = await effectiveRole(env, m.id!, session.server_role, session.actor);
    if (!eff) return errorResponse(403, "OMEW_BANNED", "not a member or banned");
    const room = await strongholdStub.getRoom(m.resId!);
    if (!room) return errorResponse(404, "OMEW_ROOM_NOT_FOUND", "room not found");
    const roomRef = `${m.id!}/${typeToKind(room.type)}/${m.resId!}`;
    const claims: RoomTokenClaims = {
      v: 1, typ: "room", actor: session.actor, room: roomRef, role: eff.role, deny: eff.deny,
      exp: nowS() + ROOM_TOKEN_TTL_S, jti: newJti(),
    };
    const token = await signToken(claims, env.DEV_TOKEN_SECRET);
    return json({ token, room: roomRef, exp: claims.exp });
  }

  m = match("/stronghold/:id/tips-token", path);
  if (m && method === "POST") {
    const session = await requireSession(request, env);
    if (session instanceof Response) return errorResponse(401, "OMEW_SESSION_INVALID", "auth required");
    const strongholdStub = env.STRONGHOLD_DO.getByName(m.id!);
    const member = await strongholdStub.getMember(session.actor);
    if (!overlayRole(session.server_role, member)) return errorResponse(403, "OMEW_BANNED", "not a member or banned");
    const claims: StrongholdTokenClaims = {
      v: 1, typ: "stronghold", actor: session.actor, stronghold: m.id!, exp: nowS() + ROOM_TOKEN_TTL_S, jti: newJti(),
    };
    const token = await signToken(claims, env.DEV_TOKEN_SECRET);
    return json({ token, stronghold: m.id!, exp: claims.exp });
  }

  // ---- WS upgrade forwarding (proposal S4.1: "Worker (API): ... 房间 WS 升级转发") ----

  m = match("/stronghold/:id/rooms/:resId/ws", path);
  if (m && method === "GET") {
    if (request.headers.get("Upgrade") !== "websocket") {
      return errorResponse(426, "OMEW_UPGRADE_REQUIRED", "expected websocket upgrade");
    }
    const strongholdStub = env.STRONGHOLD_DO.getByName(m.id!);
    const room = await strongholdStub.getRoom(m.resId!);
    if (!room) return errorResponse(404, "OMEW_ROOM_NOT_FOUND", "room not found");
    const roomRef = `${m.id!}/${typeToKind(room.type)}/${m.resId!}`;
    const roomStub = env.ROOM_DO.getByName(roomRef);
    return roomStub.fetch(request);
  }

  m = match("/stronghold/:id/tips/ws", path);
  if (m && method === "GET") {
    if (request.headers.get("Upgrade") !== "websocket") {
      return errorResponse(426, "OMEW_UPGRADE_REQUIRED", "expected websocket upgrade");
    }
    const strongholdStub = env.STRONGHOLD_DO.getByName(m.id!);
    return strongholdStub.fetch(request);
  }

  // ---- history proxy (S5.3: seq-anchored pagination) -------------------------------

  m = match("/stronghold/:id/rooms/:resId/history", path);
  if (m && method === "GET") {
    // Task 034: this route predates the flat {error:CODE} /api/* surface and
    // keeps its own nested {error:{code,message}} shape (see the note atop this
    // file), so it can't reuse resolveGuestOrMember/apiError - same guest gate,
    // shaped to match its existing error responses instead.
    const strongholdStub = env.STRONGHOLD_DO.getByName(m.id!);
    const config = await strongholdStub.getConfig();
    if (!config) return errorResponse(404, "OMEW_NOT_FOUND", "stronghold not found");

    const session = await requireSession(request, env);
    let isGuest = false;
    if (!(session instanceof Response)) {
      const member = await strongholdStub.getMember(session.actor);
      if (!overlayRole(session.server_role, member)) return errorResponse(403, "OMEW_BANNED", "not a member or banned");
    } else {
      const policy = await getInstanceConfig(env);
      if (!(policy.allow_guest_browsing && config.visibility === "public")) {
        return errorResponse(401, "OMEW_SESSION_INVALID", "auth required");
      }
      isGuest = true;
    }

    const room = await strongholdStub.getRoom(m.resId!);
    if (!room) return errorResponse(404, "OMEW_ROOM_NOT_FOUND", "room not found");
    if (isGuest && room.restricted) return errorResponse(404, "OMEW_ROOM_NOT_FOUND", "room not found");
    const roomRef = `${m.id!}/${typeToKind(room.type)}/${m.resId!}`;
    const before = url.searchParams.has("before") ? Number(url.searchParams.get("before")) : null;
    const limit = url.searchParams.has("limit") ? Number(url.searchParams.get("limit")) : 50;
    const roomStub = env.ROOM_DO.getByName(roomRef);
    const items = await roomStub.getHistory(before, limit);
    return json({ items });
  }

  // ---- section posts -------------------------------------------------------------
  // Reads only: posting/replying goes through the existing WS item.create entry
  // point (RoomDO.handleItemCreate), gated there by the channel/section kind
  // matrix - see room-do.ts.

  m = match("/api/stronghold/:id/rooms/:resId/posts", path);
  if (m && method === "GET") {
    const gate = await resolveGuestOrMember(request, env, m.id!);
    if (gate instanceof Response) return gate;
    const strongholdStub = env.STRONGHOLD_DO.getByName(m.id!);
    const room = await strongholdStub.getRoom(m.resId!);
    if (!room) return apiError(404, "NOT_FOUND");
    if (guestBlockedFromRoom(gate, room)) return apiError(404, "NOT_FOUND");
    if (room.type !== "section") return apiError(400, "ROOM_NOT_SECTION");

    const roomRef = `${m.id!}/${typeToKind(room.type)}/${m.resId!}`;
    const roomStub = env.ROOM_DO.getByName(roomRef);
    const after = url.searchParams.get("after");
    const limit = url.searchParams.has("limit") ? Number(url.searchParams.get("limit")) : undefined;
    return json(await roomStub.listPosts(after, limit));
  }

  m = match("/api/stronghold/:id/rooms/:resId/posts/:seq", path);
  if (m && method === "GET") {
    const gate = await resolveGuestOrMember(request, env, m.id!);
    if (gate instanceof Response) return gate;
    const strongholdStub = env.STRONGHOLD_DO.getByName(m.id!);
    const room = await strongholdStub.getRoom(m.resId!);
    if (!room) return apiError(404, "NOT_FOUND");
    if (guestBlockedFromRoom(gate, room)) return apiError(404, "NOT_FOUND");
    if (room.type !== "section") return apiError(400, "ROOM_NOT_SECTION");
    const seq = Number(m.seq);
    if (!Number.isFinite(seq)) return apiError(400, "MALFORMED");

    const roomRef = `${m.id!}/${typeToKind(room.type)}/${m.resId!}`;
    const roomStub = env.ROOM_DO.getByName(roomRef);
    const before = url.searchParams.has("before") ? Number(url.searchParams.get("before")) : null;
    const limit = url.searchParams.has("limit") ? Number(url.searchParams.get("limit")) : undefined;
    const result = await roomStub.getPost(seq, before, limit);
    if (!result) return apiError(404, "NOT_FOUND");
    return json(result);
  }

  return errorResponse(404, "OMEW_NOT_FOUND", "no such route");
}

// ---- media upload pipeline --------------------------------------------------------
// Worker-proxied write straight into the R2 binding (no presigned direct-to-R2
// upload): size/MIME/quota are checked before a byte is written, then the body
// streams through a counting+hashing transform into R2 so nothing is buffered in
// full. Content-Length is trusted for the pre-checks but re-verified against the
// actual byte count as it streams; the declared MIME is re-verified against a
// magic-byte sniff of the received bytes once the stream ends.

const MEDIA_MIME_WHITELIST = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "video/mp4",
  "audio/mpeg",
]);

const MEDIA_SNIFF_BYTES = 16;

function sniffMediaMime(bytes: Uint8Array): string | null {
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
    bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a
  ) {
    return "image/png";
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 6 &&
    bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38 &&
    (bytes[4] === 0x37 || bytes[4] === 0x39) && bytes[5] === 0x61
  ) {
    return "image/gif";
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) {
    return "image/webp";
  }
  if (bytes.length >= 8 && bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70) {
    return "video/mp4";
  }
  if (bytes.length >= 3 && bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) {
    return "audio/mpeg"; // ID3-tagged
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && (bytes[1]! & 0xe0) === 0xe0) {
    return "audio/mpeg"; // frame sync, untagged
  }
  return null;
}

function concatBytes(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((n, c) => n + c.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}

async function mediaUsage(env: Env, actor: string): Promise<number> {
  const row = await env.DB.prepare("SELECT COALESCE(SUM(size), 0) AS used FROM media WHERE owner_actor = ?")
    .bind(actor)
    .first<{ used: number }>();
  return row?.used ?? 0;
}

async function handleMediaUpload(request: Request, env: Env): Promise<Response> {
  const actor = await requireActor(request, env);
  if (!actor) return apiError(401, "AUTH_REQUIRED");

  const contentTypeHeader = request.headers.get("Content-Type");
  const contentLengthHeader = request.headers.get("Content-Length");
  if (!contentTypeHeader || !contentLengthHeader) return apiError(400, "PAYLOAD_INVALID");
  const declaredLength = Number(contentLengthHeader);
  if (!Number.isInteger(declaredLength) || declaredLength <= 0) return apiError(400, "PAYLOAD_INVALID");
  const mime = contentTypeHeader.split(";")[0]!.trim().toLowerCase();

  const config = await getInstanceConfig(env);
  if (declaredLength > config.max_file_bytes) {
    await request.body?.cancel().catch(() => {});
    return apiError(413, "FILE_TOO_LARGE");
  }
  if (!MEDIA_MIME_WHITELIST.has(mime)) {
    await request.body?.cancel().catch(() => {});
    return apiError(415, "MIME_REJECTED");
  }

  const used = await mediaUsage(env, actor);
  if (used + declaredLength > config.user_storage_quota_bytes) {
    await request.body?.cancel().catch(() => {});
    return apiError(413, "QUOTA_EXCEEDED");
  }

  if (!request.body) return apiError(400, "PAYLOAD_INVALID");

  const id = crypto.randomUUID();
  const r2Key = `media/${id}`;
  const hash = createHash("sha256");
  let totalBytes = 0;
  let sniffLen = 0;
  const sniffChunks: Uint8Array[] = [];
  let lengthExceeded = false;

  const counter = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      totalBytes += chunk.byteLength;
      if (totalBytes > declaredLength) {
        lengthExceeded = true;
        controller.error(new Error("declared content-length exceeded"));
        return;
      }
      hash.update(chunk);
      if (sniffLen < MEDIA_SNIFF_BYTES) {
        sniffChunks.push(chunk);
        sniffLen += chunk.byteLength;
      }
      controller.enqueue(chunk);
    },
  });

  // R2Bucket.put() only accepts a stream with a known length (a request/response
  // body, or the readable half of a FixedLengthStream) - a plain TransformStream's
  // output doesn't carry that metadata, so the counting/hashing transform feeds a
  // FixedLengthStream pinned to the declared length before reaching R2.
  const fixedLength = new FixedLengthStream(declaredLength);
  const pump = request.body
    .pipeThrough(counter)
    .pipeTo(fixedLength.writable)
    .catch(() => {});

  try {
    await env.MEDIA.put(r2Key, fixedLength.readable, { httpMetadata: { contentType: mime } });
  } catch {
    await pump;
    await env.MEDIA.delete(r2Key).catch(() => {});
    if (lengthExceeded) return apiError(400, "LENGTH_MISMATCH");
    return apiError(400, "UPLOAD_FAILED");
  }
  await pump;

  const sniffed = sniffMediaMime(concatBytes(sniffChunks).subarray(0, MEDIA_SNIFF_BYTES));
  if (sniffed !== mime) {
    await env.MEDIA.delete(r2Key).catch(() => {});
    return apiError(415, "MIME_REJECTED");
  }

  const now = Date.now();
  await env.DB.prepare(
    "INSERT INTO media (id, hash, owner_actor, size, mime, r2_key, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
  )
    .bind(id, hash.digest("hex"), actor, totalBytes, mime, r2Key, now)
    .run();

  return json({ id, url: `/media/${id}`, size: totalBytes, mime }, 201);
}

// ---- emote pack helpers ------------------------------------------------------------
// Colon is the `:pack:name:` delimiter (web-side rendering, see 018 task notes), so
// pack/emote names exclude it; otherwise a name is just a non-empty string <= 32 chars.

function isValidEmoteName(name: string): boolean {
  return name.length > 0 && name.length <= 32 && !name.includes(":");
}

interface EmoteEntry {
  id: string;
  name: string;
  media_id: string;
  url: string;
}

async function listEmotePacks(env: Env): Promise<{ id: string; name: string; emotes: EmoteEntry[] }[]> {
  const { results: packRows } = await env.DB.prepare("SELECT id, name FROM emote_packs ORDER BY created_at ASC").all<{
    id: string;
    name: string;
  }>();
  const { results: emoteRows } = await env.DB.prepare(
    "SELECT id, pack_id, name, media_id FROM emotes ORDER BY created_at ASC"
  ).all<{ id: string; pack_id: string; name: string; media_id: string }>();

  const byPack = new Map<string, EmoteEntry[]>();
  for (const row of emoteRows) {
    const list = byPack.get(row.pack_id) ?? [];
    list.push({ id: row.id, name: row.name, media_id: row.media_id, url: `/media/${row.media_id}` });
    byPack.set(row.pack_id, list);
  }
  return packRows.map((pack) => ({ id: pack.id, name: pack.name, emotes: byPack.get(pack.id) ?? [] }));
}

function nowS(): number {
  return Math.floor(Date.now() / 1000);
}

function asOptionalString(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

function asOptionalNumber(v: unknown): number | undefined {
  return typeof v === "number" ? v : undefined;
}

// Stronghold/room creation via /api/* doesn't take a client-supplied id/res_id
// (unlike the /stronghold/* dev-convenience routes) - generate one that always
// satisfies RES_ID_RE.
function generateResId(): string {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 20);
}

// Shared by the open-policy path in POST /api/strongholds and by approving a
// stronghold_applications row - both end with the same owner + default rooms.
async function createStrongholdWithDefaults(
  env: Env,
  name: string,
  visibility: "public" | "private",
  ownerActor: string,
  description?: string
): Promise<ConfigRow> {
  const id = generateResId();
  const stub = env.STRONGHOLD_DO.getByName(id);
  const config = await stub.initConfig(id, name, visibility, ownerActor, description);
  // Every stronghold starts with one real channel and one real section - tips
  // and room lookups work immediately, no separate "register this room" step.
  await stub.createRoom("lobby", "channel", "大厅", ["text"], false);
  await stub.createRoom("posts", "section", "帖子", ["text"], false);
  return config;
}

// ---- stronghold settings & member management helpers -----------------------------

// DO storage keeps allow_message_edit/allow_message_retract as 0/1 (SqlStorageValue
// convention, matches restricted/archived elsewhere in this codebase) - coerce to
// real JSON booleans at the wire boundary, same pattern as users.ts's toPublicUser.
function toApiConfig(row: ConfigRow) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    cover: row.cover,
    visibility: row.visibility,
    icon: row.icon,
    allow_message_edit: Boolean(row.allow_message_edit),
    allow_message_retract: Boolean(row.allow_message_retract),
    edit_window_secs: row.edit_window_secs,
    owner_actor: row.owner_actor,
    created_at: row.created_at,
  };
}

// ---- custom groups helpers (task 037) ---------------------------------------------

function toApiGroup(row: GroupRow) {
  return {
    id: row.id,
    name: row.name,
    color: row.color,
    position: row.position,
    perm_speak: row.perm_speak,
    perm_post: row.perm_post,
    perm_reply: row.perm_reply,
    is_moderator: Boolean(row.is_moderator),
  };
}

function isValidGroupName(name: string): boolean {
  return name.length > 0 && name.length <= 32;
}

const INVALID_COLOR = Symbol("invalid_color");
const COLOR_RE = /^#[0-9a-fA-F]{6}$/;

// Optional hex color - absent/null clears it, anything else must match #RRGGBB.
function parseOptionalColor(v: unknown): string | null | typeof INVALID_COLOR {
  if (v === null || v === undefined) return null;
  if (typeof v !== "string" || !COLOR_RE.test(v)) return INVALID_COLOR;
  return v;
}

// perm_speak/perm_post/perm_reply: -1 deny / 0 inherit / 1 allow. Missing means
// "leave at inherit" on create, invalid on anything else.
function parseTriState(v: unknown): -1 | 0 | 1 | null {
  if (v === undefined) return 0;
  if (v === -1 || v === 0 || v === 1) return v;
  return null;
}

const ROOM_ERROR_STATUS: Record<string, number> = {
  OMEW_MALFORMED: 400,
  OMEW_TARGET_NOT_FOUND: 404,
  OMEW_ITEM_DELETED: 409,
  OMEW_FORBIDDEN: 403,
  EDIT_DISABLED: 403,
  RETRACT_DISABLED: 403,
  WINDOW_EXPIRED: 403,
};

function roomErrorStatus(code: string): number {
  return ROOM_ERROR_STATUS[code] ?? 400;
}

interface ActorProfile {
  display_name: string;
  is_guest: boolean;
  home_domain?: string;
}

// Batch actor -> profile lookup, split across the local `users` table and the
// `guest_identity` table per m0-protocol §7.2's authority split (registration
// instance owns the profile; a member row here only owns role/deny/joined_at).
async function actorProfiles(env: Env, actors: string[]): Promise<Map<string, ActorProfile>> {
  const result = new Map<string, ActorProfile>();
  const unique = [...new Set(actors)];
  const home = instanceDomain(env);
  const localActors = unique.filter((a) => domainOfActor(a) === home);
  const guestActors = unique.filter((a) => domainOfActor(a) !== home);

  if (localActors.length > 0) {
    const localparts = localActors.map(localpartOfActor);
    const placeholders = localparts.map(() => "?").join(",");
    const { results } = await env.DB.prepare(
      `SELECT localpart, display_name FROM users WHERE localpart IN (${placeholders})`
    )
      .bind(...localparts)
      .all<{ localpart: string; display_name: string }>();
    const byLocalpart = new Map(results.map((r) => [r.localpart, r.display_name]));
    for (const actor of localActors) {
      const localpart = localpartOfActor(actor);
      result.set(actor, { display_name: byLocalpart.get(localpart) ?? localpart, is_guest: false });
    }
  }

  if (guestActors.length > 0) {
    const placeholders = guestActors.map(() => "?").join(",");
    const { results } = await env.DB.prepare(
      `SELECT actor, display_name, registered_origin FROM guest_identity WHERE actor IN (${placeholders})`
    )
      .bind(...guestActors)
      .all<{ actor: string; display_name: string | null; registered_origin: string }>();
    const byActor = new Map(results.map((r) => [r.actor, r]));
    for (const actor of guestActors) {
      const row = byActor.get(actor);
      result.set(actor, { display_name: row?.display_name ?? actor, is_guest: true, home_domain: row?.registered_origin });
    }
  }

  return result;
}

function toMemberEntry(member: MemberRow, profile: ActorProfile | undefined, groups: GroupRow[] = []) {
  return {
    actor: member.actor,
    display_name: profile?.display_name ?? member.actor,
    role: member.role,
    deny: member.deny,
    joined_at: member.joined_at,
    is_guest: profile?.is_guest ?? false,
    groups: groups.map((g) => ({ id: g.id, name: g.name, color: g.color })),
    ...(profile?.home_domain ? { home_domain: profile.home_domain } : {}),
  };
}

const MEMBERS_PAGE_SIZE = 50;

function paginateMembers(members: MemberRow[], afterCursor: string | null): { page: MemberRow[]; next_cursor: string | null } {
  const sorted = [...members].sort((a, b) => a.joined_at - b.joined_at || a.actor.localeCompare(b.actor));
  let startIndex = 0;
  if (afterCursor) {
    const idx = sorted.findIndex((entry) => entry.actor === afterCursor);
    startIndex = idx >= 0 ? idx + 1 : 0;
  }
  const page = sorted.slice(startIndex, startIndex + MEMBERS_PAGE_SIZE);
  const hasMore = startIndex + MEMBERS_PAGE_SIZE < sorted.length;
  const last = page[page.length - 1];
  return { page, next_cursor: hasMore && last ? last.actor : null };
}

async function issueSessionToken(actor: string, serverRole: ServerRole, env: Env): Promise<string> {
  const claims: SessionTokenClaims = {
    v: 1, typ: "session", actor, server_role: serverRole, exp: nowS() + SESSION_TOKEN_TTL_S, jti: newJti(),
  };
  return signToken(claims, env.DEV_TOKEN_SECRET);
}

async function requireMembership(request: Request, env: Env, strongholdId: string): Promise<Response | null> {
  const session = await requireSession(request, env);
  if (session instanceof Response) return errorResponse(401, "OMEW_SESSION_INVALID", "auth required");
  const stub = env.STRONGHOLD_DO.getByName(strongholdId);
  const member = await stub.getMember(session.actor);
  if (!overlayRole(session.server_role, member)) return errorResponse(403, "OMEW_BANNED", "not a member or banned");
  return null;
}

// S9: read paths carry the same role check as write paths - GET endpoints MUST
// also be clipped by role, not just POST/PATCH/DELETE. task 037: role here is
// the group-synthesized effective role (effectiveRole), not the raw member row.
async function requireRole(request: Request, env: Env, strongholdId: string, roles: Role[]): Promise<Response | { actor: string; role: Role }> {
  const session = await requireSession(request, env);
  if (session instanceof Response) return errorResponse(401, "OMEW_SESSION_INVALID", "auth required");
  const eff = await effectiveRole(env, strongholdId, session.server_role, session.actor);
  if (!eff) return errorResponse(403, "OMEW_BANNED", "not a member or banned");
  if (!roles.includes(eff.role)) return errorResponse(403, "OMEW_FORBIDDEN", "insufficient role");
  return { actor: session.actor, role: eff.role };
}

// ---- guest read gate (task 034 / m0-protocol §8.2) -------------------------------
// A public stronghold MAY serve unauthenticated reads; this instance's
// allow_guest_browsing toggle decides whether it actually does. An authenticated
// request keeps the existing membership gate untouched (works the same on a
// private stronghold as before - guest fallback only ever applies when no actor
// could be resolved from the request, and only to GET/read routes). No
// distinction is made between a missing Authorization header and an invalid one -
// both already collapse to "no session" here, same as every other route in this
// file. A server_owner/server_admin actor always resolves to "member" (§7.10),
// even without a real membership row.
async function resolveGuestOrMember(
  request: Request,
  env: Env,
  strongholdId: string
): Promise<
  | { kind: "member"; actor: string; member: MemberRow | null; role: Role; config: ConfigRow }
  | { kind: "guest"; config: ConfigRow }
  | Response
> {
  const stub = env.STRONGHOLD_DO.getByName(strongholdId);
  const config = await stub.getConfig();
  if (!config) return apiError(404, "NOT_FOUND");

  const session = await requireSession(request, env);
  if (!(session instanceof Response)) {
    const member = await stub.getMember(session.actor);
    const role = overlayRole(session.server_role, member);
    if (!role) return apiError(403, "FORBIDDEN");
    return { kind: "member", actor: session.actor, member, role, config };
  }

  const policy = await getInstanceConfig(env);
  if (policy.allow_guest_browsing && config.visibility === "public") {
    return { kind: "guest", config };
  }
  return apiError(401, "AUTH_REQUIRED");
}

// §8.2: a `restricted: true` room MUST stay owner/mod-only and MUST NOT enter
// directory/search/tips summaries - a guest is never owner/mod, so this only ever
// blocks the guest branch. Pre-existing authenticated-member behavior for
// restricted rooms is unchanged by task 034 and out of this helper's scope.
function guestBlockedFromRoom(gate: { kind: "member" | "guest" }, room: { restricted: number }): boolean {
  return gate.kind === "guest" && Boolean(room.restricted);
}

// Public stronghold directory (task 034), fanned out from the member index the
// same way GET /api/me/strongholds does. Small instance scale: a live COUNT via
// listMembers() per entry is fine, no cache column needed yet.
async function listPublicDirectory(
  env: Env
): Promise<Array<{ id: string; name: string; description: string | null; cover: string | null; member_count: number }>> {
  const { results } = await env.DB.prepare("SELECT DISTINCT stronghold_id FROM stronghold_member_index").all<{
    stronghold_id: string;
  }>();
  const entries = await Promise.all(
    results.map(async (row) => {
      const stub = env.STRONGHOLD_DO.getByName(row.stronghold_id);
      const config = await stub.getConfig();
      if (!config || config.visibility !== "public") return null;
      const members = await stub.listMembers();
      return { id: config.id, name: config.name, description: config.description, cover: config.cover, member_count: members.length };
    })
  );
  return entries.filter((e): e is NonNullable<typeof e> => e != null);
}
