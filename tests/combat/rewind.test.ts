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
  // Bea's is 150 ms each way, nine ticks there and back. She saw the world nearly thirteen ticks ago, within the cap, and is judged then.
  expect([combat.lag(far), back(far), back(far) < REWIND_TICKS]).toEqual([9, h.world.tick - far.inputs.view[h.world.tick & far.inputs.mask]!, true]);
  expect(back(far)).toBeGreaterThan(12);

  // A client made for the purpose now sends ada's inputs: each tick it acknowledges `ack` and says it draws `behind` ticks behind that.
  // Her own session, which would acknowledge for a page that draws no frames, hears nothing more.
  const end = h.ends[0]!;
  end.onMessage = null;
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
  // Saying it draws fifteen ticks behind gets the round trip, the tick its input came ahead, and the slack, where it once got the cap.
  tick(c.lastSnapshot, 15);
  expect([back(), 2 + REWIND_SLACK < REWIND_TICKS]).toEqual([2 + REWIND_SLACK, true]);
  // Nor does acknowledging nothing new for half a second before the shot.
  const held = c.lastSnapshot;
  for (let k = 0; k < 15; k++) tick(held, 2);
  expect([h.world.tick - c.ackTick, back()]).toEqual([15, 2 + REWIND_SLACK]);
  // Asking for a whole snapshot is not a new connection. It cannot erase the short round trip before a shot.
  for (let k = 0; k < 3; k++) {
    tick(0, 0);
    expect([c.ackTick, combat.lag(c), c.strikes]).toEqual([0, 1, 0]);
    tick(h.world.tick - 14, 15);
    expect([combat.lag(c), back(), c.strikes]).toEqual([1, 2 + REWIND_SLACK, 0]);
  }
  // A line that is nine ticks long for seconds on end is a long line, and is judged as bea's is.
  for (let k = 0; k < 200; k++) tick(c.lastSnapshot - 8, 2);
  expect([combat.lag(c), back()]).toEqual([9, 11]);
  h.host.shutdown();
});

test("a reconnect and a reused client slot measure their new line independently", () => {
  const h = new Harness({ maxClients: 1 }, 1, 60, { startingCreatures: 0 });
  const first = h.join("ada");
  h.run(1500);
  const c = h.client(first)!;
  expect(h.host.combat.lag(c)).toBe(1);
  h.ends[0]!.close();
  h.run(100);
  const returned = h.join("ada", { latencyMs: 150 });
  h.run(1200);
  expect(h.client(returned)).toBe(c);
  expect(h.host.combat.lag(c)).toBeGreaterThanOrEqual(9);
  expect(h.host.combat.lag(c)).toBeLessThanOrEqual(10);
  h.ends[1]!.close();
  h.run(5500);
  const next = h.join("bea");
  h.run(1200);
  const fresh = h.client(next)!;
  expect(fresh.id).toBe(c.id);
  expect(fresh).not.toBe(c);
  expect(h.host.combat.lag(fresh)).toBe(1);
  h.host.shutdown();
});
