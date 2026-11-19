// The server's loop (server/main.ts tickLoop): one tick a call, so requests and sockets are served between ticks that
// run late, and still TICK_RATE ticks a second of its clock with a backlog of at most 250 ms caught up.

import { expect, test } from "bun:test";
import { tickLoop } from "../../server/main.ts";
import { TICK_RATE } from "../../shared/coords.ts";

/** A loop on a made-up clock, each tick taking `cost(k)` ms of it: the ticks run in each call, the clock, and the ticks given up. */
function run(cost: (k: number) => number, calls: number): { perCall: number[]; clock: number; dropped: number } {
  let clock = 0;
  let ticks = 0;
  let dropped = 0;
  let due: (() => void) | null = null;
  tickLoop(
    { tick: () => (clock += cost(ticks++)), idle: () => {}, drop: (n) => (dropped += n) },
    () => clock,
    (go, ms) => {
      due = () => ((clock += ms), go());
      return () => (due = null);
    },
  );
  const perCall: number[] = [];
  for (let k = 0; k < calls && due; k++) {
    const before = ticks;
    (due as () => void)();
    perCall.push(ticks - before);
  }
  return { perCall, clock, dropped };
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

test("after one tick of 200 ms the ticks it held back are caught up one a call, and after one of a second they are given up", () => {
  /** Ticks run less ticks the clock is due, and the ticks given up, with tick 5 taking `stall` ms. */
  const short = (stall: number): [number, number] => {
    const { perCall, clock, dropped } = run((k) => (k === 5 ? stall : 0), 4 * TICK_RATE);
    return [perCall.reduce((n, k) => n + k, 0) - Math.floor((clock * TICK_RATE) / 1000), dropped];
  };
  expect(Math.abs(short(200)[0])).toBeLessThanOrEqual(1);
  expect(short(200)[1]).toBe(0);
  // What is not run is what is told given up.
  const [behind, dropped] = short(1000);
  expect(behind).toBeLessThan(-20);
  expect(Math.abs(behind + dropped)).toBeLessThanOrEqual(1);
});
