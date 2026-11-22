// A whole server and whole clients with a round trip between them. The benchmark's probe at a size a test can afford.

import { expect, test } from "bun:test";
import { watch } from "../../tools/bench/latency.ts";

test("clients a round trip from the server, among more walking creatures than a snapshot carries, see none step back and none blink out", () => {
  // 300 bytes a snapshot carries about a third of the herd's moves.
  for (const rtt of [100, 200]) {
    const r = watch({ rtt, clients: 2, species: "core:grazer", herd: 80, settle: 0, seconds: 4, game: { snapshotBytes: 300 } });
    expect(r.moves).toBeGreaterThan(2000);
    expect([r.back, r.blinks, r.undecodable]).toEqual([0, 0, 0]);
    // The herd is all there in the time its creates take to send, however far the client is.
    expect(r.filled).toBeLessThan(1.2);
    expect(r.shown).toBeGreaterThan(70);
    expect(r.bytes).toBeLessThan(300 * 30);
  }
});
