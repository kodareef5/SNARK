// Whole servers and clients on one WebSocket each, which is TCP, losing packets. The benchmark's probe at sizes a test can afford.

import { expect, test } from "bun:test";
import { lossy } from "../../tools/bench/transport.ts";

test("on a WebSocket that loses packets a round trip of 180 ms away, the input clock settles: it does not jump, and its lead holds within a few ticks", () => {
  const r = lossy({ rtt: 180, loss: 0.02, clients: 3, herd: 0, settle: 4, seconds: 20, seed: 5 });
  expect(r.jumps).toBeLessThan(3);
  expect(r.spread).toBeLessThanOrEqual(4);
  // With nothing lost, inputs reach the server in time with a tick or two to spare.
  const clean = lossy({ rtt: 180, loss: 0, clients: 2, herd: 0, settle: 3, seconds: 6 });
  expect([clean.held, clean.jumps, clean.corrections, clean.frozen, clean.drawn]).toEqual([0, 0, 0, 0, 2]);
  expect(clean.delay).toBeLessThan(80);
});

test("on a WebSocket that loses packets 100 ms away, others are drawn far enough behind that they seldom stand still, and shots are still judged at the moment their client saw", () => {
  const r = lossy({ rtt: 100, loss: 0.02, clients: 3, herd: 0, settle: 4, seconds: 20, seed: 5 });
  expect(r.frozen).toBeLessThan(3.5);
  expect(r.drawn).toBeGreaterThan(3);
  expect(r.clipped).toBeLessThan(5);
});

test("on a line slower than its snapshots, what waits unsent is a couple of snapshots, not seconds of them", () => {
  const r = lossy({ rtt: 100, loss: 0, clients: 2, herd: 60, settle: 3, seconds: 8, link: { bytesPerSecond: 12000 } });
  expect(r.age).toBeLessThan(3500);
});

test("a base set down beside clients on a 60 KB/s line is sent at the pace they take it, so their snapshots do not wait behind it", () => {
  const r = lossy({ rtt: 100, loss: 0, clients: 2, herd: 0, settle: 3, seconds: 4, build: { at: 0.5, pieces: 5000 }, link: { bytesPerSecond: 60000 } });
  expect(r.age99).toBeLessThan(500);
  expect(r.frozen).toBeLessThan(12);
  expect(r.synced).toBeLessThan(2500);
});
