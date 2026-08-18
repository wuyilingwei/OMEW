// Federation Inbox placeholder. Full envelope processing (m0-protocol S2.4 verify
// pipeline, S6 key discovery, S3 event application) is M5+/M6 scope. This only
// wires up the pre-parse gate the spec requires envelopes to clear before any
// parsing or outbound fetch happens (S2.4: rate limit -> size check -> parse),
// then reports 501 - the shape exists, the processing behind it does not.

const MAX_ENVELOPE_BYTES = 64 * 1024; // m0-protocol S2.1.

// Per-isolate token bucket. Not durable across isolate recycling or shared across
// colo instances - a real deployment needs this backed by something durable
// (e.g. a rate-limiting DO keyed by peer IP/origin) before M5. Documented gap.
const buckets = new Map<string, { tokens: number; last: number }>();
const BUCKET_CAPACITY = 30;
const BUCKET_REFILL_PER_SEC = 5;

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const bucket = buckets.get(ip) ?? { tokens: BUCKET_CAPACITY, last: now };
  const elapsedSec = (now - bucket.last) / 1000;
  bucket.tokens = Math.min(BUCKET_CAPACITY, bucket.tokens + elapsedSec * BUCKET_REFILL_PER_SEC);
  bucket.last = now;
  if (bucket.tokens < 1) {
    buckets.set(ip, bucket);
    return true;
  }
  bucket.tokens -= 1;
  buckets.set(ip, bucket);
  return false;
}

function errorBody(status: number, code: string, message: string): Response {
  return new Response(JSON.stringify({ error: { code, message } }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export async function handleInbox(request: Request, _env: Env): Promise<Response> {
  if (request.method !== "POST") {
    return errorBody(405, "OMEW_METHOD_NOT_ALLOWED", "inbox only accepts POST");
  }

  // m0-protocol S2.4: rate_limit MUST run before any parsing or outbound request.
  const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
  if (rateLimited(ip)) {
    return errorBody(429, "OMEW_RATE_LIMITED", "too many requests");
  }

  // m0-protocol S2.1: envelope MUST NOT exceed 64 KiB, checked before parsing.
  const contentLength = request.headers.get("Content-Length");
  if (contentLength && Number(contentLength) > MAX_ENVELOPE_BYTES) {
    return errorBody(413, "OMEW_ENVELOPE_TOO_LARGE", "envelope exceeds 64 KiB");
  }
  // Content-Length can be absent or wrong; enforce the same cap on the actual body
  // without buffering past it.
  const body = await request.arrayBuffer();
  if (body.byteLength > MAX_ENVELOPE_BYTES) {
    return errorBody(413, "OMEW_ENVELOPE_TOO_LARGE", "envelope exceeds 64 KiB");
  }

  // Everything past this point - JCS canonicalization, Ed25519 verification, peer
  // key lookup, dedup, event application - is not implemented yet.
  return errorBody(501, "OMEW_NOT_IMPLEMENTED", "federation inbox is not implemented in M1");
}
