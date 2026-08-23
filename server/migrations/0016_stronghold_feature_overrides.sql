-- Instance-wide moderation overrides are separate from StrongholdDO's owner
-- policy so server operators can supersede or release one feature at a time.
CREATE TABLE stronghold_feature_overrides (
  stronghold_id TEXT NOT NULL,
  feature TEXT NOT NULL CHECK (feature IN ('chat', 'posts')),
  mode TEXT NOT NULL CHECK (mode IN ('inherit', 'force_allow', 'force_pause')),
  expires_at INTEGER,
  updated_by TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (stronghold_id, feature)
);
