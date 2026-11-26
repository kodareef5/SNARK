// A pool's way out past the pieces standing by it (tools/mapworld/pool-pieces.ts), on a yard of 128 m.

import { expect, test } from "bun:test";
import { CORE_CONTENT } from "../../content/core.ts";
import { compileContent } from "../../shared/content/registry.ts";
import type { Grid } from "../../tools/mapworld/base.ts";
import { own } from "../../tools/mapworld/known.ts";
import { poolGround, settleRims, type Lakes, type PoolGround } from "../../tools/mapworld/lakes.ts";
import { givesWay, openPools, type PoolsOpened } from "../../tools/mapworld/pool-pieces.ts";
import type { StaticPiece } from "../../tools/mapworld/statics.ts";

const reg = compileContent(CORE_CONTENT).registry!;
const N = 65, [MIN_Y, STEP_Y] = [-32, 1 / 256];
const grid = { nx: N, nz: N, cell: 2, sizeX: 128, sizeZ: 128, x0: 0, z0: 0 } as Grid;
const at = (col: number, row: number): number => row * N + col;
/** The map's metres of a sample: x and z count from the far corner of the build's columns and rows. */
const place = (col: number, row: number): [number, number] => [(N - 1 - col) * 2, (N - 1 - row) * 2];
const inPool = (col: number, row: number): boolean => col >= 29 && col <= 35 && row >= 29 && row <= 35;

/**
 * A pool 12 m square in the middle of the yard, its water at 1 m and its bed 1.5 m under it, the ground round it at
 * `rim`; settled as the build settles it, with `rules`.
 */
function yard(rim: number, rules: object = {}): { lakes: Lakes; height: Float32Array; pools: PoolGround; open: (statics: StaticPiece[]) => PoolsOpened; wet: () => number } {
  const body = new Uint16Array(N * N), height = new Float32Array(N * N).fill(rim);
  for (let row = 29; row <= 35; row++) for (let col = 29; col <= 35; col++) { body[at(col, row)] = 1; height[at(col, row)] = -0.5; }
  const lakes: Lakes = { body, bodies: [{ name: "", surface: 1, kind: "pool" }], made: [] };
  const pools = poolGround(lakes, height);
  settleRims(lakes, rules, height, grid, MIN_Y, STEP_Y, pools);
  return { lakes, height, pools, open: (statics) => openPools(lakes, rules, height, grid, MIN_Y, STEP_Y, -Infinity, pools, reg, statics), wet: () => body.filter((b) => b === 1).length };
}

/** Pieces 4 m apart along one side of a square of 24 m round the pool, 6 m from its water, standing on ground at `y`. */
function side(which: 0 | 1 | 2 | 3, kind: string, y: number, long: number): StaticPiece[] {
  const out: StaticPiece[] = [];
  for (let d = 52 + long / 2; d < 76; d += long) {
    const [x, z] = which === 0 ? [d, 52] : which === 1 ? [d, 76] : which === 2 ? [52, d] : [76, d];
    out.push({ kind, x, y, z, yaw: which < 2 ? 0 : 90 });
  }
  return out;
}
const walls = (which: 0 | 1 | 2 | 3, y: number): StaticPiece[] => side(which, "core:zruin_wall4_concrete", y + 1.4, 4).map((p) => { own(p, 0); return p; });

test("a pool with nothing by it is walked out of and left as it is", () => {
  const y = yard(1.1), before = Array.from(y.height);
  const o = y.open([]);
  expect([o.swum, o.caught, o.laddered, o.cleared, o.takenOut]).toEqual([1, 0, 0, 0, 0]);
  expect(Array.from(y.height)).toEqual(before);
});

test("a pool walled by a building on three sides and fenced on the fourth loses a fence, no wall", () => {
  const y = yard(1.1);
  const statics = [...walls(0, 1.1), ...walls(1, 1.1), ...walls(2, 1.1), ...side(3, "core:zzstreet_fence", 1.1, 3)];
  const o = y.open(statics);
  expect([o.swum, o.caught, o.laddered, o.cleared, o.takenOut]).toEqual([1, 1, 0, 1, 0]);
  expect(o.taken.size).toBeGreaterThan(0);
  expect([...o.taken].every((k) => statics[k]!.kind === "core:zzstreet_fence")).toBe(true);
  // Most of the fence stands yet, the water is whole, and with the taken pieces away a survivor is caught no more.
  expect(o.taken.size).toBeLessThan(3);
  expect(y.wet()).toBe(49);
  expect(y.open(statics.filter((_, k) => !o.taken.has(k))).caught).toBe(0);
});

test("a pool with wall pieces on its only ladder gets a ladder where no piece stands", () => {
  // In a pit 3 m deep it may not rise out of: the settling cuts one ladder, in its first corner, 1.5 m a pair.
  const y = yard(4.1, { poolUnder: 99 });
  const ladder = [...y.height.keys()].filter((i) => inPool(i % N, Math.floor(i / N)) && y.height[i]! > -0.5);
  expect(ladder).toEqual([at(29, 29), at(30, 29), at(29, 30), at(30, 30), at(29, 31), at(30, 31)]);
  expect(y.open([]).caught).toBe(0);
  // Its top pair meets the rim on two sides of the corner: a building's wall 8 m long stands on each.
  const [nx, nz] = place(29.5, 28), [wx, wz] = place(28, 29.5);
  const statics: StaticPiece[] = [{ kind: "core:zruin_wall8_concrete", x: nx, y: 4.1 + 1.4, z: nz, yaw: 0 }, { kind: "core:zruin_wall8_concrete", x: wx, y: 4.1 + 1.4, z: wz, yaw: 90 }];
  for (const p of statics) own(p, 0);
  const before = Array.from(y.height);
  const o = y.open(statics);
  expect([o.swum, o.caught, o.laddered, o.cleared, o.takenOut, o.taken.size]).toEqual([1, 1, 1, 0, 0, 0]);
  // Another ladder, of the pool's own samples, and the first as it was.
  const cut = [...y.height.keys()].filter((i) => y.height[i] !== before[i]);
  expect(cut.length).toBeGreaterThan(0);
  expect(cut.every((i) => inPool(i % N, Math.floor(i / N)) && !ladder.includes(i))).toBe(true);
  expect(y.wet()).toBe(49);
  expect(y.open(statics).caught).toBe(0);
});

test("a pool a building's walls stand all round is taken out and its ground laid level", () => {
  const y = yard(1.1);
  const statics = [...walls(0, 1.1), ...walls(1, 1.1), ...walls(2, 1.1), ...walls(3, 1.1)];
  const o = y.open(statics);
  expect([o.swum, o.caught, o.laddered, o.cleared, o.takenOut, o.taken.size]).toEqual([1, 1, 0, 0, 1, 0]);
  expect(y.wet()).toBe(0);
  for (let row = 29; row <= 35; row++) for (let col = 29; col <= 35; col++) expect(y.height[at(col, row)]).toBeCloseTo(1.1, 2);
  expect(y.pools.restored.size).toBe(49);
});

test("only the street's unowned small pieces give way: no wall, no roof plant, no piece a building owns", () => {
  const piece = (kind: string): StaticPiece => ({ kind, x: 0, y: 0, z: 0, yaw: 0 });
  const owned = piece("core:zzstreet_fence");
  own(owned, 3);
  expect(["core:zzstreet_fence", "core:zzstreet_bollard", "core:zzzzroad_compact_abandoned_grey", "core:box_trailer", "core:zruin_wall4_concrete", "core:zruin_sill4_clay", "core:zzstreet_roof_vent", "core:zzzzzbend_median_c"].map((k) => givesWay(piece(k))))
    .toEqual([true, true, true, true, false, false, false, false]);
  expect(givesWay(owned)).toBe(false);
});
