import { expect, test } from "bun:test";
import { FORMS } from "../../content/building/forms.ts";
import { MADE_PIECE_TRIANGLES, measureSurface } from "../../tools/art/check.ts";
import { flatLod, type Shape, type Vec } from "../../tools/pack/pieces/kit.ts";
import { levelsOf, type TierRecipe } from "../../tools/pack/pieces/lod.ts";
import { tekOpening } from "../../tools/pack/pieces/tek-openings.ts";
import type { SourceLod } from "../../tools/pack/write.ts";

const recipe: TierRecipe = { name: "tek", rank: 4, runPost: false, jointHalf: .11, tones: {}, split: tekOpening };
const frames = ["doorframe", "windowframe", "double_doorway", "gateway"] as const;
const leaves = ["door", "double_door", "gate"] as const;
const names = [...frames, ...leaves, "door_open", "double_door_open", "gate_open", "half_wall", "quarter_wall", "large_wall",
  "sloped_wall_left", "sloped_wall_right", "railing", "ladder", "beam", "fence_foundation"] as const;

test("the Tek uprights bake as closed outward faces inside every distance budget", () => {
  for (const name of names) {
    const levels = levelsOf(recipe, name, FORMS[name]);
    expect(levels[0]!.faces.some(face => face.mat === "emitter"), name).toBe(true);
    expect(levels[0]!.faces.some(face => face.mat === "copper"), name).toBe(true);
    expect(levels[0]!.faces.some(face => face.mat === "alloy"), name).toBe(true);
    expect(levels[0]!.faces.some(face => face.mat === "field"), name).toBe(false);
    for (let i = 0; i < MADE_PIECE_TRIANGLES.length; i++) {
      const lod = flatLod(levels[Math.min(i, levels.length - 1)]!, () => 1);
      expect(lod.indices.length / 3, name).toBeLessThanOrEqual(MADE_PIECE_TRIANGLES[i]![1]);
      expect(measureSurface(lod), name).toMatchObject({ holes: 0, flipped: 0, insideOut: 0, collapsed: 0 });
    }
  }
});

/** A ray normal to the face crosses an outward triangle as seen from this side. */
function covers(lod: SourceLod, x: number, y: number, side: number): boolean {
  const p = lod.positions;
  for (let i = 0; i < lod.indices.length; i += 3) {
    const a = 3 * lod.indices[i]!, b = 3 * lod.indices[i + 1]!, c = 3 * lod.indices[i + 2]!;
    const area = (p[b]! - p[a]!) * (p[c + 1]! - p[a + 1]!) - (p[b + 1]! - p[a + 1]!) * (p[c]! - p[a]!);
    if (area * side < 1e-8) continue;
    const u = ((x - p[a]!) * (p[c + 1]! - p[a + 1]!) - (y - p[a + 1]!) * (p[c]! - p[a]!)) / area;
    const v = ((p[b]! - p[a]!) * (y - p[a + 1]!) - (p[b + 1]! - p[a + 1]!) * (x - p[a]!)) / area;
    if (u >= 0 && v >= 0 && u + v <= 1) return true;
  }
  return false;
}

test("portals retain their clear width, lintel and jambs from both sides", () => {
  for (const name of frames) {
    const form = FORMS[name], hole = form.openings[0]!;
    const l = hole.x0 - form.at[0], r = hole.x1 - form.at[0], b = hole.y0 - form.at[1], t = hole.y1 - form.at[1];
    for (const shape of levelsOf(recipe, name, form)) {
      const lod = flatLod(shape, () => 1);
      for (const side of [-1, 1]) {
        for (const x of [l + .03, (l + r) / 2, r - .03]) {
          for (const y of [b + .03, b + .51 * (t - b), t - .03]) expect(covers(lod, x, y, side), name).toBe(false);
        }
        expect(covers(lod, .08, t + .07, side), name).toBe(true);
        expect(covers(lod, l - .055, (t + b) / 2, side), name).toBe(true);
        if (name === "windowframe") expect(covers(lod, 0, b - .08, side)).toBe(true);
      }
    }
  }
});

function samples(shape: Shape, turn: (p: Vec) => Vec): string[] {
  const result = new Set<string>();
  for (const face of shape.faces) for (const point of face.points) result.add([face.mat, ...turn(point).map(x => Math.round(x * 10000))].join("/"));
  return [...result].sort();
}

test("the Tek leaves turn around the form hinges with their hardware intact", () => {
  for (const name of leaves) {
    const open = `${name}_open` as const, form = FORMS[open], paired = name !== "door";
    const wide = form.outline[1]![0] - form.outline[0]![0], hinge = form.off - form.at[0];
    for (const level of [0, 1, 2, 3]) {
      const shut = tekOpening(name, FORMS[name], level)!, stood = tekOpening(open, form, level)!;
      const swung = ([x, y, z]: Vec): Vec => paired && x > 0 ? [-hinge - y, x - wide, z] : [hinge + y, -x - (paired ? wide : wide / 2), z];
      expect(samples(shut, swung), name).toEqual(samples(stood, p => p));
    }
  }
});

test("the gables mirror the roof rake and the climbing gaps stay open", () => {
  for (const [level, left] of levelsOf(recipe, "sloped_wall_left", FORMS.sloped_wall_left).entries()) {
    const right = levelsOf(recipe, "sloped_wall_right", FORMS.sloped_wall_right)[level]!;
    expect(samples(left, ([x, y, z]) => [-x, y, z])).toEqual(samples(right, p => p));
  }
  for (const [name, x, z] of [["ladder", 0.03, 0.06], ["railing", .45, .13]] as const) {
    for (const shape of levelsOf(recipe, name, FORMS[name])) for (const side of [-1, 1]) {
      expect(covers(flatLod(shape, () => 1), x, z, side)).toBe(false);
    }
  }
});
