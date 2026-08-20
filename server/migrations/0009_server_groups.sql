-- Server-level user groups (m0-protocol §7.10a), replacing task 037's
-- stronghold-local groups (StrongholdDO's own groups/member_groups SQLite
-- tables, dropped in stronghold-do.ts's migrate()). Only local users can be
-- assigned - keyed by bare localpart, not full actor string, since guests
-- have no row in users to assign against.

CREATE TABLE server_groups (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  color TEXT,
  position INTEGER NOT NULL,
  -- tri-state, -1 deny / 0 inherit / 1 allow.
  allow_speak INTEGER NOT NULL DEFAULT 0,
  allow_post INTEGER NOT NULL DEFAULT 0,
  allow_reply INTEGER NOT NULL DEFAULT 0,
  is_moderator INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE user_server_groups (
  localpart TEXT NOT NULL REFERENCES users(localpart),
  group_id TEXT NOT NULL REFERENCES server_groups(id),
  PRIMARY KEY (localpart, group_id)
);

CREATE INDEX idx_user_server_groups_group ON user_server_groups(group_id);

-- No ON DELETE CASCADE (this codebase never uses it). Group deletion cascades
-- application-side: DELETE /api/admin/server-groups/:gid deletes
-- user_server_groups rows before deleting the server_groups row.
