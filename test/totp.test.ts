import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

// RFC 6238 Appendix B publishes its test vectors as 8-digit SHA1 HOTP codes
// (T0=0, X=30s, same "12345678901234567890" seed as RFC_SEED_BASE32 above).
// HOTP's dynamic truncation reduces mod 10^Digits, and 10^6 divides 10^8, so
// this implementation's 6-digit code is independently derivable as the
// published 8-digit value mod 1e6 - not a round-trip through this file's own
// generate()/validate() pair, unlike the otpauth-only tests above.
describe("verifyTotpCode against RFC 6238 Appendix B vectors (SHA1, truncated to 6 digits)", () => {
  const VECTORS: Array<{ t: number; code8: number }> = [
    { t: 59, code8: 94287082 },
    { t: 1111111109, code8: 7081804 },
    { t: 1234567890, code8: 89005924 },
  ];

  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  for (const { t, code8 } of VECTORS) {
    it(`matches the published vector at T=${t}`, () => {
      vi.setSystemTime(t * 1000);
      const code6 = String(code8 % 1_000_000).padStart(6, "0");
      const step = verifyTotpCode(RFC_SEED_BASE32, code6);
      expect(step).toBe(Math.floor(t / 30));
    });
  }
});
