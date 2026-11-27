// A fan of level rays (server/decide/nav-fan.ts) meets what castWorld meets, at the same distance, in a wood and a city.
import { expect, test } from "bun:test";
import { Fan } from "../../server/decide/nav-fan.ts";
import { Rng } from "../../shared/rng.ts";
import { castWorld, rayHit } from "../../shared/world/ray.ts";
import { lab, wood, type Lab } from "../../tools/decide/world.ts";
import { miamiSlice } from "../fixtures/cityslice.ts";

/** Rays of 12 headings at three heights from 2,000 points of `w`, cast both ways; the count that differ, and of those that hit. */
function compare(w: Lab, seed: number): { differ: number; hit: number; rays: number } {
  const fan = new Fan(w.world), hf = w.world.hf, rng = new Rng(seed);
  let differ = 0, hit = 0, rays = 0;
  for (let n = 0; n < 2000; n++) {
    const x = rng.range(20, hf.sizeX - 20), z = rng.range(20, hf.sizeZ - 20), ground = hf.heightAt(x, z);
    const reach = rng.range(1, 20), edge = rng.range(0, 1.5), turn = rng.float() * Math.PI * 2;
    fan.gather(x, z, reach + edge, ground + 0.2, ground + 2.5);
    for (let i = 0; i < 12; i++) {
      const a = turn + (i / 12) * Math.PI * 2, dx = Math.sin(a), dz = Math.cos(a);
      for (const up of [0.2, 1.1, 2.5]) {
        const ox = x + dx * edge, oz = z + dz * edge, oy = ground + up;
        castWorld(w.world, ox, oy, oz, dx, 0, dz, reach, true);
        const t = fan.cast(ox, oy, oz, dx, dz, reach);
        rays++;
        if (t !== rayHit.t) differ++;
        if (rayHit.t < reach) hit++;
      }
    }
  }
  return { differ, hit, rays };
}

test("a fan's rays stop where castWorld's do, in a dense wood", () => {
  const w = lab(wood(), 1);
  try {
    const seen = compare(w, 4);
    expect(seen.differ).toBe(0);
    expect(seen.hit).toBeGreaterThan(seen.rays / 4);
  } finally {
    w.host.shutdown();
  }
});

test("a fan's rays stop where castWorld's do, among Miami's buildings", () => {
  const w = lab(miamiSlice().map, 1);
  try {
    const seen = compare(w, 5);
    expect(seen.differ).toBe(0);
    expect(seen.hit).toBeGreaterThan(seen.rays / 10);
  } finally {
    w.host.shutdown();
  }
});
