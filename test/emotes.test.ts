import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { apiRequest, ensureMigrated, loginAs, mediaUploadRequest, registerUser } from "./helpers";

// Emote packs/emotes: v1 is instance-level and admin-managed (see agents/018 task
// notes). Reads (GET /api/emotes) only require login; every write and the export/
// import surface sits under /api/admin/* and requires server_role admin or owner
// (§7.10). :pack:name: rendering in message/post bodies is a web-side concern -
// this API stores and serves the catalog only.

const OWNERSHIP = { ownership_pubkey: "test-pubkey", ownership_ciphertext: "test-ciphertext-blob" };

let userCounter = 0;

async function freshUserToken(): Promise<string> {
  userCounter += 1;
  const username = `emoteuser${userCounter}`;
  const { status, json } = await registerUser({ username, password: "password123", ...OWNERSHIP });
  expect(status).toBe(200);
  return json.token as string;
}

async function makeAdminToken(): Promise<string> {
  userCounter += 1;
  const username = `emoteadmin${userCounter}`;
  const { status, json } = await registerUser({ username, password: "password123", ...OWNERSHIP });
  expect(status).toBe(200);
  await env.DB.prepare("UPDATE users SET server_role = 'admin' WHERE localpart = ?").bind(username).run();
  return loginAs(username);
}

function pngBytes(totalLen: number): Uint8Array {
  const bytes = new Uint8Array(totalLen);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  for (let i = 8; i < totalLen; i++) bytes[i] = i % 256;
  return bytes;
}

async function uploadMedia(token: string): Promise<string> {
  const body = pngBytes(32);
  const res = await mediaUploadRequest({ token, contentType: "image/png", declaredLength: body.byteLength, body });
  expect(res.status).toBe(201);
  const created = (await res.json()) as { id: string };
  return created.id;
}

async function createPack(adminToken: string, name: string): Promise<{ id: string; name: string }> {
  const res = await apiRequest("/api/admin/emote-packs", {
    method: "POST",
    headers: { Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({ name }),
  });
  expect(res.status).toBe(201);
  return (await res.json()) as { id: string; name: string };
}

async function createEmote(adminToken: string, packId: string, name: string, mediaId: string) {
  return apiRequest(`/api/admin/emote-packs/${packId}/emotes`, {
    method: "POST",
    headers: { Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({ name, media_id: mediaId }),
  });
}

beforeAll(async () => {
  await ensureMigrated();
});

describe("GET /api/emotes", () => {
  it("requires auth", async () => {
    const res = await apiRequest("/api/emotes");
    expect(res.status).toBe(401);
  });

  it("is readable by any logged-in user and nests emotes with a /media/:id url", async () => {
    const adminToken = await makeAdminToken();
    const readerToken = await freshUserToken();
    const mediaId = await uploadMedia(adminToken);
    const pack = await createPack(adminToken, "kaobei");
    const emoteRes = await createEmote(adminToken, pack.id, "doge", mediaId);
    expect(emoteRes.status).toBe(201);

    const res = await apiRequest("/api/emotes", { headers: { Authorization: `Bearer ${readerToken}` } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { packs: Array<{ id: string; name: string; emotes: unknown[] }> };
    const found = body.packs.find((p) => p.id === pack.id);
    expect(found).toBeDefined();
    expect(found!.name).toBe("kaobei");
    expect(found!.emotes).toEqual([{ id: expect.any(String), name: "doge", media_id: mediaId, url: `/media/${mediaId}` }]);
  });
});

describe("POST /api/admin/emote-packs", () => {
  it("rejects a non-admin with 403", async () => {
    const token = await freshUserToken();
    const res = await apiRequest("/api/admin/emote-packs", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ name: "nope" }),
    });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "ADMIN_REQUIRED" });
  });

  it("creates a pack", async () => {
    const adminToken = await makeAdminToken();
    const res = await apiRequest("/api/admin/emote-packs", {
      method: "POST",
      headers: { Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ name: "gudetama" }),
    });
    expect(res.status).toBe(201);
    const created = (await res.json()) as Record<string, unknown>;
    expect(created.name).toBe("gudetama");
    expect(created.emotes).toEqual([]);
    expect(created.id).toEqual(expect.any(String));
  });

  it("rejects a duplicate name with 409 PACK_NAME_TAKEN", async () => {
    const adminToken = await makeAdminToken();
    await createPack(adminToken, "dupe-pack");
    const res = await apiRequest("/api/admin/emote-packs", {
      method: "POST",
      headers: { Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ name: "dupe-pack" }),
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "PACK_NAME_TAKEN" });
  });

  it("rejects an empty, too-long, or colon-containing name with 400 PACK_NAME_INVALID", async () => {
    const adminToken = await makeAdminToken();
    for (const name of ["", "x".repeat(33), "a:b"]) {
      const res = await apiRequest("/api/admin/emote-packs", {
        method: "POST",
        headers: { Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({ name }),
      });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "PACK_NAME_INVALID" });
    }
  });
});

describe("DELETE /api/admin/emote-packs/:id", () => {
  it("rejects a non-admin with 403", async () => {
    const adminToken = await makeAdminToken();
    const token = await freshUserToken();
    const pack = await createPack(adminToken, "del-forbidden");
    const res = await apiRequest(`/api/admin/emote-packs/${pack.id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(403);
  });

  it("404s for an unknown pack id", async () => {
    const adminToken = await makeAdminToken();
    const res = await apiRequest("/api/admin/emote-packs/does-not-exist", {
      method: "DELETE",
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(res.status).toBe(404);
  });

  it("cascades the pack's emote rows but leaves the underlying media intact", async () => {
    const adminToken = await makeAdminToken();
    const mediaId = await uploadMedia(adminToken);
    const pack = await createPack(adminToken, "del-cascade");
    await createEmote(adminToken, pack.id, "bye", mediaId);

    const delRes = await apiRequest(`/api/admin/emote-packs/${pack.id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(delRes.status).toBe(204);

    const listRes = await apiRequest("/api/emotes", { headers: { Authorization: `Bearer ${adminToken}` } });
    const body = (await listRes.json()) as { packs: Array<{ id: string }> };
    expect(body.packs.find((p) => p.id === pack.id)).toBeUndefined();

    const mediaRes = await apiRequest(`/media/${mediaId}`, { headers: { Authorization: `Bearer ${adminToken}` } });
    expect(mediaRes.status).toBe(200);
  });
});

describe("POST /api/admin/emote-packs/:id/emotes", () => {
  it("rejects a non-admin with 403", async () => {
    const adminToken = await makeAdminToken();
    const token = await freshUserToken();
    const mediaId = await uploadMedia(adminToken);
    const pack = await createPack(adminToken, "emote-forbidden");
    const res = await createEmote(token, pack.id, "x", mediaId);
    expect(res.status).toBe(403);
  });

  it("404s for an unknown pack id", async () => {
    const adminToken = await makeAdminToken();
    const mediaId = await uploadMedia(adminToken);
    const res = await createEmote(adminToken, "does-not-exist", "x", mediaId);
    expect(res.status).toBe(404);
  });

  it("rejects a media_id that doesn't exist with 400 MEDIA_NOT_FOUND", async () => {
    const adminToken = await makeAdminToken();
    const pack = await createPack(adminToken, "emote-badmedia");
    const res = await createEmote(adminToken, pack.id, "x", "does-not-exist");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "MEDIA_NOT_FOUND" });
  });

  it("creates an emote and returns id/name/media_id/url", async () => {
    const adminToken = await makeAdminToken();
    const mediaId = await uploadMedia(adminToken);
    const pack = await createPack(adminToken, "emote-ok");
    const res = await createEmote(adminToken, pack.id, "yay", mediaId);
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ id: expect.any(String), name: "yay", media_id: mediaId, url: `/media/${mediaId}` });
  });

  it("rejects a duplicate name within the same pack with 409 EMOTE_NAME_TAKEN", async () => {
    const adminToken = await makeAdminToken();
    const mediaA = await uploadMedia(adminToken);
    const mediaB = await uploadMedia(adminToken);
    const pack = await createPack(adminToken, "emote-dupe");
    const first = await createEmote(adminToken, pack.id, "same", mediaA);
    expect(first.status).toBe(201);
    const second = await createEmote(adminToken, pack.id, "same", mediaB);
    expect(second.status).toBe(409);
    expect(await second.json()).toEqual({ error: "EMOTE_NAME_TAKEN" });
  });

  it("allows the same name across two different packs", async () => {
    const adminToken = await makeAdminToken();
    const mediaA = await uploadMedia(adminToken);
    const mediaB = await uploadMedia(adminToken);
    const packA = await createPack(adminToken, "emote-cross-a");
    const packB = await createPack(adminToken, "emote-cross-b");
    const first = await createEmote(adminToken, packA.id, "shared", mediaA);
    const second = await createEmote(adminToken, packB.id, "shared", mediaB);
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
  });

  it("rejects an empty, too-long, or colon-containing name with 400 EMOTE_NAME_INVALID", async () => {
    const adminToken = await makeAdminToken();
    const mediaId = await uploadMedia(adminToken);
    const pack = await createPack(adminToken, "emote-invalid-name");
    for (const name of ["", "x".repeat(33), "a:b"]) {
      const res = await createEmote(adminToken, pack.id, name, mediaId);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "EMOTE_NAME_INVALID" });
    }
  });
});

describe("DELETE /api/admin/emotes/:id", () => {
  it("rejects a non-admin with 403", async () => {
    const adminToken = await makeAdminToken();
    const token = await freshUserToken();
    const mediaId = await uploadMedia(adminToken);
    const pack = await createPack(adminToken, "emote-del-forbidden");
    const created = (await (await createEmote(adminToken, pack.id, "x", mediaId)).json()) as { id: string };
    const res = await apiRequest(`/api/admin/emotes/${created.id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(403);
  });

  it("deletes an emote", async () => {
    const adminToken = await makeAdminToken();
    const mediaId = await uploadMedia(adminToken);
    const pack = await createPack(adminToken, "emote-del-ok");
    const created = (await (await createEmote(adminToken, pack.id, "x", mediaId)).json()) as { id: string };
    const res = await apiRequest(`/api/admin/emotes/${created.id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(res.status).toBe(204);
  });

  it("404s for an unknown emote id", async () => {
    const adminToken = await makeAdminToken();
    const res = await apiRequest("/api/admin/emotes/does-not-exist", {
      method: "DELETE",
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(res.status).toBe(404);
  });
});

describe("GET /api/admin/emote-packs/:id/export", () => {
  it("rejects a non-admin with 403", async () => {
    const adminToken = await makeAdminToken();
    const token = await freshUserToken();
    const pack = await createPack(adminToken, "export-forbidden");
    const res = await apiRequest(`/api/admin/emote-packs/${pack.id}/export`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(403);
  });

  it("404s for an unknown pack id", async () => {
    const adminToken = await makeAdminToken();
    const res = await apiRequest("/api/admin/emote-packs/does-not-exist/export", {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(res.status).toBe(404);
  });

  it("exports the omew-emotes/v1 format snapshot", async () => {
    const adminToken = await makeAdminToken();
    const mediaA = await uploadMedia(adminToken);
    const mediaB = await uploadMedia(adminToken);
    const pack = await createPack(adminToken, "export-me");
    await createEmote(adminToken, pack.id, "one", mediaA);
    await createEmote(adminToken, pack.id, "two", mediaB);

    const res = await apiRequest(`/api/admin/emote-packs/${pack.id}/export`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toEqual({
      format: "omew-emotes/v1",
      pack: { name: "export-me" },
      emotes: [
        { name: "one", media_id: mediaA },
        { name: "two", media_id: mediaB },
      ],
      metadata: { exported_at: expect.any(Number) },
    });
  });
});

describe("POST /api/admin/emote-packs/import", () => {
  it("rejects a non-admin with 403", async () => {
    const token = await freshUserToken();
    const res = await apiRequest("/api/admin/emote-packs/import", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ format: "omew-emotes/v1", pack: { name: "x" }, emotes: [] }),
    });
    expect(res.status).toBe(403);
  });

  it("rejects an unrecognized format with 400 FORMAT_INVALID", async () => {
    const adminToken = await makeAdminToken();
    const res = await apiRequest("/api/admin/emote-packs/import", {
      method: "POST",
      headers: { Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ format: "bettermew/v0", pack: { name: "x" }, emotes: [] }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "FORMAT_INVALID" });
  });

  it("rejects a pack name that's already taken with 409 PACK_NAME_TAKEN", async () => {
    const adminToken = await makeAdminToken();
    await createPack(adminToken, "import-taken");
    const res = await apiRequest("/api/admin/emote-packs/import", {
      method: "POST",
      headers: { Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ format: "omew-emotes/v1", pack: { name: "import-taken" }, emotes: [] }),
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "PACK_NAME_TAKEN" });
  });

  it("imports resolvable entries and lists unresolvable media_ids in skipped", async () => {
    const adminToken = await makeAdminToken();
    const mediaA = await uploadMedia(adminToken);
    const mediaB = await uploadMedia(adminToken);

    const res = await apiRequest("/api/admin/emote-packs/import", {
      method: "POST",
      headers: { Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({
        format: "omew-emotes/v1",
        pack: { name: "import-mixed" },
        emotes: [
          { name: "keep-a", media_id: mediaA },
          { name: "keep-b", media_id: mediaB },
          { name: "ghost", media_id: "does-not-exist" },
        ],
        metadata: { exported_at: 1234, attribution: "archived from a defunct instance" },
      }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      pack: { id: string; name: string; emotes: Array<{ name: string; media_id: string }> };
      skipped: Array<{ name: string; media_id: string; reason: string }>;
    };
    expect(body.pack.name).toBe("import-mixed");
    expect(body.pack.emotes.map((e) => ({ name: e.name, media_id: e.media_id }))).toEqual([
      { name: "keep-a", media_id: mediaA },
      { name: "keep-b", media_id: mediaB },
    ]);
    expect(body.skipped).toEqual([{ name: "ghost", media_id: "does-not-exist", reason: "MEDIA_NOT_FOUND" }]);

    const listRes = await apiRequest("/api/emotes", { headers: { Authorization: `Bearer ${adminToken}` } });
    const list = (await listRes.json()) as { packs: Array<{ id: string; emotes: unknown[] }> };
    const imported = list.packs.find((p) => p.id === body.pack.id);
    expect(imported?.emotes).toHaveLength(2);
  });
});
