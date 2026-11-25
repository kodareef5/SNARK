// The rule's clamp for a triangle (client/core/render/piece-fit.ts), on the triangle ceilings and roofs wood's and
// stone's recipes make: a side that gives way folds what is short of its ring onto the ring and moves nothing else, so
// an eave past a side that stands is left, and a point near a corner stops where the two rings meet.

import { expect, test } from "bun:test";
import { FIT_CLASS_SHIFT, FIT_TRIANGLE, FrameTable, PIECE_FIT_AT, PIECE_FRAMED, PIECE_STATE_AT, PIECE_YIELD, PieceFit, pieceWord } from "../../client/core/render/piece-fit.ts";
import { FORMS as ROWS } from "../../content/building/forms.ts";
import { INSTANCE_BYTES } from "../../shared/pack/pack.ts";
import { STONE } from "../../tools/pack/pieces/stone.ts";
import { tierShapes } from "../../tools/pack/pieces/tier.ts";
import { WOOD } from "../../tools/pack/pieces/wood.ts";

const FORMS = { triangle_ceiling: ROWS.triangle_ceiling, triangle_roof: ROWS.triangle_roof, triangle_roof_low: ROWS.triangle_roof_low };
const ROOT3_2 = Math.sqrt(3) / 2, H = 3 * ROOT3_2, BAND = PIECE_YIELD;
/** How far inside each side a point of a triangle's own frame is: the side along its second axis, the far side, the side along its first. */
const inside = (x: number, z: number): [number, number, number] => [ROOT3_2 * x - 0.5 * z, H - (ROOT3_2 * x - 0.5 * z) - z, z];

/** The meshes' points about their triangle's first corner: a piece's origin is its collider's, which the row's `at` says. */
function points(): { id: string; level: number; at: [number, number, number][] }[] {
  return [WOOD, STONE].flatMap((recipe) => tierShapes(recipe, FORMS).flatMap((mesh) => mesh.lods.map((lod, level) => {
    const form = FORMS[mesh.id.slice(5, -recipe.name.length - 1) as keyof typeof FORMS];
    const at: [number, number, number][] = [];
    for (let v = 0; v < lod.positions.length; v += 3) at.push([lod.positions[v]! + form.at[0], lod.positions[v + 1]!, lod.positions[v + 2]! + form.at[2]]);
    return { id: mesh.id, level, at };
  })));
}

test("a triangle's yielding sides fold onto their rings, and nothing else moves", () => {
  const fit = new PieceFit();
  const data = new Uint8Array(INSTANCE_BYTES);
  let eaves = 0, corners = 0, folded = 0, worst = 0;
  for (const mesh of points()) {
    for (let mask = 1; mask < 8; mask++) {
      data[PIECE_FIT_AT] = (FIT_TRIANGLE << FIT_CLASS_SHIFT) | mask;
      fit.begin(undefined, data, 0);
      for (const [x, y, z] of mesh.at) {
        const e = inside(x, z);
        fit.vertex(x, y, z);
        const m = inside(fit.x, fit.z);
        const short = [0, 1, 2].filter((k) => (mask & (1 << k)) !== 0 && e[k]! < BAND - 1e-9);
        const where = `${mesh.id} level ${mesh.level}, sides ${mask}, point ${x.toFixed(3)} ${z.toFixed(3)}`;
        expect(fit.y).toBe(y);
        // Short of no ring that gives way, it stays: a point of an eave, out past a side that stands, among them.
        if (short.length === 0) {
          if (Math.min(...e) < -1e-6) eaves++;
          expect([fit.x, fit.z], where).toEqual([x, z]);
          continue;
        }
        folded++;
        // It lands on each ring it was short of, and inside every other ring that gives way.
        for (const k of short) expect(Math.abs(m[k]! - BAND), where).toBeLessThan(1e-6);
        for (let k = 0; k < 3; k++) if ((mask & (1 << k)) !== 0) worst = Math.max(worst, BAND - m[k]!);
        if (short.length === 2) corners++;
        // By a side that stands it keeps its distance where it was on it or out past it: it moves along that side.
        for (let k = 0; k < 3; k++) if ((mask & (1 << k)) === 0 && e[k]! < BAND) expect(Math.abs(m[k]! - e[k]!), where).toBeLessThan(1e-6);
      }
    }
  }
  // The most any point lies outside a ring that gives way: 0.14 m by the rule before, for a roof's eave near a corner.
  expect(worst).toBeLessThan(1e-6);
  // The meshes have eaves past their sides, points in the corners where two rings cross, and points to fold.
  expect(eaves).toBeGreaterThan(500);
  expect(corners).toBeGreaterThan(100);
  expect(folded).toBeGreaterThan(10000);
});

test("at every turn class the fold lands on the rings of the triangle as its base's own axes lay it", () => {
  const fit = new PieceFit();
  const table = new FrameTable();
  const yaw = 5000, slot = table.add(yaw);
  const data = new Uint8Array(INSTANCE_BYTES);
  data[PIECE_STATE_AT] = PIECE_FRAMED;
  const meshes = points().filter((m) => m.level === 0);
  for (let tw = 0; tw < 3; tw++) {
    const word = pieceWord(slot, yaw, tw);
    [data[12], data[13]] = [word & 255, word >>> 8];
    const world = (mask: number, x: number, z: number): [number, number] => {
      data[PIECE_FIT_AT] = (FIT_TRIANGLE << FIT_CLASS_SHIFT) | mask;
      fit.begin(table, data, 0);
      fit.vertex(x, 0, z);
      return [fit.c * fit.x + fit.s * fit.z, -fit.s * fit.x + fit.c * fit.z];
    };
    // Where its three corners are drawn: every point is laid between them as it lies between them in its own frame.
    const [a, b, c] = [world(0, 0, 0), world(0, 3, 0), world(0, 1.5, H)];
    const laid = (x: number, z: number): [number, number] => {
      const [v, u] = [z / H, (x - (1.5 * z) / H) / 3];
      return [a[0] + u * (b[0] - a[0]) + v * (c[0] - a[0]), a[1] + u * (b[1] - a[1]) + v * (c[1] - a[1])];
    };
    // The class turns it a twelfth of a turn each, and the base stretches its side by under a hundredth.
    expect(Math.abs(Math.hypot(b[0] - a[0], b[1] - a[1]) - 3)).toBeLessThan(0.03);
    expect(Math.abs(Math.hypot(c[0] - a[0], c[1] - a[1]) - 3)).toBeLessThan(0.03);
    let far = 0;
    for (const mesh of meshes) {
      for (let mask = 1; mask < 8; mask++) {
        data[PIECE_FIT_AT] = (FIT_TRIANGLE << FIT_CLASS_SHIFT) | mask;
        fit.begin(undefined, data, 0);
        for (const [x, , z] of mesh.at) {
          // Folded in its own frame, then laid on the base's axes: the same point the framed rule gives.
          data[PIECE_STATE_AT] = 0;
          fit.begin(undefined, data, 0);
          fit.vertex(x, 0, z);
          const want = laid(fit.x, fit.z);
          data[PIECE_STATE_AT] = PIECE_FRAMED;
          const got = world(mask, x, z);
          far = Math.max(far, Math.hypot(got[0] - want[0], got[1] - want[1]));
        }
      }
    }
    expect(far, `class ${tw}`).toBeLessThan(1e-5);
  }
});
