// M1 dev-token stub: HMAC-signed compact tokens issued directly by this instance.
// Not the m0-protocol Ed25519 signing scheme (that lands in M2 for local events and
// M6 for federation SSO assertions). No plaintext credentials are ever stored or sent.

function base64UrlEncode(bytes: Uint8Array): string {
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
