// Registration-time blocklist for localparts that would read as an official,
// system or service identity. Charset and length rules stay in users.ts.
//
// Entries are separator-free: a lookup strips `-` and `_` from the candidate
// first, so `ad-min` and `a_d_m_i_n` both resolve to `admin`.
//
// Mirrored client-side in web/src/utils/reservedUsernames.ts for inline form
// feedback; this list is the authoritative one.

export const RESERVED_USERNAMES: readonly string[] = [
  // authority and official identity
  "admin",
  "admins",
  "administrator",
  "root",
  "superuser",
  "sysadmin",
  "system",
  "owner",
  "moderator",
  "moderators",
  "mod",
  "mods",
  "staff",
  "official",
  "team",

  // service and automated senders
  "bot",
  "bots",
  "daemon",
  "service",
  "support",
  "help",
  "helpdesk",
  "contact",
  "security",
  "abuse",
  "postmaster",
  "webmaster",
  "hostmaster",
  "noreply",
  "donotreply",
  "notification",
  "notifications",
  "alert",
  "alerts",

  // brand
  "omew",
  "openmew",
  "mew",

  // route prefixes and protocol identifiers
  "api",
  "www",
  "media",
  "assets",
  "static",
  "inbox",
  "wellknown",
  "oauth",
  "auth",
  "login",
  "logout",
  "register",
  "signup",
  "signin",
  "settings",
  "me",
  "user",
  "users",
  "account",
  "accounts",
  "directory",

  // broadcast mentions and placeholder semantics
  "everyone",
  "here",
  "all",
  "channel",
  "guest",
  "anonymous",
  "deleted",
  "unknown",
  "null",
  "undefined",
];

function stripSeparators(username: string): string {
  return username.replace(/[-_]/g, "");
}

const RESERVED_SET = new Set(RESERVED_USERNAMES.map(stripSeparators));

// Expects an already-normalized (lowercased) username - see normalizeUsername.
export function isReservedUsername(username: string): boolean {
  return RESERVED_SET.has(stripSeparators(username));
}
