import { expect, test } from "bun:test";
import { SURFACE_NAMES, surfaceIndex } from "../../content/surfaces.ts";
import { S, type Ground, type World } from "../../tools/mapworld/ground.ts";
import { makeTint } from "../../tools/mapworld/tint.ts";

/** A ground `side` samples a side of one surface, with `inner` in its middle `half` samples either way. */
function ground(side: number, outer: number, inner: number, half: number): Ground {
  const surface = new Uint8Array(side * side).fill(outer);
  const mid = (side - 1) / 2;
  for (let r = 0; r < side; r++) for (let c = 0; c < side; c++) if (Math.abs(r - mid) <= half && Math.abs(c - mid) <= half) surface[r * side + c] = inner;
  return {
    grid: { nx: side, nz: side, cell: 2, noiseWest: 0, noiseNorth: 0 },
    surface,
    heaps: { owner: new Int32Array(side * side).fill(-1), ruins: [] },
    container: new Uint8Array(side * side),
  } as unknown as Ground;
}
const world = { districts: [] } as unknown as World;
const finishes = (g: Ground, s: number): string[] => {
  const tint = makeTint(g, world);
  return [...new Set([...tint].filter((_, i) => g.surface[i] === s).map((t) => SURFACE_NAMES[surfaceIndex(t, true)]!))].sort();
};

test("every road draws as asphalt, a walk as the walks' concrete, a plaza paved, and a walkway by where it is: concrete in town, gravel in a park", () => {
  for (const s of [S.STREET, S.HIGHWAY, S.CROSSWALK, S.LOT]) expect([s, finishes(ground(60, s, s, 30), s)]).toEqual([s, ["asphalt"]]);
  expect(finishes(ground(60, S.SIDEWALK, S.SIDEWALK, 30), S.SIDEWALK)).toEqual(["sidewalk"]);
  expect(finishes(ground(60, S.PLAZA, S.PLAZA, 30), S.PLAZA)).toEqual(["paving"]);
  // A path two samples wide through a park, and through a town's sidewalks and streets: never the two mixed in either.
  expect(finishes(ground(40, S.GREEN, S.WALKWAY, 1), S.WALKWAY)).toEqual(["gravel"]);
  expect(finishes(ground(40, S.SIDEWALK, S.WALKWAY, 1), S.WALKWAY)).toEqual(["sidewalk"]);
});
