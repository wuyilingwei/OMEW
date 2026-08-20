// TOTP second factor (RFC 6238, HMAC-SHA1, 30s period, 6 digits), m0-protocol
// §7.2a. Uses the `otpauth` library (pure-JS, @noble/hashes backed, already
// proven workerd-safe via web/'s ownership-key crypto using the same family).

import * as OTPAuth from "otpauth";

const PERIOD_S = 30;
const DIGITS = 6;
const SECRET_BYTES = 20; // 160 bits, RFC 4226's recommended HOTP/TOTP secret size

export function generateTotpSecret(): string {
  return new OTPAuth.Secret({ size: SECRET_BYTES }).base32;
}

export function totpOtpauthUrl(localpart: string, secretBase32: string): string {
  const totp = new OTPAuth.TOTP({
    issuer: "OMEW",
    label: localpart,
    algorithm: "SHA1",
    digits: DIGITS,
    period: PERIOD_S,
    secret: OTPAuth.Secret.fromBase32(secretBase32),
  });
  return totp.toString();
}

// Returns the matched time step on success (±1 window), or null. Callers are
// responsible for rejecting a step already recorded (replay defense) and for
// persisting the matched step on success.
export function verifyTotpCode(secretBase32: string, code: string): number | null {
  const totp = new OTPAuth.TOTP({
    algorithm: "SHA1",
    digits: DIGITS,
    period: PERIOD_S,
    secret: OTPAuth.Secret.fromBase32(secretBase32),
  });
  const delta = totp.validate({ token: code, window: 1 });
  if (delta === null) return null;
  return Math.floor(Date.now() / 1000 / PERIOD_S) + delta;
}
