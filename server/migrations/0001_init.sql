-- proposal-v0.2 S4.1: D1 rows = users / instances / guest identities / edges / archive index.
-- Message content never lands here (proposal S4.1); this instance's own room state
-- lives in RoomDO/StrongholdDO SQLite storage (server/src/room-do.ts, stronghold-do.ts).

CREATE TABLE users (
  localpart TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active', -- active | deactivated
  created_at INTEGER NOT NULL
);

-- m0-protocol S6.1 instance key set (GET /.well-known/openmew/keys), scoped per peer instance.
CREATE TABLE instances (
  instance TEXT PRIMARY KEY,
  name TEXT,
  software TEXT,
  version TEXT,
  capabilities_json TEXT,
  known_peers_json TEXT,
  fetched_at INTEGER NOT NULL
);

CREATE TABLE instance_keys (
  instance TEXT NOT NULL REFERENCES instances(instance),
  key_id TEXT NOT NULL,
  alg TEXT NOT NULL DEFAULT 'Ed25519',
  public_key TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  not_before INTEGER,
  retired_at INTEGER,
  status TEXT NOT NULL DEFAULT 'active', -- active | retired | revoked
  prev_key_id TEXT,
  continuity_sig TEXT,
  revoked_at INTEGER,
  revocation_sig TEXT,
  PRIMARY KEY (instance, key_id)
);

-- m0-protocol S7.6 guest identity row (this instance as B for actors registered elsewhere).
CREATE TABLE guest_identity (
  actor TEXT PRIMARY KEY,
  registered_origin TEXT NOT NULL,
  profile_version INTEGER NOT NULL DEFAULT 0,
  display_name TEXT,
  avatar TEXT,
  profile_status TEXT NOT NULL DEFAULT 'active', -- active | deactivated
  ownership_key_json TEXT,
  key_history_json TEXT,
  first_seen_at INTEGER NOT NULL,
  last_assertion_at INTEGER NOT NULL,
  sessions_revoked_at INTEGER
);

-- m0-protocol S7.6 per-stronghold member state for guest actors, authoritative on this instance.
CREATE TABLE guest_member_state (
  actor TEXT NOT NULL REFERENCES guest_identity(actor),
  stronghold_id TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member', -- owner | mod | member
  deny INTEGER NOT NULL DEFAULT 0,
  restricted INTEGER NOT NULL DEFAULT 0,
  banned_at INTEGER,
  application_state TEXT NOT NULL DEFAULT 'approved', -- pending | approved | rejected
  PRIMARY KEY (actor, stronghold_id)
);

-- m0-protocol S7.7 mesh edge table, (actor, peer_instance) as registered_origin=this instance.
CREATE TABLE user_link (
  actor TEXT NOT NULL,
  peer_instance TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending', -- pending | confirmed
  created_at INTEGER NOT NULL,
  confirmed_at INTEGER,
  PRIMARY KEY (actor, peer_instance)
);

-- proposal S6.1 archive index: (do_key, seq range) -> R2 shard, bumped on legal hard-delete rewrite.
CREATE TABLE archive_index (
  do_key TEXT NOT NULL,
  seq_start INTEGER NOT NULL,
  seq_end INTEGER NOT NULL,
  r2_key TEXT NOT NULL,
  shard_version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (do_key, seq_start)
);

CREATE INDEX idx_archive_index_do_key ON archive_index(do_key, seq_end);
