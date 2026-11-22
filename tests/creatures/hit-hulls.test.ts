import { expect, test } from "bun:test";
import { loadHitSurfaces, rayHulls } from "../../shared/anim/hit-hulls.ts";
import { fitHitSurface } from "../../tools/pack/hit-hulls.ts";
import type { PackHitSurface } from "../../shared/pack/pack.ts";

const head: PackHitSurface = { root: 1, zone: 1, bones: [{ bone: 1, pieces: [
  { box: [-1, 1, -1, 1, -1, 1], planes: [Math.SQRT1_2, Math.SQRT1_2, 0, 0] },
  { box: [2, 3, 0, 1, 0, 1], planes: [] },
] }] };
const parent = [-1, 0, 1, 0], zones = Uint8Array.of(2, 1, 1, 1);

test("convex skin contacts keep empty corners open, admit grazing padded sweeps and return the nearest entry", () => {
  const loaded = loadHitSurfaces([head], parent, zones)!;
  expect([...loaded.replace]).toEqual([0, 1, 1, 0]);
  const cast = (o: number[], d: number[], reach = 6, radius = 0) => rayHulls(loaded.bone[1]!, Float64Array.from(o), Float64Array.from(d), reach, radius);
  expect(cast([.25, .25, 3], [0, 0, -1])).toBe(-1);
  expect(cast([.25, .25, 3], [0, 0, -1], 6, .36)).toBeCloseTo(1.64, 6);
  expect(cast([-.25, -.25, 3], [0, 0, -1])).toBe(2);
  expect(cast([-.25, -.25, 3], [0, 0, -1], 1.99)).toBe(-1);
  expect(cast([-.25, -.25, 0], [0, 0, -1])).toBe(0);
  expect(cast([4, .1, .1], [-1, 0, 0])).toBe(1);
});

test("incomplete optional skin contact data leaves every original capsule available", () => {
  const broken = structuredClone(head);
  broken.bones[0]!.pieces[1]!.box[3] = NaN;
  expect(loadHitSurfaces([broken], parent, zones)).toBeUndefined();
  expect(loadHitSurfaces([{ ...head, root: 3 }], parent, zones)).toBeUndefined();
  expect(loadHitSurfaces(undefined, parent, zones)).toBeUndefined();
});


test("a measured skin allowance expands only its carrier and leaves the default fit exact", () => {
  const shape = { zone: "torso" as const, root: "tail", cells: { tail: [2, 2, 2] as const } };
  const skin = { positions: [0, 0, 0, .5, 0, 0, 0, .5, 0], bones: [0, 0, 0], indices: [0, 1, 2], joints: [], weights: [] };
  const fit = (padding?: Record<string, number>) => fitHitSurface({ ...shape, padding }, skin, ["tail"], [-1], [0, 0, 0], [0, 2, 0, 0, 0, 0, 0, 1, .2]);
  const exact = fit();
  expect(fit({ tail: 0 })).toEqual(exact);
  const a = exact.bones[0]!.pieces[0]!, b = fit({ tail: .02 }).bones[0]!.pieces[0]!;
  expect(b.box).toEqual([-.02, .52, -.02, .52, -.02, .02]);
  for (let i = 3; i < a.planes.length; i += 4) expect(b.planes[i]! - a.planes[i]!).toBeCloseTo(.02, 3);
  for (const value of [-.001, .101, NaN, Infinity]) expect(() => fit({ tail: value })).toThrow("padding");
  expect(() => fit({ missing: .02 })).toThrow("padding");
});
