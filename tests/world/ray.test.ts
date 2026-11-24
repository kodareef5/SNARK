import { expect, test } from "bun:test";
import { Rng } from "../../shared/rng.ts";
import { HIT_NONE, HIT_STRUCTURE, HIT_TERRAIN, castWorld, lookDirection, rayBox, rayGround, rayHit } from "../../shared/world/ray.ts";
import type { Heightfield } from "../../shared/world/heightfield.ts";
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
      // Sampling can miss a corner the exact test clips. The exact test must still not invent a hit far from the box.
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
  const turned = w.structs.add(wall, 120, 1.5, 100, 16384, 0, 1); // A quarter turn makes it thin along X.
  // A level ray toward the wall hits its near face.
  expect(castWorld(w, 100, 1.6, 100, 0, 0, 1, 50)).toBe(HIT_STRUCTURE);
  expect(rayHit.t).toBeCloseTo(9.9, 5);
  // Past its edge there is nothing within range.
  expect(castWorld(w, 102, 1.6, 100, 0, 0, 1, 50)).toBe(HIT_NONE);
  expect(rayHit.t).toBe(50);
  // The ray passes over it.
  expect(castWorld(w, 100, 3.2, 100, 0, 0, 1, 50)).toBe(HIT_NONE);
  // The range is too short to reach it.
  expect(castWorld(w, 100, 1.6, 100, 0, 0, 1, 9)).toBe(HIT_NONE);
  expect(castWorld(w, 100, 1.6, 100, 1, 0, 0, 50)).toBe(HIT_STRUCTURE);
  expect(rayHit.t).toBeCloseTo(19.9, 5);
  expect(rayHit.ref).toBe(turned);
  expect(castWorld(w, 100, 1.6, 102, 1, 0, 0, 50)).toBe(HIT_NONE); // its long side now runs along Z, 3 m wide
  // Aimed down in front of the wall, the ray hits the ground first.
  const d = [0, 0, 0];
  lookDirection(0, -8192, d); // 45 degrees down
  expect(castWorld(w, 100, 1.6, 100, d[0]!, d[1]!, d[2]!, 50)).toBe(HIT_TERRAIN);
  expect(rayHit.t).toBeCloseTo(1.6 * Math.SQRT2, 2);
});

test("terrain rays only meet ground inside the map, including its edges", () => {
  const { hf } = flatWorld();
  const d = Math.SQRT1_2;
  for (const sign of [-1, 1]) {
    const edge = sign > 0 ? 0 : hf.sizeX;
    const outside = edge - 2 * sign;
    expect(rayGround(hf, outside, 4, 16, d * sign, -d, 0, 10)).toBeCloseTo(4 / d, 12);
    expect(rayGround(hf, outside, 1, 16, d * sign, -d, 0, 10)).toBeCloseTo(2 / d, 12);
    expect(rayGround(hf, edge + 2 * sign, 4, 16, -d * sign, -d, 0, 10)).toBe(Infinity);
    expect(rayGround(hf, edge, 1, 16, 0, -1, 0, 4)).toBe(1);
    expect(rayGround(hf, outside, 1, 16, 0, -1, 0, 4)).toBe(Infinity);
  }
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
    // A structure may stop the ray first, but never later than the ground would.
    expect(rayHit.t).toBeLessThanOrEqual(brute + 0.02);
    if (kind === HIT_TERRAIN) {
      hits++;
      expect(Math.abs(rayHit.t - brute)).toBeLessThan(0.02);
    } else if (kind === HIT_NONE) expect(brute).toBe(60);
  }
  expect(hits).toBeGreaterThan(150);
});

/** Where the ray first meets one of the two triangles of any cell under its path, by testing every one of them. Infinity for none. */
function firstTriangle(hf: Heightfield, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxT: number): number {
  const c = hf.cell;
  const span = (o: number, d: number, cells: number): [number, number] => {
    const a = Math.floor(Math.min(o, o + d * maxT) / c);
    const b = Math.floor(Math.max(o, o + d * maxT) / c);
    return [Math.max(0, a), Math.min(cells - 1, b)];
  };
  const [i0, i1] = span(ox, dx, hf.nx - 1);
  const [j0, j1] = span(oz, dz, hf.nz - 1);
  let best = Infinity;
  const tri = (ax: number, ay: number, az: number, bx: number, by: number, bz: number, cx: number, cy: number, cz: number): void => {
    // Moller and Trumbore, with the edges counted in.
    const e1 = [bx - ax, by - ay, bz - az];
    const e2 = [cx - ax, cy - ay, cz - az];
    const p = [dy * e2[2]! - dz * e2[1]!, dz * e2[0]! - dx * e2[2]!, dx * e2[1]! - dy * e2[0]!];
    const det = e1[0]! * p[0]! + e1[1]! * p[1]! + e1[2]! * p[2]!;
    if (Math.abs(det) < 1e-15) return;
    const s = [ox - ax, oy - ay, oz - az];
    const u = (s[0]! * p[0]! + s[1]! * p[1]! + s[2]! * p[2]!) / det;
    const q = [s[1]! * e1[2]! - s[2]! * e1[1]!, s[2]! * e1[0]! - s[0]! * e1[2]!, s[0]! * e1[1]! - s[1]! * e1[0]!];
    const v = (dx * q[0]! + dy * q[1]! + dz * q[2]!) / det;
    const t = (e2[0]! * q[0]! + e2[1]! * q[1]! + e2[2]! * q[2]!) / det;
    if (u < -1e-12 || v < -1e-12 || u + v > 1 + 1e-12 || t < 0 || t > maxT) return;
    if (t < best) best = t;
  };
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) {
      const x0 = i * c;
      const z0 = j * c;
      const h00 = hf.sample(i, j);
      const h10 = hf.sample(i + 1, j);
      const h01 = hf.sample(i, j + 1);
      const h11 = hf.sample(i + 1, j + 1);
      tri(x0, h00, z0, x0 + c, h10, z0, x0 + c, h11, z0 + c);
      tri(x0, h00, z0, x0 + c, h11, z0 + c, x0, h01, z0 + c);
    }
  }
  return best;
}

test("a ray meets the ground where it first crosses a drawn triangle, however thin the crossing", () => {
  // A ridge along x: one row of samples a metre up, so two slopes of 1 in 2 meet at a sharp crest at z = 64.
  const w = flatWorld(2);
  for (let i = 0; i < w.hf.nx; i++) w.hf.setSample(i, 32, 1);
  // Level rays a millimetre under the crest, across it at many angles. Each is under the ground for a few millimetres only.
  const misses: number[] = [];
  for (let k = 0; k < 64; k++) {
    const a = (k - 32) / 40;
    const dx = Math.sin(a);
    const dz = Math.cos(a);
    const t = castWorld(w, 60, 0.999, 50, dx, 0, dz, 40) === HIT_TERRAIN ? rayHit.t : Infinity;
    // The rising slope reaches 0.999 at z = 63.998.
    if (!(Math.abs(t - 13.998 / dz) < 1e-9)) misses.push(k);
  }
  expect(misses).toEqual([]);

  // Over the proving ground, every ray ends where the first triangle it crosses is, to rounding.
  const p = provingWorld();
  const ground = { hf: p.hf, structs: flatWorld(8).structs };
  const rng = new Rng(31);
  const d = [0, 0, 0];
  let hits = 0;
  for (let i = 0; i < 400; i++) {
    const ox = rng.range(60, 450);
    const oz = rng.range(60, 450);
    const oy = p.hf.heightAt(ox, oz) + rng.range(0.5, 12);
    lookDirection(rng.int(65536), rng.int(16384) - 12000, d);
    const want = firstTriangle(p.hf, ox, oy, oz, d[0]!, d[1]!, d[2]!, 60);
    const kind = castWorld(ground, ox, oy, oz, d[0]!, d[1]!, d[2]!, 60);
    if (want === Infinity) expect(kind).toBe(HIT_NONE);
    else {
      hits++;
      expect(kind).toBe(HIT_TERRAIN);
      expect(Math.abs(rayHit.t - want)).toBeLessThan(1e-9);
    }
  }
  expect(hits).toBeGreaterThan(150);
});
