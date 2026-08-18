-- Real user system, replacing the M1 dev-token stub. Instance-level identity
-- policy (root registration gate, invite codes, federation trust list) plus the
-- columns users needs for password auth and account ownership.

CREATE TABLE instance_config (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  allow_root INTEGER NOT NULL DEFAULT 1,
  root_requirements TEXT NOT NULL DEFAULT '[]', -- JSON array of "email" | "phone" | "code"
  trusted_identity_servers TEXT NOT NULL DEFAULT '["*"]' -- JSON array of domains or "*"
);

INSERT INTO instance_config (id, allow_root, root_requirements, trusted_identity_servers)
VALUES (1, 1, '[]', '["*"]');

CREATE TABLE invite_codes (
  code TEXT PRIMARY KEY,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  used_by TEXT,
  used_at INTEGER
);

ALTER TABLE users ADD COLUMN pw_hash TEXT;
ALTER TABLE users ADD COLUMN pw_salt TEXT;
ALTER TABLE users ADD COLUMN email TEXT;
ALTER TABLE users ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN ownership_pubkey TEXT;
ALTER TABLE users ADD COLUMN ownership_ciphertext TEXT;
