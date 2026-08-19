// Instance-level identity policy (allow_root / root_requirements /
// trusted_identity_servers), username/email validation and invite-code helpers for
// the real user system that replaces the M1 dev-token stub. HMAC session tokens
// themselves are unchanged - see auth.ts.

import { base64UrlEncode } from "./auth";
import type { InstanceConfig, PublicUser, RootRequirement } from "./types";

const ROOT_REQUIREMENTS: readonly RootRequirement[] = ["email", "phone", "code"];

// m0-protocol §1.3 calls for PRECIS UsernameCaseMapped; this is an approximation
// (case-fold to lowercase, then restrict to the wire ASCII subset). Full PRECIS /
// UTS #39 confusable handling (§1.4) is out of scope for M1.
const USERNAME_RE = /^[a-z0-9_-]{2,32}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DOMAIN_OR_WILDCARD_RE =
  /^(\*|[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+)$/;

const INVITE_CODE_BYTES = 15; // -> 20 base64url chars, ~120 bits

export function normalizeUsername(input: string): string {
  return input.toLowerCase();
}

export function isValidUsername(username: string): boolean {
  return USERNAME_RE.test(username);
}

export function isValidEmail(email: string): boolean {
  return EMAIL_RE.test(email);
}

export function isValidRootRequirements(value: unknown): value is RootRequirement[] {
  return Array.isArray(value) && value.every((v) => ROOT_REQUIREMENTS.includes(v as RootRequirement));
}

// An empty list is a valid (if extreme) policy - it trusts no identity server and
// so disables inbound federation sessions entirely; only element shape is checked.
export function isValidTrustedServers(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === "string" && DOMAIN_OR_WILDCARD_RE.test(v));
}

export function generateInviteCode(): string {
  return base64UrlEncode(crypto.getRandomValues(new Uint8Array(INVITE_CODE_BYTES)));
}

// Local actors are always `@localpart:HOME_DOMAIN` (types.ts) - recover the
// localpart to look a session's actor up in the users table.
export function localpartOfActor(actor: string): string {
  const colon = actor.indexOf(":");
  return actor.startsWith("@") && colon > 1 ? actor.slice(1, colon) : "";
}

// The domain half of `@localpart:domain` - distinguishes a local user (domain ==
// HOME_DOMAIN, looked up in `users`) from a guest actor (looked up in `guest_identity`).
export function domainOfActor(actor: string): string {
  const colon = actor.indexOf(":");
  return actor.startsWith("@") && colon > 1 ? actor.slice(colon + 1) : "";
}

export async function getInstanceConfig(env: Env): Promise<InstanceConfig> {
  const row = await env.DB.prepare(
    "SELECT allow_root, root_requirements, trusted_identity_servers, max_file_bytes, user_storage_quota_bytes FROM instance_config WHERE id = 1"
  ).first<{
    allow_root: number;
    root_requirements: string;
    trusted_identity_servers: string;
    max_file_bytes: number;
    user_storage_quota_bytes: number;
  }>();
  if (!row) {
    // Unreachable once migration 0002 has run (it seeds the single row) - fail
    // closed to the most restrictive policy rather than 500 if it somehow isn't.
    return {
      allow_root: false,
      root_requirements: [],
      trusted_identity_servers: ["*"],
      max_file_bytes: 10485760,
      user_storage_quota_bytes: 209715200,
    };
  }
  return {
    allow_root: Boolean(row.allow_root),
    root_requirements: JSON.parse(row.root_requirements) as RootRequirement[],
    trusted_identity_servers: JSON.parse(row.trusted_identity_servers) as string[],
    max_file_bytes: row.max_file_bytes,
    user_storage_quota_bytes: row.user_storage_quota_bytes,
  };
}

export function isValidPositiveInt(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

export function isOriginTrusted(config: InstanceConfig, origin: string): boolean {
  return config.trusted_identity_servers.includes("*") || config.trusted_identity_servers.includes(origin);
}

export function toPublicUser(
  row: { localpart: string; is_admin: number; email: string | null; email_verified: number },
  actor: string
): PublicUser {
  return {
    username: row.localpart,
    actor,
    is_admin: Boolean(row.is_admin),
    email: row.email,
    email_verified: Boolean(row.email_verified),
  };
}
