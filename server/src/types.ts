// `Env` itself is not declared here - it comes from wrangler-generated
// worker-configuration.d.ts (run `npm run types` in server/ after touching
// wrangler.jsonc) plus the DEV_TOKEN_SECRET augmentation in src/env.d.ts.

// M1 has no federation wiring yet (M5/M6): this instance's own domain isn't
// configured anywhere, so a fixed placeholder stands in for it everywhere an
// `origin`/actor domain is needed.
export const HOME_DOMAIN = "local";

// m0-protocol S3.4 deny bitmask.
export const DENY_CHANNEL_SPEAK = 1;
export const DENY_SECTION_POST = 2;
export const DENY_SECTION_REPLY = 4;

export type Role = "owner" | "mod" | "member";

export type RoomKind = "ch" | "sec";
// m0-protocol S3.6: `type` uses full words in stronghold.room.create payloads;
// S1.5 room-ref path segments use the "ch"/"sec" abbreviation. Two vocabularies,
// same concept - convert at the boundary rather than storing both.
export type RoomType = "channel" | "section";

export function typeToKind(type: RoomType): RoomKind {
  return type === "channel" ? "ch" : "sec";
}

// m0-protocol S9 / S7.3: room-scoped WS token claims.
export interface RoomTokenClaims {
  v: 1;
  typ: "room";
  actor: string;
  room: string; // room-ref
  role: Role;
  deny: number;
  exp: number; // unix seconds, MUST <= now + 300
  jti: string;
}

// m0-protocol S7.3: stronghold-scoped WS token claims (tips channel), grants no write access.
export interface StrongholdTokenClaims {
  v: 1;
  typ: "stronghold";
  actor: string;
  stronghold: string;
  exp: number;
  jti: string;
}

// Session claims (see auth.ts for the HMAC signing mechanism) - not a WS token,
// used for HTTP bearer auth. Issued by /api/register and /api/login (users.ts).
export interface SessionTokenClaims {
  v: 1;
  typ: "session";
  actor: string;
  exp: number;
  jti: string;
}

// Instance-level identity policy (users.ts), backed by the single-row
// instance_config table (migration 0002).
export type RootRequirement = "email" | "phone" | "code";

export interface InstanceConfig {
  allow_root: boolean;
  root_requirements: RootRequirement[];
  trusted_identity_servers: string[];
}

// Shape returned to clients on register/login - never includes pw_hash/pw_salt or
// the ownership ciphertext.
export interface PublicUser {
  username: string;
  actor: string;
  is_admin: boolean;
  email: string | null;
  email_verified: boolean;
}
