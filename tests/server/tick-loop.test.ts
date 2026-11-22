// The server's loop (server/main.ts tickLoop): one tick a call, so requests and sockets are served between ticks that
// run late, and still TICK_RATE ticks a second of its clock: a stall of up to CATCH_UP_MS is caught up, and only what is
// past it is given up, and told.

import { expect, test } from "bun:test";
import { CATCH_UP_MS, tickLoop } from "../../server/main.ts";
import { TICK_RATE } from "../../shared/coords.ts";

const TICK_MS = 1000 / TICK_RATE;

/**
 * A loop on a made-up clock, each tick taking `cost(k)` ms of it: the ticks run in each call, how many more each said
 * were due, the clock and the ticks run after each call, and the ticks given up.
 */
function run(cost: (k: number) => number, calls: number) {
  let clock = 0;
  let ticks = 0;
  let dropped = 0;
  const behind: number[] = [];
  let due: (() => void) | null = null;
  tickLoop(
    { tick: (_due, owed) => (behind.push(owed), (clock += cost(ticks++))), idle: () => {}, drop: (n) => (dropped += n) },
    () => clock,
    (go, ms) => {
      due = () => ((clock += ms), go());
      return () => (due = null);
    },
  );
  const perCall: number[] = [];
  const ranBy: [number, number][] = [];
  for (let k = 0; k < calls && due; k++) {
    const before = ticks;
    (due as () => void)();
    perCall.push(ticks - before);
    ranBy.push([clock, ticks + dropped]);
  }
  return { perCall, clock, dropped, behind, ranBy, ticks };
}

test("ticks that each cost twice their time run one a call, every call, and never two", () => {
  const { perCall } = run(() => 2000 / TICK_RATE, 300);
  expect(Math.max(...perCall)).toBe(1);
  expect(perCall.slice(10).every((n) => n === 1)).toBe(true);
});

test("ticks that cost nothing run TICK_RATE a second of the loop's clock", () => {
  const { perCall, clock } = run(() => 0, 3 * TICK_RATE);
  expect(perCall.reduce((n, k) => n + k, 0)).toBe(Math.round((clock * TICK_RATE) / 1000));
});

test("a stall of up to two seconds is caught up a tick a call with nothing given up, and past that only the excess is given up", () => {
  for (const stall of [210, 1010, CATCH_UP_MS - 40, 5010, 20010]) {
    const { perCall, clock, dropped, behind, ticks } = run((k) => (k === 5 ? stall : 0), 25 * TICK_RATE);
    expect(Math.max(...perCall)).toBe(1);
    // Every tick its clock has come to is run or given up.
    expect(Math.abs(ticks + dropped - Math.floor(clock / TICK_MS))).toBeLessThanOrEqual(1);
    // The tick after the stall says how many more were due as it began, and the count falls by one a tick as they are caught up.
    expect(behind[6]).toBe(Math.floor((stall - TICK_MS) / TICK_MS));
    // Past CATCH_UP_MS what is past it is given up as that tick ends, and what is left is caught up.
    expect(dropped).toBe(stall - 2 * TICK_MS > CATCH_UP_MS ? Math.ceil((stall - 2 * TICK_MS - CATCH_UP_MS) / TICK_MS) : 0);
    const left = behind[7]!;
    expect(left).toBe(behind[6]! - 1 - dropped);
    for (let k = 8; k < 7 + left; k++) expect(behind[k]).toBe(behind[k - 1]! - 1);
  }
});

test("from the start to any call the loop has run no more ticks than its clock allows, a burst after a stall only paying back ticks owed", () => {
  const { ranBy } = run((k) => (k % 50 === 7 ? 900 : k % 3 === 0 ? 45 : 2), 40 * TICK_RATE);
  for (const [clock, ran] of ranBy) expect(ran).toBeLessThanOrEqual(Math.floor(clock / TICK_MS) + 1);
});
