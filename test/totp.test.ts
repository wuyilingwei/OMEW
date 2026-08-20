import { describe, expect, it } from "vitest";
import * as OTPAuth from "otpauth";
import { generateTotpSecret, totpOtpauthUrl, verifyTotpCode } from "../server/src/totp";

// RFC 6238 Appendix B test vector's fixed seed, decimal->base32'd (the RFC's
// vectors use SHA1 with an 8-digit truncation at T0=0/X=30s; otpauth's own
// generate()/validate() round-trip below is the real contract - this constant
// only anchors that period/digit math against a widely-known reference secret).
const RFC_SEED_BASE32 = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"; // ASCII "12345678901234567890"

describe("generateTotpSecret / totpOtpauthUrl", () => {
  it("generates a base32 secret and a matching otpauth:// URL", () => {
    const secret = generateTotpSecret();
    expect(secret.length).toBeGreaterThan(0);
    const url = totpOtpauthUrl("alice", secret);
    expect(url).toMatch(/^otpauth:\/\/totp\/OMEW:alice\?/);
    expect(url).toContain(`secret=${secret}`);
    expect(url).toContain("issuer=OMEW");
    expect(url).toContain("algorithm=SHA1");
    expect(url).toContain("digits=6");
    expect(url).toContain("period=30");
  });
});

describe("verifyTotpCode", () => {
  it("accepts the current code for a known secret", () => {
    const totp = new OTPAuth.TOTP({
      algorithm: "SHA1",
      digits: 6,
      period: 30,
      secret: OTPAuth.Secret.fromBase32(RFC_SEED_BASE32),
    });
    const code = totp.generate();
    const step = verifyTotpCode(RFC_SEED_BASE32, code);
    expect(step).not.toBeNull();
    expect(step).toBe(Math.floor(Date.now() / 1000 / 30));
  });

  it("accepts a code one step in the past or future (±1 window)", () => {
    const totp = new OTPAuth.TOTP({
      algorithm: "SHA1",
      digits: 6,
      period: 30,
      secret: OTPAuth.Secret.fromBase32(RFC_SEED_BASE32),
    });
    const now = Math.floor(Date.now() / 1000);
    const pastCode = totp.generate({ timestamp: (now - 30) * 1000 });
    const futureCode = totp.generate({ timestamp: (now + 30) * 1000 });
    expect(verifyTotpCode(RFC_SEED_BASE32, pastCode)).not.toBeNull();
    expect(verifyTotpCode(RFC_SEED_BASE32, futureCode)).not.toBeNull();
  });

  it("rejects a code two steps away (outside the ±1 window)", () => {
    const totp = new OTPAuth.TOTP({
      algorithm: "SHA1",
      digits: 6,
      period: 30,
      secret: OTPAuth.Secret.fromBase32(RFC_SEED_BASE32),
    });
    const now = Math.floor(Date.now() / 1000);
    const farCode = totp.generate({ timestamp: (now + 90) * 1000 });
    expect(verifyTotpCode(RFC_SEED_BASE32, farCode)).toBeNull();
  });

  it("rejects a garbage code", () => {
    expect(verifyTotpCode(RFC_SEED_BASE32, "000000")).toBeNull();
    expect(verifyTotpCode(RFC_SEED_BASE32, "not-a-code")).toBeNull();
  });
});
