// The server's loop (server/main.ts tickLoop): one tick a call, so requests and sockets are served between ticks that
// run late, and still TICK_RATE ticks a second of its clock with a backlog of at most 250 ms caught up.

import { expect, test } from "bun:test";
import { tickLoop } from "../../server/main.ts";
import { TICK_RATE } from "../../shared/coords.ts";

/** A loop on a made-up clock, each tick taking `cost(k)` ms of it: the ticks run in each call, and the clock. */
function run(cost: (k: number) => number, calls: number): { perCall: number[]; clock: number } {
  let clock = 0;
  let ticks = 0;
  let due: (() => void) | null = null;
  tickLoop(
    () => (clock += cost(ticks++)),
    () => {},
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
  return { perCall, clock };
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
  /** Ticks run less ticks the clock is due, with tick 5 taking `stall` ms. */
  const short = (stall: number): number => {
    const { perCall, clock } = run((k) => (k === 5 ? stall : 0), 4 * TICK_RATE);
    return perCall.reduce((n, k) => n + k, 0) - Math.floor((clock * TICK_RATE) / 1000);
  };
  expect(Math.abs(short(200))).toBeLessThanOrEqual(1);
  expect(short(1000)).toBeLessThan(-20);
});
