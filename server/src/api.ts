import { createHash } from "node:crypto";
import { dummyPasswordFields, hashPassword, newJti, signToken, verifyPassword, verifyToken } from "./auth";
import { handleInbox } from "./inbox";
import type { ConfigRow, MemberRow } from "./stronghold-do";
import {
  HOME_DOMAIN,
  typeToKind,
  type Role,
  type RoomTokenClaims,
  type RoomType,
  type SessionTokenClaims,
  type StrongholdTokenClaims,
} from "./types";
import {
  domainOfActor,
  generateInviteCode,
  getInstanceConfig,
  isOriginTrusted,
  isValidActorList,
  isValidDomainList,
  isValidEmail,
  isValidPositiveInt,
  isValidRootRequirements,
  isValidStrongholdCreationPolicy,
  isValidTrustedServers,
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

async function requireActor(request: Request, env: Env): Promise<string | null> {
  const header = request.headers.get("Authorization");
  if (!header?.startsWith("Bearer ")) return null;
  const claims = await verifyToken<SessionTokenClaims>(header.slice(7), env.DEV_TOKEN_SECRET);
  if (!claims || claims.typ !== "session") return null;
  return claims.actor;
}

// is_admin isn't carried in the session token claims (it can change after a token is
// issued), so admin routes re-check it against the users row on every request.
async function requireAdmin(request: Request, env: Env): Promise<{ actor: string } | Response> {
  const actor = await requireActor(request, env);
  if (!actor) return apiError(401, "AUTH_REQUIRED");
  if (!(await isActorAdmin(env, actor))) return apiError(403, "ADMIN_REQUIRED");
  return { actor };
}

// Same is_admin lookup as requireAdmin, but for an actor already known from
// elsewhere (m0-protocol §7.9 policy gate) rather than off the request's bearer
// token. Guest actors (foreign domain) are never local admins.
async function isActorAdmin(env: Env, actor: string): Promise<boolean> {
  if (domainOfActor(actor) !== HOME_DOMAIN) return false;
  const row = await env.DB.prepare("SELECT is_admin FROM users WHERE localpart = ?")
    .bind(localpartOfActor(actor))
    .first<{ is_admin: number }>();
  return Boolean(row?.is_admin);
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
    });
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
    const actor = `@${username}:${HOME_DOMAIN}`;
    const now = Date.now();

    const statements = [
      env.DB.prepare(
        "INSERT INTO users (localpart, display_name, status, created_at, pw_hash, pw_salt, email, email_verified, is_admin, ownership_pubkey, ownership_ciphertext) VALUES (?, ?, 'active', ?, ?, ?, ?, 0, 0, ?, ?)"
      ).bind(username, username, now, hash, salt, email, ownershipPubkey, ownershipCiphertext),
    ];
    const codeConsumeIndex = requiresCode ? statements.length : -1;
    if (requiresCode) {
      statements.push(
        env.DB.prepare("UPDATE invite_codes SET used_by = ?, used_at = ? WHERE code = ? AND used_by IS NULL")
          .bind(username, now, code)
      );
    }
    // Atomic first-mover claim: only the registration that observes zero existing
    // admins gets to set is_admin=1, so concurrent first registrations can't both win.
    const adminBootstrapIndex = statements.length;
    statements.push(
      env.DB.prepare(
        "UPDATE users SET is_admin = 1 WHERE localpart = ? AND (SELECT COUNT(*) FROM users WHERE is_admin = 1) = 0"
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
    const isAdmin = results[adminBootstrapIndex]!.meta.changes === 1;

    const token = await issueSessionToken(actor, env);
    const user = toPublicUser({ localpart: username, is_admin: isAdmin ? 1 : 0, email, email_verified: 0 }, actor);
    return json({ token, user });
  }

  if (method === "POST" && path === "/api/login") {
    const body = await readJsonBody(request);
    if (!body) return apiError(413, "PAYLOAD_INVALID");
    const username = normalizeUsername(String(body.username ?? ""));
    const password = String(body.password ?? "");

    const user = await env.DB.prepare(
      "SELECT localpart, pw_hash, pw_salt, status, is_admin, email, email_verified FROM users WHERE localpart = ?"
    )
      .bind(username)
      .first<{
        localpart: string;
        pw_hash: string | null;
        pw_salt: string | null;
        status: string;
        is_admin: number;
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

    const actor = `@${username}:${HOME_DOMAIN}`;
    const token = await issueSessionToken(actor, env);
    return json({ token, user: toPublicUser(user, actor) });
  }

  // ---- instance admin --------------------------------------------------------------

  if (method === "GET" && path === "/api/admin/instance/config") {
    const gate = await requireAdmin(request, env);
    if (gate instanceof Response) return gate;
    return json(await getInstanceConfig(env));
  }

  if (method === "PATCH" && path === "/api/admin/instance/config") {
    const gate = await requireAdmin(request, env);
    if (gate instanceof Response) return gate;
    const body = await readJsonBody(request);
    if (!body) return apiError(413, "PAYLOAD_INVALID");

    const current = await getInstanceConfig(env);
    const allowRoot = "allow_root" in body ? body.allow_root : current.allow_root;
    if (typeof allowRoot !== "boolean") return apiError(400, "CONFIG_INVALID");
    const rootRequirements = "root_requirements" in body ? body.root_requirements : current.root_requirements;
    if (!isValidRootRequirements(rootRequirements)) return apiError(400, "CONFIG_INVALID");
    const trustedServers = "trusted_identity_servers" in body ? body.trusted_identity_servers : current.trusted_identity_servers;
    if (!isValidTrustedServers(trustedServers)) return apiError(400, "CONFIG_INVALID");
    const maxFileBytes = "max_file_bytes" in body ? body.max_file_bytes : current.max_file_bytes;
    if (!isValidPositiveInt(maxFileBytes)) return apiError(400, "CONFIG_INVALID");
    const userStorageQuotaBytes = "user_storage_quota_bytes" in body ? body.user_storage_quota_bytes : current.user_storage_quota_bytes;
    if (!isValidPositiveInt(userStorageQuotaBytes)) return apiError(400, "CONFIG_INVALID");
    // federation_peers: outbound content-federation allowlist. Subscribe/backfill
    // wiring lands in M5/M6 and MUST target only this list (m0-protocol §7.9).
    const federationPeers = "federation_peers" in body ? body.federation_peers : current.federation_peers;
    if (!isValidDomainList(federationPeers)) return apiError(400, "CONFIG_INVALID");
    const strongholdCreationPolicy =
      "stronghold_creation_policy" in body ? body.stronghold_creation_policy : current.stronghold_creation_policy;
    if (!isValidStrongholdCreationPolicy(strongholdCreationPolicy)) return apiError(400, "CONFIG_INVALID");
    const strongholdCreators = "stronghold_creators" in body ? body.stronghold_creators : current.stronghold_creators;
    if (!isValidActorList(strongholdCreators)) return apiError(400, "CONFIG_INVALID");

    await env.DB.prepare(
      "UPDATE instance_config SET allow_root = ?, root_requirements = ?, trusted_identity_servers = ?, max_file_bytes = ?, " +
        "user_storage_quota_bytes = ?, federation_peers = ?, stronghold_creation_policy = ?, stronghold_creators = ? WHERE id = 1"
    )
      .bind(
        allowRoot ? 1 : 0,
        JSON.stringify(rootRequirements),
        JSON.stringify(trustedServers),
        maxFileBytes,
        userStorageQuotaBytes,
        JSON.stringify(federationPeers),
        strongholdCreationPolicy,
        JSON.stringify(strongholdCreators)
      )
      .run();
    return json({
      allow_root: allowRoot,
      root_requirements: rootRequirements,
      trusted_identity_servers: trustedServers,
      max_file_bytes: maxFileBytes,
      user_storage_quota_bytes: userStorageQuotaBytes,
      federation_peers: federationPeers,
      stronghold_creation_policy: strongholdCreationPolicy,
      stronghold_creators: strongholdCreators,
    });
  }

  if (method === "POST" && path === "/api/admin/invite-codes") {
    const gate = await requireAdmin(request, env);
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
    const gate = await requireAdmin(request, env);
    if (gate instanceof Response) return gate;
    const { results } = await env.DB.prepare(
      "SELECT code, created_by, created_at, used_by, used_at FROM invite_codes ORDER BY created_at DESC"
    ).all();
    return json({ codes: results });
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
    const actor = await requireActor(request, env);
    if (!actor) return apiError(401, "AUTH_REQUIRED");
    const row = await env.DB.prepare("SELECT owner_actor, r2_key, size FROM media WHERE id = ?")
      .bind(mediaDeleteMatch.id!)
      .first<{ owner_actor: string; r2_key: string; size: number }>();
    if (!row) return apiError(404, "NOT_FOUND");
    if (row.owner_actor !== actor) {
      const userRow = await env.DB.prepare("SELECT is_admin FROM users WHERE localpart = ?")
        .bind(localpartOfActor(actor))
        .first<{ is_admin: number }>();
      if (!userRow || !userRow.is_admin) return apiError(403, "FORBIDDEN");
    }
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
    const gate = await requireAdmin(request, env);
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
    const gate = await requireAdmin(request, env);
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
    const gate = await requireAdmin(request, env);
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
    const gate = await requireAdmin(request, env);
    if (gate instanceof Response) return gate;
    const result = await env.DB.prepare("DELETE FROM emotes WHERE id = ?").bind(emoteDeleteMatch.id!).run();
    if (result.meta.changes === 0) return apiError(404, "NOT_FOUND");
    return new Response(null, { status: 204, headers: cors() });
  }

  const emoteExportMatch = match("/api/admin/emote-packs/:id/export", path);
  if (emoteExportMatch && method === "GET") {
    const gate = await requireAdmin(request, env);
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
    const gate = await requireAdmin(request, env);
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
    const actor = await requireActor(request, env);
    if (!actor) return apiError(401, "AUTH_REQUIRED");
    const body = await readJsonBody(request);
    if (!body) return apiError(413, "PAYLOAD_INVALID");
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) return apiError(400, "MALFORMED");
    const visibility = body.visibility === "private" ? "private" : "public";
    const description = asOptionalString(body.description);

    // m0-protocol §7.9: creation policy gate. Admins always take the direct path,
    // regardless of policy - they don't file applications against themselves.
    const config = await getInstanceConfig(env);
    const isAdmin = await isActorAdmin(env, actor);
    if (!isAdmin && config.stronghold_creation_policy === "restricted" && !config.stronghold_creators.includes(actor)) {
      return apiError(403, "CREATION_RESTRICTED");
    }
    if (!isAdmin && config.stronghold_creation_policy === "application") {
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
    const gate = await requireAdmin(request, env);
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
    const gate = await requireAdmin(request, env);
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
    const actor = await requireActor(request, env);
    if (!actor) return apiError(401, "AUTH_REQUIRED");
    const stub = env.STRONGHOLD_DO.getByName(m.id!);
    const requester = await stub.getMember(actor);
    if (!requester || requester.banned_at) return apiError(403, "FORBIDDEN");
    if (requester.role !== "owner" && requester.role !== "mod") return apiError(403, "FORBIDDEN");

    const body = await readJsonBody(request);
    if (!body) return apiError(413, "PAYLOAD_INVALID");
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) return apiError(400, "MALFORMED");
    const type: RoomType = body.type === "section" ? "section" : "channel";

    const resId = generateResId();
    const room = await stub.createRoom(resId, type, name, ["text"], false);
    return json(room, 201);
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
      const profiles = await actorProfiles(env, [actor]);
      return json(toMemberEntry(existing, profiles.get(actor)));
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
    const actor = await requireActor(request, env);
    if (!actor) return apiError(401, "AUTH_REQUIRED");
    const stub = env.STRONGHOLD_DO.getByName(m.id!);
    const config = await stub.getConfig();
    if (!config) return apiError(404, "NOT_FOUND");
    const member = await stub.getMember(actor);
    if (!member || member.banned_at) return apiError(403, "FORBIDDEN");
    return json(toApiConfig(config));
  }
  if (m && method === "PATCH") {
    const actor = await requireActor(request, env);
    if (!actor) return apiError(401, "AUTH_REQUIRED");
    const stub = env.STRONGHOLD_DO.getByName(m.id!);
    const member = await stub.getMember(actor);
    if (!member || member.banned_at) return apiError(403, "FORBIDDEN");
    if (member.role !== "owner" && member.role !== "mod") return apiError(403, "FORBIDDEN");
    const body = await readJsonBody(request);
    if (!body) return apiError(413, "PAYLOAD_INVALID");
    // §9 / proposal: visibility is owner-only, every other config field is owner/mod.
    if ("visibility" in body && member.role !== "owner") return apiError(403, "FORBIDDEN");

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
    const actor = await requireActor(request, env);
    if (!actor) return apiError(401, "AUTH_REQUIRED");
    const stub = env.STRONGHOLD_DO.getByName(m.id!);
    const requester = await stub.getMember(actor);
    if (!requester || requester.banned_at) return apiError(403, "FORBIDDEN");

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
    const profiles = await actorProfiles(env, page.map((entry) => entry.actor));
    const entries = page.map((entry) => toMemberEntry(entry, profiles.get(entry.actor)));
    return json({ entries, next_cursor });
  }

  m = match("/api/stronghold/:id/members/:actor", path);
  if (m && method === "PATCH") {
    const actor = await requireActor(request, env);
    if (!actor) return apiError(401, "AUTH_REQUIRED");
    const stub = env.STRONGHOLD_DO.getByName(m.id!);
    const requester = await stub.getMember(actor);
    if (!requester || requester.banned_at) return apiError(403, "FORBIDDEN");
    if (requester.role !== "owner" && requester.role !== "mod") return apiError(403, "FORBIDDEN");

    const body = await readJsonBody(request);
    if (!body) return apiError(413, "PAYLOAD_INVALID");

    const target = await stub.getMember(m.actor!);
    if (!target) return apiError(404, "NOT_FOUND");
    if (target.role === "owner") return apiError(403, "FORBIDDEN");

    let role: "mod" | "member" | undefined;
    if ("role" in body) {
      // §9: appointing/dismissing a mod is owner-only.
      if (requester.role !== "owner") return apiError(403, "FORBIDDEN");
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
    const profiles = await actorProfiles(env, [updated.actor]);
    return json(toMemberEntry(updated, profiles.get(updated.actor)));
  }
  if (m && method === "DELETE") {
    const actor = await requireActor(request, env);
    if (!actor) return apiError(401, "AUTH_REQUIRED");
    const stub = env.STRONGHOLD_DO.getByName(m.id!);
    const requester = await stub.getMember(actor);
    if (!requester || requester.banned_at) return apiError(403, "FORBIDDEN");
    if (requester.role !== "owner" && requester.role !== "mod") return apiError(403, "FORBIDDEN");

    const target = await stub.getMember(m.actor!);
    if (!target) return apiError(404, "NOT_FOUND");
    if (target.role === "owner") return apiError(403, "FORBIDDEN");
    if (target.role === "mod" && requester.role !== "owner") return apiError(403, "FORBIDDEN");

    await stub.removeMember(m.actor!);
    return new Response(null, { status: 204, headers: cors() });
  }

  m = match("/api/stronghold/:id/bans", path);
  if (m && method === "GET") {
    const actor = await requireActor(request, env);
    if (!actor) return apiError(401, "AUTH_REQUIRED");
    const stub = env.STRONGHOLD_DO.getByName(m.id!);
    const requester = await stub.getMember(actor);
    if (!requester || requester.banned_at) return apiError(403, "FORBIDDEN");
    if (requester.role !== "owner" && requester.role !== "mod") return apiError(403, "FORBIDDEN");
    const entries = await stub.listBans();
    return json({ entries });
  }

  m = match("/api/stronghold/:id/bans/:actor", path);
  if (m && method === "PUT") {
    const actor = await requireActor(request, env);
    if (!actor) return apiError(401, "AUTH_REQUIRED");
    const stub = env.STRONGHOLD_DO.getByName(m.id!);
    const requester = await stub.getMember(actor);
    if (!requester || requester.banned_at) return apiError(403, "FORBIDDEN");
    if (requester.role !== "owner" && requester.role !== "mod") return apiError(403, "FORBIDDEN");

    const target = await stub.getMember(m.actor!);
    if (!target) return apiError(404, "NOT_FOUND");
    if (target.role === "owner") return apiError(403, "FORBIDDEN");
    if (target.role === "mod" && requester.role !== "owner") return apiError(403, "FORBIDDEN");

    const banned = await stub.banMember(m.actor!, actor);
    if (!banned) return apiError(404, "NOT_FOUND");
    return json({ actor: banned.actor, operator: actor, banned_at: banned.banned_at });
  }
  if (m && method === "DELETE") {
    const actor = await requireActor(request, env);
    if (!actor) return apiError(401, "AUTH_REQUIRED");
    const stub = env.STRONGHOLD_DO.getByName(m.id!);
    const requester = await stub.getMember(actor);
    if (!requester || requester.banned_at) return apiError(403, "FORBIDDEN");
    if (requester.role !== "owner" && requester.role !== "mod") return apiError(403, "FORBIDDEN");

    await stub.unbanMember(m.actor!);
    return new Response(null, { status: 204, headers: cors() });
  }

  m = match("/api/stronghold/:id/transfer", path);
  if (m && method === "POST") {
    const actor = await requireActor(request, env);
    if (!actor) return apiError(401, "AUTH_REQUIRED");
    const stub = env.STRONGHOLD_DO.getByName(m.id!);
    const requester = await stub.getMember(actor);
    if (!requester || requester.banned_at) return apiError(403, "FORBIDDEN");
    if (requester.role !== "owner") return apiError(403, "FORBIDDEN");

    const body = await readJsonBody(request);
    if (!body) return apiError(413, "PAYLOAD_INVALID");
    const to = typeof body.to === "string" ? body.to : "";
    if (!to) return apiError(400, "MALFORMED");

    const updated = await stub.transferOwnership(actor, to);
    if (!updated) return apiError(400, "TARGET_NOT_MEMBER");
    return json(toApiConfig(updated));
  }

  // ---- room item edit/retract ("edit"/"retract" HTTP entry points; the WS frame
  // types stay item.update/item.delete per m0-protocol S5.4 namespacing) ----------

  m = match("/api/stronghold/:id/rooms/:resId/items/:seq", path);
  if (m && method === "PATCH") {
    const actor = await requireActor(request, env);
    if (!actor) return apiError(401, "AUTH_REQUIRED");
    const strongholdStub = env.STRONGHOLD_DO.getByName(m.id!);
    const member = await strongholdStub.getMember(actor);
    if (!member || member.banned_at) return apiError(403, "FORBIDDEN");
    const room = await strongholdStub.getRoom(m.resId!);
    if (!room) return apiError(404, "NOT_FOUND");
    const seq = Number(m.seq);
    if (!Number.isFinite(seq)) return apiError(400, "MALFORMED");
    const body = await readJsonBody(request);
    if (!body) return apiError(413, "PAYLOAD_INVALID");

    const roomRef = `${m.id!}/${typeToKind(room.type)}/${m.resId!}`;
    const roomStub = env.ROOM_DO.getByName(roomRef);
    const result = await roomStub.editItem(actor, roomRef, seq, body.content);
    if (!result.ok) return apiError(roomErrorStatus(result.code), result.code);
    return json({ seq: result.seq, target_seq: seq });
  }
  if (m && method === "DELETE") {
    const actor = await requireActor(request, env);
    if (!actor) return apiError(401, "AUTH_REQUIRED");
    const strongholdStub = env.STRONGHOLD_DO.getByName(m.id!);
    const member = await strongholdStub.getMember(actor);
    if (!member || member.banned_at) return apiError(403, "FORBIDDEN");
    const room = await strongholdStub.getRoom(m.resId!);
    if (!room) return apiError(404, "NOT_FOUND");
    const seq = Number(m.seq);
    if (!Number.isFinite(seq)) return apiError(400, "MALFORMED");

    const roomRef = `${m.id!}/${typeToKind(room.type)}/${m.resId!}`;
    const roomStub = env.ROOM_DO.getByName(roomRef);
    const result = await roomStub.retractItem(actor, member.role, roomRef, seq);
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

    if (domainOfActor(target) === HOME_DOMAIN) {
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
    const actor = await requireActor(request, env);
    if (!actor) return errorResponse(401, "OMEW_SESSION_INVALID", "auth required");
    const strongholdStub = env.STRONGHOLD_DO.getByName(m.id!);
    const member = await strongholdStub.getMember(actor);
    if (!member || member.banned_at) return errorResponse(403, "OMEW_BANNED", "not a member or banned");
    const room = await strongholdStub.getRoom(m.resId!);
    if (!room) return errorResponse(404, "OMEW_ROOM_NOT_FOUND", "room not found");
    const roomRef = `${m.id!}/${typeToKind(room.type)}/${m.resId!}`;
    const deny = member.role === "owner" || member.role === "mod" ? 0 : member.deny;
    const claims: RoomTokenClaims = {
      v: 1, typ: "room", actor, room: roomRef, role: member.role, deny,
      exp: nowS() + ROOM_TOKEN_TTL_S, jti: newJti(),
    };
    const token = await signToken(claims, env.DEV_TOKEN_SECRET);
    return json({ token, room: roomRef, exp: claims.exp });
  }

  m = match("/stronghold/:id/tips-token", path);
  if (m && method === "POST") {
    const actor = await requireActor(request, env);
    if (!actor) return errorResponse(401, "OMEW_SESSION_INVALID", "auth required");
    const strongholdStub = env.STRONGHOLD_DO.getByName(m.id!);
    const member = await strongholdStub.getMember(actor);
    if (!member || member.banned_at) return errorResponse(403, "OMEW_BANNED", "not a member or banned");
    const claims: StrongholdTokenClaims = {
      v: 1, typ: "stronghold", actor, stronghold: m.id!, exp: nowS() + ROOM_TOKEN_TTL_S, jti: newJti(),
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
    const gate = await requireRole(request, env, m.id!, ["owner", "mod", "member"]);
    if (gate instanceof Response) return gate;
    const strongholdStub = env.STRONGHOLD_DO.getByName(m.id!);
    const room = await strongholdStub.getRoom(m.resId!);
    if (!room) return errorResponse(404, "OMEW_ROOM_NOT_FOUND", "room not found");
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
    const actor = await requireActor(request, env);
    if (!actor) return apiError(401, "AUTH_REQUIRED");
    const strongholdStub = env.STRONGHOLD_DO.getByName(m.id!);
    const member = await strongholdStub.getMember(actor);
    if (!member || member.banned_at) return apiError(403, "FORBIDDEN");
    const room = await strongholdStub.getRoom(m.resId!);
    if (!room) return apiError(404, "NOT_FOUND");
    if (room.type !== "section") return apiError(400, "ROOM_NOT_SECTION");

    const roomRef = `${m.id!}/${typeToKind(room.type)}/${m.resId!}`;
    const roomStub = env.ROOM_DO.getByName(roomRef);
    const after = url.searchParams.get("after");
    const limit = url.searchParams.has("limit") ? Number(url.searchParams.get("limit")) : undefined;
    return json(await roomStub.listPosts(after, limit));
  }

  m = match("/api/stronghold/:id/rooms/:resId/posts/:seq", path);
  if (m && method === "GET") {
    const actor = await requireActor(request, env);
    if (!actor) return apiError(401, "AUTH_REQUIRED");
    const strongholdStub = env.STRONGHOLD_DO.getByName(m.id!);
    const member = await strongholdStub.getMember(actor);
    if (!member || member.banned_at) return apiError(403, "FORBIDDEN");
    const room = await strongholdStub.getRoom(m.resId!);
    if (!room) return apiError(404, "NOT_FOUND");
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
  const localActors = unique.filter((a) => domainOfActor(a) === HOME_DOMAIN);
  const guestActors = unique.filter((a) => domainOfActor(a) !== HOME_DOMAIN);

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

function toMemberEntry(member: MemberRow, profile: ActorProfile | undefined) {
  return {
    actor: member.actor,
    display_name: profile?.display_name ?? member.actor,
    role: member.role,
    deny: member.deny,
    joined_at: member.joined_at,
    is_guest: profile?.is_guest ?? false,
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

async function issueSessionToken(actor: string, env: Env): Promise<string> {
  const claims: SessionTokenClaims = { v: 1, typ: "session", actor, exp: nowS() + SESSION_TOKEN_TTL_S, jti: newJti() };
  return signToken(claims, env.DEV_TOKEN_SECRET);
}

async function requireMembership(request: Request, env: Env, strongholdId: string): Promise<Response | null> {
  const actor = await requireActor(request, env);
  if (!actor) return errorResponse(401, "OMEW_SESSION_INVALID", "auth required");
  const stub = env.STRONGHOLD_DO.getByName(strongholdId);
  const member = await stub.getMember(actor);
  if (!member || member.banned_at) return errorResponse(403, "OMEW_BANNED", "not a member or banned");
  return null;
}

// S9: read paths carry the same role check as write paths - GET endpoints MUST
// also be clipped by role, not just POST/PATCH/DELETE.
async function requireRole(request: Request, env: Env, strongholdId: string, roles: Role[]): Promise<Response | { actor: string; role: Role }> {
  const actor = await requireActor(request, env);
  if (!actor) return errorResponse(401, "OMEW_SESSION_INVALID", "auth required");
  const stub = env.STRONGHOLD_DO.getByName(strongholdId);
  const member = await stub.getMember(actor);
  if (!member || member.banned_at) return errorResponse(403, "OMEW_BANNED", "not a member or banned");
  if (!roles.includes(member.role)) return errorResponse(403, "OMEW_FORBIDDEN", "insufficient role");
  return { actor, role: member.role };
}
