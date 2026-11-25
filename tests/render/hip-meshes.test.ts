// Each tier's hip and saddle against the roofs beside them, on the recipes' own meshes: a hip on the side a triangle
// shares with a slope and with another triangle, a saddle on the corner six triangles share and on a ridge's hipped end.
// Nothing of a trim hangs in air over a roof, it stands over the seam it caps, and it stays inside the roofs' undersides.

import { expect, test } from "bun:test";
import { ALL_FORMS } from "../../content/building/forms.ts";
import { MADE_PIECE_TRIANGLES, TRIM_TRIANGLES } from "../../tools/art/check.ts";
import type { Shape } from "../../tools/pack/pieces/kit.ts";
import { TEXTURED, levelsOf, type TierRecipe } from "../../tools/pack/pieces/lod.ts";
import { METAL } from "../../tools/pack/pieces/metal.ts";
import { STONE } from "../../tools/pack/pieces/stone.ts";
import { THATCH } from "../../tools/pack/pieces/thatch.ts";
import { WOOD } from "../../tools/pack/pieces/wood.ts";
import type { FormDef } from "../../shared/world/lattice/forms.ts";

type Tri = readonly [number, number, number, number, number, number, number, number, number];
const ALL: Record<string, FormDef> = ALL_FORMS;
const ROOT3 = Math.sqrt(3);
/** Metres of air a trim may have under it over a roof: a hewn timber's stray at the finest level, a coarser level's own error past it, as a roof's tests allow. */
const AIR = [0.005, 0.02, 0.02] as const;

/** A shape's triangles laid in the world: `to` takes a recipe point (z up) to x, y up, z. */
function laid(shape: Shape, to: (p: readonly number[]) => number[]): Tri[] {
  const c = shape.corners();
  const out: Tri[] = [];
  for (let t = 0; t < c.length; t += 3) out.push([...to(c[t]!), ...to(c[t + 1]!), ...to(c[t + 2]!)] as unknown as Tri);
  return out;
}

/** A roof's triangles at `level`, its origin at (x, z) and turned `turn` degrees from +X toward +Z, as piece-meets.test.ts sets them. */
function roof(recipe: TierRecipe, form: string, x: number, z: number, turn: number, level: number): Tri[] {
  const f = ALL[form]!;
  const shapes = levelsOf(recipe, form, f);
  const [c, s] = [Math.cos((turn * Math.PI) / 180), Math.sin((turn * Math.PI) / 180)];
  return laid(shapes[Math.min(level, shapes.length - 1)]!, (p) => [x + c * p[0]! + s * p[1]!, f.at[1] + p[2]!, z + s * p[0]! - c * p[1]!]);
}

/** A trim laid from (x, z) at height y, its +X toward (dx, dz), as the client lays one by a yaw. */
function trim(shape: Shape, x: number, y: number, z: number, dx: number, dz: number): Tri[] {
  const l = Math.hypot(dx, dz), [ux, uz] = [dx / l, dz / l];
  return laid(shape, (p) => [x + ux * p[0]! + uz * p[1]!, y + p[2]!, z + uz * p[0]! - ux * p[1]!]);
}

/** The lowest and highest any of `tris` stands over (x, z), or null. */
function over(tris: readonly Tri[], x: number, z: number): [number, number] | null {
  let [low, high] = [Infinity, -Infinity];
  for (const t of tris) {
    const d = (t[5] - t[8]) * (t[0] - t[6]) + (t[6] - t[3]) * (t[2] - t[8]);
    if (Math.abs(d) < 1e-12) continue;
    const a = ((t[5] - t[8]) * (x - t[6]) + (t[6] - t[3]) * (z - t[8])) / d;
    const b = ((t[8] - t[2]) * (x - t[6]) + (t[0] - t[6]) * (z - t[8])) / d;
    if (a < -1e-9 || b < -1e-9 || a + b > 1 + 1e-9) continue;
    const y = a * t[1] + b * t[4] + (1 - a - b) * t[7];
    low = Math.min(low, y);
    high = Math.max(high, y);
  }
  return high === -Infinity ? null : [low, high];
}

interface Met {
  /** The most air between a trim's underside and the roofs' top under it; the least it stands over their top on its line; how far it reaches under their undersides. */
  air: number;
  proud: number;
  under: number;
}

/** A trim against the roofs it lies on, read at each of `points` in plan; `line` those its top must stand over the roofs at. */
function meet(cap: readonly Tri[], roofs: readonly Tri[][], points: readonly (readonly [number, number])[], line: readonly (readonly [number, number])[]): Met {
  const met: Met = { air: 0, proud: Infinity, under: 0 };
  const tops = (x: number, z: number): [number, number] | null => {
    let got: [number, number] | null = null;
    for (const r of roofs) {
      const h = over(r, x, z);
      if (h) got = got ? [Math.min(got[0], h[0]), Math.max(got[1], h[1])] : h;
    }
    return got;
  };
  for (const [x, z] of points) {
    const [t, r] = [over(cap, x, z), tops(x, z)];
    if (!t || !r) continue;
    met.air = Math.max(met.air, t[0] - r[1]);
    met.under = Math.max(met.under, r[0] - t[0]);
  }
  for (const [x, z] of line) {
    const [t, r] = [over(cap, x, z), tops(x, z)];
    expect(t !== null && r !== null, `the trim and the roofs reach ${x.toFixed(2)}, ${z.toFixed(2)}`).toBe(true);
    met.proud = Math.min(met.proud, t![1] - r![1]);
  }
  return met;
}

const TIERS: readonly TierRecipe[] = [WOOD, STONE, METAL];
const apex: [number, number] = [1.5, 1.5 * ROOT3];

/** A hip's footprint and line in plan from the low corner (0, 0) up to the apex, `w` either side, clear of both ends. */
function hipPoints(w: number): { points: [number, number][]; line: [number, number][] } {
  const [ux, uz] = [apex[0] / 3, apex[1] / 3], [nx, nz] = [-uz, ux];
  const points: [number, number][] = [], line: [number, number][] = [];
  for (let k = 0; k <= 50; k++) {
    const t = 0.15 + (2.6 * k) / 50;
    line.push([ux * t, uz * t]);
    for (let j = -8; j <= 8; j++) points.push([ux * t + (nx * w * j) / 8, uz * t + (nz * w * j) / 8]);
  }
  return { points, line };
}

/** The two roofs beside a hip: a triangle's first sloped side against a slope turned 30 degrees, or against the next triangle round a bay. */
const PAIRS: readonly [string, (recipe: TierRecipe, level: number) => Tri[][]][] = [
  ["a triangle and a slope", (r, l) => [roof(r, "triangle_roof", 0, 0, 0, l), roof(r, "roof", 0.75 - 1.5 * Math.cos(Math.PI / 6), 0.75 * ROOT3 + 1.5 * Math.sin(Math.PI / 6), -30, l)]],
  ["two triangles round a bay", (r, l) => [roof(r, "triangle_roof", 0, 0, 0, l), roof(r, "triangle_roof", -1.5, 1.5 * ROOT3, -60, l)]],
];

test("a hip lies on the roofs either side of its line, over their seam, and inside their undersides", () => {
  const said: string[] = [];
  for (const recipe of TIERS) {
    const hip = recipe.trims!().hip!;
    for (const [name, pair] of PAIRS) {
      for (let level = 0; level < TEXTURED; level++) {
        const cap = trim(hip[level]!, apex[0] / 2, 1, apex[1] / 2, apex[0], apex[1]);
        const { points, line } = hipPoints(0.04);
        const met = meet(cap, pair(recipe, level), points, line);
        said.push(`${recipe.name} hip, ${name}, level ${level}: air ${(met.air * 1000).toFixed(1)} mm, over the seam ${(met.proud * 1000).toFixed(1)} mm, under the roofs ${(met.under * 1000).toFixed(1)} mm`);
        expect(met.air, `${recipe.name} ${name} level ${level}: air under it`).toBeLessThanOrEqual(AIR[level]!);
        expect(met.proud, `${recipe.name} ${name} level ${level}: over the seam`).toBeGreaterThanOrEqual(0.01);
        expect(met.under, `${recipe.name} ${name} level ${level}: under the roofs`).toBeLessThanOrEqual(0);
      }
    }
  }
  if (process.env.SNARK_MEETS) console.log(said.join("\n"));
});

test("a saddle sits on six triangles round their corner and on a ridge's hipped end, over the hips that end there", () => {
  const said: string[] = [];
  for (const recipe of TIERS) {
    const { hip, saddle, ridge } = recipe.trims!();
    for (let level = 0; level < TEXTURED; level++) {
      // Six triangles turned about the apex, each high there, and a hip on each side two share.
      const six = [0, 60, 120, 180, 240, 300].map((turn) => {
        const [c, s] = [Math.cos((turn * Math.PI) / 180), Math.sin((turn * Math.PI) / 180)];
        return roof(recipe, "triangle_roof", apex[0] - (c * apex[0] - s * apex[1]), apex[1] - (s * apex[0] + c * apex[1]), turn, level);
      });
      const hips = [0, 60, 120, 180, 240, 300].flatMap((turn) => {
        const a = ((turn + 240) * Math.PI) / 180;
        return trim(hip![level]!, apex[0] + Math.cos(a) * 1.5, 1, apex[1] + Math.sin(a) * 1.5, -Math.cos(a), -Math.sin(a));
      });
      const cap = trim(saddle![level]!, apex[0], 1.75, apex[1], 1, 0);
      const points: [number, number][] = [];
      for (let k = 0; k < 36; k++) for (const r of [0.02, 0.06, 0.1, 0.13]) points.push([apex[0] + r * Math.cos((k * Math.PI) / 18), apex[1] + r * Math.sin((k * Math.PI) / 18)]);
      const met = meet(cap, six, points, [apex]);
      // The hips' tops under it, so it covers where they end.
      const high = Math.max(...points.map(([x, z]) => over(hips, x, z)?.[1] ?? -Infinity));
      said.push(`${recipe.name} saddle on six triangles, level ${level}: air ${(met.air * 1000).toFixed(1)} mm, over the apex ${(met.proud * 1000).toFixed(1)} mm, over the hips ${((over(cap, apex[0], apex[1])![1] - high) * 1000).toFixed(1)} mm, under the roofs ${(met.under * 1000).toFixed(1)} mm`);
      expect(met.air, `${recipe.name} level ${level}: air under it`).toBeLessThanOrEqual(AIR[level]!);
      expect(met.under, `${recipe.name} level ${level}: under the roofs`).toBeLessThanOrEqual(0);
      expect(over(cap, apex[0], apex[1])![1] - high, `${recipe.name} level ${level}: over the hips`).toBeGreaterThan(0.02);
      // A ridge's end: two slopes to a ridge along -X from the apex, and the triangles round the apex's other half.
      const ends = [roof(recipe, "roof", apex[0] - 1.5, apex[1] - 1.5, 0, level), roof(recipe, "roof", apex[0] - 1.5, apex[1] + 1.5, 180, level), ...[0, 60, 120].map((turn) => {
        const t = turn + 30, [c, s] = [Math.cos((t * Math.PI) / 180), Math.sin((t * Math.PI) / 180)];
        return roof(recipe, "triangle_roof", apex[0] - (c * apex[0] - s * apex[1]), apex[1] - (s * apex[0] + c * apex[1]), t, level);
      })];
      const ridgeEnd = trim(ridge![level]!, apex[0] - 1.5, 1.75, apex[1], 1, 0);
      const hipped = meet(cap, ends, points, [apex]);
      const ridgeTop = Math.max(...points.map(([x, z]) => over(ridgeEnd, x, z)?.[1] ?? -Infinity));
      said.push(`${recipe.name} saddle on a ridge's hipped end, level ${level}: air ${(hipped.air * 1000).toFixed(1)} mm, over the ridge ${((over(cap, apex[0], apex[1])![1] - ridgeTop) * 1000).toFixed(1)} mm`);
      expect(hipped.air, `${recipe.name} level ${level}: air under it at a ridge's end`).toBeLessThanOrEqual(AIR[level]!);
      expect(over(cap, apex[0], apex[1])![1] - ridgeTop, `${recipe.name} level ${level}: over the ridge's end`).toBeGreaterThan(0.01);
    }
  }
  if (process.env.SNARK_MEETS) console.log(said.join("\n"));
});

test("a ridge stands 2 cm past each end of its side, where an open end is left as made", () => {
  for (const recipe of [WOOD, STONE, METAL, THATCH]) {
    recipe.trims!().ridge!.forEach((shape, level) => {
      const xs = shape.corners().map((p) => p[0]);
      expect([recipe.name, level, Math.min(...xs), Math.max(...xs)].map((v) => (typeof v === "number" ? Math.round(v * 1e4) / 1e4 : v))).toEqual([recipe.name, level, -1.52, 1.52]);
    });
  }
});

test("a hip and a saddle cost a trim's triangles, and thatch, which has no triangle roof, has neither", () => {
  for (const recipe of TIERS) {
    const trims = recipe.trims!();
    for (const name of ["hip", "saddle"]) {
      const shapes = trims[name]!;
      expect([recipe.name, name, shapes.length]).toEqual([recipe.name, name, TRIM_TRIANGLES[name]!.length]);
      shapes.forEach((shape, level) => expect(shape.triangles, `${recipe.name} ${name} level ${level}`).toBeLessThanOrEqual(TRIM_TRIANGLES[name]![level]!));
    }
  }
  expect(Object.keys(THATCH.trims!()).filter((name) => name === "hip" || name === "saddle")).toEqual([]);
  // A hip and a saddle are each under a tenth of a roof's finest triangles.
  for (const name of ["hip", "saddle"]) expect(TRIM_TRIANGLES[name]![0]!).toBeLessThanOrEqual(MADE_PIECE_TRIANGLES[0]![1] / 10);
});
