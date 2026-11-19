// A stall at either end is paid for once, by the time it took (planning/architecture/networking.md, Inputs and the clock):
// the server catches up the ticks it owes and a page's clock keeps real time, so no page's clock moves and no input it
// sent comes late. The server's stalls are shaped like those measured on the 16 km Miami (var/look/net/stalls.txt).

import { expect, test } from "bun:test";
import { BitWriter } from "../../shared/net/codec.ts";
import { InputBuffer, PROTOCOL_VERSION, writeHello, writeInputs } from "../../shared/net/protocol.ts";
import { CH_RELIABLE, CH_UNRELIABLE } from "../../shared/net/transport.ts";
import { defaultLook } from "../../shared/anim/look.ts";
import { BTN_SPRINT } from "../../shared/sim/character.ts";
import { REWIND_TICKS } from "../../server/combat.ts";
import { Rig, bursts, frames, turning, type PageOptions } from "../fixtures/stall.ts";
import { Harness, testKey } from "../fixtures/net.ts";

/** Long ticks of two bursts measured in one run, a long one every six ticks, and the live server's worst tick. */
const MEASURED = { 300: [84, 119, 149, 205, 124, 119, 158, 138, 151, 89, 146, 160, 115, 134, 54], 700: [154, 78, 130, 60, 444, 299, 56, 188, 63, 186, 119, 308, 85, 80, 52, 96, 55, 53, 57, 228, 82, 211], 1100: [725] };
const LONG_FRAMES = frames([[5000, 300], [12000, 800], [20000, 2000]]);

/** A walker on a turning path and a page standing by that draws it, watched `ms` after two seconds to settle. */
function play(cost: (k: number) => number, ms: number, walker: PageOptions = {}, link = walker.link ?? { tcp: true, latencyMs: 20 }) {
  const rig = new Rig(cost);
  const w = rig.join("walker", { link, steer: turning, ...walker });
  const v = rig.join("watcher", { link, watch: true });
  rig.run(2000);
  rig.watch();
  rig.run(ms);
  const out = { rig, walker: rig.counts(w), watcher: rig.counts(v), dropped: rig.dropped, late: Math.max(...rig.meter.secondColumns().late), session: w };
  rig.close();
  return out;
}

test("a server whose ticks run late in bursts as measured moves no page's clock, loses no input and corrects nothing, and the meter counts them late", () => {
  const { walker, watcher, dropped, late } = play(bursts(MEASURED), 40000);
  expect([walker.jumps, watcher.jumps, dropped]).toEqual([0, 0, 0]);
  expect([walker.thrown, walker.guessed, walker.corrections]).toEqual([0, 0, 0]);
  // The tick after the one of 725 ms begins about 690 ms late.
  expect(late).toBeGreaterThan(650);
  // Others are never drawn going back.
  expect(watcher.rewinds).toBe(0);
});

test("a stall of half a second or two is caught up: others stand still no longer than it, never go back, and snapshots come at the clock's pace", () => {
  for (const stall of [500, 2000]) {
    const { walker, watcher, dropped } = play(bursts({ 300: [stall] }), 15000);
    expect([walker.jumps, walker.thrown, walker.guessed, walker.corrections, dropped]).toEqual([0, 0, 0, 0, 0]);
    expect(watcher.still).toBeLessThan(stall);
    expect(watcher.rewinds).toBe(0);
    // Thirty snapshots a second of the clock is six or seven in 200 ms; the ticks caught up add no more than two.
    expect(watcher.burst).toBeLessThanOrEqual(9);
    // A shot fired meanwhile is judged at most the rewind's fifteen ticks back, and never refused.
    expect(walker.rewind).toBe(REWIND_TICKS);
  }
});

test("frames of 300, 800 and 2,000 ms leave a walking page's clock on real time: the input after each is on time and nothing is corrected", () => {
  const { walker } = play(bursts({}), 30000, { frame: LONG_FRAMES });
  expect([walker.jumps, walker.thrown, walker.corrections]).toEqual([0, 0, 0]);
  // The ticks of a frame that were never sampled the server holds and lets go of, as the page stepped them.
  expect(walker.guessed).toBeGreaterThan(80);
});

test("both together on a lossy stream cost no jump, and no more thrown inputs or corrections than the stream alone", () => {
  const link = { tcp: true, loss: 0.01, latencyMs: 100 };
  const alone = play(bursts({}), 40000, { link }).walker;
  const both = play(bursts(MEASURED), 40000, { link, frame: LONG_FRAMES });
  expect([both.walker.jumps, both.watcher.jumps, both.dropped]).toEqual([0, 0, 0]);
  expect(both.walker.thrown).toBeLessThanOrEqual(alone.thrown);
  expect(both.walker.corrections).toBeLessThanOrEqual(alone.corrections);
  expect(both.watcher.rewinds).toBe(0);
});

test("a loop more than two seconds behind gives up only the excess, and every page moves its clock back by it at once, losing nothing", () => {
  const giant = play(bursts({ 300: [5000] }), 20000);
  expect(giant.dropped).toBeGreaterThan(80);
  expect([giant.walker.jumps, giant.watcher.jumps]).toEqual([1, 1]);
  expect([giant.walker.thrown, giant.walker.guessed, giant.walker.corrections]).toEqual([0, 0, 0]);
  expect(giant.walker.margin).toBeGreaterThanOrEqual(1);
  // A loop that cannot keep up gives up a tick at a time, and a page moves with each.
  const slow = play((k) => (k >= 300 && k < 520 ? 45 : 7), 25000);
  expect(slow.dropped).toBeGreaterThan(0);
  expect(slow.walker.jumps).toBe(slow.dropped);
  expect([slow.walker.thrown, slow.walker.corrections]).toEqual([0, 0]);
});

test("a page hidden for five seconds is on time at its first frame back", () => {
  const { walker } = play(bursts({}), 15000, { hidden: (at) => at >= 8000 && at < 13000 });
  expect([walker.jumps, walker.thrown, walker.corrections]).toEqual([0, 0, 0]);
  expect(walker.margin).toBeGreaterThanOrEqual(1);
});

test("a clock planted forty ticks early comes back in one jump that keeps what it sent: nothing is corrected and no input is lost", () => {
  const rig = new Rig();
  const s = rig.join("early", { link: { tcp: true, latencyMs: 30 }, steer: turning });
  rig.run(3000);
  rig.watch();
  s.tickClock += 40;
  rig.run(6000);
  const c = rig.counts(s);
  expect(c.jumps).toBe(1);
  expect([c.thrown, c.corrections]).toEqual([0, 0]);
  expect(s.simTick - rig.h.world.tick).toBeGreaterThan(0);
  rig.close();
});

test("inputs banked far ahead buy a body no steps: it steps once a tick whatever is buffered", () => {
  const h = new Harness();
  const end = h.net.connect();
  const w = new BitWriter(256);
  writeHello(w, PROTOCOL_VERSION, h.reg.hash, h.world.anim.set.hash, "banker", 0, testKey("banker"), defaultLook());
  end.send(CH_RELIABLE, w.bytes());
  h.run(300);
  const c = h.server.clients.find((x) => x?.name === "banker")!;
  const inputs = new InputBuffer(256);
  const ents = h.world.ents;
  let most = 0;
  for (let k = 0; k < 200; k++) {
    // Eight ticks of sprinting a message, as far ahead as the window takes.
    const newest = h.world.tick + 250;
    for (let t = newest - 7; t <= newest; t++) inputs.set(t, 0, 127, 0, 0, BTN_SPRINT);
    w.reset();
    writeInputs(w, inputs, 0, newest, 8);
    end.send(CH_UNRELIABLE, w.bytes());
    const [x, z] = [ents.x[c.ent]!, ents.z[c.ent]!];
    h.run(1000 / 30);
    most = Math.max(most, Math.hypot(ents.x[c.ent]! - x, ents.z[c.ent]! - z));
  }
  // Sprint speed is 7.2 m/s, 0.24 m a tick.
  expect(most).toBeLessThan(0.25);
  h.host.shutdown();
});
