import { expect, test } from "bun:test";
import { groundAt } from "../../shared/anim/ragdoll.ts";
import type { MapDims } from "../../shared/coords.ts";
import { Rng } from "../../shared/rng.ts";
import { ground, groundN, groundNear, groundUnder, steepGround, push, type CollisionWorld } from "../../shared/world/collide.ts";
import { Heightfield, TERRAIN_CELL, type GroundView } from "../../shared/world/heightfield.ts";
import { castWorld, lookDirection, rayGround, rayHit } from "../../shared/world/ray.ts";
import { provingWorld } from "../fixtures/world.ts";

/** A stand-in for ground held as pieces: each view is a fresh copy of its box alone, so a read outside it is NaN. */
class Pieces extends Heightfield {
  views = 0;
  across = 0;

  constructor(from: Heightfield, span: number) {
    super(from.dims, from.cell, from.minY, from.stepY, from.heights);
    this.seaLevel = from.seaLevel;
    this.span = span;
  }

  override view(i0: number, j0: number, i1: number, j1: number): GroundView {
    if (!(i0 >= 0 && j0 >= 0 && i0 <= i1 && j0 <= j1 && i1 < this.nx && j1 < this.nz)) throw new Error(`box ${i0}, ${j0}, ${i1}, ${j1} is off the map`);
    this.views++;
    if (Math.floor(i0 / this.span) !== Math.floor((i1 - 1) / this.span) || Math.floor(j0 / this.span) !== Math.floor((j1 - 1) / this.span)) this.across++;
    const w = i1 - i0 + 1;
    return { heights: this.window(i0, j0, i1, j1), stride: w, off: -(j0 * w + i0) };
  }
}

/** Rough ground: every sample at random, so each cell has its own faces and creases. */
function rough(dims: MapDims, seed: number): Heightfield {
  const hf = new Heightfield(dims, TERRAIN_CELL, -32, 1 / 256);
  const rng = new Rng(seed);
  for (let k = 0; k < hf.heights.length; k++) hf.heights[k] = 32 * 256 + rng.int(6 * 256);
  return hf;
}

const grounds = (): [string, Heightfield][] => [["the proving ground", provingWorld().hf], ["rough ground", rough({ chunksX: 3, chunksZ: 2 }, 7)]];

/** A place anywhere over the map, a little past its edges, or on a line between samples. */
function place(rng: Rng, hf: Heightfield): [number, number] {
  const pick = (size: number): number => {
    const r = rng.int(10);
    if (r === 0) return rng.range(-3, 3);
    if (r === 1) return size + rng.range(-3, 3);
    if (r === 2) return rng.int(Math.floor(size / hf.cell) + 1) * hf.cell;
    return rng.range(0, size);
  };
  return [pick(hf.sizeX), pick(hf.sizeZ)];
}

test("a dense view is the one array, one piece, and allocates nothing", () => {
  const hf = rough({ chunksX: 2, chunksZ: 2 }, 1);
  const a = hf.view(0, 0, 1, 1);
  const b = hf.view(10, 20, 40, 60);
  expect(a).toBe(b);
  expect(a.heights).toBe(hf.heights);
  expect([a.stride, a.off]).toEqual([hf.nx, 0]);
  expect(hf.span).toBe(hf.nx - 1);
});

test("a view's samples are the dense ones anywhere, at edges and corners", () => {
  const rng = new Rng(3);
  for (const [, hf] of grounds()) {
    const pieces = new Pieces(hf, 24);
    const [lastI, lastJ] = [hf.nx - 1, hf.nz - 1];
    const boxes: number[][] = [[0, 0, 1, 1], [lastI - 1, 0, lastI, 1], [0, lastJ - 1, 1, lastJ], [lastI - 1, lastJ - 1, lastI, lastJ], [0, 0, lastI, lastJ], [0, 5, lastI, 9], [7, 0, 12, lastJ]];
    for (let n = 0; n < 300; n++) {
      const i0 = rng.int(hf.nx), j0 = rng.int(hf.nz);
      boxes.push([i0, j0, Math.min(lastI, i0 + rng.int(40)), Math.min(lastJ, j0 + rng.int(40))]);
    }
    for (const [i0, j0, i1, j1] of boxes) {
      for (const g of [hf, pieces]) {
        const v = g.view(i0!, j0!, i1!, j1!);
        for (let j = j0!; j <= j1!; j++) for (let i = i0!; i <= i1!; i++) if (v.heights[v.off + j * v.stride + i] !== hf.heights[j * hf.nx + i]) throw new Error(`sample ${i}, ${j} of box ${i0}, ${j0}, ${i1}, ${j1} differs`);
      }
    }
  }
});

test("ground in pieces gives the dense answers to collision, to the bit", () => {
  const rng = new Rng(5);
  const out = new Float64Array(4);
  for (const [name, hf] of grounds()) {
    const pieces = new Pieces(hf, 24);
    const answer = (g: Heightfield, x: number, z: number, r: number, y: number): number[] => {
      const under = groundUnder(g, x, z, r);
      const got = [under, ground.nx, ground.ny, ground.nz, ground.up];
      const count = groundNear(g, x, y, z, r, 0.3);
      got.push(count, ...groundN.subarray(0, count * 4));
      got.push(steepGround(g, x, y, z, r, 0.7) ? 1 : 0, push.x, push.y, push.z, push.depth, push.up);
      groundAt(g, x, z, out);
      return got.concat(...out);
    };
    for (let n = 0; n < 4000; n++) {
      const [x, z] = place(rng, hf);
      const r = [0.25, 0.4, 1, 2.5, 5][rng.int(5)]!;
      const y = hf.heightAt(x, z) + rng.range(-1, 0.4);
      const dense = answer(hf, x, z, r, y);
      const paged = answer(pieces, x, z, r, y);
      if (!dense.every((v, k) => Object.is(v, paged[k]))) throw new Error(`${name}: ${x}, ${z}, r ${r}: ${dense} against ${paged}`);
    }
    expect(pieces.views).toBeGreaterThan(4000);
    expect(pieces.across).toBeGreaterThan(0);
  }
});

test("ground in pieces gives the dense answers to rays, to the bit", () => {
  const rng = new Rng(9);
  const d = [0, 0, 0];
  for (const [name, hf] of grounds()) {
    const pieces = new Pieces(hf, 24);
    const dense: CollisionWorld = name === "the proving ground" ? provingWorld() : { hf, structs: provingWorld().structs };
    const paged: CollisionWorld = { hf: pieces, structs: dense.structs };
    const cast = (w: CollisionWorld, s: number[], far: number): number[] => {
      const kind = castWorld(w, s[0]!, s[1]!, s[2]!, s[3]!, s[4]!, s[5]!, far);
      return [rayGround(w.hf, s[0]!, s[1]!, s[2]!, s[3]!, s[4]!, s[5]!, far), kind, rayHit.t, rayHit.ref, rayHit.nx, rayHit.ny, rayHit.nz];
    };
    const views = pieces.views;
    for (let n = 0; n < 3000; n++) {
      const [x, z] = place(rng, hf);
      const pitch = n % 7 === 0 ? -16384 : n % 11 === 0 ? 0 : rng.int(4000) - 3000;
      lookDirection(n % 13 === 0 ? rng.int(4) * 16384 : rng.int(65536), pitch, d);
      const s = [x, hf.heightAt(x, z) + rng.range(-0.5, 30), z, d[0]!, d[1]!, d[2]!];
      const far = [6, 40, 600][rng.int(3)]!;
      const a = cast(dense, s, far);
      const b = cast(paged, s, far);
      if (!a.every((v, k) => Object.is(v, b[k]))) throw new Error(`${name}: ray ${s} of ${far} m: ${a} against ${b}`);
    }
    // Long rays cross pieces and ask again at each edge.
    expect(pieces.views - views).toBeGreaterThan(6000);
  }
});
