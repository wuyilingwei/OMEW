-- TOTP second factor (RFC 6238) and WebAuthn passkeys (instance-local auth,
-- m0-protocol §7.2a) - do not touch federation/ownership identity (§7.9a
-- untouched, see docs/spec.md §7.2a).

ALTER TABLE users ADD COLUMN totp_secret TEXT;
ALTER TABLE users ADD COLUMN totp_enabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN last_totp_step INTEGER NOT NULL DEFAULT 0;

CREATE TABLE webauthn_credentials (
  credential_id TEXT PRIMARY KEY,
  localpart TEXT NOT NULL REFERENCES users(localpart),
  public_key TEXT NOT NULL,
  counter INTEGER NOT NULL DEFAULT 0,
  transports TEXT, -- JSON array, may be null (client omitted it)
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_webauthn_credentials_localpart ON webauthn_credentials(localpart);

-- No ON DELETE CASCADE (repo convention). User deletion cascading to
-- webauthn_credentials, if ever implemented, is application-side and out of
-- scope for this task.
