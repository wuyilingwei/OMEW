-- Instance governance for self-operated deployments: known federation peers to
-- federate outbound with (independent of trusted_identity_servers' identity
-- admission role), a stronghold-creation policy, and the application/approval
-- flow backing its "application" mode.

ALTER TABLE instance_config ADD COLUMN federation_peers TEXT NOT NULL DEFAULT '[]';
ALTER TABLE instance_config ADD COLUMN stronghold_creation_policy TEXT NOT NULL DEFAULT 'open';
ALTER TABLE instance_config ADD COLUMN stronghold_creators TEXT NOT NULL DEFAULT '[]';

CREATE TABLE stronghold_applications (
  id TEXT PRIMARY KEY,
  actor TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  visibility TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending',
  created_at INTEGER NOT NULL,
  decided_by TEXT,
  decided_at INTEGER
);

CREATE INDEX idx_stronghold_applications_state ON stronghold_applications(state);
