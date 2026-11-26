// The generator stands pieces on the ground the game collides with (tools/mapworld/statics.ts, shared/world/heightfield.ts).

import { expect, test } from "bun:test";
import { Heightfield } from "../../shared/world/heightfield.ts";
import type { Ground, World } from "../../tools/mapworld/ground.ts";
import { siteOf } from "../../tools/mapworld/statics.ts";

/** A one-chunk ground whose base samples run west to east and north to south, from lattice metres x0, z0. */
function both(height: (i: number, j: number) => number, x0 = 640, z0 = -320) {
  const hf = new Heightfield({ chunksX: 1, chunksZ: 1 }, 2, 0, 1 / 256), nx = hf.nx, nz = hf.nz;
  const base = new Float32Array(nx * nz);
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    hf.setSample(i, j, height(i, j));
    base[(nz - 1 - j) * nx + (nx - 1 - i)] = hf.sample(i, j);
  }
  const grid = { nx, nz, cell: 2, x0, z0, x1: x0 + (nx - 1) * 2, z1: z0 + (nz - 1) * 2, east: 0, south: 0 };
  const ground = { grid, height: base, heaps: { ruins: [] } } as unknown as Ground;
  return { hf, site: siteOf({ districts: [] } as unknown as World, ground, "test"), x0, z0 };
}

test("a cell's middle stands on the triangle the game walks on, not the four corners' mean", () => {
  const { site, x0, z0 } = both((i, j) => (i === 1 && j === 1 ? 4 : 0));
  expect(site.groundAt(x0 + 1, z0 + 1)).toBeCloseTo(2, 6);
});

test("the generator's ground is the game's at every point", () => {
  let seed = 7;
  const rand = (): number => ((seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32);
  const { hf, site, x0, z0 } = both(() => rand() * 20);
  let worst = 0;
  for (let k = 0; k < 2000; k++) {
    const x = rand() * 64, z = rand() * 64;
    worst = Math.max(worst, Math.abs(site.groundAt(x0 + x, z0 + z) - hf.heightAt(x, z)));
  }
  expect(worst).toBeLessThan(1e-4);
});
