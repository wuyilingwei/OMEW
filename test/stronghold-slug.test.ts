import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { apiRequest, ensureMigrated, sessionToken } from "./helpers";

// Task 059: stronghold URL short-name (slug) - derivation + dedup on create,
// GET /api/resolve/:server/:slug, and the server-admin-only PATCH endpoint.

beforeAll(async () => {
  await ensureMigrated();
});

describe("slug derivation + uniqueness on creation", () => {
  it("derives a lowercase-dash slug from the name", async () => {
    const owner = "@slugowner1:local";
    const token = await sessionToken(owner);
    const res = await apiRequest("/api/strongholds", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ name: "My Cool Place!!" }),
    });
    expect(res.status).toBe(201);
    const config = (await res.json()) as { slug: string };
    expect(config.slug).toBe("my-cool-place");
  });

  it("appends a numeric suffix when the derived slug is already taken", async () => {
    const owner1 = "@slugowner2a:local";
    const owner2 = "@slugowner2b:local";
    const token1 = await sessionToken(owner1);
    const token2 = await sessionToken(owner2);

    const res1 = await apiRequest("/api/strongholds", {
      method: "POST",
      headers: { Authorization: `Bearer ${token1}` },
      body: JSON.stringify({ name: "Duplicate Name" }),
    });
    const res2 = await apiRequest("/api/strongholds", {
      method: "POST",
      headers: { Authorization: `Bearer ${token2}` },
      body: JSON.stringify({ name: "Duplicate Name" }),
    });
    const config1 = (await res1.json()) as { slug: string };
    const config2 = (await res2.json()) as { slug: string };
    expect(config1.slug).toBe("duplicate-name");
    expect(config2.slug).toBe("duplicate-name-2");
  });

  it("falls back to a random slug for an all-non-ASCII name", async () => {
    const owner = "@slugowner3:local";
    const token = await sessionToken(owner);
    const res = await apiRequest("/api/strongholds", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ name: "据点名称" }),
    });
    const config = (await res.json()) as { slug: string };
    expect(config.slug.length).toBeGreaterThan(0);
    expect(config.slug).toMatch(/^[a-z0-9]+$/);
  });
});

describe("GET /api/resolve/:server/:slug", () => {
  it("resolves a known slug on server 'a'", async () => {
    const owner = "@slugresolve1:local";
    const token = await sessionToken(owner);
    const created = await apiRequest("/api/strongholds", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ name: "Resolve Target" }),
    });
    const config = (await created.json()) as { id: string; slug: string };

    const res = await apiRequest(`/api/resolve/a/${config.slug}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ stronghold_id: config.id });
  });

  it("404s for an unknown slug", async () => {
    const res = await apiRequest("/api/resolve/a/no-such-slug-at-all");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "NOT_FOUND" });
  });

  it("404s for any non-'a' server segment (federation not implemented)", async () => {
    const owner = "@slugresolve2:local";
    const token = await sessionToken(owner);
    const created = await apiRequest("/api/strongholds", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ name: "Another Target" }),
    });
    const config = (await created.json()) as { slug: string };

    const res = await apiRequest(`/api/resolve/other-instance/${config.slug}`);
    expect(res.status).toBe(404);
  });
});

describe("PATCH /api/admin/strongholds/:id/slug", () => {
  it("rejects the stronghold's own owner (403) - server-admin gate, not effectiveRole", async () => {
    const owner = "@slugpatch1:local";
    const token = await sessionToken(owner);
    const created = await apiRequest("/api/strongholds", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ name: "Patch Target One" }),
    });
    const config = (await created.json()) as { id: string };

    const res = await apiRequest(`/api/admin/strongholds/${config.id}/slug`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ slug: "new-name" }),
    });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "ADMIN_REQUIRED" });
  });

  it("lets a server admin rename the slug", async () => {
    const owner = "@slugpatch2:local";
    const ownerToken = await sessionToken(owner);
    const created = await apiRequest("/api/strongholds", {
      method: "POST",
      headers: { Authorization: `Bearer ${ownerToken}` },
      body: JSON.stringify({ name: "Patch Target Two" }),
    });
    const config = (await created.json()) as { id: string };

    const adminToken = await sessionToken("@slugadmin1:local", "admin");
    const res = await apiRequest(`/api/admin/strongholds/${config.id}/slug`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ slug: "renamed-place" }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: config.id, slug: "renamed-place" });

    const stub = env.STRONGHOLD_DO.getByName(config.id);
    const cfg = await stub.getConfig();
    expect(cfg?.slug).toBe("renamed-place");

    const resolveRes = await apiRequest("/api/resolve/a/renamed-place");
    expect(await resolveRes.json()).toEqual({ stronghold_id: config.id });
  });

  it("rejects a malformed slug with 400", async () => {
    const owner = "@slugpatch3:local";
    const ownerToken = await sessionToken(owner);
    const created = await apiRequest("/api/strongholds", {
      method: "POST",
      headers: { Authorization: `Bearer ${ownerToken}` },
      body: JSON.stringify({ name: "Patch Target Three" }),
    });
    const config = (await created.json()) as { id: string };

    const adminToken = await sessionToken("@slugadmin2:local", "admin");
    const res = await apiRequest(`/api/admin/strongholds/${config.id}/slug`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ slug: "Not Valid!" }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "MALFORMED" });
  });

  it("rejects an already-taken slug with 409", async () => {
    const owner1 = "@slugpatch4a:local";
    const owner2 = "@slugpatch4b:local";
    const token1 = await sessionToken(owner1);
    const token2 = await sessionToken(owner2);

    const created1 = await apiRequest("/api/strongholds", {
      method: "POST",
      headers: { Authorization: `Bearer ${token1}` },
      body: JSON.stringify({ name: "Taken Slug Holder" }),
    });
    const config1 = (await created1.json()) as { id: string; slug: string };
    const created2 = await apiRequest("/api/strongholds", {
      method: "POST",
      headers: { Authorization: `Bearer ${token2}` },
      body: JSON.stringify({ name: "Some Other Name" }),
    });
    const config2 = (await created2.json()) as { id: string };

    const adminToken = await sessionToken("@slugadmin3:local", "admin");
    const res = await apiRequest(`/api/admin/strongholds/${config2.id}/slug`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ slug: config1.slug }),
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "ALREADY_EXISTS" });
  });
});
