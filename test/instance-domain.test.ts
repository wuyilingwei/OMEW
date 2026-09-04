import { env, runInDurableObject } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import worker from "../server/src/api";
import { signToken } from "../server/src/auth";
import type { RoomTokenClaims } from "../server/src/types";
import type { RoomDO } from "../server/src/room-do";
import { ensureMigrated, itemCreateFrame, nextMessage, registerUser, TEST_SECRET } from "./helpers";

// The default fixture pins the instance domain to "local" so existing actor
// assertions remain stable; this file overrides it only within each test.

const OWNERSHIP = { ownership_pubkey: "test-pubkey", ownership_ciphertext: "test-ciphertext-blob" };

beforeAll(async () => {
  await ensureMigrated();
});

describe("actor domain derivation", () => {
  it("uses the 'local' placeholder by default (vitest.config.ts test fixture)", async () => {
    const { status, json } = await registerUser({ username: "domaintest1", password: "password123", ...OWNERSHIP });
    expect(status).toBe(200);
    expect((json.user as Record<string, unknown>).actor).toBe("@domaintest1:local");
  });

  it("reflects INSTANCE_DOMAIN when the deployment configures one", async () => {
    const original = env.INSTANCE_DOMAIN;
    try {
      env.INSTANCE_DOMAIN = "omew.wuyilingwei.com";
      const { status, json } = await registerUser({ username: "domaintest2", password: "password123", ...OWNERSHIP });
      expect(status).toBe(200);
      expect((json.user as Record<string, unknown>).actor).toBe("@domaintest2:omew.wuyilingwei.com");
    } finally {
      env.INSTANCE_DOMAIN = original;
    }
  });

  it("derives a workers.dev identity through HTTP, WebAuthn, and the proxied room WebSocket", async () => {
    const original = env.INSTANCE_DOMAIN;
    const hostname = "openmew-example.workers.dev";
    try {
      env.INSTANCE_DOMAIN = "";
      const registerResponse = await worker.fetch(new Request(`https://${hostname}/api/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "workersdevuser", password: "password123", ...OWNERSHIP }),
      }), env);
      expect(registerResponse.status).toBe(200);
      const registered = await registerResponse.json() as { token: string; user: { actor: string } };
      expect(registered.user.actor).toBe(`@workersdevuser:${hostname}`);

      const optionsResponse = await worker.fetch(new Request(`https://${hostname}/api/me/passkeys/options`, {
        method: "POST",
        headers: { Authorization: `Bearer ${registered.token}` },
      }), env);
      expect(optionsResponse.status).toBe(200);
      const options = await optionsResponse.json() as { options: { rp: { id: string } } };
      expect(options.options.rp.id).toBe(hostname);

      const strongholdId = "workersdev-domain";
      const stronghold = env.STRONGHOLD_DO.getByName(strongholdId);
      await stronghold.initConfig(strongholdId, "Workers.dev", "public", registered.user.actor);
      await stronghold.createRoom("general", "channel", "General", ["text"], false);
      const roomRef = `${strongholdId}/ch/general`;
      const claims: RoomTokenClaims = {
        v: 1, typ: "room", actor: registered.user.actor, room: roomRef, role: "owner", deny: 0,
        exp: Math.floor(Date.now() / 1000) + 300, jti: crypto.randomUUID(),
      };
      const token = await signToken(claims, TEST_SECRET);
      const socketResponse = await worker.fetch(new Request(`https://${hostname}/stronghold/${strongholdId}/rooms/general/ws`, {
        headers: { Upgrade: "websocket", "Sec-WebSocket-Protocol": token },
      }), env);
      expect(socketResponse.status).toBe(101);
      const ws = socketResponse.webSocket!;
      ws.accept();
      ws.send(itemCreateFrame("workersdev-message", "hello"));
      await nextMessage(ws);

      const room = env.ROOM_DO.getByName(roomRef);
      await runInDurableObject(room, async (_instance: RoomDO, state: DurableObjectState) => {
        const item = state.storage.sql.exec("SELECT origin FROM item").one() as { origin: string };
        expect(item.origin).toBe(hostname);
      });
      ws.close();
    } finally {
      env.INSTANCE_DOMAIN = original;
    }
  });

  it("does not derive an identity from non-workers.dev request hosts", async () => {
    const original = env.INSTANCE_DOMAIN;
    try {
      env.INSTANCE_DOMAIN = "";
      const response = await worker.fetch(new Request("https://untrusted.example/api/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "localfallback", password: "password123", ...OWNERSHIP }),
      }), env);
      const body = await response.json() as { user: { actor: string } };
      expect(body.user.actor).toBe("@localfallback:local");
    } finally {
      env.INSTANCE_DOMAIN = original;
    }
  });
});
