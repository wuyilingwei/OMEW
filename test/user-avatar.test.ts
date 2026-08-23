import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import pngFixture from "./fixtures/tiny.png.base64?raw";
import { apiRequest, avatarUploadRequest, coverUploadRequest, ensureMigrated, registerUser } from "./helpers";

const OWNERSHIP = { ownership_pubkey: "test-pubkey", ownership_ciphertext: "test-ciphertext-blob" };

function pngBytes(): Uint8Array {
  return Uint8Array.from(atob(pngFixture.trim()), (char) => char.charCodeAt(0));
}

beforeAll(async () => {
  await ensureMigrated();
});

describe("personal avatar", () => {
  it("requires authentication and rejects non-image uploads", async () => {
    const unauthenticated = await avatarUploadRequest({ contentType: "image/png", body: pngBytes() });
    expect(unauthenticated.status).toBe(401);
    expect(await unauthenticated.json()).toEqual({ error: "AUTH_REQUIRED" });

    const { json } = await registerUser({ username: "avatarreject", password: "password123", ...OWNERSHIP });
    const notImage = await avatarUploadRequest({
      token: json.token as string,
      contentType: "audio/mpeg",
      body: new Uint8Array([0x49, 0x44, 0x33, 0x04]),
    });
    expect(notImage.status).toBe(415);
    expect(await notImage.json()).toEqual({ error: "AVATAR_IMAGE_REQUIRED" });
  });

  it("uploads, projects and clears the current user's avatar", async () => {
    const username = "avatarowner";
    const { status, json } = await registerUser({ username, password: "password123", ...OWNERSHIP });
    expect(status).toBe(200);
    expect((json.user as Record<string, unknown>).avatar).toBeNull();
    const token = json.token as string;
    const actor = (json.user as { actor: string }).actor;

    const upload = await avatarUploadRequest({ token, contentType: "image/png", body: pngBytes() });
    expect(upload.status).toBe(201);
    const uploaded = (await upload.json()) as { id: string; url: string; avatar: string; mime: string; size: number };
    expect(uploaded.avatar).toBe(uploaded.url);
    expect(uploaded.url).toBe(`/media/${uploaded.id}`);
    expect(uploaded.mime).toBe("image/png");
    expect(uploaded.size).toBeGreaterThan(0);

    const login = await apiRequest("/api/login", {
      method: "POST",
      body: JSON.stringify({ username, password: "password123" }),
    });
    expect(login.status).toBe(200);
    expect(((await login.json()) as { user: { avatar: string } }).user.avatar).toBe(uploaded.avatar);

    const profile = await apiRequest(`/api/users/${encodeURIComponent(actor)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(profile.status).toBe(200);
    expect(((await profile.json()) as { avatar: string }).avatar).toBe(uploaded.avatar);

    const strongholdId = `avatar${Date.now()}`;
    await env.STRONGHOLD_DO.getByName(strongholdId).initConfig(strongholdId, "Avatar Stronghold", "public", actor);
    const members = await apiRequest(`/api/stronghold/${strongholdId}/members?tab=all`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(members.status).toBe(200);
    expect(((await members.json()) as { entries: Array<{ actor: string; avatar: string }> }).entries)
      .toContainEqual(expect.objectContaining({ actor, avatar: uploaded.avatar }));

    const cleared = await apiRequest("/api/me/avatar", {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(cleared.status).toBe(200);
    expect(await cleared.json()).toEqual({ avatar: null });

    const profileAfterClear = await apiRequest(`/api/users/${encodeURIComponent(actor)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(((await profileAfterClear.json()) as { avatar: string | null }).avatar).toBeNull();

    const replacement = await avatarUploadRequest({ token, contentType: "image/png", body: pngBytes() });
    const replacementBody = (await replacement.json()) as { id: string; avatar: string };
    const deleteMedia = await apiRequest(`/api/media/${replacementBody.id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(deleteMedia.status).toBe(204);
    const profileAfterMediaDelete = await apiRequest(`/api/users/${encodeURIComponent(actor)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(((await profileAfterMediaDelete.json()) as { avatar: string | null }).avatar).toBeNull();
  });
});

describe("personal cover", () => {
  it("uploads, projects and cleans up an owned cover media object", async () => {
    const { json } = await registerUser({ username: "coverowner", password: "password123", ...OWNERSHIP });
    const token = json.token as string;
    const actor = (json.user as { actor: string }).actor;
    const upload = await coverUploadRequest({ token, contentType: "image/png", body: pngBytes() });
    expect(upload.status).toBe(201);
    const body = (await upload.json()) as { id: string; url: string; cover: string };
    expect(body.cover).toBe(body.url);
    const login = await apiRequest("/api/login", { method: "POST", body: JSON.stringify({ username: "coverowner", password: "password123" }) });
    expect(((await login.json()) as { user: { cover: string } }).user.cover).toBe(body.url);
    const cleared = await apiRequest("/api/me/cover", { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
    expect(await cleared.json()).toEqual({ cover: null });
    const profile = await apiRequest(`/api/users/${encodeURIComponent(actor)}`, { headers: { Authorization: `Bearer ${token}` } });
    expect(((await profile.json()) as { cover: string | null }).cover).toBeNull();
    expect((await apiRequest(`/media/${body.id}`)).status).toBe(404);
  });
});
