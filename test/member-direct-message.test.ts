import { describe, expect, it } from "vitest";
import { env } from "cloudflare:test";
import { apiRequest, ensureMigrated, registerUser } from "./helpers";

const OWNERSHIP = { ownership_pubkey: "dm-pubkey", ownership_ciphertext: "dm-ciphertext" };

async function createPair() {
  await ensureMigrated();
  const suffix = Date.now().toString(36);
  const owner = await registerUser({ username: `dmo${suffix}`, password: "password123", ...OWNERSHIP });
  const peer = await registerUser({ username: `dmp${suffix}`, password: "password123", ...OWNERSHIP });
  const ownerToken = owner.json.token as string;
  const peerToken = peer.json.token as string;
  const ownerActor = (owner.json.user as { actor: string }).actor;
  const peerActor = (peer.json.user as { actor: string }).actor;
  const id = `dm-${suffix}`;
  const stub = env.STRONGHOLD_DO.getByName(id);
  await stub.initConfig(id, "Private message test", "public", ownerActor);
  await stub.addMember(peerActor);
  return { id, ownerToken, peerToken, ownerActor, peerActor };
}

describe("ordinary member blocks and private messages", () => {
  it("persists a member thread and blocks new messages in either direction", async () => {
    const pair = await createPair();
    const path = `/api/stronghold/${pair.id}/direct-messages/${encodeURIComponent(pair.peerActor)}`;
    const empty = await apiRequest(path, { headers: { Authorization: `Bearer ${pair.ownerToken}` } });
    expect(empty.status).toBe(200);
    expect((await empty.json()) as { messages: unknown[] }).toEqual({ messages: [] });

    const sent = await apiRequest(path, {
      method: "POST",
      headers: { Authorization: `Bearer ${pair.ownerToken}` },
      body: JSON.stringify({ body: "hello private world" }),
    });
    expect(sent.status).toBe(201);
    expect((await sent.json()) as { sender_actor: string; recipient_actor: string; body: string }).toMatchObject({
      sender_actor: pair.ownerActor, recipient_actor: pair.peerActor, body: "hello private world",
    });

    const peerPath = `/api/stronghold/${pair.id}/direct-messages/${encodeURIComponent(pair.ownerActor)}`;
    const thread = await apiRequest(peerPath, { headers: { Authorization: `Bearer ${pair.peerToken}` } });
    expect((await thread.json()) as { messages: Array<{ body: string }> }).toEqual({ messages: [{ body: "hello private world", id: expect.any(String), sender_actor: pair.ownerActor, recipient_actor: pair.peerActor, created_at: expect.any(Number) }] });

    const block = await apiRequest(`/api/stronghold/${pair.id}/blocks/${encodeURIComponent(pair.ownerActor)}`, {
      method: "PUT", headers: { Authorization: `Bearer ${pair.peerToken}` },
    });
    expect(block.status).toBe(200);
    const blocked = await apiRequest(path, {
      method: "POST", headers: { Authorization: `Bearer ${pair.ownerToken}` }, body: JSON.stringify({ body: "must not send" }),
    });
    expect(blocked.status).toBe(403);
    expect(await blocked.json()).toEqual({ error: "DIRECT_MESSAGE_BLOCKED" });
  });

  it("rejects self-targeted ordinary blocks and messages", async () => {
    const pair = await createPair();
    const selfPath = `/api/stronghold/${pair.id}/blocks/${encodeURIComponent(pair.ownerActor)}`;
    const blocked = await apiRequest(selfPath, { method: "PUT", headers: { Authorization: `Bearer ${pair.ownerToken}` } });
    expect(blocked.status).toBe(400);
    expect(await blocked.json()).toEqual({ error: "SELF_TARGET" });
    const message = await apiRequest(`/api/stronghold/${pair.id}/direct-messages/${encodeURIComponent(pair.ownerActor)}`, {
      method: "POST", headers: { Authorization: `Bearer ${pair.ownerToken}` }, body: JSON.stringify({ body: "no self DM" }),
    });
    expect(message.status).toBe(400);
    expect(await message.json()).toEqual({ error: "SELF_TARGET" });
  });
});
