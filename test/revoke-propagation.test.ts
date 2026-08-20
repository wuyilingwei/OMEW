import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { DENY_CHANNEL_SPEAK } from "../server/src/types";
import {
  connectRoom,
  ensureMigrated,
  itemCreateFrame,
  itemDeleteFrame,
  nextClose,
  nextMessage,
} from "./helpers";

// m0-protocol §7.3 revocation propagation: StrongholdDO pushes a local
// member.revoke frame to every room DO it owns whenever ban/kick/role-deny/group
// state changes, so an already-established WS connection is corrected or torn
// down immediately rather than waiting out its (<=300s) token exp. The room MUST
// be registered via StrongholdDO.createRoom for it to be a push target - same
// requirement as the existing edit-config push tests (stronghold-management.test.ts).

let strongholdSeq = 0;
async function freshStronghold(ownerActor: string): Promise<string> {
  const id = `revoke${Date.now()}${strongholdSeq++}`;
  const stub = env.STRONGHOLD_DO.getByName(id);
  await stub.initConfig(id, "Revoke Test Stronghold", "public", ownerActor);
  await stub.createRoom("general", "channel", "General", ["text"], false);
  return id;
}

beforeAll(async () => {
  await ensureMigrated();
});

describe("member.revoke propagation (m0-protocol §7.3)", () => {
  it("closes a banned member's live WS connection", async () => {
    const owner = "@revokeowner1:local";
    const target = "@revokebanned1:local";
    const id = await freshStronghold(owner);
    const stub = env.STRONGHOLD_DO.getByName(id);
    await stub.addMember(target, "member");
    const roomRef = `${id}/ch/general`;
    const { ws } = await connectRoom(roomRef, target, "member");

    // Subscribe before triggering the ban - StrongholdDO awaits the room push
    // synchronously, so the close can already have fired by the time banMember's
    // own promise resolves.
    const closePromise = nextClose(ws);
    await stub.banMember(target, owner);

    const closeEvent = await closePromise;
    expect(closeEvent.code).toBe(1008);
    expect(closeEvent.reason).toBe("OMEW_SESSION_INVALID");
  });

  it("closes a kicked member's live WS connection", async () => {
    const owner = "@revokeowner2:local";
    const target = "@revokekicked2:local";
    const id = await freshStronghold(owner);
    const stub = env.STRONGHOLD_DO.getByName(id);
    await stub.addMember(target, "member");
    const roomRef = `${id}/ch/general`;
    const { ws } = await connectRoom(roomRef, target, "member");

    const closePromise = nextClose(ws);
    const removed = await stub.removeMember(target);
    expect(removed).toBe(true);

    const closeEvent = await closePromise;
    expect(closeEvent.code).toBe(1008);
  });

  it("updates a live connection's deny bits so its next write is rejected", async () => {
    const owner = "@revokeowner3:local";
    const target = "@revokedeny3:local";
    const id = await freshStronghold(owner);
    const stub = env.STRONGHOLD_DO.getByName(id);
    await stub.addMember(target, "member", 0);
    const roomRef = `${id}/ch/general`;
    const { ws } = await connectRoom(roomRef, target, "member", 0);

    // Deny wasn't in effect at handshake time - this message goes through.
    ws.send(itemCreateFrame("m1", "before deny"));
    const ack1 = await nextMessage(ws);
    expect(ack1).toMatchObject({ type: "ack", status: "ok" });

    const updated = await stub.updateMember(target, { deny: DENY_CHANNEL_SPEAK });
    expect(updated?.deny).toBe(DENY_CHANNEL_SPEAK);

    // Same connection, no reconnect - attachment must already carry the new deny.
    ws.send(itemCreateFrame("m2", "after deny"));
    const err = await nextMessage(ws);
    expect(err).toMatchObject({ type: "error", code: "OMEW_FORBIDDEN" });
  });

  it("revokes a moderator group's live privilege without disconnecting the socket", async () => {
    const owner = "@revokeowner4:local";
    const target = "@revokemod4:local";
    const victim = "@revokevictim4:local";
    const id = await freshStronghold(owner);
    const stub = env.STRONGHOLD_DO.getByName(id);
    const group = await stub.createGroup("Mods", null, 0, 0, 0, true);
    await stub.addMember(target, "member");
    await stub.addMemberToGroup(target, group.id);

    const roomRef = `${id}/ch/general`;
    // Token mint (api.ts) would have resolved this member to "mod" via
    // getEffective at handshake time - simulated directly here, same as every
    // other connectRoom call in this suite.
    const { ws: modWs } = await connectRoom(roomRef, target, "mod");
    const { ws: victimWs } = await connectRoom(roomRef, victim, "member");

    victimWs.send(itemCreateFrame("m1", "first"));
    const ack1 = await nextMessage(victimWs);
    const seq1 = ack1.seq as number;

    modWs.send(itemDeleteFrame(seq1));
    const deleteAck = await nextMessage(modWs);
    expect(deleteAck).toMatchObject({ type: "ack", status: "ok", target_seq: seq1 });

    await stub.removeMemberFromGroup(target, group.id);

    victimWs.send(itemCreateFrame("m2", "second"));
    const ack2 = await nextMessage(victimWs);
    const seq2 = ack2.seq as number;

    // Same socket, still open (this was update_deny, not close) - but the
    // privilege is gone now that the moderator group no longer applies.
    modWs.send(itemDeleteFrame(seq2));
    const forbidden = await nextMessage(modWs);
    expect(forbidden).toMatchObject({ type: "error", code: "OMEW_FORBIDDEN" });
  });

  it("leaves an unrelated member's connection untouched by another member's ban", async () => {
    const owner = "@revokeowner5:local";
    const target = "@revokebanned5:local";
    const bystander = "@revokebystander5:local";
    const id = await freshStronghold(owner);
    const stub = env.STRONGHOLD_DO.getByName(id);
    await stub.addMember(target, "member");
    await stub.addMember(bystander, "member");
    const roomRef = `${id}/ch/general`;
    const { ws: targetWs } = await connectRoom(roomRef, target, "member");
    const { ws: bystanderWs } = await connectRoom(roomRef, bystander, "member");

    const closePromise = nextClose(targetWs);
    await stub.banMember(target, owner);
    await closePromise;

    // The bystander's connection never got touched by target's revoke frame.
    bystanderWs.send(itemCreateFrame("m1", "still here"));
    const ack = await nextMessage(bystanderWs);
    expect(ack).toMatchObject({ type: "ack", status: "ok" });

    bystanderWs.close();
  });
});
