import { expect, test } from "bun:test";
import { ALL_FORMS, formHulls } from "../../content/building/forms.ts";
import { hullPoint } from "../../shared/world/convex.ts";
import type { FormDef } from "../../shared/world/lattice/forms.ts";
import { defaultPalette } from "../../shared/pack/palette.ts";
import { parsePack } from "../../shared/pack/pack.ts";
import { MADE_PIECE_TRIANGLES, measureSurface } from "../../tools/art/check.ts";
import { flatLod } from "../../tools/pack/pieces/kit.ts";
import { colliderBox, levelsOf } from "../../tools/pack/pieces/lod.ts";
import { tekDeck } from "../../tools/pack/pieces/tek-decks.ts";
import { TEK } from "../../tools/pack/pieces/tek.ts";
import { buildPack, unpackMeshes, type SourceLod } from "../../tools/pack/write.ts";

const forms: Readonly<Record<string, FormDef>> = ALL_FORMS;
const recipe = { ...TEK, split: tekDeck };
const parts = Object.entries(forms).filter(([, form]) => form.plane === "flat");
const meshes = new Map(unpackMeshes(parsePack(buildPack(parts.map(([id, form]) => ({
  id, lods: levelsOf(recipe, id, form).map((shape, i) => ({ ...flatLod(shape, () => 83), error: i * .01 })),
})), defaultPalette()))).map(m => [m.id, m.lods]));

/** Heights where a vertical line crosses this level of the packed mesh. */
function floors(lod: SourceLod, x: number, z: number): number[] {
  const p = lod.positions, hits = [];
  for (let k = 0; k < lod.indices.length; k += 3) {
    const a = lod.indices[k]! * 3, b = lod.indices[k+1]! * 3, c = lod.indices[k+2]! * 3;
    const dx = p[b]! - p[a]!, dz = p[b+2]! - p[a+2]!, ex = p[c]! - p[a]!, ez = p[c+2]! - p[a+2]!;
    const determinant = dx*ez - dz*ex;
    if (Math.abs(determinant) < 1e-9) continue;
    const u = ((x - p[a]!) * ez - (z - p[a+2]!) * ex) / determinant;
    const v = (dx * (z - p[a+2]!) - dz * (x - p[a]!)) / determinant;
    if (Math.min(u, v, 1 - u - v) >= -1e-6) hits.push(p[a+1]! + u*(p[b+1]! - p[a+1]!) + v*(p[c+1]! - p[a+1]!));
  }
  return hits;
}

test("Tek decks fit their colliders and distance budgets after packing", () => {
  for (const [name, form] of parts) {
    const box = colliderBox(form), levels = meshes.get(name)!;
    expect(levels.at(-1)!.indices.length / 3).toBeLessThanOrEqual(12);
    for (const [level, lod] of levels.entries()) {
      const over = lod.positions.reduce((worst, v, i) => Math.max(worst, box[i % 3]! - v, v - box[3+i%3]!), 0);
      expect(over, name).toBeLessThan(.016);
      expect(measureSurface(lod), name).toMatchObject({ holes: 0, flipped: 0, insideOut: 0, collapsed: 0 });
      expect(lod.indices.length / 3, name).toBeLessThanOrEqual(MADE_PIECE_TRIANGLES[level]![1]);
    }
  }
});

test("roof skins follow the collider folds above and below each facet", () => {
  for (const [name, form] of parts.filter(([, f]) => f.corner && f.layer === "slab")) {
    for (const hull of formHulls(form)) {
      const tops = new Map<string, number[]>();
      for (const c of hull.corners) {
        const q = hullPoint(c, hull.sixty === true), key = [q[0], q[2]].join(",");
        if (!tops.has(key) || q[1] > tops.get(key)![1]!) tops.set(key, q);
      }
      const sum = [0, 0, 0];
      for (const q of tops.values()) for (let i = 0; i < 3; i++) sum[i]! += q[i]! / tops.size;
      for (const level of meshes.get(name)!) {
        const hits = floors(level, sum[0]!, sum[2]!);
        expect(Math.abs(Math.max(...hits) - sum[1]!), name).toBeLessThan(.028);
        expect(Math.abs(Math.min(...hits) - sum[1]! + form.thick), name).toBeLessThan(.015);
      }
    }
  }
});

test("the hatch keeps a clear opening and the open leaf hangs beside it", () => {
  for (const x of [-.69, .14, .68]) for (const z of [-.68, .11, .69]) {
    for (const l of meshes.get("trapdoor_frame")!) expect(floors(l, x, z)).toEqual([]);
    for (const l of meshes.get("trapdoor")!) expect(floors(l, x, z).length).toBeGreaterThan(0);
    for (const l of meshes.get("trapdoor_open")!) expect(floors(l, x, z)).toEqual([]);
  }
  for (const l of meshes.get("trapdoor_frame")!) {
    for (const [x, z] of [[1.36, 0], [-1.36, 0], [0, 1.36], [0, -1.36]]) {
      expect(floors(l, x!, z!).length).toBeGreaterThan(0);
    }
  }
});

test("each close stair tread and the ramp meet the walkable surface", () => {
  const stairs = meshes.get("stairs")![0]!, ramp = meshes.get("ramp")![0]!;
  for (let i = 0; i < 10; i++) {
    const z = -1.5 + (i + .5) * .3;
    expect(Math.max(...floors(stairs, .024, z))).toBeCloseTo(-1.5 + (i+1) * .3, 1);
    expect(Math.max(...floors(ramp, .024, z))).toBeCloseTo(-1.5 + (z+1.5) * 2.94/3, 1);
  }
});
