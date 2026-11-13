import { expect, test } from "bun:test";
import { Rng } from "../../shared/rng.ts";
import { HIT_NONE, HIT_STRUCTURE, HIT_TERRAIN, castWorld, lookDirection, rayBox, rayHit } from "../../shared/world/ray.ts";
import { flatWorld, provingWorld } from "../fixtures/world.ts";

test("look direction is a unit vector that follows yaw and pitch", () => {
  const d = [0, 0, 0];
  lookDirection(0, 0, d);
  expect(d[0]).toBe(0);
  expect(d[1]).toBe(0);
  expect(d[2]).toBeCloseTo(1, 6); // yaw 0 faces +Z
  lookDirection(16384, 0, d);
  expect(d[0]).toBeCloseTo(1, 6);
  expect(d[2]).toBeCloseTo(0, 6);
  lookDirection(0, 16384, d);
  expect(d[1]).toBeCloseTo(1, 6); // straight up
  const rng = new Rng(1);
  for (let i = 0; i < 200; i++) {
    lookDirection(rng.int(65536), rng.int(32769) - 16384, d);
    expect(Math.hypot(d[0]!, d[1]!, d[2]!)).toBeCloseTo(1, 5);
  }
});

test("a ray meets a box where sampling along it first finds a point inside", () => {
  const rng = new Rng(8);
  let hits = 0;
  for (let i = 0; i < 2000; i++) {
    const o = [rng.range(-6, 6), rng.range(-6, 6), rng.range(-6, 6)];
    const lo = [rng.range(-3, 0), rng.range(-3, 0), rng.range(-3, 0)];
    const hi = [lo[0]! + rng.range(0.2, 4), lo[1]! + rng.range(0.2, 4), lo[2]! + rng.range(0.2, 4)];
    // Half the rays are aimed at the box, half anywhere.
    const aimed = rng.int(2) === 0;
    const v = [0, 1, 2].map((a) => (aimed ? rng.range(lo[a]!, hi[a]!) - o[a]! : rng.range(-1, 1)));
    const len = Math.hypot(v[0]!, v[1]!, v[2]!);
    if (len < 0.1) continue;
    const d = v.map((x) => x / len);
    const t = rayBox(o[0]!, o[1]!, o[2]!, d[0]!, d[1]!, d[2]!, lo[0]!, lo[1]!, lo[2]!, hi[0]!, hi[1]!, hi[2]!);
    let brute = Infinity;
    for (let s = 0; s < 20; s += 0.005) {
      const p = [o[0]! + d[0]! * s, o[1]! + d[1]! * s, o[2]! + d[2]! * s];
      if (p[0]! >= lo[0]! && p[0]! <= hi[0]! && p[1]! >= lo[1]! && p[1]! <= hi[1]! && p[2]! >= lo[2]! && p[2]! <= hi[2]!) {
        brute = s;
        break;
      }
    }
    if (brute === Infinity) {
      // Sampling can miss a corner the exact test clips; the exact test must not invent a hit far from the box.
      if (t !== Infinity) expect(t).toBeLessThan(20.01);
      continue;
    }
    hits++;
    expect(Math.abs(t - brute)).toBeLessThan(0.006);
  }
  expect(hits).toBeGreaterThan(300);
});

test("world rays stop at the ground and at structures, whichever is nearer, and report which", () => {
  const w = flatWorld(4);
  const wall = w.kind("core:wall"); // 3 m wide, 3 m tall, 0.2 m thick
  w.structs.add(wall, 100, 1.5, 110, 0, 0, 1);
  const turned = w.structs.add(wall, 120, 1.5, 100, 16384, 0, 1); // turned a quarter: now thin along X
  // Level, toward the wall: hits its near face.
  expect(castWorld(w, 100, 1.6, 100, 0, 0, 1, 50)).toBe(HIT_STRUCTURE);
  expect(rayHit.t).toBeCloseTo(9.9, 5);
  // Past its edge: nothing within range.
  expect(castWorld(w, 102, 1.6, 100, 0, 0, 1, 50)).toBe(HIT_NONE);
  expect(rayHit.t).toBe(50);
  // Over it.
  expect(castWorld(w, 100, 3.2, 100, 0, 0, 1, 50)).toBe(HIT_NONE);
  // Too short to reach.
  expect(castWorld(w, 100, 1.6, 100, 0, 0, 1, 9)).toBe(HIT_NONE);
  // The turned wall, along X, and which structure it was.
  expect(castWorld(w, 100, 1.6, 100, 1, 0, 0, 50)).toBe(HIT_STRUCTURE);
  expect(rayHit.t).toBeCloseTo(19.9, 5);
  expect(rayHit.ref).toBe(turned);
  expect(castWorld(w, 100, 1.6, 102, 1, 0, 0, 50)).toBe(HIT_NONE); // its long side now runs along Z, 3 m wide
  // Down at the ground in front of the wall: the ground comes first.
  const d = [0, 0, 0];
  lookDirection(0, -8192, d); // 45 degrees down
  expect(castWorld(w, 100, 1.6, 100, d[0]!, d[1]!, d[2]!, 50)).toBe(HIT_TERRAIN);
  expect(rayHit.t).toBeCloseTo(1.6 * Math.SQRT2, 2);
});

test("terrain rays on the proving ground agree with walking along the ray in small steps", () => {
  const w = provingWorld();
  const rng = new Rng(3);
  const d = [0, 0, 0];
  let hits = 0;
  for (let i = 0; i < 400; i++) {
    const ox = rng.range(60, 450);
    const oz = rng.range(60, 450);
    const oy = w.hf.heightAt(ox, oz) + rng.range(0.5, 12);
    lookDirection(rng.int(65536), rng.int(16384) - 12000, d);
    const kind = castWorld(w, ox, oy, oz, d[0]!, d[1]!, d[2]!, 60);
    let brute = 60;
    for (let s = 0; s < 60; s += 0.01) {
      if (oy + d[1]! * s < w.hf.heightAt(ox + d[0]! * s, oz + d[2]! * s)) {
        brute = s;
        break;
      }
    }
    // A structure may stop the ray first; never later than the ground would.
    expect(rayHit.t).toBeLessThanOrEqual(brute + 0.02);
    if (kind === HIT_TERRAIN) {
      hits++;
      expect(Math.abs(rayHit.t - brute)).toBeLessThan(0.02);
    } else if (kind === HIT_NONE) expect(brute).toBe(60);
  }
  expect(hits).toBeGreaterThan(150);
});
