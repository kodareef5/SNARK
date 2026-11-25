import { expect, test } from "bun:test";
import { ALL_FORMS, formHulls } from "../../content/building/forms.ts";
import { hullPoint } from "../../shared/world/convex.ts";
import type { FormDef } from "../../shared/world/lattice/forms.ts";
import { TEK_INLAY_COLOUR, TEK_RAIL_COLOUR } from "../../content/building/tek-wall.ts";
import { defaultPalette, REGION_BASE } from "../../shared/pack/palette.ts";
import { parsePack } from "../../shared/pack/pack.ts";
import { MADE_PIECE_TRIANGLES, measureSurface } from "../../tools/art/check.ts";
import { colliderBox } from "../../tools/pack/pieces/lod.ts";
import { bakeTek } from "../../tools/pack/pieces/tek.ts";
import { buildPack, unpackMeshes, type SourceLod } from "../../tools/pack/write.ts";

const forms: Readonly<Record<string, FormDef>> = ALL_FORMS;
const parts = Object.entries(forms).filter(([, form]) => form.plane === "flat");
const packed = parsePack(buildPack(bakeTek(Object.fromEntries(parts)), defaultPalette()));
const meshes = new Map(unpackMeshes(packed).map(mesh => [mesh.id.slice("core:".length, -"_tek".length), mesh.lods]));

/** Heights where a vertical line crosses this level of the packed mesh. */
function floors(lod: SourceLod, x: number, z: number, colour?: number): number[] {
  const p = lod.positions, hits = [];
  for (let k = 0; k < lod.indices.length; k += 3) {
    if (colour !== undefined && lod.colors[lod.indices[k]!] !== colour) continue;
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

test("the foundation treads and powered keel stand above the graphite channel", () => {
  const deck = meshes.get("foundation")![0]!;
  const top = (x: number, z: number, colour?: number) => Math.max(...floors(deck, x, z, colour));
  const optical = top(.06, .12);
  expect(top(.06, .12, TEK_INLAY_COLOUR)).toBe(optical);
  for (const hand of [-1, 1]) {
    const tread = top(hand * 1.05, .085);
    expect(top(hand * 1.05, .085, REGION_BASE)).toBe(tread);
    expect(tread - optical).toBeGreaterThan(.009);
    expect(tread - top(hand * .603, .085)).toBeGreaterThan(.047);
    expect(top(hand * .378, .11, TEK_RAIL_COLOUR)).toBe(top(hand * .378, .11));
  }
});

test("the ceiling's optical coffer faces the room beneath its walking armor", () => {
  for (const level of meshes.get("ceiling")!.slice(0, 3)) {
    const under = Math.min(...floors(level, .054, -.082));
    expect(Math.min(...floors(level, .054, -.082, TEK_INLAY_COLOUR))).toBe(under);
    expect(Math.max(...floors(level, .28, .22, REGION_BASE))).toBe(Math.max(...floors(level, .28, .22)));
  }
});

test("armored stair noses cantilever over open bays beside the stringers", () => {
  const near = meshes.get("stairs")![0]!;
  for (const z of [-.75, -.15, .45, 1.05]) {
    const rim = floors(near, 1.22, z);
    expect(Math.max(...rim) - Math.min(...rim)).toBeGreaterThan(.085);
    expect(Math.max(...rim) - Math.min(...rim)).toBeLessThan(.13);
    expect(Math.min(...floors(near, 0, z))).toBeLessThan(-1.48);
  }
});

test("each close Tek deck has a powered lens and a bounded optical surface", () => {
  for (const [name] of parts) {
    const close = meshes.get(name)![0]!;
    for (const material of [TEK_INLAY_COLOUR, TEK_RAIL_COLOUR, REGION_BASE]) {
      expect(close.colors.includes(material), name).toBe(true);
    }
  }
});
