// Fits the grade to painted mood keys: for each key, the numbers of its grade (grade.ts) that bring the dome nearest the
// key at its four sky points, and the light nearest its three grey cards, in OKLab. Noon goes first, since its grade
// sets the anchors every other hour's light hangs from; its light is fixed by them (D155), so only its dome is fitted.
// Prints the grades as grade.ts writes them, and how far each key's points lie from the result, by the table as the
// game samples it.
// Run: bun tools/sky/fit.ts KEYS.json [--only noon,dusk]   (KEYS.json: { keys: { name: { points: { zenith: [r, g, b], ... } } } })

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { FRAME, FRAME_FLOATS } from "../../client/core/render/packet.ts";
import { cardTakes, domeLight, shownSky, skyFrame, slotHeight, sunDirection, type Sky } from "../../client/core/render/sky.ts";
import { srgbToLinear } from "../../client/core/render/surface.ts";
import { KEYS } from "./base.ts";
import { SkyBuilder } from "./build.ts";
import { GRADES, type Grade } from "./grade.ts";

export const SKY_POINTS = ["zenith", "high", "toward", "away"] as const;
export const CARDS = ["lit", "shaded", "up"] as const;
type Rgb = [number, number, number];

/** OKLab of a colour of 0 to 255, times 100: a distance of about 2 is just seen. */
export function oklab(c: readonly number[]): Rgb {
  const [r, g, b] = c.map((v) => srgbToLinear(v / 255)) as Rgb;
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [(0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s) * 100, (1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s) * 100, (0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s) * 100];
}

export function apart(a: readonly number[], b: readonly number[]): number {
  const x = oklab(a), y = oklab(b);
  return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
}

interface Point {
  heading: number;
  elevation: number;
}

interface BaseKey {
  name: string;
  hour: number;
  lightBy: "sun" | "moon";
  sun: Point;
  points: Record<string, Point>;
}

/** The base pictures' points: where each key is read. */
export function basePoints(): BaseKey[] {
  return JSON.parse(readFileSync(resolve(import.meta.dir, "../../assets/source/core/sky/keys/base/points.json"), "utf8")).keys;
}

/** Degrees round from the sun's heading to a point's, 0 to 180. */
function around(p: Point, sun: Point): number {
  const d = Math.abs((((p.heading - sun.heading) % 360) + 540) % 360 - 180);
  return d;
}

/** A direction from a heading and an elevation, as base.ts makes it. */
function direction(p: Point): number[] {
  const h = (p.heading * Math.PI) / 180, e = (p.elevation * Math.PI) / 180;
  return [-Math.sin(h) * Math.cos(e), Math.sin(e), Math.cos(h) * Math.cos(e)];
}

/** The dome as the game shows it at a key's points, read from a table and its light. */
export function tableAt(sky: Sky, key: BaseKey): Record<string, number[]> {
  const sun = [0, 0, 0];
  sunDirection(key.hour, sun);
  const f = new Float32Array(FRAME_FLOATS);
  skyFrame(key.hour, sky, f);
  const k = f[FRAME.skyScale]! * f[FRAME.exposure]!;
  const out: Record<string, number[]> = {};
  for (const name of SKY_POINTS) {
    const c = [0, 0, 0];
    domeLight(sky.table, sun, direction(key.points[name]!), c);
    const s = [0, 0, 0];
    shownSky(c.map((v) => v * k), s);
    out[name] = s;
  }
  return out;
}

/** What the builder makes of a key at its own height, the dome at its points and its cards, on screen. */
function model(b: SkyBuilder, key: BaseKey, g: Grade, height: number): Record<string, number[]> {
  const e = b.exposureAt(height, g);
  const out: Record<string, number[]> = {};
  const c = new Float64Array(3);
  for (const name of SKY_POINTS) {
    const p = key.points[name]!;
    b.domeAt(height, p.elevation, around(p, key.sun), c);
    const s = [0, 0, 0];
    shownSky(Array.from(c, (v) => v * e), s);
    out[name] = s;
  }
  const l = b.light(height, g);
  const moon = key.lightBy === "moon";
  const light = moon ? l.moon : l.sun;
  const lift = (slotHeight(height) * Math.PI) / 180;
  const dir = moon ? [-Math.cos((height * Math.PI) / 180), -Math.sin((height * Math.PI) / 180), 0] : [Math.cos(lift), Math.sin(lift), 0];
  const side = Math.sign(dir[0]!) || 1;
  const face = (n: number[]): number[] => {
    const t = cardTakes(n, n, dir);
    const s = [0, 0, 0];
    shownSky([0, 1, 2].map((k) => (light[k]! * t.light + (l.below[k]! + (l.above[k]! - l.below[k]!) * (0.5 + 0.5 * n[1]!)) * t.sky) * e), s);
    return s;
  };
  out.lit = face([side, 0, 0]);
  out.shaded = face([-side, 0, 0]);
  out.up = face([0, 1, 0]);
  return out;
}

/** A grade from the numbers the search moves. */
/**
 * Bounds that keep a grade gentle, the art director's measure's own: each tint within a factor of 4, saturation within
 * 2, the horizon lifted at most 2.5 times or lowered to a third, the glow round the light at most halved.
 */
const BOUNDS: readonly (readonly [number, number])[] = [
  [-Math.log(4), Math.log(4)], [-Math.log(4), Math.log(4)], [-Math.log(4), Math.log(4)],
  [-Math.log(2), Math.log(2)],
  [Math.log(1 / 3), Math.log(2.5)],
  [Math.log(0.5), Math.log(2.5)],
  [Math.log(1 / 3), Math.log(2.5)],
  [-Math.log(4), Math.log(4)], [-Math.log(4), Math.log(4)], [-Math.log(4), Math.log(4)],
  [-Math.log(2), Math.log(2)],
  [-0.5, 0.5],
];

function gradeOf(base: Grade, raw: number[], light: boolean): Grade {
  const x = raw.map((v, i) => Math.max(BOUNDS[i]![0], Math.min(BOUNDS[i]![1], v)));
  return {
    ...base,
    tint: [Math.exp(x[0]!), Math.exp(x[1]!), Math.exp(x[2]!)],
    saturation: Math.exp(x[3]!),
    horizon: x[4]!,
    glow: base.name === "night" ? 0 : x[5]!,
    moonGlow: base.name === "night" ? x[5]! : 0,
    farHorizon: x[6]!,
    sun: light ? [Math.exp(x[7]!), Math.exp(x[8]!), Math.exp(x[9]!)] : base.sun,
    sky: light ? Math.exp(x[10]!) : base.sky,
    afterglow: light ? 0.5 + x[11]! : base.afterglow,
  };
}

/** Nelder and Mead's simplex search for the least of `f` from `x0`. */
function simplex(f: (x: number[]) => number, x0: number[], step: number, rounds: number): number[] {
  const n = x0.length;
  let pts = [x0, ...x0.map((_, i) => x0.map((v, j) => (i === j ? v + step : v)))];
  let vals = pts.map(f);
  for (let r = 0; r < rounds; r++) {
    const order = vals.map((v, i) => [v, i] as const).sort((a, b) => a[0] - b[0]).map((p) => p[1]);
    pts = order.map((i) => pts[i]!);
    vals = order.map((i) => vals[i]!);
    const mid = x0.map((_, j) => pts.slice(0, n).reduce((s, p) => s + p[j]!, 0) / n);
    const worst = pts[n]!;
    const at = (t: number): number[] => mid.map((m, j) => m + t * (worst[j]! - m));
    const refl = at(-1);
    const fr = f(refl);
    if (fr < vals[0]!) {
      const exp = at(-2);
      const fe = f(exp);
      [pts[n], vals[n]] = fe < fr ? [exp, fe] : [refl, fr];
    } else if (fr < vals[n - 1]!) [pts[n], vals[n]] = [refl, fr];
    else {
      const con = at(0.5);
      const fc = f(con);
      if (fc < vals[n]!) [pts[n], vals[n]] = [con, fc];
      else {
        pts = pts.map((p, i) => (i === 0 ? p : p.map((v, j) => pts[0]![j]! + 0.5 * (v - pts[0]![j]!))));
        vals = pts.map((p, i) => (i === 0 ? vals[0]! : f(p)));
      }
    }
  }
  return pts[vals.indexOf(Math.min(...vals))]!;
}

type Paint = Record<string, Record<string, number[]>>;

/**
 * Fits the grades of `names` to the painted points, noon first, aiming the sky points at `aim` (the paint unless
 * told otherwise), from `grades` and the numbers each key was last fitted with in `from`. Returns the grades, every
 * key's in place, each fitted key's numbers, and what the builder makes of each at its own height.
 */
export function fit(paint: Paint, names: readonly string[], aim: Paint = paint, grades: Grade[] = GRADES.map((g) => ({ ...g })), from: Record<string, number[]> = {}): { grades: Grade[]; numbers: Record<string, number[]>; made: Paint } {
  const numbers: Record<string, number[]> = { ...from };
  const made: Paint = {};
  const b = new SkyBuilder(undefined, grades);
  const base = basePoints();
  const order = [...names].sort((a, c) => (a === "noon" ? -1 : c === "noon" ? 1 : 0));
  for (const name of order) {
    const key = base.find((k) => k.name === name)!;
    const at = grades.findIndex((g) => g.name === name);
    const height = grades[at]!.height;
    const target = { ...paint[name]!, ...Object.fromEntries(SKY_POINTS.map((p) => [p, aim[name]![p]!])) };
    const light = name !== "noon";
    const cost = (x: number[]): number => {
      grades[at] = gradeOf(grades[at]!, x, light);
      if (!light) b.anchor();
      const m = model(b, key, grades[at]!, height);
      let sum = 0;
      for (const p of SKY_POINTS) sum += apart(m[p]!, target[p]!) ** 2;
      for (const p of CARDS) sum += 0.5 * apart(m[p]!, target[p]!) ** 2;
      // Numbers the key says little about stay near the physical sky's.
      for (let i = 0; i < x.length; i++) sum += (i < 7 ? 2 : 8) * x[i]! * x[i]!;
      return sum;
    };
    const best = simplex(cost, from[name] ?? [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], from[name] ? 0.05 : 0.3, 700);
    cost(best);
    numbers[name] = best;
    const m = (made[name] = model(b, key, grades[at]!, height));
    console.log(`${name.padEnd(9)} fitted at ${height.toFixed(2)} degrees: ${[...SKY_POINTS, ...CARDS].map((p) => `${p} ${apart(m[p]!, target[p]!).toFixed(1)}`).join(", ")}`);
    if (process.argv.includes("--verbose")) for (const p of [...SKY_POINTS, ...CARDS]) console.log(`    ${p.padEnd(7)} key ${target[p]!.map(Math.round).join(",")}  table ${m[p]!.map(Math.round).join(",")}`);
  }
  return { grades, numbers, made };
}

const r = (v: number): string => String(+v.toFixed(3));

/** Grades as grade.ts writes them. */
export function gradesText(grades: readonly Grade[]): string {
  return grades.map((g) => `  { name: "${g.name}", height: ${g.height}, tint: [${g.tint.map(r).join(", ")}], saturation: ${r(g.saturation)}, horizon: ${r(g.horizon)}, farHorizon: ${r(g.farHorizon)}, glow: ${r(g.glow)}, moonGlow: ${r(g.moonGlow)}, sun: [${g.sun.map(r).join(", ")}], sky: ${r(g.sky)}, afterglow: ${r(g.afterglow)} },`).join("\n");
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const file = args[0];
  if (!file) throw new Error("bun tools/sky/fit.ts KEYS.json [--only name,name]");
  const only = args.indexOf("--only") >= 0 ? args[args.indexOf("--only") + 1]!.split(",") : null;
  const painted = JSON.parse(readFileSync(resolve(file), "utf8")).keys as Record<string, { points: Record<string, number[]> }>;
  const paint = Object.fromEntries(Object.entries(painted).map(([n, k]) => [n, k.points]));
  const names = KEYS.map((k) => k.name).filter((n) => paint[n] && (!only || only.includes(n)));
  // Fitted at each key's own height, then seen through the table as the game samples it, between slices. A key with a
  // point further than 5.8 from it there is fitted once more, from where it was, aiming past the key by as much as
  // the table moved that point from what the fit made.
  let { grades, numbers, made } = fit(paint, names);
  const report = (seen: Paint): string[] =>
    names.filter((name) => {
      const parts = SKY_POINTS.map((p) => apart(seen[name]![p]!, paint[name]![p]!));
      console.log(`  ${name.padEnd(9)} through the table: ${SKY_POINTS.map((p, i) => `${p} ${parts[i]!.toFixed(1)}`).join(", ")}`);
      return Math.max(...parts) > 5.8;
    });
  const seen = throughTable(grades, names);
  const again = report(seen);
  if (again.length > 0) {
    console.log(`fitting ${again.join(", ")} again, aiming past the keys by what the table took away`);
    const aim: Paint = JSON.parse(JSON.stringify(paint));
    for (const name of again) for (const p of SKY_POINTS) aim[name]![p] = paint[name]![p]!.map((v, k) => Math.max(0, Math.min(255, v + made[name]![p]![k]! - seen[name]![p]![k]!)));
    ({ grades, numbers, made } = fit(paint, again, aim, grades, numbers));
    report(throughTable(grades, names));
  }
  console.log(gradesText(grades));
}

/** The table the grades make, and the dome there at every key's points as the game shows it. */
export function throughTable(grades: readonly Grade[], names: readonly string[]): Paint {
  const { table, lights } = new SkyBuilder(undefined, grades).build();
  const sky: Sky = { table, lights };
  const out: Paint = {};
  for (const key of basePoints()) if (names.includes(key.name)) out[key.name] = tableAt(sky, key);
  return out;
}
