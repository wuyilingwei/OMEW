-- Global account bans are authoritative in D1. `status = 'banned'` continues
-- to make every existing session fail its next server-side authorization check;
-- the nullable expiry is lazily cleared by the authentication paths.
ALTER TABLE users ADD COLUMN banned_at INTEGER;
ALTER TABLE users ADD COLUMN banned_by TEXT;
ALTER TABLE users ADD COLUMN banned_until INTEGER;

CREATE INDEX idx_users_active_bans ON users(status, banned_until);
