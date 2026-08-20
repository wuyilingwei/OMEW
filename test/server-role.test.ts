import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { apiRequest, connectRoom, ensureMigrated, itemCreateFrame, loginAs, nextMessage, registerUser, sessionToken } from "./helpers";

// m0-protocol §7.10: server-level role tier. Registration bootstrap (first user
// -> owner) is covered in user-system.test.ts; this file covers the owner-only
// appointment endpoints (GET/PATCH /api/admin/users) and the
// server_owner/server_admin permission-gate overlay onto stronghold roles -
// owner-equivalent everywhere except ownership transfer.

const OWNERSHIP = { ownership_pubkey: "test-pubkey", ownership_ciphertext: "test-ciphertext-blob" };
let userCounter = 0;

async function freshUser(prefix = "role"): Promise<{ actor: string; username: string; token: string }> {
  userCounter += 1;
  const username = `${prefix}${userCounter}`;
  const { status, json } = await registerUser({ username, password: "password123", ...OWNERSHIP });
  expect(status).toBe(200);
  return { actor: `@${username}:local`, username, token: json.token as string };
}

// Promotes via direct D1 write then re-logs-in - server_role rides in the
// session token claim, so a token minted before the promotion wouldn't reflect
// it (see helpers.loginAs).
async function makeOwner(): Promise<{ actor: string; username: string; token: string }> {
  const user = await freshUser("owner");
  await env.DB.prepare("UPDATE users SET server_role = 'owner' WHERE localpart = ?").bind(user.username).run();
  return { ...user, token: await loginAs(user.username) };
}

async function makeAdmin(): Promise<{ actor: string; username: string; token: string }> {
  const user = await freshUser("admin");
  await env.DB.prepare("UPDATE users SET server_role = 'admin' WHERE localpart = ?").bind(user.username).run();
  return { ...user, token: await loginAs(user.username) };
}

beforeAll(async () => {
  await ensureMigrated();
});

describe("GET /api/admin/users (server_owner only)", () => {
  it("lists localpart/server_role/created_at", async () => {
    const owner = await makeOwner();
    const listed = await freshUser("listuser");

    const res = await apiRequest("/api/admin/users", { headers: { Authorization: `Bearer ${owner.token}` } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      users: Array<{ localpart: string; server_role: string; created_at: number }>;
      next_cursor: string | null;
    };
    const entry = body.users.find((u) => u.localpart === listed.username);
    expect(entry).toMatchObject({ localpart: listed.username, server_role: "user" });
    expect(typeof entry?.created_at).toBe("number");
  });

  it("rejects a server_admin caller - this listing is owner-only, not admin", async () => {
    const admin = await makeAdmin();
    const res = await apiRequest("/api/admin/users", { headers: { Authorization: `Bearer ${admin.token}` } });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "ADMIN_REQUIRED" });
  });

  it("rejects a plain user", async () => {
    const user = await freshUser();
    const res = await apiRequest("/api/admin/users", { headers: { Authorization: `Bearer ${user.token}` } });
    expect(res.status).toBe(403);
  });
});

describe("PATCH /api/admin/users/:localpart (server_owner only)", () => {
  it("promotes a user to admin and demotes back to user", async () => {
    const owner = await makeOwner();
    const target = await freshUser("target");

    const promote = await apiRequest(`/api/admin/users/${target.username}`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${owner.token}` },
      body: JSON.stringify({ server_role: "admin" }),
    });
    expect(promote.status).toBe(200);
    expect(await promote.json()).toEqual({ localpart: target.username, server_role: "admin" });
    const row = await env.DB.prepare("SELECT server_role FROM users WHERE localpart = ?")
      .bind(target.username)
      .first<{ server_role: string }>();
    expect(row?.server_role).toBe("admin");

    const demote = await apiRequest(`/api/admin/users/${target.username}`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${owner.token}` },
      body: JSON.stringify({ server_role: "user" }),
    });
    expect(demote.status).toBe(200);
    expect(await demote.json()).toEqual({ localpart: target.username, server_role: "user" });
  });

  it("cannot promote to owner - 400 ROLE_INVALID", async () => {
    const owner = await makeOwner();
    const target = await freshUser("target2");
    const res = await apiRequest(`/api/admin/users/${target.username}`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${owner.token}` },
      body: JSON.stringify({ server_role: "owner" }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "ROLE_INVALID" });
  });

  it("cannot modify its own row - 400 ROLE_INVALID", async () => {
    const owner = await makeOwner();
    const res = await apiRequest(`/api/admin/users/${owner.username}`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${owner.token}` },
      body: JSON.stringify({ server_role: "admin" }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "ROLE_INVALID" });
  });

  it("rejects a server_admin caller - owner-only, not admin", async () => {
    const admin = await makeAdmin();
    const target = await freshUser("target3");
    const res = await apiRequest(`/api/admin/users/${target.username}`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${admin.token}` },
      body: JSON.stringify({ server_role: "admin" }),
    });
    expect(res.status).toBe(403);
  });

  it("404s for an unknown localpart", async () => {
    const owner = await makeOwner();
    const res = await apiRequest("/api/admin/users/does-not-exist-at-all", {
      method: "PATCH",
      headers: { Authorization: `Bearer ${owner.token}` },
      body: JSON.stringify({ server_role: "admin" }),
    });
    expect(res.status).toBe(404);
  });
});

describe("is_admin compat field", () => {
  it("is true for server_role owner and admin, false for user", async () => {
    const owner = await makeOwner();
    const admin = await makeAdmin();
    const user = await freshUser();

    for (const [account, expected] of [
      [owner, { server_role: "owner", is_admin: true }],
      [admin, { server_role: "admin", is_admin: true }],
      [user, { server_role: "user", is_admin: false }],
    ] as const) {
      const res = await apiRequest("/api/login", {
        method: "POST",
        body: JSON.stringify({ username: account.username, password: "password123" }),
      });
      const body = (await res.json()) as { user: Record<string, unknown> };
      expect(body.user).toMatchObject(expected);
    }
  });
});

describe("server_owner/server_admin permission-gate overlay in a stronghold they never joined (§7.10)", () => {
  async function freshStrongholdWithLobby(ownerActor: string): Promise<string> {
    const id = `overlay${Date.now()}${userCounter++}`;
    const stub = env.STRONGHOLD_DO.getByName(id);
    await stub.initConfig(id, "Overlay Test Stronghold", "public", ownerActor);
    await stub.createRoom("lobby", "channel", "Lobby", ["text"], false);
    return id;
  }

  it("server_admin passes the owner gate for config writes and for moderating someone else's message, but transfer stays 403", async () => {
    const realOwner = "@ovlowner1:local";
    const member = "@ovlmember1:local";
    const admin = "@ovladmin1:local"; // never joins this stronghold
    const id = await freshStrongholdWithLobby(realOwner);
    const stub = env.STRONGHOLD_DO.getByName(id);
    await stub.addMember(member, "member");
    const adminToken = await sessionToken(admin, "admin");

    // owner-only field (visibility) succeeds despite no membership row at all.
    const patchRes = await apiRequest(`/api/stronghold/${id}/config`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ visibility: "private", description: "moderated by server admin" }),
    });
    expect(patchRes.status).toBe(200);
    const patched = (await patchRes.json()) as Record<string, unknown>;
    expect(patched.visibility).toBe("private");
    expect(patched.description).toBe("moderated by server admin");

    // moderate (retract) another member's message.
    const { ws } = await connectRoom(`${id}/ch/lobby`, member, "member");
    ws.send(itemCreateFrame("c1", "hello from member"));
    const ack = (await nextMessage(ws)) as { seq: number };
    ws.close();

    const delRes = await apiRequest(`/api/stronghold/${id}/rooms/lobby/items/${ack.seq}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(delRes.status).toBe(200);

    // the one exception: ownership transfer needs the real owner or server_owner.
    const transferRes = await apiRequest(`/api/stronghold/${id}/transfer`, {
      method: "POST",
      headers: { Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ to: member }),
    });
    expect(transferRes.status).toBe(403);
    expect(await transferRes.json()).toEqual({ error: "FORBIDDEN" });
  });

  it("server_owner (also never a member) can transfer ownership away from the real owner", async () => {
    const realOwner = "@ovlowner2:local";
    const member = "@ovlmember2:local";
    const serverOwner = "@ovlserverowner1:local";
    const id = await freshStrongholdWithLobby(realOwner);
    const stub = env.STRONGHOLD_DO.getByName(id);
    await stub.addMember(member, "member");
    const ownerToken = await sessionToken(serverOwner, "owner");

    const transferRes = await apiRequest(`/api/stronghold/${id}/transfer`, {
      method: "POST",
      headers: { Authorization: `Bearer ${ownerToken}` },
      body: JSON.stringify({ to: member }),
    });
    expect(transferRes.status).toBe(200);
    const transferred = (await transferRes.json()) as Record<string, unknown>;
    expect(transferred.owner_actor).toBe(member);
  });

  it("a plain user with no membership and no server role stays FORBIDDEN (overlay doesn't leak)", async () => {
    const realOwner = "@ovlowner3:local";
    const outsider = "@ovloutsider1:local";
    const id = await freshStrongholdWithLobby(realOwner);
    const outsiderToken = await sessionToken(outsider, "user");

    const patchRes = await apiRequest(`/api/stronghold/${id}/config`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${outsiderToken}` },
      body: JSON.stringify({ description: "should not work" }),
    });
    expect(patchRes.status).toBe(403);
  });
});
