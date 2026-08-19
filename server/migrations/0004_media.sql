-- Media upload pipeline: instance-level file size/quota limits plus the media
-- table backing R2-stored uploads.

ALTER TABLE instance_config ADD COLUMN max_file_bytes INTEGER NOT NULL DEFAULT 10485760;
ALTER TABLE instance_config ADD COLUMN user_storage_quota_bytes INTEGER NOT NULL DEFAULT 209715200;

CREATE TABLE media (
  id TEXT PRIMARY KEY,
  hash TEXT NOT NULL,
  owner_actor TEXT NOT NULL,
  size INTEGER NOT NULL,
  mime TEXT NOT NULL,
  r2_key TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_media_owner_actor ON media(owner_actor);
