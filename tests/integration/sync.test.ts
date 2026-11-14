// What a client is told of the structures around it.

import { expect, test } from "bun:test";
import { CHUNK_SIZE, chunkCx, chunkCz } from "../../shared/coords.ts";
import { GONE_FELL } from "../../shared/world/structures.ts";
import { Harness } from "../fixtures/net.ts";

test("a collapse too large for one message reaches the client whole", () => {
  // More rows a tick than a message holds, so the rows are cut to fit as well.
  const h = new Harness({ chunkSlotsPerTick: 4096 }, 1, 30);
  const s = h.join("ada");
  h.run(300);
  const structs = h.world.structs;
  const chunk = h.world.ents.chunk[h.ent(s)]!;
  const x0 = chunkCx(h.world.dims, chunk) * CHUNK_SIZE;
  const z0 = chunkCz(h.world.dims, chunk) * CHUNK_SIZE;
  // Every other piece of 17,000 falls at once: 8,500 runs of slots, which is more than a message holds.
  const wall = h.reg.index.get("core:wall")!;
  const fell = new Uint32Array(8500);
  for (let i = 0; i < 17000; i++) {
    const ref = structs.add(wall, x0 + 1 + (i % 130) * 0.47, 200, z0 + 1 + Math.floor(i / 130) * 0.47, 0, 0, 100);
    if (i % 2 === 1) fell[i >> 1] = ref;
  }
  const server = structs.chunks[chunk]!;
  const client = (): number => s.world!.structs.chunks[chunk]!.live;
  h.run(1500);
  expect(client()).toBe(server.live);
  expect(structs.removeMany(fell, fell.length, GONE_FELL, x0 + 32, 200, z0 + 32, h.world.tick)).toBe(8500);
  h.run(1000);
  expect([client(), s.world!.structs.chunks[chunk]!.version]).toEqual([server.live, server.version]);
  expect(h.server.stats.overflows).toBe(1);
});
