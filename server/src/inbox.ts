// Federation Inbox placeholder. Full envelope processing (m0-protocol S2.4 verify
// pipeline, S6 key discovery, S3 event application) is M5+/M6 scope. This only
// exposes the protocol route but deliberately does not consume untrusted bodies
// until the verification pipeline exists. Declared oversize bodies are rejected
// from headers; every other POST fails closed with 501 before reading a byte.

const MAX_ENVELOPE_BYTES = 64 * 1024; // m0-protocol S2.1.

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

  // The header precheck is safe without touching the body. Missing or dishonest
  // lengths are harmless while the endpoint short-circuits before body reads.
  const contentLength = request.headers.get("Content-Length");
  if (contentLength && Number(contentLength) > MAX_ENVELOPE_BYTES) {
    return errorBody(413, "OMEW_ENVELOPE_TOO_LARGE", "envelope exceeds 64 KiB");
  }

  // M5 must add a durable rate-limit binding and a streaming bounded reader in
  // the same change that enables parsing. Until then, do not consume the body.
  return errorBody(501, "OMEW_NOT_IMPLEMENTED", "federation inbox is not implemented in M1");
}
