import { expect, test } from "bun:test";
import { CHUNK_SIZE, chunkCx, chunkCz } from "../../shared/coords.ts";
import { Harness } from "../fixtures/net.ts";

const TICK_MS = 1000 / 30;

/** `count` walls on a lattice high above `chunk`, where nothing collides with them. Returns their refs. */
function wallsAbove(h: Harness, chunk: number, count: number): number[] {
  const dims = h.world.dims;
  const wall = h.reg.index.get("core:wall")!;
  const x0 = chunkCx(dims, chunk) * CHUNK_SIZE;
  const z0 = chunkCz(dims, chunk) * CHUNK_SIZE;
  const refs: number[] = [];
  for (let n = 0; n < count; n++) {
    refs.push(h.world.structs.add(wall, x0 + 2 + (n % 20) * 3, 400 + Math.floor(n / 400) * 4, z0 + 2 + (Math.floor(n / 20) % 20) * 3, 0, 1, 1e6));
  }
  return refs;
}

test("a client finishes taking in a large chunk while a nearer chunk changes every tick", () => {
  const h = new Harness();
  const s = h.join("ada");
  h.run(1000);
  const dims = h.world.dims;
  const near = h.client(s)!.chunk;
  const far = near + (chunkCx(dims, near) + 1 < dims.chunksX ? 1 : -1);
  const [target] = wallsAbove(h, near, 1);
  // Five ticks of the default budget of 256 rows.
  wallsAbove(h, far, 1200);
  const before = h.server.stats.chunkBytes;
  h.run(60 * TICK_MS, () => h.world.structs.damage(target!, 1));
  expect(s.world!.structs.chunks[far]?.live).toBe(h.world.structs.chunks[far]!.live);
  // Each row is sent about once: 1,200 rows of at most 21 bytes, plus the near chunk's one row a tick.
  expect(h.server.stats.chunkBytes - before).toBeLessThan(1200 * 21 + 60 * 40 + 4096);
});
