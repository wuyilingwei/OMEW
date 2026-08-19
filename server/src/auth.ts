// Session/room token mechanism: HMAC-signed compact tokens issued directly by this
// instance once a password has been verified (see users.ts for registration/login).
// Not the m0-protocol Ed25519 signing scheme (that lands in M2 for local events and
// M6 for federation SSO assertions). No plaintext credentials are ever stored or sent.

export function base64UrlEncode(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(str: string): Uint8Array {
  const padded = str.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((str.length + 3) % 4);
  const bin = atob(padded);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

export async function signToken<T extends object>(claims: T, secret: string): Promise<string> {
  const payload = base64UrlEncode(new TextEncoder().encode(JSON.stringify(claims)));
  const key = await hmacKey(secret);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return `${payload}.${base64UrlEncode(new Uint8Array(sig))}`;
}

export async function verifyToken<T extends { exp: number }>(
  token: string,
  secret: string
): Promise<T | null> {
  const dot = token.lastIndexOf(".");
  if (dot < 0) return null;
  const payload = token.slice(0, dot);
  const sigB64 = token.slice(dot + 1);
  const key = await hmacKey(secret);
  let sigBytes: Uint8Array;
  try {
    sigBytes = base64UrlDecode(sigB64);
  } catch {
    return null;
  }
  const ok = await crypto.subtle.verify(
    "HMAC",
    key,
    sigBytes,
    new TextEncoder().encode(payload)
  );
  if (!ok) return null;
  let claims: T;
  try {
    claims = JSON.parse(new TextDecoder().decode(base64UrlDecode(payload)));
  } catch {
    return null;
  }
  if (typeof claims.exp !== "number" || claims.exp * 1000 < Date.now()) return null;
  return claims;
}

export function newJti(): string {
  return crypto.randomUUID();
}

// Password hashing: WebCrypto PBKDF2-SHA256, random salt per user.
// Workers WebCrypto hard-caps PBKDF2 at 100k iterations (NotSupportedError above);
// local workerd does not enforce the cap, so only production surfaces it.
const PBKDF2_ITERATIONS = 100_000;
const PBKDF2_HASH_BITS = 256;
const SALT_BYTES = 16;

async function pbkdf2(password: string, salt: Uint8Array): Promise<Uint8Array> {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations: PBKDF2_ITERATIONS },
    keyMaterial,
    PBKDF2_HASH_BITS
  );
  return new Uint8Array(bits);
}

export async function hashPassword(password: string): Promise<{ hash: string; salt: string }> {
  const saltBytes = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const hashBytes = await pbkdf2(password, saltBytes);
  return { hash: base64UrlEncode(hashBytes), salt: base64UrlEncode(saltBytes) };
}

function timingSafeEqualStr(a: string, b: string): boolean {
  const aBytes = new TextEncoder().encode(a);
  const bBytes = new TextEncoder().encode(b);
  const len = Math.max(aBytes.length, bBytes.length);
  let diff = aBytes.length ^ bBytes.length;
  for (let i = 0; i < len; i++) {
    diff |= (aBytes[i] ?? 0) ^ (bBytes[i] ?? 0);
  }
  return diff === 0;
}

export async function verifyPassword(password: string, hash: string, salt: string): Promise<boolean> {
  const saltBytes = base64UrlDecode(salt);
  const computed = await pbkdf2(password, saltBytes);
  return timingSafeEqualStr(base64UrlEncode(computed), hash);
}

// Fixed, non-secret placeholder used when no user row exists, so login always pays
// the same PBKDF2 cost and never reveals account existence through timing.
export function dummyPasswordFields(): { hash: string; salt: string } {
  return { hash: "", salt: base64UrlEncode(new Uint8Array(SALT_BYTES)) };
}
