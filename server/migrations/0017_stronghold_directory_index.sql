-- Read model for the public stronghold directory. Configuration and membership
-- live in StrongholdDO SQLite, so listing them directly would require two RPCs
-- per stronghold. StrongholdDO writes this projection with every directory
-- visible configuration or membership change; the directory route hydrates
-- rows missing after this migration from the authoritative DO once.
CREATE TABLE stronghold_directory_index (
  stronghold_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  avatar TEXT,
  cover TEXT,
  visibility TEXT NOT NULL,
  member_count INTEGER NOT NULL,
  slug TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX idx_stronghold_directory_index_public
  ON stronghold_directory_index(visibility, stronghold_id);
