import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { apiRequest, ensureMigrated, loginAs, mediaUploadRequest, registerUser } from "./helpers";

// Media upload pipeline: Worker-proxied streaming write into R2, with size/MIME/
// quota enforced synchronously in the upload path (no presigned direct-to-R2
// upload - see agents/017 task notes for the architecture call). max_file_bytes
// / user_storage_quota_bytes are env config as of task 035 (server/src/config.ts).

const OWNERSHIP = { ownership_pubkey: "test-pubkey", ownership_ciphertext: "test-ciphertext-blob" };

let userCounter = 0;

async function freshUserToken(): Promise<string> {
  userCounter += 1;
  const username = `mediauser${userCounter}`;
  const { status, json } = await registerUser({ username, password: "password123", ...OWNERSHIP });
  expect(status).toBe(200);
  return json.token as string;
}

async function makeAdminToken(): Promise<string> {
  userCounter += 1;
  const username = `mediaadmin${userCounter}`;
  const { status, json } = await registerUser({ username, password: "password123", ...OWNERSHIP });
  expect(status).toBe(200);
  await env.DB.prepare("UPDATE users SET server_role = 'admin' WHERE localpart = ?").bind(username).run();
  return loginAs(username);
}

function setMediaLimits(overrides: { max_file_bytes?: number; user_storage_quota_bytes?: number }): void {
  if (overrides.max_file_bytes !== undefined) env.MAX_FILE_BYTES = String(overrides.max_file_bytes);
  if (overrides.user_storage_quota_bytes !== undefined) env.USER_STORAGE_QUOTA_BYTES = String(overrides.user_storage_quota_bytes);
}

function pngBytes(totalLen: number): Uint8Array {
  const bytes = new Uint8Array(totalLen);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  for (let i = 8; i < totalLen; i++) bytes[i] = i % 256;
  return bytes;
}

function jpegBytes(totalLen: number): Uint8Array {
  const bytes = new Uint8Array(totalLen);
  bytes.set([0xff, 0xd8, 0xff], 0);
  for (let i = 3; i < totalLen; i++) bytes[i] = i % 256;
  return bytes;
}

function plainTextBytes(totalLen: number): Uint8Array {
  const text = "definitely not an image or media file, just text bytes";
  const bytes = new Uint8Array(totalLen);
  for (let i = 0; i < totalLen; i++) bytes[i] = text.charCodeAt(i % text.length);
  return bytes;
}

beforeAll(async () => {
  await ensureMigrated();
});

describe("POST /api/media rejections", () => {
  it("enforces max_file_bytes: accepts at the limit, rejects one byte over with 413 FILE_TOO_LARGE", async () => {
    const token = await freshUserToken();
    await setMediaLimits({ max_file_bytes: 64, user_storage_quota_bytes: 1_000_000 });

    const atLimit = pngBytes(64);
    const okRes = await mediaUploadRequest({ token, contentType: "image/png", declaredLength: atLimit.byteLength, body: atLimit });
    expect(okRes.status).toBe(201);

    const overLimit = pngBytes(65);
    const res = await mediaUploadRequest({ token, contentType: "image/png", declaredLength: overLimit.byteLength, body: overLimit });
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: "FILE_TOO_LARGE" });
  });

  it("rejects a Content-Type outside the whitelist with 415 MIME_REJECTED", async () => {
    const token = await freshUserToken();
    await setMediaLimits({ max_file_bytes: 1_000_000, user_storage_quota_bytes: 1_000_000 });

    const body = plainTextBytes(16);
    const res = await mediaUploadRequest({ token, contentType: "application/pdf", declaredLength: body.byteLength, body });
    expect(res.status).toBe(415);
    expect(await res.json()).toEqual({ error: "MIME_REJECTED" });
  });

  it("enforces the storage quota: accepts an upload that exactly fills it, rejects the next byte over with 413 QUOTA_EXCEEDED", async () => {
    const token = await freshUserToken();
    await setMediaLimits({ max_file_bytes: 1_000_000, user_storage_quota_bytes: 1000 });

    const first = pngBytes(400);
    const firstRes = await mediaUploadRequest({ token, contentType: "image/png", declaredLength: first.byteLength, body: first });
    expect(firstRes.status).toBe(201);

    const exactFill = pngBytes(600);
    const fillRes = await mediaUploadRequest({ token, contentType: "image/png", declaredLength: exactFill.byteLength, body: exactFill });
    expect(fillRes.status).toBe(201);

    const oneMore = pngBytes(8);
    const overRes = await mediaUploadRequest({ token, contentType: "image/png", declaredLength: oneMore.byteLength, body: oneMore });
    expect(overRes.status).toBe(413);
    expect(await overRes.json()).toEqual({ error: "QUOTA_EXCEEDED" });
  });

  it("rejects a streaming upload without Content-Length before consuming the body", async () => {
    const token = await freshUserToken();
    await setMediaLimits({ max_file_bytes: 1_000_000, user_storage_quota_bytes: 1_000_000 });
    let pulls = 0;
    const body = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          pulls += 1;
          controller.enqueue(pngBytes(64));
          controller.close();
        },
      },
      { highWaterMark: 0 }
    );
    const res = await mediaUploadRequest({
      token,
      contentType: "image/png",
      declaredLength: null,
      body,
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "PAYLOAD_INVALID" });
    expect(pulls).toBe(0);
  });

  it("sniffs magic bytes, rejects a mismatched declared MIME with 415, and does not persist the object", async () => {
    const token = await freshUserToken();
    await setMediaLimits({ max_file_bytes: 1_000_000, user_storage_quota_bytes: 1_000_000 });

    // Declares image/png but the bytes are actually a JPEG.
    const body = jpegBytes(32);
    const res = await mediaUploadRequest({ token, contentType: "image/png", declaredLength: body.byteLength, body });
    expect(res.status).toBe(415);
    expect(await res.json()).toEqual({ error: "MIME_REJECTED" });

    const storage = (await (await apiRequest("/api/me/storage", { headers: { Authorization: `Bearer ${token}` } })).json()) as {
      used: number;
    };
    expect(storage.used).toBe(0);
  });
});

describe("POST /api/media success + GET /media/:id", () => {
  it("uploads a valid PNG, returns {id, url, size, mime}, and serves it back with immutable cache headers", async () => {
    const token = await freshUserToken();
    await setMediaLimits({ max_file_bytes: 1_000_000, user_storage_quota_bytes: 1_000_000 });

    const body = pngBytes(128);
    const res = await mediaUploadRequest({ token, contentType: "image/png", declaredLength: body.byteLength, body });
    expect(res.status).toBe(201);
    const created = (await res.json()) as { id: string; url: string; size: number; mime: string };
    expect(created.url).toBe(`/media/${created.id}`);
    expect(created.size).toBe(128);
    expect(created.mime).toBe("image/png");

    const getRes = await apiRequest(created.url, { headers: { Authorization: `Bearer ${token}` } });
    expect(getRes.status).toBe(200);
    expect(getRes.headers.get("Content-Type")).toBe("image/png");
    expect(getRes.headers.get("Cache-Control")).toBe("public, max-age=31536000, immutable");
    const fetched = new Uint8Array(await getRes.arrayBuffer());
    expect(fetched).toEqual(body);
  });

  it("serves a media object to an unauthenticated reader - the random id is the capability", async () => {
    const token = await freshUserToken();
    await setMediaLimits({ max_file_bytes: 1_000_000, user_storage_quota_bytes: 1_000_000 });

    const body = pngBytes(96);
    const uploadRes = await mediaUploadRequest({ token, contentType: "image/png", declaredLength: body.byteLength, body });
    const created = (await uploadRes.json()) as { url: string };

    const getRes = await apiRequest(created.url);
    expect(getRes.status).toBe(200);
    expect(getRes.headers.get("Content-Type")).toBe("image/png");
    expect(new Uint8Array(await getRes.arrayBuffer())).toEqual(body);
  });

  it("404s an unknown media id", async () => {
    const res = await apiRequest("/media/does-not-exist");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "NOT_FOUND" });
  });
});

describe("DELETE /api/media/:id", () => {
  it("lets the owner delete their upload and releases quota", async () => {
    const token = await freshUserToken();
    await setMediaLimits({ max_file_bytes: 1_000_000, user_storage_quota_bytes: 1_000_000 });

    const body = pngBytes(200);
    const uploadRes = await mediaUploadRequest({ token, contentType: "image/png", declaredLength: body.byteLength, body });
    const created = (await uploadRes.json()) as { id: string };

    const beforeStorage = (await (await apiRequest("/api/me/storage", { headers: { Authorization: `Bearer ${token}` } })).json()) as {
      used: number;
    };
    expect(beforeStorage.used).toBe(200);

    const delRes = await apiRequest(`/api/media/${created.id}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
    expect(delRes.status).toBe(204);

    const afterStorage = (await (await apiRequest("/api/me/storage", { headers: { Authorization: `Bearer ${token}` } })).json()) as {
      used: number;
    };
    expect(afterStorage.used).toBe(0);

    const getRes = await apiRequest(`/media/${created.id}`, { headers: { Authorization: `Bearer ${token}` } });
    expect(getRes.status).toBe(404);
  });

  it("rejects deletion by a non-owner, non-admin actor with 403 FORBIDDEN", async () => {
    const ownerToken = await freshUserToken();
    const otherToken = await freshUserToken();
    await setMediaLimits({ max_file_bytes: 1_000_000, user_storage_quota_bytes: 1_000_000 });

    const body = pngBytes(64);
    const uploadRes = await mediaUploadRequest({ token: ownerToken, contentType: "image/png", declaredLength: body.byteLength, body });
    const created = (await uploadRes.json()) as { id: string };

    const delRes = await apiRequest(`/api/media/${created.id}`, { method: "DELETE", headers: { Authorization: `Bearer ${otherToken}` } });
    expect(delRes.status).toBe(403);
    expect(await delRes.json()).toEqual({ error: "FORBIDDEN" });
  });

  it("lets an admin delete someone else's upload", async () => {
    const ownerToken = await freshUserToken();
    const adminToken = await makeAdminToken();
    await setMediaLimits({ max_file_bytes: 1_000_000, user_storage_quota_bytes: 1_000_000 });

    const body = pngBytes(64);
    const uploadRes = await mediaUploadRequest({ token: ownerToken, contentType: "image/png", declaredLength: body.byteLength, body });
    const created = (await uploadRes.json()) as { id: string };

    const delRes = await apiRequest(`/api/media/${created.id}`, { method: "DELETE", headers: { Authorization: `Bearer ${adminToken}` } });
    expect(delRes.status).toBe(204);
  });
});

describe("GET /api/me/storage", () => {
  it("reports used, quota and max_file", async () => {
    const token = await freshUserToken();
    await setMediaLimits({ max_file_bytes: 12345, user_storage_quota_bytes: 54321 });

    const res = await apiRequest("/api/me/storage", { headers: { Authorization: `Bearer ${token}` } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ used: 0, quota: 54321, max_file: 12345 });
  });
});

describe("admin instance config: media limits are env, not runtime-writable", () => {
  it("GET reflects the env-derived max_file_bytes and user_storage_quota_bytes", async () => {
    const adminToken = await makeAdminToken();
    setMediaLimits({ max_file_bytes: 5_000_000, user_storage_quota_bytes: 100_000_000 });

    const getRes = await apiRequest("/api/admin/instance/config", { headers: { Authorization: `Bearer ${adminToken}` } });
    const fetched = (await getRes.json()) as Record<string, unknown>;
    expect(fetched.max_file_bytes).toBe(5_000_000);
    expect(fetched.user_storage_quota_bytes).toBe(100_000_000);
    expect(fetched.source).toBe("env");
  });

  it("PATCH 409s with POLICY_IS_ENV instead of writing the limits", async () => {
    const adminToken = await makeAdminToken();
    const res = await apiRequest("/api/admin/instance/config", {
      method: "PATCH",
      headers: { Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ max_file_bytes: 5_000_000 }),
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "POLICY_IS_ENV" });
  });
});
