import { runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import type { RoomDO } from "../server/src/room-do";
import { connectRoom, itemCreateFrame, nextMessage } from "./helpers";

// proposal S5.2 / m0-protocol S5.1: next_seq is persisted independently of the
// item table and MUST NOT regress when archiving (or any other process) deletes
// rows out of it. This simulates an archive pass (DO alarm -> R2 -> delete rows,
// proposal S6.1) by wiping the item table directly, then proves the next
// allocated seq still continues from where it left off rather than being
// re-derived from the now-empty table.
describe("RoomDO seq monotonicity", () => {
  it("keeps advancing after archive deletes all item rows", async () => {
    const roomRef = "seqtest/ch/general";
    const { ws, stub } = await connectRoom(roomRef, "@alice:local", "owner");

    ws.send(itemCreateFrame("c1", "first"));
    const ack1 = await nextMessage(ws);
    ws.send(itemCreateFrame("c2", "second"));
    const ack2 = await nextMessage(ws);
    ws.send(itemCreateFrame("c3", "third"));
    const ack3 = await nextMessage(ws);

    expect(ack1.seq).toBe(1);
    expect(ack2.seq).toBe(2);
    expect(ack3.seq).toBe(3);

    // Simulate an archive pass: delete every item row (dedupe_local/meta are
    // side tables the archive alarm MUST NOT touch, per proposal S5.1).
    await runInDurableObject(stub, async (_instance: RoomDO, state: DurableObjectState) => {
      const before = state.storage.sql.exec("SELECT COUNT(*) AS n FROM item").one() as { n: number };
      expect(before.n).toBe(3);
      state.storage.sql.exec("DELETE FROM item");
      const after = state.storage.sql.exec("SELECT COUNT(*) AS n FROM item").one() as { n: number };
      expect(after.n).toBe(0);
    });

    // A naive implementation deriving next_seq from MAX(item.seq) would now
    // hand out seq 1 again (table is empty). The spec forbids that.
    ws.send(itemCreateFrame("c4", "fourth"));
    const ack4 = await nextMessage(ws);
    expect(ack4.seq).toBe(4);

    ws.close();
  });

  it("isolates seq counters per room", async () => {
    const { ws: wsA } = await connectRoom("seqtest/ch/room-a", "@alice:local", "owner");
    const { ws: wsB } = await connectRoom("seqtest/ch/room-b", "@bob:local", "owner");

    wsA.send(itemCreateFrame("a1", "hello"));
    const ackA1 = await nextMessage(wsA);
    wsB.send(itemCreateFrame("b1", "hi"));
    const ackB1 = await nextMessage(wsB);

    expect(ackA1.seq).toBe(1);
    expect(ackB1.seq).toBe(1);

    wsA.close();
    wsB.close();
  });
});
