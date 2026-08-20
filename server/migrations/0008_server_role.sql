-- Task 035: server-level role tier (m0-protocol §7.10), orthogonal to
-- stronghold roles. server_owner is unique (the instance operator; defaults to
-- the first local registration, see api.ts's registration bootstrap),
-- server_admin is appointable by server_owner. Neither propagates over
-- federation. users.is_admin is superseded and no longer read anywhere in
-- server/src - kept as an archived column rather than dropped.

ALTER TABLE users ADD COLUMN server_role TEXT NOT NULL DEFAULT 'user';

-- Backfill: production currently has exactly one is_admin=1 account (the
-- server owner) - promote it.
UPDATE users SET server_role = 'owner' WHERE is_admin = 1;
