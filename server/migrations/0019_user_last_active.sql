-- Member roster activity projection. This is intentionally nullable: guest
-- actors and accounts that have never authenticated have no local evidence.
ALTER TABLE users ADD COLUMN last_active_at INTEGER;

CREATE INDEX idx_users_last_active_at ON users(last_active_at);
