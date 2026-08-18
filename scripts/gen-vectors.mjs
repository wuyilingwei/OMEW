#!/usr/bin/env node
// Generates test/vectors/m0-vectors.json for the OMEW M0 protocol draft (docs/m0-protocol-draft.md, Appendix A).
// Node >= 20, zero runtime dependencies (Ed25519 via node:crypto, JCS self-implemented below).
//
// All key material in this file is deterministically derived from hardcoded "TEST ONLY" labels.
// It has no relation to any real instance or account and MUST NOT be used outside conformance testing.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_PATH = path.join(__dirname, '..', 'test', 'vectors', 'm0-vectors.json');

// ---------------------------------------------------------------------------
// RFC 8785 JSON Canonicalization Scheme (JCS) -- self-implemented.
//
// Approach: deep-clone the value into a new object whose keys are inserted in
// ascending UTF-16 code unit order (matching JCS's key-ordering requirement),
// then serialize with the platform JSON.stringify. This works because V8's
// JSON.stringify already implements the two remaining JCS requirements
// exactly as specified: number formatting follows the ECMA-262
// Number::toString algorithm (the same algorithm JCS section 3.2.2 mandates,
// since JCS explicitly reuses ECMAScript's ToString for numbers), and string
// escaping follows the ECMA-262 Quote() abstract operation (JCS section
// 3.2.3 also just requires standard JSON string escaping, and additionally
// permits -- does not require -- leaving '/' and non-ASCII characters
// unescaped, which is V8's default behavior). This is the same technique
// used by the reference `canonicalize` npm package (Erik Wilde /
// cyberphone's C2PA-adjacent JCS implementations); we do not vendor it
// because the technique is ~15 lines and pulling a dependency for it would
// violate the "prefer zero dependencies" instruction for this task.
//
// Scope note: every number in every test vector below is a JSON integer
// within the protocol's mandated +/-(2^53-1) safe range (see docs
// section 2.2), so the trickiest part of RFC 8785 (shortest round-trip
// serialization of arbitrary IEEE-754 doubles) is never exercised -- JS's
// native integer-to-string already produces the required output for that
// range. TV-09 exists specifically to document *why* the range limit exists.
// ---------------------------------------------------------------------------

function jcsClone(value) {
  if (Array.isArray(value)) return value.map(jcsClone);
  if (value !== null && typeof value === 'object') {
    const sorted = {};
    for (const key of Object.keys(value).sort()) {
      sorted[key] = jcsClone(value[key]);
    }
    return sorted;
  }
  return value;
}

function jcsCanonicalize(value) {
  return JSON.stringify(jcsClone(value));
}

function jcsCanonicalizeBytes(value) {
  return Buffer.from(jcsCanonicalize(value), 'utf8');
}

// ---------------------------------------------------------------------------
// Ed25519 via node:crypto, from raw 32-byte seeds (no external dependency).
// Node's crypto.createPrivateKey has no 'raw' Ed25519 import, so raw seeds
// are wrapped in the fixed 16-byte PKCS8 prefix for Ed25519 private keys,
// and raw public keys are wrapped in the fixed 12-byte SPKI prefix.
// ---------------------------------------------------------------------------

const PKCS8_ED25519_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');
const SPKI_ED25519_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

function keypairFromSeed(seed) {
  if (seed.length !== 32) throw new Error('seed must be 32 bytes');
  const privateKey = crypto.createPrivateKey({
    key: Buffer.concat([PKCS8_ED25519_PREFIX, seed]),
    format: 'der',
    type: 'pkcs8',
  });
  const publicKeyObj = crypto.createPublicKey(privateKey);
  const rawPublicKey = Buffer.from(publicKeyObj.export({ format: 'jwk' }).x, 'base64url');
  return { seed, privateKey, publicKeyObj, rawPublicKey };
}

function publicKeyObjFromRaw(rawPublicKey) {
  return crypto.createPublicKey({
    key: Buffer.concat([SPKI_ED25519_PREFIX, rawPublicKey]),
    format: 'der',
    type: 'spki',
  });
}

function ed25519Sign(privateKey, message) {
  return crypto.sign(null, message, privateKey);
}

function ed25519Verify(rawPublicKey, message, signature) {
  return crypto.verify(null, message, publicKeyObjFromRaw(rawPublicKey), signature);
}

function b64url(buf) {
  return buf.toString('base64url');
}

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest();
}

// key_id SHOULD be base64url(SHA-256(public_key))[0:16] per docs section 6.1.
function deriveKeyId(rawPublicKey) {
  return b64url(sha256(rawPublicKey).subarray(0, 16));
}

// ---------------------------------------------------------------------------
// Deterministic TEST ONLY material derivation. Every seed, nonce and id below
// is HMAC-free SHA-256(label) so the whole vector set is reproducible from
// source without shipping raw magic bytes, and unambiguously "TEST ONLY" by
// construction (labels are hardcoded strings, not randomness).
// ---------------------------------------------------------------------------

function testSeed(label) {
  return sha256(Buffer.from(`OPENMEW-M0-TEST-ONLY-SEED::${label}`, 'utf8'));
}

function testNonceBytes(label, len = 16) {
  return sha256(Buffer.from(`OPENMEW-M0-TEST-ONLY-NONCE::${label}`, 'utf8')).subarray(0, len);
}

// Deterministic, format-valid UUIDv7 (version=7, RFC4122 variant). The 74
// timestamp/random bits are derived from the label rather than wall-clock
// time, so vectors are reproducible; monotonic-ordering semantics of real
// UUIDv7 generation are out of scope for these signing vectors.
function testUuidV7(label) {
  const h = sha256(Buffer.from(`OPENMEW-M0-TEST-ONLY-UUID::${label}`, 'utf8'));
  const b = Buffer.from(h.subarray(0, 16));
  b[6] = 0x70 | (b[6] & 0x0f); // version 7
  b[8] = 0x80 | (b[8] & 0x3f); // variant RFC4122
  const hex = b.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

function testClientId(label) {
  // UUIDv4-shaped nonce per docs section 3.2 (SHOULD be UUIDv4; format not enforced by protocol).
  const h = sha256(Buffer.from(`OPENMEW-M0-TEST-ONLY-CID::${label}`, 'utf8'));
  const b = Buffer.from(h.subarray(0, 16));
  b[6] = 0x40 | (b[6] & 0x0f);
  b[8] = 0x80 | (b[8] & 0x3f);
  const hex = b.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

function mediaId(contentLabel) {
  return b64url(sha256(Buffer.from(`OPENMEW-M0-TEST-ONLY-MEDIA::${contentLabel}`, 'utf8')));
}

// ---------------------------------------------------------------------------
// Domain separation prefixes (docs section 2.3, 6.1, 6.3, 6.7, 7.1, 8.3.1, 7.8.1, 6.5).
// ---------------------------------------------------------------------------

const DOMAIN = {
  event: 'openmew/event/v1',
  instanceDescriptor: 'openmew/instance-descriptor/v1',
  userProfile: 'openmew/user-profile/v1',
  assertion: 'openmew/assertion/v1',
  keyRotation: 'openmew/key-rotation/v1',
  keyRevocation: 'openmew/key-revocation/v1',
  request: 'openmew/request/v1',
  ownership: 'openmew/ownership/v1',
  migrationClaim: 'openmew/migration-claim/v1',
};

function signingInputBytes(domainPrefix, objectWithoutSig) {
  return Buffer.concat([
    Buffer.from(domainPrefix, 'utf8'),
    Buffer.from([0x00]),
    jcsCanonicalizeBytes(objectWithoutSig),
  ]);
}

// Builds a signed-envelope-shaped test case: signs `obj` (which MUST NOT
// contain `sig`) under `domainPrefix` with `signer`, and self-checks the
// signature verifies before returning (build-time sanity guard; the
// authoritative independent re-check is scripts/verify-vectors.mjs).
function buildSignedCase({ caseId, description, domainPrefix, object, signer, expected = 'valid', notes }) {
  if ('sig' in object) throw new Error(`${caseId}: object must not pre-contain sig`);
  const signingInput = signingInputBytes(domainPrefix, object);
  const signature = ed25519Sign(signer.privateKey, signingInput);
  const signedObject = { ...object, sig: b64url(signature) };

  const selfCheck = ed25519Verify(signer.rawPublicKey, signingInput, signature);
  if (expected === 'valid' && !selfCheck) {
    throw new Error(`${caseId}: build-time self-check failed (expected valid signature)`);
  }

  return {
    case_id: caseId,
    description,
    domain_prefix: domainPrefix,
    object: signedObject,
    canonical_jcs_hex: jcsCanonicalizeBytes(object).toString('hex'),
    signing_input_hex: signingInput.toString('hex'),
    key_id: signer.keyId,
    public_key: b64url(signer.rawPublicKey),
    signature: b64url(signature),
    expected,
    ...(notes ? { notes } : {}),
  };
}

// ---------------------------------------------------------------------------
// Key material
// ---------------------------------------------------------------------------

function makeInstanceKey(instance, label) {
  const kp = keypairFromSeed(testSeed(`${instance}#${label}`));
  const keyId = deriveKeyId(kp.rawPublicKey);
  return { ...kp, instance, keyId };
}

function makeOwnershipKey(actor, label) {
  const kp = keypairFromSeed(testSeed(`ownership#${actor}#${label}`));
  const keyId = deriveKeyId(kp.rawPublicKey);
  return { ...kp, actor, keyId };
}

const keys = {
  aKey1: makeInstanceKey('a.example', 'key-1'),
  aKey2: makeInstanceKey('a.example', 'key-2'),
  aKey3: makeInstanceKey('a.example', 'key-3'),
  bKey1: makeInstanceKey('b.example', 'key-1'),
  cKey1: makeInstanceKey('c.example', 'key-1'),
  dKey1: makeInstanceKey('d.example', 'key-1'),
};

const ownershipKeys = {
  alice1: makeOwnershipKey('@alice:a.example', 'key-1'),
  alice2: makeOwnershipKey('@alice:a.example', 'key-2'),
  alice3: makeOwnershipKey('@alice:a.example', 'key-3'),
};

const T0 = 1755000000000; // fixed base timestamp (ms), 2025-08-12T13:20:00.000Z; arbitrary but fixed.

const vectors = [];

// ===========================================================================
// TV-01 -- minimal item.create, pure ASCII text
// ===========================================================================
{
  const envelope = {
    v: 1,
    id: testUuidV7('tv01-item'),
    type: 'item.create',
    origin: 'a.example',
    room: 'sh01/ch/general',
    actor: '@alice:a.example',
    seq: 1,
    ts: T0,
    payload: {
      client_id: testClientId('tv01'),
      kind: 'post',
      body: { text: 'Hello, OpenMew!' },
    },
    key_id: keys.aKey1.keyId,
  };
  vectors.push({
    id: 'TV-01',
    title: '最小 item.create,纯 ASCII text',
    spec_refs: ['§2.1', '§2.2', '§2.3', '§2.4'],
    cases: [
      buildSignedCase({
        caseId: 'TV-01',
        description: 'Minimal item.create envelope, ASCII-only body.text, signed by home a.example.',
        domainPrefix: DOMAIN.event,
        object: envelope,
        signer: keys.aKey1,
      }),
    ],
  });
}

// ===========================================================================
// TV-02 -- item.create with objects.users sideload
// ===========================================================================
{
  const envelope = {
    v: 1,
    id: testUuidV7('tv02-item'),
    type: 'item.create',
    origin: 'a.example',
    room: 'sh01/ch/general',
    actor: '@alice:a.example',
    seq: 2,
    ts: T0 + 1000,
    payload: {
      client_id: testClientId('tv02'),
      kind: 'post',
      body: { text: 'sideload carries my profile summary' },
    },
    objects: {
      users: [
        {
          actor: '@alice:a.example',
          profile_version: 3,
          display_name: 'Alice',
          avatar: `omew://a.example/media/${mediaId('tv02-avatar')}`,
          ownership_key: {
            key_id: ownershipKeys.alice1.keyId,
            public_key: b64url(ownershipKeys.alice1.rawPublicKey),
            created_at: T0 - 86400000,
          },
        },
      ],
    },
    key_id: keys.aKey1.keyId,
  };
  vectors.push({
    id: 'TV-02',
    title: '含 objects.users sideload',
    spec_refs: ['§2.1', '§7.4'],
    cases: [
      buildSignedCase({
        caseId: 'TV-02',
        description: 'item.create carrying an objects.users profile-summary sideload for the author.',
        domainPrefix: DOMAIN.event,
        object: envelope,
        signer: keys.aKey1,
      }),
    ],
  });
}

// ===========================================================================
// TV-03 -- non-ASCII body (CJK + emoji + combining/precomposed chars), NFC + JCS escaping
// ===========================================================================
{
  // All human-readable segments below are already NFC-normalized (precomposed
  // accents), as required of body.text by docs section 3.2. Control
  // characters, a literal quote and a literal backslash are included to
  // exercise JCS's mandatory escaping; U+2028 (LINE SEPARATOR) is included
  // to demonstrate that JCS (like JSON) does NOT require escaping it.
  const text =
    'café naïve 你好，世界 🎉' + // café naïve 你好，世界 🎉
    '\nline2\ttabbed "quoted" back\\slash' +
    ' unescaped-line-separator';
  const envelope = {
    v: 1,
    id: testUuidV7('tv03-item'),
    type: 'item.create',
    origin: 'a.example',
    room: 'sh01/ch/general',
    actor: '@alice:a.example',
    seq: 3,
    ts: T0 + 2000,
    payload: {
      client_id: testClientId('tv03'),
      kind: 'post',
      body: { text },
    },
    key_id: keys.aKey1.keyId,
  };
  vectors.push({
    id: 'TV-03',
    title: '含非 ASCII 正文(CJK + emoji + 组合字符),校验 NFC 与 JCS 转义',
    spec_refs: ['§1.3', '§2.2', '§3.2'],
    cases: [
      buildSignedCase({
        caseId: 'TV-03',
        description:
          'body.text mixes NFC-normalized CJK, an astral-plane emoji (surrogate pair), control characters ' +
          'requiring \\n/\\t escaping, a literal quote and backslash, and a literal U+2028 that JCS leaves unescaped.',
        domainPrefix: DOMAIN.event,
        object: envelope,
        signer: keys.aKey1,
        notes:
          'Verifies against NFC(text) === text (illustrative unicode-normalize check only; the protocol ' +
          'does not mandate receiver-side rejection of non-NFC body text, only writer-side NFC production).',
      }),
    ],
  });
}

// ===========================================================================
// TV-04 -- media object + omew:// media-ref
// ===========================================================================
{
  const ref = `omew://a.example/media/${mediaId('tv04-screenshot')}`;
  const envelope = {
    v: 1,
    id: testUuidV7('tv04-item'),
    type: 'item.create',
    origin: 'a.example',
    room: 'sh01/ch/general',
    actor: '@alice:a.example',
    seq: 4,
    ts: T0 + 3000,
    payload: {
      client_id: testClientId('tv04'),
      kind: 'post',
      body: {
        text: 'screenshot attached',
        media: [
          {
            ref,
            mime: 'image/png',
            size: 123456,
            width: 800,
            height: 600,
            blurhash: 'LKO2?U%2Tw=w]~RBVZRi};RPxuwH',
            alt: 'A sample screenshot',
          },
        ],
      },
    },
    key_id: keys.aKey1.keyId,
  };
  vectors.push({
    id: 'TV-04',
    title: '含媒体对象与 omew:// 引用',
    spec_refs: ['§1.6', '§2.1'],
    cases: [
      buildSignedCase({
        caseId: 'TV-04',
        description: `item.create with one body.media entry referencing ${ref}.`,
        domainPrefix: DOMAIN.event,
        object: envelope,
        signer: keys.aKey1,
      }),
    ],
  });
}

// ===========================================================================
// TV-05 -- unknown extension field: signature MUST cover it; stripping it MUST break verification
// ===========================================================================
{
  const envelope = {
    v: 1,
    id: testUuidV7('tv05-item'),
    type: 'item.create',
    origin: 'a.example',
    room: 'sh01/ch/general',
    actor: '@alice:a.example',
    seq: 5,
    ts: T0 + 4000,
    payload: {
      client_id: testClientId('tv05'),
      kind: 'post',
      body: { text: 'carries an unknown top-level extension field' },
    },
    x_vendor_debug: { trace_id: 'abc123', hint: 'unspecified by v1' },
    key_id: keys.aKey1.keyId,
  };
  const positive = buildSignedCase({
    caseId: 'TV-05a',
    description: 'item.create with an unknown top-level field x_vendor_debug; signature covers it.',
    domainPrefix: DOMAIN.event,
    object: envelope,
    signer: keys.aKey1,
  });

  // Negative companion: a relay that strips the unknown field before
  // verification (forbidden by docs section 2.3: "中继实现 MUST NOT 剥离未知
  // 字段后转发") produces a different signing_input, so the original
  // signature MUST NOT verify against the stripped object.
  const { x_vendor_debug, ...stripped } = envelope;
  const strippedSigningInput = signingInputBytes(DOMAIN.event, stripped);
  const strippedVerifies = ed25519Verify(
    keys.aKey1.rawPublicKey,
    strippedSigningInput,
    Buffer.from(positive.signature, 'base64url'),
  );
  if (strippedVerifies) {
    throw new Error('TV-05b: expected verification failure after stripping unknown field, but it verified');
  }

  vectors.push({
    id: 'TV-05',
    title: '含未知扩展字段,验证签名覆盖与不剥离',
    spec_refs: ['§2.1', '§2.3', '§13.2'],
    cases: [
      positive,
      {
        case_id: 'TV-05b',
        description:
          'MUST-fail: verifying the TV-05a signature against the envelope with x_vendor_debug stripped ' +
          '(simulating a relay that drops unknown fields) MUST fail, because the field was signature-covered.',
        domain_prefix: DOMAIN.event,
        object: stripped,
        canonical_jcs_hex: jcsCanonicalizeBytes(stripped).toString('hex'),
        signing_input_hex: strippedSigningInput.toString('hex'),
        key_id: keys.aKey1.keyId,
        public_key: b64url(keys.aKey1.rawPublicKey),
        signature: positive.signature,
        expected: 'reject',
        reject_reason: 'signature_mismatch_after_field_stripped',
      },
    ],
  });
}

// ===========================================================================
// TV-06 -- key order reversed, equivalent input -> identical JCS output
// ===========================================================================
{
  const envelopeA = {
    v: 1,
    id: testUuidV7('tv06-item'),
    type: 'item.create',
    origin: 'a.example',
    room: 'sh01/ch/general',
    actor: '@alice:a.example',
    seq: 6,
    ts: T0 + 5000,
    payload: {
      client_id: testClientId('tv06'),
      kind: 'post',
      body: { text: 'key order must not affect canonical bytes' },
    },
    key_id: keys.aKey1.keyId,
  };
  // Same logical object, keys inserted in reverse/scrambled order.
  const envelopeB = {
    key_id: envelopeA.key_id,
    payload: {
      body: { text: envelopeA.payload.body.text },
      kind: envelopeA.payload.kind,
      client_id: envelopeA.payload.client_id,
    },
    ts: envelopeA.ts,
    seq: envelopeA.seq,
    actor: envelopeA.actor,
    room: envelopeA.room,
    origin: envelopeA.origin,
    type: envelopeA.type,
    id: envelopeA.id,
    v: envelopeA.v,
  };

  const bytesA = jcsCanonicalizeBytes(envelopeA);
  const bytesB = jcsCanonicalizeBytes(envelopeB);
  if (!bytesA.equals(bytesB)) {
    throw new Error('TV-06: JCS output diverged for key-order-scrambled equivalent input');
  }
  const caseA = buildSignedCase({
    caseId: 'TV-06a',
    description: 'Envelope with fields in the field-table order (docs §2.1).',
    domainPrefix: DOMAIN.event,
    object: envelopeA,
    signer: keys.aKey1,
  });
  const caseB = buildSignedCase({
    caseId: 'TV-06b',
    description: 'Same logical envelope, keys inserted in reverse order; MUST produce byte-identical JCS output and signature.',
    domainPrefix: DOMAIN.event,
    object: envelopeB,
    signer: keys.aKey1,
  });
  if (caseA.signature !== caseB.signature || caseA.canonical_jcs_hex !== caseB.canonical_jcs_hex) {
    throw new Error('TV-06: expected identical signature/canonical bytes regardless of source key order');
  }
  vectors.push({
    id: 'TV-06',
    title: '键序颠倒的等价输入,验证 JCS 输出一致',
    spec_refs: ['§2.2 (JCS)'],
    cases: [caseA, caseB],
  });
}

// ===========================================================================
// TV-07 -- session assertion (openmew/assertion/v1)
// ===========================================================================
{
  const assertion = {
    v: 1,
    typ: 'openmew.assertion.v1',
    iss: 'a.example',
    sub: '@alice:a.example',
    aud: 'b.example',
    jti: testUuidV7('tv07-jti'),
    iat: Math.floor(T0 / 1000),
    exp: Math.floor(T0 / 1000) + 300,
    profile_version: 3,
    key_id: keys.aKey1.keyId,
  };
  vectors.push({
    id: 'TV-07',
    title: '会话断言(openmew/assertion/v1 域分隔)',
    spec_refs: ['§7.1', '§7.2'],
    cases: [
      buildSignedCase({
        caseId: 'TV-07',
        description: 'Federation session assertion issued by a.example for @alice, audience b.example, exp-iat = 300s (max allowed).',
        domainPrefix: DOMAIN.assertion,
        object: assertion,
        signer: keys.aKey1,
      }),
    ],
  });
}

// ===========================================================================
// TV-08 -- instance key rotation continuity chain (3 generations) + retired-grace MUST-fail
// ===========================================================================
{
  const created1 = T0 - 30 * 86400000;
  const created2 = T0 - 10 * 86400000;
  const created3 = T0;
  const retiredAt1 = created2; // key1 retired the moment key2 becomes active
  const retiredAt2 = created3;
  const Q = 86400000; // 24h, free-tier Cloudflare Queues retention (docs §4.3)

  // Generation 1: first key, no prev_key_id, trust established by first pin (§6.4).
  const entry1 = {
    instance: 'a.example',
    key_id: keys.aKey1.keyId,
    public_key: b64url(keys.aKey1.rawPublicKey),
    created_at: created1,
  };

  // Generation 2: continuity signed by key1.
  const continuity2Input = {
    instance: 'a.example',
    key_id: keys.aKey2.keyId,
    public_key: b64url(keys.aKey2.rawPublicKey),
    created_at: created2,
    prev_key_id: keys.aKey1.keyId,
  };
  const continuity2Case = buildSignedCase({
    caseId: 'TV-08a',
    description: 'Generation 2 key continuity signature, signed by generation-1 private key.',
    domainPrefix: DOMAIN.keyRotation,
    object: continuity2Input,
    signer: keys.aKey1,
  });

  // Generation 3: continuity signed by key2.
  const continuity3Input = {
    instance: 'a.example',
    key_id: keys.aKey3.keyId,
    public_key: b64url(keys.aKey3.rawPublicKey),
    created_at: created3,
    prev_key_id: keys.aKey2.keyId,
  };
  const continuity3Case = buildSignedCase({
    caseId: 'TV-08b',
    description: 'Generation 3 key continuity signature, signed by generation-2 private key.',
    domainPrefix: DOMAIN.keyRotation,
    object: continuity3Input,
    signer: keys.aKey2,
  });

  const keySetChain = [
    { ...entry1, status: 'retired', retired_at: retiredAt1 },
    {
      instance: 'a.example',
      key_id: keys.aKey2.keyId,
      public_key: b64url(keys.aKey2.rawPublicKey),
      created_at: created2,
      prev_key_id: keys.aKey1.keyId,
      continuity_sig: continuity2Case.signature,
      status: 'retired',
      retired_at: retiredAt2,
    },
    {
      instance: 'a.example',
      key_id: keys.aKey3.keyId,
      public_key: b64url(keys.aKey3.rawPublicKey),
      created_at: created3,
      prev_key_id: keys.aKey2.keyId,
      continuity_sig: continuity3Case.signature,
      status: 'active',
    },
  ];

  // A regular event still signed by the now-retired generation-1 key.
  const retiredEnvelope = {
    v: 1,
    id: testUuidV7('tv08-retired-item'),
    type: 'item.create',
    origin: 'a.example',
    room: 'sh01/ch/general',
    actor: '@alice:a.example',
    seq: 7,
    ts: retiredAt1 + 1000,
    payload: {
      client_id: testClientId('tv08-retired'),
      kind: 'post',
      body: { text: 'signed by a key that is now retired' },
    },
    key_id: keys.aKey1.keyId,
  };
  const retiredCaseWithinGrace = buildSignedCase({
    caseId: 'TV-08c',
    description: 'Event signed by retired generation-1 key, verified while now_ms <= retired_at + Q. MUST accept (docs §2.4/§6.3).',
    domainPrefix: DOMAIN.event,
    object: retiredEnvelope,
    signer: keys.aKey1,
  });
  retiredCaseWithinGrace.lifecycle_check = {
    key_status: 'retired',
    retired_at: retiredAt1,
    grace_period_q_ms: Q,
    verify_at_ms: retiredAt1 + Q - 1000,
    expected_lifecycle_result: 'accept',
  };

  const retiredCaseAfterGrace = buildSignedCase({
    caseId: 'TV-08d',
    description:
      'MUST-fail: same signature as TV-08c, but verified after now_ms > retired_at + Q. The Ed25519 ' +
      'signature itself is still cryptographically valid; rejection is a key-lifecycle policy decision ' +
      '(OMEW_KEY_UNKNOWN per docs §2.4), not a signature failure.',
    domainPrefix: DOMAIN.event,
    object: retiredEnvelope,
    signer: keys.aKey1,
  });
  retiredCaseAfterGrace.lifecycle_check = {
    key_status: 'retired',
    retired_at: retiredAt1,
    grace_period_q_ms: Q,
    verify_at_ms: retiredAt1 + Q + 1000,
    expected_lifecycle_result: 'reject',
    reject_code: 'OMEW_KEY_UNKNOWN',
  };
  retiredCaseAfterGrace.expected = 'reject';
  retiredCaseAfterGrace.reject_reason = 'retired_key_grace_period_exceeded';

  vectors.push({
    id: 'TV-08',
    title: '轮换连续性签名链(三代密钥)',
    spec_refs: ['§6.3', '§6.4', '§2.4'],
    keyset_chain: keySetChain,
    cases: [continuity2Case, continuity3Case, retiredCaseWithinGrace, retiredCaseAfterGrace],
  });
}

// ===========================================================================
// TV-09 -- boundary integers (+/-(2^53-1)) and out-of-range rejection
// ===========================================================================
{
  const MAX_SAFE = Number.MAX_SAFE_INTEGER; // 2^53 - 1, the protocol's declared ceiling (docs §2.2)
  const boundaryEnvelope = {
    v: 1,
    id: testUuidV7('tv09-boundary-item'),
    type: 'item.create',
    origin: 'a.example',
    room: 'sh01/ch/general',
    actor: '@alice:a.example',
    seq: MAX_SAFE,
    ts: T0,
    payload: {
      client_id: testClientId('tv09'),
      kind: 'post',
      body: { text: `seq at the protocol ceiling: ${MAX_SAFE}` },
    },
    key_id: keys.aKey1.keyId,
  };
  const boundaryCase = buildSignedCase({
    caseId: 'TV-09a',
    description: 'seq = 2^53 - 1 (Number.MAX_SAFE_INTEGER), the protocol-mandated ceiling. MUST accept.',
    domainPrefix: DOMAIN.event,
    object: boundaryEnvelope,
    signer: keys.aKey1,
  });
  boundaryCase.integer_check = { value: MAX_SAFE, is_safe_integer: Number.isSafeInteger(MAX_SAFE), expected: 'accept' };

  // Out-of-range companion: 2^53 is one past the ceiling. It happens to be
  // exactly representable as an IEEE-754 double, but 2^53+1 is NOT (it
  // rounds down to 2^53), which is exactly why the protocol draws the line
  // at 2^53-1 rather than trusting "exactly representable" per value: once
  // consecutive integers stop being individually representable, JSON
  // producers/consumers can silently disagree on the value. We demonstrate
  // this by constructing the raw JSON text for 2^53+1 with BigInt (bypassing
  // JS's own float rounding at construction time) and showing JSON.parse
  // silently returns 2^53 instead.
  const overCeiling = 2n ** 53n; // out of range per docs §2.2 (only <= 2^53-1 is in range)
  const nextInt = 2n ** 53n + 1n; // demonstrates the representability cliff
  const rawJsonWithNextInt = `{"seq":${nextInt.toString()}}`;
  const parsedBack = JSON.parse(rawJsonWithNextInt).seq;
  const roundTripLossy = BigInt(parsedBack) !== nextInt;

  const outOfRangeEnvelope = {
    ...boundaryEnvelope,
    id: testUuidV7('tv09-oor-item'),
    seq: Number(overCeiling),
    ts: T0 + 1,
  };
  const outOfRangeSigningInput = signingInputBytes(DOMAIN.event, outOfRangeEnvelope);
  const outOfRangeSignature = ed25519Sign(keys.aKey1.privateKey, outOfRangeSigningInput);
  vectors.push({
    id: 'TV-09',
    title: '边界整数(±(2^53 − 1))与超界拒绝',
    spec_refs: ['§2.2'],
    cases: [
      boundaryCase,
      {
        case_id: 'TV-09b',
        description:
          'MUST-fail: seq = 2^53, one past the protocol ceiling of 2^53-1. Even though correctly signed ' +
          '(the Ed25519 signature below verifies), the envelope MUST still be rejected at the field-validation ' +
          'layer because the protocol range check is "abs(value) <= 2^53-1", not "is exactly representable ' +
          'as a double" -- signature validity alone is not sufficient for acceptance.',
        domain_prefix: DOMAIN.event,
        object: outOfRangeEnvelope,
        canonical_jcs_hex: jcsCanonicalizeBytes(outOfRangeEnvelope).toString('hex'),
        signing_input_hex: outOfRangeSigningInput.toString('hex'),
        key_id: keys.aKey1.keyId,
        public_key: b64url(keys.aKey1.rawPublicKey),
        signature: b64url(outOfRangeSignature),
        expected: 'reject',
        reject_reason: 'integer_out_of_range',
        integer_check: { value: Number(overCeiling), is_safe_integer: Number.isSafeInteger(Number(overCeiling)), expected: 'reject' },
        representability_demo: {
          note:
            'Constructing 2^53+1 via raw JSON text and parsing it back demonstrates the representability ' +
            'cliff that motivates the +/-(2^53-1) ceiling: values above the ceiling can silently change value ' +
            'across independent JCS producers/consumers.',
          raw_json: rawJsonWithNextInt,
          intended_value: nextInt.toString(),
          value_after_json_roundtrip: String(parsedBack),
          lossy: roundTripLossy,
        },
      },
    ],
  });
}

// ===========================================================================
// TV-10 -- confusable localpart collision samples (docs §1.4)
// ===========================================================================
{
  // docs §1.4 mandates the full UTS #39 confusables table for production use
  // and explicitly forbids approximating it with a handwritten table. This
  // vector is NOT a substitute for that table: it only encodes the worked
  // example the spec text itself calls out for the ASCII-restricted
  // localpart charset ("0/o, 1/l, rn/m 一类碰撞"), to pin down expected
  // behavior for that documented subset. See the final report for this
  // limitation.
  function asciiSkeleton(localpart) {
    return localpart.replace(/rn/g, 'm').replace(/0/g, 'o').replace(/1/g, 'l');
  }
  const samples = [
    { a: 'oscar', b: '0scar', collide: true },
    { a: 'mark', b: 'rnark', collide: true },
    { a: 'cool', b: 'c001', collide: true },
    { a: 'oscar', b: 'oscarx', collide: false },
  ];
  const cases = samples.map((s, i) => {
    const skA = asciiSkeleton(s.a);
    const skB = asciiSkeleton(s.b);
    const collides = skA === skB;
    if (collides !== s.collide) {
      throw new Error(`TV-10 sample ${i}: expected collide=${s.collide}, computed ${collides}`);
    }
    return {
      case_id: `TV-10${String.fromCharCode(97 + i)}`,
      description: `localpart "${s.a}" vs "${s.b}": skeleton "${skA}" vs "${skB}".`,
      localpart_a: s.a,
      localpart_b: s.b,
      skeleton_a: skA,
      skeleton_b: skB,
      expected: collides ? 'reject' : 'valid',
      reject_reason: collides ? 'OMEW_NAME_CONFUSABLE' : undefined,
    };
  });
  vectors.push({
    id: 'TV-10',
    title: 'confusable localpart 碰撞样本集',
    spec_refs: ['§1.4'],
    notes:
      'Illustrative ASCII-subset skeleton function (0->o, 1->l, rn->m) only, not the full UTS #39 table ' +
      'mandated by §1.4 for production implementations.',
    cases,
  });
}

// ===========================================================================
// TV-11 -- instance descriptor + user profile document signing
// ===========================================================================
{
  const descriptor = {
    v: 1,
    instance: 'a.example',
    name: 'Example Instance A',
    software: 'openmew',
    version: '0.1.0-m0',
    capabilities: ['federation.session', 'federation.history', 'media.attachments'],
    public_strongholds: [{ id: 'sh01', name: 'Test Stronghold', description: 'M0 vector fixture', member_count: 1, tags: [] }],
    known_peers: ['b.example', 'c.example'],
    key_id: keys.aKey1.keyId,
  };
  const profile = {
    v: 1,
    actor: '@alice:a.example',
    profile_version: 3,
    display_name: 'Alice',
    avatar: `omew://a.example/media/${mediaId('tv11-avatar')}`,
    bio: 'M0 test fixture account',
    created_at: T0 - 90 * 86400000,
    status: 'active',
    ownership_key: {
      key_id: ownershipKeys.alice1.keyId,
      public_key: b64url(ownershipKeys.alice1.rawPublicKey),
      created_at: T0 - 90 * 86400000,
    },
    key_history: [],
    also_known_as: [],
    key_id: keys.aKey1.keyId,
  };
  vectors.push({
    id: 'TV-11',
    title: '实例描述符与用户档案文档签名(两个域分隔前缀)',
    spec_refs: ['§6.1'],
    cases: [
      buildSignedCase({
        caseId: 'TV-11a',
        description: 'GET /.well-known/openmew/instance descriptor document, signed by the instance active key.',
        domainPrefix: DOMAIN.instanceDescriptor,
        object: descriptor,
        signer: keys.aKey1,
      }),
      buildSignedCase({
        caseId: 'TV-11b',
        description: 'GET /.well-known/openmew/users/alice profile document, signed by the instance active key.',
        domainPrefix: DOMAIN.userProfile,
        object: profile,
        signer: keys.aKey1,
      }),
    ],
  });
}

// ===========================================================================
// TV-12 -- federated request signature (openmew/request/v1)
// ===========================================================================
{
  const requestObj = {
    method: 'GET',
    path: '/rooms/sh01/ch/general/history',
    query: 'before=100&limit=50',
    origin: 'b.example',
    on_behalf_of: '@bob:b.example',
    ts: T0,
    nonce: b64url(testNonceBytes('tv12-request')),
  };
  const built = buildSignedCase({
    caseId: 'TV-12',
    description: 'Federated GET request signature for a history-backfill call from b.example on behalf of @bob:b.example.',
    domainPrefix: DOMAIN.request,
    object: requestObj,
    signer: keys.bKey1,
  });
  built.authorization_header =
    `OpenMew key_id=${keys.bKey1.keyId},ts=${requestObj.ts},nonce=${requestObj.nonce},` +
    `on_behalf_of=${encodeURIComponent(requestObj.on_behalf_of)},sig=${built.signature}`;
  vectors.push({
    id: 'TV-12',
    title: '联邦请求签名(openmew/request/v1)',
    spec_refs: ['§8.3.1'],
    cases: [built],
  });
}

// ===========================================================================
// TV-13 -- ownership key rotation chain (3 generations) + broken-chain MUST-fail
// ===========================================================================
{
  const created1 = T0 - 60 * 86400000;
  const created2 = T0 - 20 * 86400000;
  const created3 = T0 - 1 * 86400000;

  const rotation2Input = {
    actor: '@alice:a.example',
    key_id: ownershipKeys.alice2.keyId,
    public_key: b64url(ownershipKeys.alice2.rawPublicKey),
    created_at: created2,
    prev_key_id: ownershipKeys.alice1.keyId,
  };
  const rotation2Case = buildSignedCase({
    caseId: 'TV-13a',
    description: 'Ownership key generation-2 continuity signature, signed by generation-1 ownership private key.',
    domainPrefix: DOMAIN.ownership,
    object: rotation2Input,
    signer: ownershipKeys.alice1,
  });

  const rotation3Input = {
    actor: '@alice:a.example',
    key_id: ownershipKeys.alice3.keyId,
    public_key: b64url(ownershipKeys.alice3.rawPublicKey),
    created_at: created3,
    prev_key_id: ownershipKeys.alice2.keyId,
  };
  const rotation3Case = buildSignedCase({
    caseId: 'TV-13b',
    description: 'Ownership key generation-3 continuity signature, signed by generation-2 ownership private key.',
    domainPrefix: DOMAIN.ownership,
    object: rotation3Input,
    signer: ownershipKeys.alice2,
  });

  const keyHistory = [
    { key_id: ownershipKeys.alice1.keyId, public_key: b64url(ownershipKeys.alice1.rawPublicKey), created_at: created1 },
    {
      key_id: ownershipKeys.alice2.keyId,
      public_key: b64url(ownershipKeys.alice2.rawPublicKey),
      created_at: created2,
      prev_key_id: ownershipKeys.alice1.keyId,
      continuity_sig: rotation2Case.signature,
    },
    {
      key_id: ownershipKeys.alice3.keyId,
      public_key: b64url(ownershipKeys.alice3.rawPublicKey),
      created_at: created3,
      prev_key_id: ownershipKeys.alice2.keyId,
      continuity_sig: rotation3Case.signature,
    },
  ];

  // MUST-fail companion: tamper with generation-3's continuity_sig (swap in
  // generation-2's signature bytes) -- chain verification MUST reject.
  const tamperedKeyHistory = keyHistory.map((entry, i) => (i === 2 ? { ...entry, continuity_sig: rotation2Case.signature } : entry));
  const tamperedVerifies = ed25519Verify(
    ownershipKeys.alice2.rawPublicKey,
    signingInputBytes(DOMAIN.ownership, rotation3Input),
    Buffer.from(tamperedKeyHistory[2].continuity_sig, 'base64url'),
  );
  if (tamperedVerifies) throw new Error('TV-13c: tampered continuity_sig unexpectedly verified');

  vectors.push({
    id: 'TV-13',
    title: '所有权密钥轮换链(三代)与 key_history 校验(openmew/ownership/v1)',
    spec_refs: ['§6.7'],
    key_history: keyHistory,
    cases: [
      rotation2Case,
      rotation3Case,
      {
        case_id: 'TV-13c',
        description:
          'MUST-fail: key_history[2].continuity_sig replaced with generation-2\'s own continuity_sig ' +
          '(chain-break simulation). Verifying it against generation-3\'s continuity_input under ' +
          'generation-2\'s public key MUST fail.',
        domain_prefix: DOMAIN.ownership,
        object: rotation3Input,
        canonical_jcs_hex: jcsCanonicalizeBytes(rotation3Input).toString('hex'),
        signing_input_hex: signingInputBytes(DOMAIN.ownership, rotation3Input).toString('hex'),
        key_id: ownershipKeys.alice2.keyId,
        public_key: b64url(ownershipKeys.alice2.rawPublicKey),
        signature: tamperedKeyHistory[2].continuity_sig,
        expected: 'reject',
        reject_reason: 'OMEW_OWNERSHIP_PROOF_INVALID',
      },
    ],
  });
}

// ===========================================================================
// TV-14 -- migration claim signature + cross-edge replay rejection
// ===========================================================================
{
  const old = '@alice:a.example';
  const newActor = '@alice:c.example';
  const signedAt = T0;

  function migrationClaim(caseIdPrefix, challengeOrigin, nonceLabel) {
    const claim = {
      old,
      new: newActor,
      nonce: b64url(testNonceBytes(nonceLabel)),
      challenge_origin: challengeOrigin,
      signed_at: signedAt,
    };
    return buildSignedCase({
      caseId: caseIdPrefix,
      description: `Migration claim_input for edge challenge_origin=${challengeOrigin}, signed by the ownership chain tail (generation 3).`,
      domainPrefix: DOMAIN.migrationClaim,
      object: claim,
      signer: ownershipKeys.alice3,
    });
  }

  const edgeB = migrationClaim('TV-14a', 'b.example', 'tv14-edge-b');
  const edgeD = migrationClaim('TV-14b', 'd.example', 'tv14-edge-d');

  // Cross-edge replay: edge B's signature MUST NOT verify against edge D's
  // signing_input (different challenge_origin/nonce), even though it is the
  // same actor, same key, same `old`/`new`, same signed_at.
  const replayVerifies = ed25519Verify(
    ownershipKeys.alice3.rawPublicKey,
    Buffer.from(edgeD.signing_input_hex, 'hex'),
    Buffer.from(edgeB.signature, 'base64url'),
  );
  if (replayVerifies) throw new Error('TV-14c: cross-edge replay unexpectedly verified');

  vectors.push({
    id: 'TV-14',
    title: '迁移证明签名与跨边重放拒绝(openmew/migration-claim/v1,两条边各一份 nonce)',
    spec_refs: ['§7.8.1'],
    cases: [
      edgeB,
      edgeD,
      {
        case_id: 'TV-14c',
        description:
          'MUST-fail: edge B\'s proof signature replayed against edge D\'s claim_input (different ' +
          'challenge_origin and nonce). Verification MUST fail, proving a single proof cannot cross edges.',
        domain_prefix: DOMAIN.migrationClaim,
        object: { old, new: newActor, nonce: b64url(testNonceBytes('tv14-edge-d')), challenge_origin: 'd.example', signed_at: signedAt },
        canonical_jcs_hex: jcsCanonicalizeBytes({
          old,
          new: newActor,
          nonce: b64url(testNonceBytes('tv14-edge-d')),
          challenge_origin: 'd.example',
          signed_at: signedAt,
        }).toString('hex'),
        signing_input_hex: edgeD.signing_input_hex,
        key_id: ownershipKeys.alice3.keyId,
        public_key: b64url(ownershipKeys.alice3.rawPublicKey),
        signature: edgeB.signature,
        expected: 'reject',
        reject_reason: 'cross_edge_replay',
      },
    ],
  });
}

// ===========================================================================
// TV-15 -- user.moved dual-path envelopes: dual_sign (+ nested home_release) and disaster (+ objection freeze)
// ===========================================================================
{
  const old = '@alice:a.example';
  const newActor = '@alice:c.example';

  // Self-registration proof alice submits to the new home C itself (§7.8.1:
  // "C 侧受理迁移前 MUST 以同一流程验证发起者"), reused as payload.proof.
  const cSelfClaim = {
    old,
    new: newActor,
    nonce: b64url(testNonceBytes('tv15-edge-c-self')),
    challenge_origin: 'c.example',
    signed_at: T0 - 3600000,
  };
  const cSelfClaimSig = ed25519Sign(ownershipKeys.alice3.privateKey, signingInputBytes(DOMAIN.migrationClaim, cSelfClaim));
  const proofObject = {
    ...cSelfClaim,
    ownership_key_id: ownershipKeys.alice3.keyId,
    key_history: [
      { key_id: ownershipKeys.alice1.keyId, public_key: b64url(ownershipKeys.alice1.rawPublicKey) },
      { key_id: ownershipKeys.alice2.keyId, public_key: b64url(ownershipKeys.alice2.rawPublicKey), prev_key_id: ownershipKeys.alice1.keyId },
      { key_id: ownershipKeys.alice3.keyId, public_key: b64url(ownershipKeys.alice3.rawPublicKey), prev_key_id: ownershipKeys.alice2.keyId },
    ],
    sig: b64url(cSelfClaimSig),
  };

  // --- dual_sign path ---
  const homeReleaseTs = T0 - 86400000; // 1 day before the outer announcement; well within the 30-day freshness bound (§7.8.2)
  const homeReleaseEnvelope = {
    v: 1,
    id: testUuidV7('tv15-home-release'),
    type: 'user.update',
    origin: 'a.example',
    actor: old,
    ts: homeReleaseTs,
    payload: { profile_version: 4, moved_to: newActor },
    key_id: keys.aKey1.keyId,
  };
  const homeReleaseCase = buildSignedCase({
    caseId: 'TV-15a-nested',
    description: 'Nested home_release: A\'s own signed user.update envelope with moved_to=new, evidence only (not a delivered event).',
    domainPrefix: DOMAIN.event,
    object: homeReleaseEnvelope,
    signer: keys.aKey1,
  });

  const dualSignReceivedAt = T0; // simulated peer receipt time used for the 30-day freshness check on the nested envelope
  const dualSignEnvelope = {
    v: 1,
    id: testUuidV7('tv15-dual-sign'),
    type: 'user.moved',
    origin: 'c.example',
    actor: newActor,
    ts: T0,
    payload: {
      old,
      new: newActor,
      mode: 'dual_sign',
      proof: proofObject,
      home_release: homeReleaseCase.object,
      effective_at: T0,
    },
    key_id: keys.cKey1.keyId,
  };
  const dualSignCase = buildSignedCase({
    caseId: 'TV-15a',
    description: 'user.moved, mode=dual_sign, broadcast by new home c.example, carrying a verified nested home_release from a.example.',
    domainPrefix: DOMAIN.event,
    object: dualSignEnvelope,
    signer: keys.cKey1,
  });
  dualSignCase.nested_home_release_check = {
    nested_origin_equals_old_domain: homeReleaseEnvelope.origin === old.split(':')[1],
    received_at_ms: dualSignReceivedAt,
    nested_ts_ms: homeReleaseTs,
    age_ms: dualSignReceivedAt - homeReleaseTs,
    freshness_ceiling_ms: 30 * 86400000,
    expected: 'accept',
  };

  // --- disaster path + objection freeze ---
  const disasterTs = T0 + 5000;
  const disasterEnvelope = {
    v: 1,
    id: testUuidV7('tv15-disaster'),
    type: 'user.moved',
    origin: 'c.example',
    actor: newActor,
    ts: disasterTs,
    payload: {
      old,
      new: newActor,
      mode: 'disaster',
      proof: proofObject,
      effective_at: disasterTs + 604800000, // +7d public notice period, §7.8.2
    },
    key_id: keys.cKey1.keyId,
  };
  const disasterCase = buildSignedCase({
    caseId: 'TV-15b',
    description: 'user.moved, mode=disaster (no home_release): recorded pending, effective_at = ts + 7d.',
    domainPrefix: DOMAIN.event,
    object: disasterEnvelope,
    signer: keys.cKey1,
  });

  const objectionEnvelope = {
    v: 1,
    id: testUuidV7('tv15-objection'),
    type: 'user.move_objection',
    origin: 'a.example',
    actor: old,
    ts: disasterTs + 3600000, // 1h after the disaster announcement, still within the 7d notice window
    payload: { target_id: disasterEnvelope.id, reason: 'old home disputes this migration' },
    key_id: keys.aKey1.keyId,
  };
  const objectionCase = buildSignedCase({
    caseId: 'TV-15c',
    description: 'user.move_objection from old home a.example, target_id matches the disaster user.moved, arrives within the 7d notice window.',
    domainPrefix: DOMAIN.event,
    object: objectionEnvelope,
    signer: keys.aKey1,
  });

  vectors.push({
    id: 'TV-15',
    title: 'user.moved 双路径信封:dual_sign 含嵌套 home_release 验签、disaster 含公示期与异议冻结',
    spec_refs: ['§7.8.2', '§7.8.3'],
    cases: [
      homeReleaseCase,
      dualSignCase,
      disasterCase,
      objectionCase,
      {
        case_id: 'TV-15d',
        description:
          'MUST-fail (state-machine, not signature): a second disaster-path migration proof for the same ' +
          '`old` actor, submitted after a matching, in-window user.move_objection was recorded, MUST be ' +
          'rejected 409 OMEW_MIGRATION_FROZEN regardless of signature validity.',
        state_machine_check: {
          old,
          disaster_moved_id: disasterEnvelope.id,
          disaster_effective_at: disasterEnvelope.payload.effective_at,
          objection_target_id: objectionEnvelope.payload.target_id,
          objection_received_at: objectionEnvelope.ts,
          second_disaster_attempt_at: disasterTs + 7200000,
        },
        expected: 'reject',
        reject_reason: 'OMEW_MIGRATION_FROZEN',
      },
    ],
  });
}

// ---------------------------------------------------------------------------
// Assemble and write output
// ---------------------------------------------------------------------------

const output = {
  meta: {
    protocol_version: 1,
    spec_file: 'docs/m0-protocol-draft.md',
    generator: 'scripts/gen-vectors.mjs',
    generated_note:
      'All timestamps are fixed constants, not wall-clock. All key material is deterministically ' +
      'derived TEST ONLY material (see scripts/gen-vectors.mjs testSeed/testNonceBytes/testUuidV7). ' +
      'Do not reuse any key, nonce or id from this file outside conformance testing.',
    jcs_implementation:
      'Self-implemented: recursive key-sorted clone (UTF-16 code unit order) followed by native ' +
      'JSON.stringify, relying on V8 already implementing RFC 8785-compatible ECMA-262 number/string ' +
      'serialization for the JSON-integer-only, ASCII-plus-escaped-control-char content used throughout ' +
      'these vectors. See the comment block in scripts/gen-vectors.mjs for the full justification.',
    signature_algorithm: 'Ed25519 (RFC 8032) via node:crypto (WebCrypto algorithm identifier "Ed25519"; NODE-ED25519 is not used)',
    domain_prefixes: DOMAIN,
  },
  keys: {
    'a.example#key-1': { instance: 'a.example', key_id: keys.aKey1.keyId, public_key: b64url(keys.aKey1.rawPublicKey), role: 'instance signing key' },
    'a.example#key-2': { instance: 'a.example', key_id: keys.aKey2.keyId, public_key: b64url(keys.aKey2.rawPublicKey), role: 'instance signing key (rotation gen 2)' },
    'a.example#key-3': { instance: 'a.example', key_id: keys.aKey3.keyId, public_key: b64url(keys.aKey3.rawPublicKey), role: 'instance signing key (rotation gen 3)' },
    'b.example#key-1': { instance: 'b.example', key_id: keys.bKey1.keyId, public_key: b64url(keys.bKey1.rawPublicKey), role: 'instance signing key' },
    'c.example#key-1': { instance: 'c.example', key_id: keys.cKey1.keyId, public_key: b64url(keys.cKey1.rawPublicKey), role: 'instance signing key' },
    'd.example#key-1': { instance: 'd.example', key_id: keys.dKey1.keyId, public_key: b64url(keys.dKey1.rawPublicKey), role: 'instance signing key' },
    '@alice:a.example#ownership-1': { actor: '@alice:a.example', key_id: ownershipKeys.alice1.keyId, public_key: b64url(ownershipKeys.alice1.rawPublicKey), role: 'ownership key generation 1' },
    '@alice:a.example#ownership-2': { actor: '@alice:a.example', key_id: ownershipKeys.alice2.keyId, public_key: b64url(ownershipKeys.alice2.rawPublicKey), role: 'ownership key generation 2' },
    '@alice:a.example#ownership-3': { actor: '@alice:a.example', key_id: ownershipKeys.alice3.keyId, public_key: b64url(ownershipKeys.alice3.rawPublicKey), role: 'ownership key generation 3 (chain tail)' },
  },
  vectors,
};

fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
fs.writeFileSync(OUT_PATH, JSON.stringify(output, null, 2) + '\n', 'utf8');

const caseCount = vectors.reduce((n, v) => n + v.cases.length, 0);
console.log(`wrote ${OUT_PATH}`);
console.log(`${vectors.length} vector groups (TV-01..TV-15), ${caseCount} cases total`);
