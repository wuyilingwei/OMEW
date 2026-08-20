import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { verifyToken } from "../server/src/auth";
import { synthesizeEffectivePermissions } from "../server/src/permissions";
import { DENY_CHANNEL_SPEAK, DENY_SECTION_POST, DENY_SECTION_REPLY, type RoomTokenClaims } from "../server/src/types";
import {
  apiRequest,
  connectRoom,
  ensureMigrated,
  itemCreateFrame,
  nextMessage,
  sessionToken,
  TEST_SECRET,
} from "./helpers";

// Task 037: stronghold-local custom groups (multi-membership, position-ordered
// tri-state perms + moderator flag) and their synthesis into the existing
// role/deny mechanics - shared by the HTTP permission gate and the WS
// room-token mint. See server/src/permissions.ts for the pure function and
// server/src/stronghold-do.ts for the groups/member_groups tables.

let strongholdSeq = 0;
async function freshStronghold(ownerActor: string, visibility: "public" | "private" = "public"): Promise<string> {
  const id = `grp${Date.now()}${strongholdSeq++}`;
  const stub = env.STRONGHOLD_DO.getByName(id);
  await stub.initConfig(id, "Test Stronghold", visibility, ownerActor);
  return id;
}

beforeAll(async () => {
  await ensureMigrated();
});

// ---- synthesis matrix (pure function, no DO/HTTP involved) -----------------------

describe("synthesizeEffectivePermissions", () => {
  it("built-in owner/mod are unrestricted by any groups passed in", () => {
    const denyEverything = [{ position: 0, perm_speak: -1, perm_post: -1, perm_reply: -1, is_moderator: 0 }];
    expect(synthesizeEffectivePermissions("owner", 7, denyEverything)).toEqual({ role: "owner", deny: 0 });
    expect(synthesizeEffectivePermissions("mod", 7, denyEverything)).toEqual({ role: "mod", deny: 0 });
  });

  it("a plain member with no groups keeps exactly their existing member.deny bits", () => {
    expect(synthesizeEffectivePermissions("member", 0, [])).toEqual({ role: "member", deny: 0 });
    expect(synthesizeEffectivePermissions("member", DENY_CHANNEL_SPEAK, [])).toEqual({ role: "member", deny: DENY_CHANNEL_SPEAK });
  });

  it("higher-position group overrides a lower one's tri-state, per field independently", () => {
    const low = { position: 0, perm_speak: -1, perm_post: 0, perm_reply: 0, is_moderator: 0 };
    const high = { position: 1, perm_speak: 1, perm_post: -1, perm_reply: 0, is_moderator: 0 };
    // speak: high re-allows over low's deny -> not denied. post: only high denies -> denied. reply: untouched.
    expect(synthesizeEffectivePermissions("member", 0, [low, high])).toEqual({ role: "member", deny: DENY_SECTION_POST });
  });

  it("synthesis sorts by position itself - input array order doesn't matter", () => {
    const high = { position: 1, perm_speak: 1, perm_post: 0, perm_reply: 0, is_moderator: 0 };
    const low = { position: 0, perm_speak: -1, perm_post: 0, perm_reply: 0, is_moderator: 0 };
    const result = synthesizeEffectivePermissions("member", 0, [high, low]);
    expect(result.deny & DENY_CHANNEL_SPEAK).toBe(0); // position-1 group still wins regardless of array order
  });

  it("multiple groups combine denials across different fields", () => {
    const speakDeny = { position: 0, perm_speak: -1, perm_post: 0, perm_reply: 0, is_moderator: 0 };
    const replyDeny = { position: 1, perm_speak: 0, perm_post: 0, perm_reply: -1, is_moderator: 0 };
    const result = synthesizeEffectivePermissions("member", 0, [speakDeny, replyDeny]);
    expect(result.deny).toBe(DENY_CHANNEL_SPEAK | DENY_SECTION_REPLY);
  });

  it("any held group flagged moderator escalates to mod and forces deny to 0, overriding member.deny", () => {
    const modGroup = { position: 0, perm_speak: -1, perm_post: -1, perm_reply: -1, is_moderator: 1 };
    const punished = DENY_CHANNEL_SPEAK | DENY_SECTION_POST | DENY_SECTION_REPLY;
    expect(synthesizeEffectivePermissions("member", punished, [modGroup])).toEqual({ role: "mod", deny: 0 });
  });

  it("member-level deny bit overrides last, adding a denial on top of an explicit group allow", () => {
    const allowAll = { position: 0, perm_speak: 1, perm_post: 1, perm_reply: 1, is_moderator: 0 };
    const result = synthesizeEffectivePermissions("member", DENY_SECTION_POST, [allowAll]);
    expect(result.deny).toBe(DENY_SECTION_POST);
  });
});

// ---- StrongholdDO.getEffective (member + groups + synthesis, one call) -----------

describe("StrongholdDO.getEffective", () => {
  it("null for a non-member or a banned member", async () => {
    const owner = "@effowner1:local";
    const id = await freshStronghold(owner);
    const stub = env.STRONGHOLD_DO.getByName(id);
    expect(await stub.getEffective("@nobody1:local")).toBeNull();

    const banned = "@effbanned1:local";
    await stub.addMember(banned, "member");
    await stub.banMember(banned, owner);
    expect(await stub.getEffective(banned)).toBeNull();
  });

  it("folds a member's held groups into role/deny", async () => {
    const owner = "@effowner2:local";
    const member = "@effmember2:local";
    const id = await freshStronghold(owner);
    const stub = env.STRONGHOLD_DO.getByName(id);
    await stub.addMember(member, "member");
    const muted = await stub.createGroup("Muted", null, -1, 0, 0, false);
    await stub.addMemberToGroup(member, muted.id);

    expect(await stub.getEffective(member)).toEqual({ role: "member", deny: DENY_CHANNEL_SPEAK });
    expect(await stub.getEffective(owner)).toEqual({ role: "owner", deny: 0 });
  });
});

// ---- group CRUD + position reordering ---------------------------------------------

describe("groups CRUD API", () => {
  it("owner can create, list, patch, and delete a group", async () => {
    const owner = "@crudowner1:local";
    const id = await freshStronghold(owner);
    const token = await sessionToken(owner);

    const createRes = await apiRequest(`/api/stronghold/${id}/groups`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ name: "VIP", color: "#ff00aa", perm_speak: 1 }),
    });
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as Record<string, unknown>;
    expect(created).toMatchObject({
      name: "VIP", color: "#ff00aa", perm_speak: 1, perm_post: 0, perm_reply: 0, is_moderator: false, position: 0,
    });

    const listRes = await apiRequest(`/api/stronghold/${id}/groups`, { headers: { Authorization: `Bearer ${token}` } });
    expect(((await listRes.json()) as { groups: unknown[] }).groups).toHaveLength(1);

    const patchRes = await apiRequest(`/api/stronghold/${id}/groups/${created.id}`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ name: "VIP+", is_moderator: true }),
    });
    expect(patchRes.status).toBe(200);
    const patched = (await patchRes.json()) as Record<string, unknown>;
    expect(patched).toMatchObject({ name: "VIP+", is_moderator: true });

    const delRes = await apiRequest(`/api/stronghold/${id}/groups/${created.id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(delRes.status).toBe(204);

    const afterDelete = await apiRequest(`/api/stronghold/${id}/groups`, { headers: { Authorization: `Bearer ${token}` } });
    expect(((await afterDelete.json()) as { groups: unknown[] }).groups).toHaveLength(0);
  });

  it("rejects invalid name/color/perm values", async () => {
    const owner = "@crudowner2:local";
    const id = await freshStronghold(owner);
    const token = await sessionToken(owner);

    const badName = await apiRequest(`/api/stronghold/${id}/groups`, {
      method: "POST", headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify({ name: "" }),
    });
    expect(badName.status).toBe(400);
    expect(await badName.json()).toEqual({ error: "GROUP_NAME_INVALID" });

    const tooLongName = await apiRequest(`/api/stronghold/${id}/groups`, {
      method: "POST", headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify({ name: "x".repeat(33) }),
    });
    expect(tooLongName.status).toBe(400);
    expect(await tooLongName.json()).toEqual({ error: "GROUP_NAME_INVALID" });

    const badColor = await apiRequest(`/api/stronghold/${id}/groups`, {
      method: "POST", headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify({ name: "X", color: "red" }),
    });
    expect(badColor.status).toBe(400);
    expect(await badColor.json()).toEqual({ error: "GROUP_COLOR_INVALID" });

    const badPerm = await apiRequest(`/api/stronghold/${id}/groups`, {
      method: "POST", headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify({ name: "X", perm_speak: 5 }),
    });
    expect(badPerm.status).toBe(400);
    expect(await badPerm.json()).toEqual({ error: "GROUP_PERM_INVALID" });
  });

  it("a plain member cannot manage groups; a mod can", async () => {
    const owner = "@crudowner3:local";
    const mod = "@crudmod3:local";
    const member = "@crudmember3:local";
    const id = await freshStronghold(owner);
    const stub = env.STRONGHOLD_DO.getByName(id);
    await stub.addMember(mod, "mod");
    await stub.addMember(member, "member");
    const memberToken = await sessionToken(member);
    const modToken = await sessionToken(mod);

    const byMember = await apiRequest(`/api/stronghold/${id}/groups`, {
      method: "POST", headers: { Authorization: `Bearer ${memberToken}` }, body: JSON.stringify({ name: "X" }),
    });
    expect(byMember.status).toBe(403);
    expect(await byMember.json()).toEqual({ error: "FORBIDDEN" });

    const byMod = await apiRequest(`/api/stronghold/${id}/groups`, {
      method: "POST", headers: { Authorization: `Bearer ${modToken}` }, body: JSON.stringify({ name: "X" }),
    });
    expect(byMod.status).toBe(201);
  });

  it("server owner/admin overlay can manage groups without real membership", async () => {
    const owner = "@crudowner4:local";
    const id = await freshStronghold(owner);
    const serverAdminToken = await sessionToken("@serveradmin4:local", "admin");

    const res = await apiRequest(`/api/stronghold/${id}/groups`, {
      method: "POST", headers: { Authorization: `Bearer ${serverAdminToken}` }, body: JSON.stringify({ name: "AdminGroup" }),
    });
    expect(res.status).toBe(201);
  });

  it("position defaults to append order; bulk PATCH .../groups reorders", async () => {
    const owner = "@crudowner5:local";
    const id = await freshStronghold(owner);
    const token = await sessionToken(owner);
    const stub = env.STRONGHOLD_DO.getByName(id);

    const a = await stub.createGroup("A", null, 0, 0, 0, false);
    const b = await stub.createGroup("B", null, 0, 0, 0, false);
    expect(a.position).toBe(0);
    expect(b.position).toBe(1);

    const reorderRes = await apiRequest(`/api/stronghold/${id}/groups`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ positions: [{ id: a.id, position: 5 }, { id: b.id, position: 1 }] }),
    });
    expect(reorderRes.status).toBe(200);
    const body = (await reorderRes.json()) as { groups: Array<{ id: string; position: number }> };
    expect(body.groups.map((g) => g.id)).toEqual([b.id, a.id]);
  });

  it("individual PATCH .../groups/:gid also accepts a position move", async () => {
    const owner = "@crudowner6:local";
    const id = await freshStronghold(owner);
    const token = await sessionToken(owner);
    const stub = env.STRONGHOLD_DO.getByName(id);
    const a = await stub.createGroup("A", null, 0, 0, 0, false);

    const res = await apiRequest(`/api/stronghold/${id}/groups/${a.id}`, {
      method: "PATCH", headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify({ position: 9 }),
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { position: number }).position).toBe(9);
  });

  it("404s patching/deleting an unknown group id", async () => {
    const owner = "@crudowner7:local";
    const id = await freshStronghold(owner);
    const token = await sessionToken(owner);

    const patchRes = await apiRequest(`/api/stronghold/${id}/groups/does-not-exist`, {
      method: "PATCH", headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify({ name: "X" }),
    });
    expect(patchRes.status).toBe(404);

    const delRes = await apiRequest(`/api/stronghold/${id}/groups/does-not-exist`, {
      method: "DELETE", headers: { Authorization: `Bearer ${token}` },
    });
    expect(delRes.status).toBe(404);
  });
});

// ---- member <-> group assignment ---------------------------------------------------

describe("member <-> group assignment", () => {
  it("owner can add/remove a member's group; a member can hold multiple groups", async () => {
    const owner = "@assignowner1:local";
    const member = "@assignmember1:local";
    const id = await freshStronghold(owner);
    const stub = env.STRONGHOLD_DO.getByName(id);
    await stub.addMember(member, "member");
    const g1 = await stub.createGroup("G1", null, 0, 0, 0, false);
    const g2 = await stub.createGroup("G2", null, 0, 0, 0, false);
    const token = await sessionToken(owner);

    const put1 = await apiRequest(`/api/stronghold/${id}/members/${encodeURIComponent(member)}/groups/${g1.id}`, {
      method: "PUT", headers: { Authorization: `Bearer ${token}` },
    });
    expect(put1.status).toBe(204);
    const put2 = await apiRequest(`/api/stronghold/${id}/members/${encodeURIComponent(member)}/groups/${g2.id}`, {
      method: "PUT", headers: { Authorization: `Bearer ${token}` },
    });
    expect(put2.status).toBe(204);

    const groups = await stub.listMemberGroups(member);
    expect(groups.map((g) => g.id).sort()).toEqual([g1.id, g2.id].sort());

    const del = await apiRequest(`/api/stronghold/${id}/members/${encodeURIComponent(member)}/groups/${g1.id}`, {
      method: "DELETE", headers: { Authorization: `Bearer ${token}` },
    });
    expect(del.status).toBe(204);
    const after = await stub.listMemberGroups(member);
    expect(after.map((g) => g.id)).toEqual([g2.id]);
  });

  it("cannot assign a group to the owner", async () => {
    const owner = "@assignowner2:local";
    const id = await freshStronghold(owner);
    const stub = env.STRONGHOLD_DO.getByName(id);
    const g1 = await stub.createGroup("G1", null, 0, 0, 0, false);
    const token = await sessionToken(owner);

    const res = await apiRequest(`/api/stronghold/${id}/members/${encodeURIComponent(owner)}/groups/${g1.id}`, {
      method: "PUT", headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(403);
  });

  it("404s assigning an unknown member", async () => {
    const owner = "@assignowner3:local";
    const id = await freshStronghold(owner);
    const stub = env.STRONGHOLD_DO.getByName(id);
    const g1 = await stub.createGroup("G1", null, 0, 0, 0, false);
    const token = await sessionToken(owner);

    const res = await apiRequest(`/api/stronghold/${id}/members/${encodeURIComponent("@ghost3:local")}/groups/${g1.id}`, {
      method: "PUT", headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(404);
  });

  it("members list entries carry groups: [{id,name,color}]", async () => {
    const owner = "@assignowner4:local";
    const member = "@assignmember4:local";
    const id = await freshStronghold(owner);
    const stub = env.STRONGHOLD_DO.getByName(id);
    await stub.addMember(member, "member");
    const g1 = await stub.createGroup("Cool", "#123456", 0, 0, 0, false);
    await stub.addMemberToGroup(member, g1.id);
    const token = await sessionToken(owner);

    const res = await apiRequest(`/api/stronghold/${id}/members`, { headers: { Authorization: `Bearer ${token}` } });
    const body = (await res.json()) as {
      entries: Array<{ actor: string; groups: Array<{ id: string; name: string; color: string | null }> }>;
    };
    const entry = body.entries.find((e) => e.actor === member);
    expect(entry?.groups).toEqual([{ id: g1.id, name: "Cool", color: "#123456" }]);
    const ownerEntry = body.entries.find((e) => e.actor === owner);
    expect(ownerEntry?.groups).toEqual([]);
  });
});

// ---- token mint reflects the group-synthesized effective role/deny ----------------

describe("WS room-token mint reflects group synthesis", () => {
  it("a group with perm_speak=-1 bakes DENY_CHANNEL_SPEAK into the minted token", async () => {
    const owner = "@tokowner1:local";
    const member = "@tokmember1:local";
    const id = await freshStronghold(owner);
    const stub = env.STRONGHOLD_DO.getByName(id);
    await stub.createRoom("general", "channel", "General", ["text"], false);
    await stub.addMember(member, "member");
    const muted = await stub.createGroup("Muted", null, -1, 0, 0, false);
    await stub.addMemberToGroup(member, muted.id);
    const session = await sessionToken(member);

    const mintRes = await apiRequest(`/stronghold/${id}/rooms/general/token`, {
      method: "POST", headers: { Authorization: `Bearer ${session}` },
    });
    expect(mintRes.status).toBe(200);
    const { token: roomToken } = (await mintRes.json()) as { token: string };
    const claims = await verifyToken<RoomTokenClaims>(roomToken, TEST_SECRET);
    expect(claims?.role).toBe("member");
    expect((claims?.deny ?? 0) & DENY_CHANNEL_SPEAK).toBe(DENY_CHANNEL_SPEAK);
  });

  it("a moderator-flagged group escalates the minted token to role mod, deny 0, overriding prior punishment", async () => {
    const owner = "@tokowner2:local";
    const member = "@tokmember2:local";
    const id = await freshStronghold(owner);
    const stub = env.STRONGHOLD_DO.getByName(id);
    await stub.createRoom("general", "channel", "General", ["text"], false);
    await stub.addMember(member, "member", DENY_CHANNEL_SPEAK); // pre-existing individual punishment
    const staff = await stub.createGroup("Staff", null, 0, 0, 0, true);
    await stub.addMemberToGroup(member, staff.id);
    const session = await sessionToken(member);

    const mintRes = await apiRequest(`/stronghold/${id}/rooms/general/token`, {
      method: "POST", headers: { Authorization: `Bearer ${session}` },
    });
    const { token: roomToken } = (await mintRes.json()) as { token: string };
    const claims = await verifyToken<RoomTokenClaims>(roomToken, TEST_SECRET);
    expect(claims?.role).toBe("mod");
    expect(claims?.deny).toBe(0);
  });

  it("end to end: a group-denied speak permission actually blocks item.create over WS", async () => {
    const owner = "@tokowner3:local";
    const member = "@tokmember3:local";
    const id = await freshStronghold(owner);
    const stub = env.STRONGHOLD_DO.getByName(id);
    await stub.addMember(member, "member");
    const muted = await stub.createGroup("Muted", null, -1, 0, 0, false);
    await stub.addMemberToGroup(member, muted.id);
    const roomRef = `${id}/ch/general`;

    const eff = await stub.getEffective(member);
    expect(eff).toEqual({ role: "member", deny: DENY_CHANNEL_SPEAK });

    const { ws } = await connectRoom(roomRef, member, eff!.role, eff!.deny);
    ws.send(itemCreateFrame("m1", "hi"));
    const err = await nextMessage(ws);
    expect(err).toMatchObject({ type: "error", code: "OMEW_FORBIDDEN" });
    ws.close();
  });

  it("group changes take effect on the member's next token mint (no live-socket kick exists for any permission change today, ban/deny included - same propagation model)", async () => {
    const owner = "@propowner1:local";
    const member = "@propmember1:local";
    const id = await freshStronghold(owner);
    const stub = env.STRONGHOLD_DO.getByName(id);
    await stub.createRoom("general", "channel", "General", ["text"], false);
    await stub.addMember(member, "member");
    const session = await sessionToken(member);

    const before = await apiRequest(`/stronghold/${id}/rooms/general/token`, {
      method: "POST", headers: { Authorization: `Bearer ${session}` },
    });
    const beforeClaims = await verifyToken<RoomTokenClaims>((await before.json() as { token: string }).token, TEST_SECRET);
    expect(beforeClaims?.role).toBe("member");

    const staff = await stub.createGroup("Staff", null, 0, 0, 0, true);
    await stub.addMemberToGroup(member, staff.id);

    const after = await apiRequest(`/stronghold/${id}/rooms/general/token`, {
      method: "POST", headers: { Authorization: `Bearer ${session}` },
    });
    const afterClaims = await verifyToken<RoomTokenClaims>((await after.json() as { token: string }).token, TEST_SECRET);
    expect(afterClaims?.role).toBe("mod");
  });
});

// ---- HTTP permission gate honors group-escalated moderator status -----------------

describe("HTTP gate: group-escalated moderator status", () => {
  it("a member escalated to mod-equivalent by a group can patch stronghold config", async () => {
    const owner = "@gateowner1:local";
    const member = "@gatemember1:local";
    const id = await freshStronghold(owner);
    const stub = env.STRONGHOLD_DO.getByName(id);
    await stub.addMember(member, "member");
    const staff = await stub.createGroup("Staff", null, 0, 0, 0, true);
    await stub.addMemberToGroup(member, staff.id);
    const token = await sessionToken(member);

    const res = await apiRequest(`/api/stronghold/${id}/config`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ description: "set by group-mod" }),
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as Record<string, unknown>).description).toBe("set by group-mod");
  });

  it("a group-escalated mod still cannot change visibility (owner-only) or appoint a real mod", async () => {
    const owner = "@gateowner2:local";
    const member = "@gatemember2:local";
    const id = await freshStronghold(owner);
    const stub = env.STRONGHOLD_DO.getByName(id);
    await stub.addMember(member, "member");
    const staff = await stub.createGroup("Staff", null, 0, 0, 0, true);
    await stub.addMemberToGroup(member, staff.id);
    const token = await sessionToken(member);

    const visRes = await apiRequest(`/api/stronghold/${id}/config`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ visibility: "private" }),
    });
    expect(visRes.status).toBe(403);

    const other = "@gateother2:local";
    await stub.addMember(other, "member");
    const roleRes = await apiRequest(`/api/stronghold/${id}/members/${encodeURIComponent(other)}`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ role: "mod" }),
    });
    expect(roleRes.status).toBe(403);
  });

  it("a plain member (no moderator group) is still forbidden from tier-gated actions", async () => {
    const owner = "@gateowner3:local";
    const member = "@gatemember3:local";
    const id = await freshStronghold(owner);
    const stub = env.STRONGHOLD_DO.getByName(id);
    await stub.addMember(member, "member");
    const speakOnly = await stub.createGroup("SpeakOnly", null, 1, 0, 0, false);
    await stub.addMemberToGroup(member, speakOnly.id);
    const token = await sessionToken(member);

    const res = await apiRequest(`/api/stronghold/${id}/config`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ description: "nope" }),
    });
    expect(res.status).toBe(403);
  });
});
