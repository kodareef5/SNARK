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

const tones = ["alloy", "gasket", "socket", "bevel", "titanium", "chamfer", "cover", "emitter", "lens", "copper", "membrane"];

/** A normal ray returns the first outward surface visible from either side. */
function visible(lod: SourceLod, x: number, y: number, side: number) {
  let depth = -Infinity, tone = "";
  const p = lod.positions;
  for (let i = 0; i < lod.indices.length; i += 3) {
    const ia = lod.indices[i]!, a = 3 * ia, b = 3 * lod.indices[i + 1]!, c = 3 * lod.indices[i + 2]!;
    const dx = x - p[a]!, dy = y - p[a + 1]!, bx = p[b]! - p[a]!, by = p[b + 1]! - p[a + 1]!;
    const cx = p[c]! - p[a]!, cy = p[c + 1]! - p[a + 1]!, area = bx * cy - by * cx;
    if (area * side < 1e-8) continue;
    const u = (dx * cy - dy * cx) / area, v = (dy * bx - dx * by) / area;
    if (u < 0 || v < 0 || u + v > 1) continue;
    const z = side * ((1 - u - v) * p[a + 2]! + u * p[b + 2]! + v * p[c + 2]!);
    if (z > depth) { depth = z; tone = tones[lod.colors[ia]!]!; }
  }
  return { tone, depth };
}

function covers(lod: SourceLod, x: number, y: number, side: number): boolean {
  return Number.isFinite(visible(lod, x, y, side).depth);
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

test("both sides of the personnel door expose a recessed pane and working hardware", () => {
  const form = FORMS.door;
  const [left, low] = form.outline[0]!, height = form.outline[2]![1] - low, width = -left * 2;
  const lod = flatLod(tekOpening("door", form, 0)!, name => tones.indexOf(name));
  const y = (at: number) => low - form.at[1] + height * at;
  for (const side of [-1, 1]) {
    const field = visible(lod, 0, y(.63), side);
    expect(field.tone).toBe("membrane");
    expect(visible(lod, left + .046 * width, y(.205), side).tone).toBe("copper");
    expect(visible(lod, left + .046 * width, y(.79), side).tone).toBe("copper");
    const lock = visible(lod, left + .936 * width, y(.45), side);
    expect(lock.tone).toBe("copper");
    expect(lock.depth - field.depth).toBeGreaterThan(.025);
    expect(visible(lod, left + .825 * width, y(.47), side).tone).toBe("emitter");
  }
});

test("the gate bridge crosses both optical leaves above the glass", () => {
  const f = FORMS.gate, shape = tekOpening("gate", f, 0)!;
  const [left, low] = f.outline[0]!, [right, high] = f.outline[2]!;
  const x = (right - left) / 4, y = (h: number) => low - f.at[1] + (high - low) * h;
  const lod = flatLod(shape, mat => tones.indexOf(mat));
  for (const side of [-1, 1]) for (const leaf of [-1, 1]) {
    const lower = visible(lod, leaf * x, y(.31), side), upper = visible(lod, leaf * x, y(.72), side);
    expect([lower.tone, upper.tone]).toEqual(["membrane", "membrane"]);
    const brace = visible(lod, leaf * x, y(.55), side);
    expect(brace.tone).toBe("alloy");
    expect(brace.depth - lower.depth).toBeGreaterThan(.04);
  }
});

test("optical jambs and armor panels keep their cells bounded by a raised rim", () => {
  for (const name of [...frames, "quarter_wall", "half_wall", "large_wall", "sloped_wall_left", "sloped_wall_right"] as const) {
    const shape = tekOpening(name, FORMS[name], 0)!;
    const optical = shape.faces.filter(face => face.mat === "membrane");
    expect(optical.length, name).toBeGreaterThanOrEqual(2);
    const floor = Math.abs(optical[0]!.points[0]![1]);
    expect(optical.every(face => face.points.every(p => Math.abs(Math.abs(p[1]) - floor) < 1e-6)), name).toBe(true);
    const guide = shape.faces.filter(f => f.mat === "emitter").flatMap(f => f.points.map(p => Math.abs(p[1])));
    expect(Math.max(...guide) - floor, name).toBeGreaterThan(.02);
  }
});

test("each paired frame exposes the two journals on each opening edge", () => {
  for (const name of ["double_doorway", "gateway"] as const) {
    const f = FORMS[name], hole = f.openings[0]!, left = hole.x0 - f.at[0];
    const cheek = Math.min(.21, (hole.x0 - f.outline[0]![0]) * .31);
    const lod = flatLod(tekOpening(name, f, 0)!, mat => tones.indexOf(mat));
    for (const d of [-1, 1]) for (const side of [-1, 1]) for (const at of [.22, .77]) {
      const y = hole.y0 + (hole.y1 - hole.y0) * at - f.at[1];
      expect(visible(lod, d * (Math.abs(left) + cheek * .57), y, side).tone, name).toBe("copper");
    }
  }
});
