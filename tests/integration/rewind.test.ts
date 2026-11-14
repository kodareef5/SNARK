// How far back a shot is judged: as far as the shooter's own line explains, and never by its word alone.

import { expect, test } from "bun:test";
import { REWIND_SLACK, REWIND_TICKS } from "../../server/combat.ts";
import { BitWriter } from "../../shared/net/codec.ts";
import { INPUT_WINDOW, InputBuffer, writeInputs } from "../../shared/net/protocol.ts";
import { CH_UNRELIABLE } from "../../shared/net/transport.ts";
import { Harness } from "../fixtures/net.ts";

test("a shot is judged no further back than the round trip the server measured, whatever the client says it saw and however it holds back what it acknowledges", () => {
  const h = new Harness({}, 1, 60, { dev: true });
  const ada = h.join("ada");
  const bea = h.join("bea", { latencyMs: 150 });
  h.run(3000);
  const combat = h.host.combat;
  const c = h.client(ada)!;
  const far = h.client(bea)!;
  const back = (of = c): number => h.world.tick - combat.viewTick(of);
  // Ada's line is short: a round trip of one tick, and she says she saw the world four or five ticks ago, which stands.
  expect(combat.lag(c)).toBe(1);
  expect(back()).toBe(h.world.tick - c.inputs.view[h.world.tick & c.inputs.mask]!);
  expect([back() > 3, back() < 6]).toEqual([true, true]);
  // Bea's is 150 ms each way, nine ticks there and back. She saw the world thirteen ticks ago and is judged at the cap.
  expect([combat.lag(far), back(far)]).toEqual([9, REWIND_TICKS]);

  // A client made for the purpose now sends ada's inputs: each tick it acknowledges `ack` and says it draws `behind` ticks behind that.
  const end = h.ends[0]!;
  const buf = new InputBuffer(INPUT_WINDOW);
  const w = new BitWriter(256);
  const tick = (ack: number, behind: number): void => {
    const T = h.world.tick + 1;
    buf.set(T, 0, 0, 0, 0, 0);
    w.reset();
    writeInputs(w, buf, ack, T, 1, behind);
    end.send(CH_UNRELIABLE, w.bytes());
    h.net.advance(h.now);
    h.server.tick();
  };
  // What her own client sent ahead runs out first. Acknowledging at once and drawing two ticks behind is three ticks back.
  for (let k = 0; k < 12; k++) tick(c.lastSnapshot, 2);
  expect([combat.lag(c), back()]).toEqual([1, 3]);
  // Saying it draws fifteen ticks behind gets the round trip and the slack, where it once got the cap.
  tick(c.lastSnapshot, 15);
  expect([back(), 1 + REWIND_SLACK < REWIND_TICKS]).toEqual([1 + REWIND_SLACK, true]);
  // Nor does acknowledging nothing new for half a second before the shot.
  const held = c.lastSnapshot;
  for (let k = 0; k < 15; k++) tick(held, 2);
  expect([h.world.tick - c.ackTick, back()]).toEqual([15, 1 + REWIND_SLACK]);
  // A line that is nine ticks long for seconds on end is a long line, and is judged as bea's is.
  for (let k = 0; k < 200; k++) tick(c.lastSnapshot - 8, 2);
  expect([combat.lag(c), back()]).toEqual([9, 11]);
});
