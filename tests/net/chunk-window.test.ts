// Chunk rows are held to the bytes a client has on the way, counted as written, and to the slots of a tick.

import { expect, test } from "bun:test";
import type { ClientSession } from "../../client/core/session.ts";
import { CHUNK_SIZE, chunkCx, chunkCz } from "../../shared/coords.ts";
import type { LinkOptions } from "../../shared/net/loopback.ts";
import { boxBase } from "../../tools/bench/base.ts";
import { Harness } from "../fixtures/net.ts";

/** A survivor on `link`, and the bench's wooden box base of `count` owned pieces set down at once in the chunk it stands in. */
function base(link: LinkOptions, count: number): { h: Harness; s: ClientSession; chunk: number } {
  const h = new Harness({}, 1, 60);
  const s = h.join("ada", link);
  h.run(2000);
  const chunk = h.world.ents.chunk[h.ent(s)]!;
  const [x0, z0] = [chunkCx(h.world.dims, chunk) * CHUNK_SIZE, chunkCz(h.world.dims, chunk) * CHUNK_SIZE];
  for (const [kind, x, y, z, yaw] of boxBase(h.reg, "wood", x0 + 0.5, 300, z0 + 0.5, 21, 1, count)) h.world.structs.add(kind, x, y, z, yaw, 7, h.reg.maxHp[kind]!);
  expect(h.world.structs.chunks[chunk]!.live).toBe(count);
  return { h, s, chunk };
}

test("a 20,000-piece chunk arrives whole within 0.9 s on a clean line", () => {
  const { h, s, chunk } = base({ tcp: true, latencyMs: 25 }, 20000);
  const from = h.now;
  let whole = -1;
  h.run(3000, (now) => {
    if (whole < 0 && s.world!.structs.chunks[chunk]?.version === h.world.structs.chunks[chunk]!.version) whole = now - from;
  });
  expect(s.world!.structs.chunks[chunk]!.live).toBe(20000);
  // 1,024 slots a tick is 20 ticks, 667 ms, and the line's 50 ms there and back. At 256 slots it was 2.6 s.
  expect(whole).toBeGreaterThan(0);
  expect(whole).toBeLessThanOrEqual(900);
});

test("a client that has acknowledged nothing since is sent 16 KB of rows and one row more at most", () => {
  // 600 ms there and back, so nothing sent in the half second after the base stands is acknowledged within it.
  const { h, s, chunk } = base({ tcp: true, latencyMs: 300 }, 20000);
  const before = h.server.stats.chunkBytes;
  h.run(500);
  const sent = h.server.stats.chunkBytes - before;
  expect(sent).toBeGreaterThan(15 * 1024);
  expect(sent).toBeLessThanOrEqual(16 * 1024 + 64);
  // It still comes whole.
  h.run(8000);
  expect([s.world!.structs.chunks[chunk]!.live, s.world!.structs.chunks[chunk]!.version]).toEqual([20000, h.world.structs.chunks[chunk]!.version]);
});
