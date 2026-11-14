// Whole servers and clients on one WebSocket each, which is TCP, losing packets. The benchmark's probe at sizes a test can afford.

import { expect, test } from "bun:test";
import { lossy } from "../../tools/bench/transport.ts";

test("on a WebSocket that loses packets a round trip of 180 ms away, the input clock settles: it does not jump, and its lead holds within a few ticks", () => {
  const r = lossy({ rtt: 180, loss: 0.02, clients: 3, herd: 0, settle: 4, seconds: 20, seed: 5 });
  expect(r.jumps).toBeLessThan(3);
  expect(r.spread).toBeLessThanOrEqual(4);
  // With nothing lost, inputs reach the server in time with a tick or two to spare.
  const clean = lossy({ rtt: 180, loss: 0, clients: 2, herd: 0, settle: 3, seconds: 6 });
  expect([clean.held, clean.jumps, clean.corrections]).toEqual([0, 0, 0]);
  expect(clean.delay).toBeLessThan(80);
});
