-- Stronghold slug (short-name) global uniqueness + reverse lookup index.
-- The slug itself lives on each StrongholdDO's own config table (per-DO
-- SQLite); this D1 table exists only because uniqueness across every
-- stronghold and resolve-by-slug both need a global, queryable index.

CREATE TABLE stronghold_slug_index (
  slug TEXT PRIMARY KEY,
  stronghold_id TEXT NOT NULL UNIQUE
);
