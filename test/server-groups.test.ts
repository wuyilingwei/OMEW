import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { verifyToken } from "../server/src/auth";
import { synthesizeEffectivePermissions } from "../server/src/permissions";
import { DENY_CHANNEL_SPEAK, DENY_SECTION_POST, DENY_SECTION_REPLY, type RoomTokenClaims } from "../server/src/types";
import { apiRequest, connectRoom, ensureMigrated, itemCreateFrame, nextMessage, registerUser, sessionToken, TEST_SECRET } from "./helpers";

// Task 048 (m0-protocol §7.10a): server-level user groups, replacing task 037's
// stronghold-local groups. Groups are server-wide (D1 server_groups /
// user_server_groups) and only assignable to local registered users; a
// definition or assignment change fans revocation out to every stronghold the
// affected user belongs to (see server/src/api.ts's broadcastGroupRevoke).

const OWNERSHIP = { ownership_pubkey: "test-pubkey", ownership_ciphertext: "test-ciphertext-blob" };

let strongholdSeq = 0;
async function freshStronghold(ownerActor: string, visibility: "public" | "private" = "public"): Promise<string> {
  const id = `sgrp${Date.now()}${strongholdSeq++}`;
  const stub = env.STRONGHOLD_DO.getByName(id);
  await stub.initConfig(id, "Test Stronghold", visibility, ownerActor);
  return id;
}

let userSeq = 0;
async function freshUser(): Promise<{ localpart: string; actor: string }> {
  const localpart = `sgrpuser${Date.now()}${userSeq++}`;
  const { status } = await registerUser({ username: localpart, password: "password123", ...OWNERSHIP });
  expect(status).toBe(200);
  return { localpart, actor: `@${localpart}:local` };
}

beforeAll(async () => {
  await ensureMigrated();
});

// ---- synthesis matrix (pure function, no DO/HTTP involved) -----------------------

describe("synthesizeEffectivePermissions", () => {
  it("built-in owner/mod are unrestricted by any groups passed in", () => {
    const denyEverything = [{ position: 0, allow_speak: -1 as const, allow_post: -1 as const, allow_reply: -1 as const, is_moderator: 0 }];
    expect(synthesizeEffectivePermissions("owner", 7, denyEverything)).toEqual({ role: "owner", deny: 0 });
    expect(synthesizeEffectivePermissions("mod", 7, denyEverything)).toEqual({ role: "mod", deny: 0 });
  });

  it("a plain member with no groups keeps exactly their existing member.deny bits", () => {
    expect(synthesizeEffectivePermissions("member", 0, [])).toEqual({ role: "member", deny: 0 });
    expect(synthesizeEffectivePermissions("member", DENY_CHANNEL_SPEAK, [])).toEqual({ role: "member", deny: DENY_CHANNEL_SPEAK });
  });

  it("higher-position group overrides a lower one's tri-state, per field independently", () => {
    const low = { position: 0, allow_speak: -1 as const, allow_post: 0 as const, allow_reply: 0 as const, is_moderator: 0 };
    const high = { position: 1, allow_speak: 1 as const, allow_post: -1 as const, allow_reply: 0 as const, is_moderator: 0 };
    expect(synthesizeEffectivePermissions("member", 0, [low, high])).toEqual({ role: "member", deny: DENY_SECTION_POST });
  });

  it("synthesis sorts by position itself - input array order doesn't matter", () => {
    const high = { position: 1, allow_speak: 1 as const, allow_post: 0 as const, allow_reply: 0 as const, is_moderator: 0 };
    const low = { position: 0, allow_speak: -1 as const, allow_post: 0 as const, allow_reply: 0 as const, is_moderator: 0 };
    const result = synthesizeEffectivePermissions("member", 0, [high, low]);
    expect(result.deny & DENY_CHANNEL_SPEAK).toBe(0);
  });

  it("multiple groups combine denials across different fields", () => {
    const speakDeny = { position: 0, allow_speak: -1 as const, allow_post: 0 as const, allow_reply: 0 as const, is_moderator: 0 };
    const replyDeny = { position: 1, allow_speak: 0 as const, allow_post: 0 as const, allow_reply: -1 as const, is_moderator: 0 };
    const result = synthesizeEffectivePermissions("member", 0, [speakDeny, replyDeny]);
    expect(result.deny).toBe(DENY_CHANNEL_SPEAK | DENY_SECTION_REPLY);
  });

  it("any held group flagged moderator escalates to mod and forces deny to 0, overriding member.deny", () => {
    const modGroup = { position: 0, allow_speak: -1 as const, allow_post: -1 as const, allow_reply: -1 as const, is_moderator: 1 };
    const punished = DENY_CHANNEL_SPEAK | DENY_SECTION_POST | DENY_SECTION_REPLY;
    expect(synthesizeEffectivePermissions("member", punished, [modGroup])).toEqual({ role: "mod", deny: 0 });
  });

  it("member-level deny bit overrides last, adding a denial on top of an explicit group allow", () => {
    const allowAll = { position: 0, allow_speak: 1 as const, allow_post: 1 as const, allow_reply: 1 as const, is_moderator: 0 };
    const result = synthesizeEffectivePermissions("member", DENY_SECTION_POST, [allowAll]);
    expect(result.deny).toBe(DENY_SECTION_POST);
  });
});

// ---- admin CRUD + auth gate --------------------------------------------------------

describe("admin server-groups CRUD", () => {
  it("plain user is forbidden; admin/owner can create, list, patch, delete", async () => {
    const plainToken = await sessionToken("@plaingroups1:local", "user");
    const forbidden = await apiRequest("/api/admin/server-groups", {
      method: "POST", headers: { Authorization: `Bearer ${plainToken}` }, body: JSON.stringify({ name: "X" }),
    });
    expect(forbidden.status).toBe(403);
    expect(await forbidden.json()).toEqual({ error: "ADMIN_REQUIRED" });

    const adminToken = await sessionToken("@admingroups1:local", "admin");
    const createRes = await apiRequest("/api/admin/server-groups", {
      method: "POST",
      headers: { Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ name: "VIP", color: "#ff00aa", allow_speak: 1 }),
    });
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as Record<string, unknown>;
    expect(created).toMatchObject({
      name: "VIP", color: "#ff00aa", allow_speak: 1, allow_post: 0, allow_reply: 0, is_moderator: false,
    });

    const listRes = await apiRequest("/api/admin/server-groups", { headers: { Authorization: `Bearer ${adminToken}` } });
    expect(listRes.status).toBe(200);
    expect(((await listRes.json()) as { groups: Array<{ id: string }> }).groups.some((g) => g.id === created.id)).toBe(true);

    const patchRes = await apiRequest(`/api/admin/server-groups/${created.id}`, {
      method: "PATCH", headers: { Authorization: `Bearer ${adminToken}` }, body: JSON.stringify({ name: "VIP+", is_moderator: true }),
    });
    expect(patchRes.status).toBe(200);
    expect(await patchRes.json()).toMatchObject({ name: "VIP+", is_moderator: true });

    const delRes = await apiRequest(`/api/admin/server-groups/${created.id}`, {
      method: "DELETE", headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(delRes.status).toBe(204);

    const patchGone = await apiRequest(`/api/admin/server-groups/${created.id}`, {
      method: "PATCH", headers: { Authorization: `Bearer ${adminToken}` }, body: JSON.stringify({ name: "Y" }),
    });
    expect(patchGone.status).toBe(404);
  });

  it("rejects invalid name/color/perm values", async () => {
    const adminToken = await sessionToken("@admingroups2:local", "admin");

    const badName = await apiRequest("/api/admin/server-groups", {
      method: "POST", headers: { Authorization: `Bearer ${adminToken}` }, body: JSON.stringify({ name: "" }),
    });
    expect(badName.status).toBe(400);
    expect(await badName.json()).toEqual({ error: "GROUP_NAME_INVALID" });

    const badColor = await apiRequest("/api/admin/server-groups", {
      method: "POST", headers: { Authorization: `Bearer ${adminToken}` }, body: JSON.stringify({ name: "X", color: "red" }),
    });
    expect(badColor.status).toBe(400);
    expect(await badColor.json()).toEqual({ error: "GROUP_COLOR_INVALID" });

    const badPerm = await apiRequest("/api/admin/server-groups", {
      method: "POST", headers: { Authorization: `Bearer ${adminToken}` }, body: JSON.stringify({ name: "X", allow_speak: 5 }),
    });
    expect(badPerm.status).toBe(400);
    expect(await badPerm.json()).toEqual({ error: "GROUP_PERM_INVALID" });
  });

  it("bulk PATCH reorders by position", async () => {
    const adminToken = await sessionToken("@admingroups3:local", "admin");
    const a = await (
      await apiRequest("/api/admin/server-groups", {
        method: "POST", headers: { Authorization: `Bearer ${adminToken}` }, body: JSON.stringify({ name: "A" }),
      })
    ).json() as { id: string };
    const b = await (
      await apiRequest("/api/admin/server-groups", {
        method: "POST", headers: { Authorization: `Bearer ${adminToken}` }, body: JSON.stringify({ name: "B" }),
      })
    ).json() as { id: string };

    const reorderRes = await apiRequest("/api/admin/server-groups", {
      method: "PATCH",
      headers: { Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ positions: [{ id: a.id, position: 5 }, { id: b.id, position: 1 }] }),
    });
    expect(reorderRes.status).toBe(200);
    const body = (await reorderRes.json()) as { groups: Array<{ id: string }> };
    const ids = body.groups.map((g) => g.id).filter((id) => id === a.id || id === b.id);
    expect(ids).toEqual([b.id, a.id]);
  });
});

// ---- assignment -------------------------------------------------------------------

describe("server-groups member assignment", () => {
  it("assigns/unassigns a registered local user; 404s on unknown group or user", async () => {
    const adminToken = await sessionToken("@admingroups4:local", "admin");
    const user = await freshUser();
    const group = (await (
      await apiRequest("/api/admin/server-groups", {
        method: "POST", headers: { Authorization: `Bearer ${adminToken}` }, body: JSON.stringify({ name: "G1" }),
      })
    ).json()) as { id: string };

    const put = await apiRequest(`/api/admin/server-groups/${group.id}/members/${user.localpart}`, {
      method: "PUT", headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(put.status).toBe(204);

    const listRes = await apiRequest(`/api/admin/server-groups/${group.id}/members`, { headers: { Authorization: `Bearer ${adminToken}` } });
    expect(((await listRes.json()) as { localparts: string[] }).localparts).toEqual([user.localpart]);

    const del = await apiRequest(`/api/admin/server-groups/${group.id}/members/${user.localpart}`, {
      method: "DELETE", headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(del.status).toBe(204);
    const afterDel = await apiRequest(`/api/admin/server-groups/${group.id}/members`, { headers: { Authorization: `Bearer ${adminToken}` } });
    expect(((await afterDel.json()) as { localparts: string[] }).localparts).toEqual([]);

    const badGroup = await apiRequest(`/api/admin/server-groups/does-not-exist/members/${user.localpart}`, {
      method: "PUT", headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(badGroup.status).toBe(404);

    const badUser = await apiRequest(`/api/admin/server-groups/${group.id}/members/nosuchuser`, {
      method: "PUT", headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(badUser.status).toBe(404);
  });
});

// ---- batch read-only display endpoint ----------------------------------------------

describe("GET /api/server-groups/members (batch display)", () => {
  it("returns every requested localpart, group-less as empty array, guest readable", async () => {
    const adminToken = await sessionToken("@admingroups5:local", "admin");
    const user = await freshUser();
    const group = (await (
      await apiRequest("/api/admin/server-groups", {
        method: "POST", headers: { Authorization: `Bearer ${adminToken}` }, body: JSON.stringify({ name: "Cool", color: "#123456" }),
      })
    ).json()) as { id: string };
    await apiRequest(`/api/admin/server-groups/${group.id}/members/${user.localpart}`, {
      method: "PUT", headers: { Authorization: `Bearer ${adminToken}` },
    });

    // No Authorization header - relies on default allow_guest_browsing.
    const res = await apiRequest(`/api/server-groups/members?localparts=${user.localpart},nogroups`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { groups: Record<string, Array<{ id: string; name: string; color: string | null }>> };
    expect(body.groups[user.localpart]).toEqual([{ id: group.id, name: "Cool", color: "#123456" }]);
    expect(body.groups.nogroups).toEqual([]);
  });

  it("400s on empty or over-cap localparts", async () => {
    const empty = await apiRequest("/api/server-groups/members?localparts=");
    expect(empty.status).toBe(400);
    expect(await empty.json()).toEqual({ error: "PAYLOAD_INVALID" });

    const tooMany = Array.from({ length: 101 }, (_, i) => `u${i}`).join(",");
    const over = await apiRequest(`/api/server-groups/members?localparts=${tooMany}`);
    expect(over.status).toBe(400);
    expect(await over.json()).toEqual({ error: "PAYLOAD_INVALID" });
  });
});

// ---- revocation propagation + effective synthesis end-to-end ----------------------

describe("group changes trigger revocation across strongholds", () => {
  it("token mint reflects a newly assigned deny group", async () => {
    const owner = "@tokowner1:local";
    const member = await freshUser();
    const id = await freshStronghold(owner);
    const stub = env.STRONGHOLD_DO.getByName(id);
    await stub.createRoom("general", "channel", "General", ["text"], false);
    await stub.addMember(member.actor, "member");
    const session = await sessionToken(member.actor);

    const adminToken = await sessionToken("@admingroups6:local", "admin");
    const muted = (await (
      await apiRequest("/api/admin/server-groups", {
        method: "POST", headers: { Authorization: `Bearer ${adminToken}` }, body: JSON.stringify({ name: "Muted", allow_speak: -1 }),
      })
    ).json()) as { id: string };
    await apiRequest(`/api/admin/server-groups/${muted.id}/members/${member.localpart}`, {
      method: "PUT", headers: { Authorization: `Bearer ${adminToken}` },
    });

    const mintRes = await apiRequest(`/stronghold/${id}/rooms/general/token`, {
      method: "POST", headers: { Authorization: `Bearer ${session}` },
    });
    expect(mintRes.status).toBe(200);
    const { token: roomToken } = (await mintRes.json()) as { token: string };
    const claims = await verifyToken<RoomTokenClaims>(roomToken, TEST_SECRET);
    expect(claims?.role).toBe("member");
    expect((claims?.deny ?? 0) & DENY_CHANNEL_SPEAK).toBe(DENY_CHANNEL_SPEAK);
  });

  it("a moderator-flagged group escalates an already-open room socket via live revocation push", async () => {
    const owner = "@tokowner2:local";
    const member = await freshUser();
    const id = await freshStronghold(owner);
    const stub = env.STRONGHOLD_DO.getByName(id);
    await stub.createRoom("general", "channel", "General", ["text"], false);
    await stub.addMember(member.actor, "member");
    const roomRef = `${id}/ch/general`;

    const { ws } = await connectRoom(roomRef, member.actor, "member", 0);
    ws.send(itemCreateFrame("m1", "hi"));
    const ok = await nextMessage(ws);
    expect(ok).not.toMatchObject({ type: "error" });

    const adminToken = await sessionToken("@admingroups7:local", "admin");
    const muted = (await (
      await apiRequest("/api/admin/server-groups", {
        method: "POST", headers: { Authorization: `Bearer ${adminToken}` }, body: JSON.stringify({ name: "Muted2", allow_speak: -1 }),
      })
    ).json()) as { id: string };
    await apiRequest(`/api/admin/server-groups/${muted.id}/members/${member.localpart}`, {
      method: "PUT", headers: { Authorization: `Bearer ${adminToken}` },
    });

    ws.send(itemCreateFrame("m2", "still hi?"));
    const err = await nextMessage(ws);
    expect(err).toMatchObject({ type: "error", code: "OMEW_FORBIDDEN" });
    ws.close();
  });

  it("HTTP gate: a member escalated to mod-equivalent by group assignment can patch stronghold config", async () => {
    const owner = "@gateowner1:local";
    const member = await freshUser();
    const id = await freshStronghold(owner);
    const stub = env.STRONGHOLD_DO.getByName(id);
    await stub.addMember(member.actor, "member");

    const adminToken = await sessionToken("@admingroups8:local", "admin");
    const staff = (await (
      await apiRequest("/api/admin/server-groups", {
        method: "POST", headers: { Authorization: `Bearer ${adminToken}` }, body: JSON.stringify({ name: "Staff", is_moderator: true }),
      })
    ).json()) as { id: string };
    await apiRequest(`/api/admin/server-groups/${staff.id}/members/${member.localpart}`, {
      method: "PUT", headers: { Authorization: `Bearer ${adminToken}` },
    });

    const token = await sessionToken(member.actor);
    const res = await apiRequest(`/api/stronghold/${id}/config`, {
      method: "PATCH", headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify({ description: "set by group-mod" }),
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as Record<string, unknown>).description).toBe("set by group-mod");

    // Still not owner-only capable.
    const visRes = await apiRequest(`/api/stronghold/${id}/config`, {
      method: "PATCH", headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify({ visibility: "private" }),
    });
    expect(visRes.status).toBe(403);
  });

  it("guest actors (federated) never carry server groups", async () => {
    const owner = "@gateowner2:local";
    const guest = "@ghost1:remote.example";
    const id = await freshStronghold(owner);
    const stub = env.STRONGHOLD_DO.getByName(id);
    await stub.addMember(guest, "member");
    const token = await sessionToken(guest);

    const res = await apiRequest(`/api/stronghold/${id}/config`, {
      method: "PATCH", headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify({ description: "nope" }),
    });
    expect(res.status).toBe(403);
  });
});
