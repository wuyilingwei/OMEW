import { dummyPasswordFields, hashPassword, newJti, signToken, verifyPassword, verifyToken } from "./auth";
import { handleInbox } from "./inbox";
import {
  HOME_DOMAIN,
  typeToKind,
  type Role,
  type RoomTokenClaims,
  type SessionTokenClaims,
  type StrongholdTokenClaims,
} from "./types";
import {
  generateInviteCode,
  getInstanceConfig,
  isOriginTrusted,
  isValidEmail,
  isValidRootRequirements,
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
  const row = await env.DB.prepare("SELECT is_admin FROM users WHERE localpart = ?")
    .bind(localpartOfActor(actor))
    .first<{ is_admin: number }>();
  if (!row || !row.is_admin) return apiError(403, "ADMIN_REQUIRED");
  return { actor };
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
    return json({ allow_root: config.allow_root, root_requirements: config.root_requirements });
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

    await env.DB.prepare(
      "UPDATE instance_config SET allow_root = ?, root_requirements = ?, trusted_identity_servers = ? WHERE id = 1"
    )
      .bind(allowRoot ? 1 : 0, JSON.stringify(rootRequirements), JSON.stringify(trustedServers))
      .run();
    return json({ allow_root: allowRoot, root_requirements: rootRequirements, trusted_identity_servers: trustedServers });
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

  return errorResponse(404, "OMEW_NOT_FOUND", "no such route");
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
