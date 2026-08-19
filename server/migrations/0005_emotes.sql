-- Emote packs: instance-level, admin-managed sets of named emotes that each
-- reference an existing media row (migration 0004). Deleting a pack/emote only
-- removes these rows, never the underlying media (proposal §11: asset lifecycle
-- stays with the media pipeline, not the emote catalog).

CREATE TABLE emote_packs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE emotes (
  id TEXT PRIMARY KEY,
  pack_id TEXT NOT NULL REFERENCES emote_packs(id),
  name TEXT NOT NULL,
  media_id TEXT NOT NULL REFERENCES media(id),
  created_at INTEGER NOT NULL,
  UNIQUE(pack_id, name)
);

CREATE INDEX idx_emotes_pack_id ON emotes(pack_id);
