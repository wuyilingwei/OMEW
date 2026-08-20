-- Hardening follow-up for 0010 (m0-protocol §7.2a):
-- - used_challenges makes WebAuthn challenge tokens single-use, closing a
--   captured-response replay window (challenge tokens were only exp-checked).
-- - totp_attempts throttles TOTP code guessing per account, independent of
--   how many fresh pending tokens the caller can mint.

CREATE TABLE used_challenges (
  jti TEXT PRIMARY KEY,
  exp INTEGER NOT NULL
);

CREATE TABLE totp_attempts (
  localpart TEXT PRIMARY KEY REFERENCES users(localpart),
  fail_count INTEGER NOT NULL DEFAULT 0,
  locked_until INTEGER NOT NULL DEFAULT 0
);
