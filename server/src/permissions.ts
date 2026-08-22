// task 048: server-level groups (m0-protocol §7.10a). This is the single
// synthesis function shared by the HTTP permission gate (api.ts's
// effectiveRole) and the WS room-token mint (POST /stronghold/:id/rooms/:resId/token) -
// both need the exact same answer for "given this member's base role/deny and
// the server groups they hold, what's their effective role/deny".

import { DENY_CHANNEL_SPEAK, DENY_SECTION_POST, DENY_SECTION_REPLY, type Role } from "./types";

// -1 deny, 0 inherit (no opinion), 1 allow.
export type PermTriState = -1 | 0 | 1;

export interface ServerGroupPermInput {
  position: number;
  allow_speak: PermTriState;
  allow_post: PermTriState;
  allow_reply: PermTriState;
  is_moderator: number;
}

export interface EffectivePermissions {
  role: Role;
  deny: number;
}

export function canAccessRestrictedRoom(role: Role | null, room: { restricted: number }): boolean {
  return !room.restricted || role === "owner" || role === "mod";
}

// baseRole/baseDeny MUST already reflect the server_role owner/admin overlay
// (m0-protocol §7.10) and the built-in owner/mod roles - none of those are
// touched by groups at all. Groups only ever act on a plain "member".
export function synthesizeEffectivePermissions(
  baseRole: Role,
  baseDeny: number,
  groups: ServerGroupPermInput[]
): EffectivePermissions {
  if (baseRole !== "member") {
    return { role: baseRole, deny: 0 };
  }

  // Baseline: all allowed. Apply each group's tri-state in ascending position
  // order - a later (higher-position) group's non-inherit value overrides an
  // earlier one's, per group. moderator is a plain OR across every held group.
  const sorted = [...groups].sort((a, b) => a.position - b.position);
  let speak: number = 0;
  let post: number = 0;
  let reply: number = 0;
  let moderator = false;
  for (const g of sorted) {
    if (g.allow_speak !== 0) speak = g.allow_speak;
    if (g.allow_post !== 0) post = g.allow_post;
    if (g.allow_reply !== 0) reply = g.allow_reply;
    if (g.is_moderator) moderator = true;
  }

  if (moderator) {
    // Any group flagged moderator => effect equals the built-in mod role, which
    // always carries deny = 0 - same invariant here, group-granted or built-in.
    return { role: "mod", deny: 0 };
  }

  let deny = 0;
  if (speak === -1) deny |= DENY_CHANNEL_SPEAK;
  if (post === -1) deny |= DENY_SECTION_POST;
  if (reply === -1) deny |= DENY_SECTION_REPLY;
  // Member-level deny bit (existing per-actor punishment, task 016) overrides
  // last - it only ever adds denials on top of whatever the groups produced.
  deny |= baseDeny;
  return { role: "member", deny };
}
