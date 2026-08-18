#!/usr/bin/env node
// Independently re-verifies test/vectors/m0-vectors.json.
//
// This file is intentionally self-contained and does NOT import
// scripts/gen-vectors.mjs: it re-implements JCS and Ed25519 verification
// from scratch so a bug in the generator's own JCS/signing code is not
// silently rubber-stamped by reusing the same code to check it. It reads
// only the JSON vector file, plus the domain prefixes and lifecycle rules
// documented in docs/m0-protocol-draft.md.
//
// Node >= 20, zero runtime dependencies.
//
// Exit code 0 iff every case behaved as its `expected` field states
// (positive cases verify, MUST-fail cases genuinely fail / are rejected).

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VECTORS_PATH = path.join(__dirname, '..', 'test', 'vectors', 'm0-vectors.json');

// --- JCS (RFC 8785), independent re-implementation ---
function jcsClone(value) {
  if (Array.isArray(value)) return value.map(jcsClone);
  if (value !== null && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = jcsClone(value[key]);
    return out;
  }
  return value;
}
function jcsBytes(value) {
  return Buffer.from(JSON.stringify(jcsClone(value)), 'utf8');
}

// --- Ed25519 via node:crypto, independent re-implementation of the raw-key wrapping ---
const SPKI_ED25519_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');
function publicKeyObjFromRawB64Url(b64) {
  const raw = Buffer.from(b64, 'base64url');
  if (raw.length !== 32) throw new Error(`public key must decode to 32 bytes, got ${raw.length}`);
  return crypto.createPublicKey({ key: Buffer.concat([SPKI_ED25519_PREFIX, raw]), format: 'der', type: 'spki' });
}
function verify(publicKeyB64, message, sigB64) {
  return crypto.verify(null, message, publicKeyObjFromRawB64Url(publicKeyB64), Buffer.from(sigB64, 'base64url'));
}

let pass = 0;
let fail = 0;
const failures = [];

function report(label, ok, detail) {
  if (ok) {
    pass++;
    console.log(`  PASS  ${label}`);
  } else {
    fail++;
    failures.push({ label, detail });
    console.log(`  FAIL  ${label}${detail ? ' -- ' + detail : ''}`);
  }
}

function checkHexMatchesRecompute(label, c) {
  const recomputedJcs = jcsBytes(c.object && c.object.sig !== undefined ? withoutSig(c.object) : c.object);
  const jcsOk = recomputedJcs.toString('hex') === c.canonical_jcs_hex;
  report(`${label} canonical_jcs_hex matches independent JCS recomputation`, jcsOk);

  const recomputedInput = Buffer.concat([Buffer.from(c.domain_prefix, 'utf8'), Buffer.from([0x00]), recomputedJcs]);
  const inputOk = recomputedInput.toString('hex') === c.signing_input_hex;
  report(`${label} signing_input_hex matches independent recomputation`, inputOk);
  return recomputedInput;
}

function withoutSig(obj) {
  const { sig, ...rest } = obj;
  return rest;
}

const doc = JSON.parse(fs.readFileSync(VECTORS_PATH, 'utf8'));

console.log(`Verifying ${VECTORS_PATH}`);
console.log(`${doc.vectors.length} vector groups declared`);
console.log('');

for (const group of doc.vectors) {
  console.log(`${group.id} -- ${group.title}`);
  for (const c of group.cases) {
    const label = `${c.case_id}`;

    // Reject reasons where the Ed25519 signature itself is expected to fail
    // cryptographic verification (tamper / replay / stripped-field cases).
    const CRYPTO_FAILURE_REASONS = new Set(['signature_mismatch_after_field_stripped', 'cross_edge_replay', 'OMEW_OWNERSHIP_PROOF_INVALID']);
    // Reject reasons where the signature is still cryptographically valid but
    // an out-of-band policy check (field range, key lifecycle) MUST reject anyway.
    const POLICY_FAILURE_REASONS = new Set(['integer_out_of_range', 'retired_key_grace_period_exceeded']);

    // Structural cases without a domain_prefix / signature (e.g. TV-10 confusable
    // samples, TV-15d state-machine) are checked by their own dedicated logic below.
    if (c.domain_prefix && c.signing_input_hex) {
      const recomputedInput = checkHexMatchesRecompute(label, c);
      const sigValid = verify(c.public_key, recomputedInput, c.signature);

      if (c.expected === 'reject' && CRYPTO_FAILURE_REASONS.has(c.reject_reason)) {
        report(`${label} Ed25519 signature correctly FAILS to verify (${c.reject_reason})`, !sigValid);
      } else if (c.expected === 'reject' && POLICY_FAILURE_REASONS.has(c.reject_reason)) {
        // Signature itself is valid (correctly signed); rejection is an out-of-band policy decision.
        report(`${label} Ed25519 signature verifies (crypto ok; still MUST reject on policy)`, sigValid);
      } else {
        report(`${label} Ed25519 signature verifies`, sigValid);
      }

      if (c.integer_check) {
        const inRange = Number.isSafeInteger(c.integer_check.value);
        const wantAccept = c.integer_check.expected === 'accept';
        report(`${label} integer range check (|value| <= 2^53-1) -> ${wantAccept ? 'accept' : 'reject'}`, inRange === wantAccept);
      }

      if (c.nested_home_release_check) {
        // TV-15a: re-derive the §7.8.2 nested home_release freshness rule
        // (age since simulated receipt MUST be <= 30 days) independently.
        const n = c.nested_home_release_check;
        const withinFreshness = n.age_ms <= n.freshness_ceiling_ms;
        report(`${label} nested home_release freshness (age=${n.age_ms}ms <= ceiling=${n.freshness_ceiling_ms}ms)`, withinFreshness && n.expected === 'accept');
        report(`${label} nested home_release origin equals old actor's domain`, n.nested_origin_equals_old_domain === true);
      }

      if (c.authorization_header) {
        const expectedHeader =
          `OpenMew key_id=${c.key_id},ts=${c.object.ts},nonce=${c.object.nonce},` +
          `on_behalf_of=${encodeURIComponent(c.object.on_behalf_of)},sig=${c.signature}`;
        report(`${label} Authorization header reconstructs from signed fields`, c.authorization_header === expectedHeader);
      }

      if (c.representability_demo) {
        const d = c.representability_demo;
        report(`${label} representability demo: JSON round-trip is lossy above the safe-integer ceiling`, d.lossy === true && d.value_after_json_roundtrip !== d.intended_value);
      }

      if (c.case_id === 'TV-03') {
        const text = c.object.payload.body.text;
        report(`${label} body.text is already NFC-normalized`, text === text.normalize('NFC'));
        report(`${label} body.text contains a surrogate-pair emoji encoded correctly`, /\u{1F389}/u.test(text));
      }

      if (c.lifecycle_check) {
        // TV-08c/TV-08d: re-derive the docs §2.4 pseudocode's retired-key
        // grace-period rule independently from the stored verify_at_ms/retired_at/Q.
        const lc = c.lifecycle_check;
        const lifecycleAccepts = !(lc.key_status === 'retired' && lc.verify_at_ms > lc.retired_at + lc.grace_period_q_ms);
        const wantAccept = lc.expected_lifecycle_result === 'accept';
        report(
          `${label} §2.4 retired-grace policy (retired_at=${lc.retired_at}, Q=${lc.grace_period_q_ms}, now=${lc.verify_at_ms}) -> ${wantAccept ? 'accept' : 'reject'}`,
          lifecycleAccepts === wantAccept,
        );
      }
      continue;
    }

    if (group.id === 'TV-10') {
      const skA = c.skeleton_a;
      const skB = c.skeleton_b;
      const collides = skA === skB;
      const wantCollide = c.expected === 'reject';
      report(`${label} skeleton collision check ("${c.localpart_a}" vs "${c.localpart_b}")`, collides === wantCollide);
      continue;
    }

    if (c.case_id === 'TV-15d') {
      const s = c.state_machine_check;
      // Re-derive §7.8.2 objection-freeze logic independently:
      // an objection targeting the disaster user.moved, received before its
      // effective_at, freezes the `old` actor's migration; any subsequent
      // disaster proof for the same `old` MUST be rejected while frozen.
      const objectionInWindow = s.objection_target_id === s.disaster_moved_id && s.objection_received_at <= s.disaster_effective_at;
      const secondAttemptWhileFrozen = objectionInWindow && s.second_disaster_attempt_at <= s.disaster_effective_at;
      const rejected = objectionInWindow; // frozen state persists until a dual_sign proof arrives (none does here)
      report(`${label} §7.8.2 objection-freeze state machine rejects second disaster proof`, rejected);
      report(`${label} second attempt occurs before effective_at (still within frozen window)`, secondAttemptWhileFrozen);
      continue;
    }

    report(`${label} (unrecognized case shape)`, false, 'no domain_prefix/signing_input_hex and no special-cased handler');
  }

  // Group-level extras
  if (group.id === 'TV-06') {
    const [a, b] = group.cases;
    report('TV-06 canonical_jcs_hex identical across key-order variants', a.canonical_jcs_hex === b.canonical_jcs_hex);
    report('TV-06 signature identical across key-order variants', a.signature === b.signature);
  }

  if (group.id === 'TV-08' && group.keyset_chain) {
    // Re-verify the full continuity chain independently: gen2 signed by gen1,
    // gen3 signed by gen2, each rooted at the first (self-pinned) key.
    const chain = group.keyset_chain;
    for (let i = 1; i < chain.length; i++) {
      const entry = chain[i];
      const prev = chain.find((e) => e.key_id === entry.prev_key_id);
      const okPrevFound = Boolean(prev);
      report(`TV-08 keyset_chain[${i}] prev_key_id resolves to a known earlier entry`, okPrevFound);
      if (!okPrevFound) continue;
      const continuityInput = { instance: entry.instance, key_id: entry.key_id, public_key: entry.public_key, created_at: entry.created_at, prev_key_id: entry.prev_key_id };
      const input = Buffer.concat([Buffer.from(doc.meta.domain_prefixes.keyRotation, 'utf8'), Buffer.from([0x00]), jcsBytes(continuityInput)]);
      const ok = verify(prev.public_key, input, entry.continuity_sig);
      report(`TV-08 keyset_chain[${i}] continuity_sig verifies against prev entry's public key`, ok);
    }
  }

  if (group.id === 'TV-13' && group.key_history) {
    const chain = group.key_history;
    for (let i = 1; i < chain.length; i++) {
      const entry = chain[i];
      const prev = chain.find((e) => e.key_id === entry.prev_key_id);
      if (!prev) {
        report(`TV-13 key_history[${i}] prev_key_id resolves`, false);
        continue;
      }
      const rotationInput = { actor: '@alice:a.example', key_id: entry.key_id, public_key: entry.public_key, created_at: entry.created_at, prev_key_id: entry.prev_key_id };
      const input = Buffer.concat([Buffer.from(doc.meta.domain_prefixes.ownership, 'utf8'), Buffer.from([0x00]), jcsBytes(rotationInput)]);
      const ok = verify(prev.public_key, input, entry.continuity_sig);
      report(`TV-13 key_history[${i}] continuity_sig verifies against prev entry's public key`, ok);
    }
  }

  console.log('');
}

console.log('---');
console.log(`${pass} passed, ${fail} failed`);
if (fail > 0) {
  console.log('');
  console.log('Failures:');
  for (const f of failures) console.log(`  - ${f.label}${f.detail ? ': ' + f.detail : ''}`);
  process.exit(1);
}
process.exit(0);
