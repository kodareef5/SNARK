// Fits the grade to painted mood keys: for each key, the numbers of its grade (grade.ts) that bring the dome nearest the
// key at its four sky points, and the light nearest its three grey cards, in OKLab. Noon goes first, since its grade
// sets the anchors every other hour's light hangs from; its light is fixed by them (D155), so only its dome is fitted.
// Prints the grades as grade.ts writes them, and how far each key's points lie from the result, by the table as the
// game samples it.
// Run: bun tools/sky/fit.ts KEYS.json [--only noon,dusk]   (KEYS.json: { keys: { name: { points: { zenith: [r, g, b], ... } } } })

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { FRAME, FRAME_FLOATS } from "../../client/core/render/packet.ts";
import { cardTakes, domeLight, shownSky, skyFrame, sunDirection, type Sky } from "../../client/core/render/sky.ts";
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
  const dir = moon ? [-Math.cos((height * Math.PI) / 180), -Math.sin((height * Math.PI) / 180), 0] : [Math.cos((height * Math.PI) / 180), Math.sin((height * Math.PI) / 180), 0];
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
function gradeOf(base: Grade, x: number[], light: boolean): Grade {
  return {
    ...base,
    tint: [Math.exp(x[0]!), Math.exp(x[1]!), Math.exp(x[2]!)],
    saturation: Math.exp(x[3]!),
    horizon: x[4]!,
    glow: base.name === "night" ? 0 : x[5]!,
    moonGlow: base.name === "night" ? x[5]! : 0,
    sun: light ? [Math.exp(x[6]!), Math.exp(x[7]!), Math.exp(x[8]!)] : base.sun,
    sky: light ? Math.exp(x[9]!) : base.sky,
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

/** Fits the grades of `names` to the painted points, noon first. Returns the grades, every key's in place. */
export function fit(paint: Record<string, Record<string, number[]>>, names: readonly string[]): Grade[] {
  const grades = GRADES.map((g) => ({ ...g }));
  const b = new SkyBuilder(undefined, grades);
  const base = basePoints();
  const order = [...names].sort((a, c) => (a === "noon" ? -1 : c === "noon" ? 1 : 0));
  for (const name of order) {
    const key = base.find((k) => k.name === name)!;
    const at = grades.findIndex((g) => g.name === name);
    const height = grades[at]!.height;
    const target = paint[name]!;
    const light = name !== "noon";
    const cost = (x: number[]): number => {
      grades[at] = gradeOf(grades[at]!, x, light);
      if (!light) b.anchor();
      const m = model(b, key, grades[at]!, height);
      let sum = 0;
      for (const p of SKY_POINTS) sum += apart(m[p]!, target[p]!) ** 2;
      for (const p of CARDS) sum += 0.5 * apart(m[p]!, target[p]!) ** 2;
      // Numbers the key says little about stay near the physical sky's.
      for (let i = 0; i < x.length; i++) sum += (i < 6 ? 2 : 8) * x[i]! * x[i]!;
      return sum;
    };
    const start = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    const best = simplex(cost, start, 0.3, 700);
    cost(best);
    console.log(`${name.padEnd(9)} fitted at ${height.toFixed(2)} degrees: ${SKY_POINTS.map((p) => `${p} ${apart(model(b, key, grades[at]!, height)[p]!, target[p]!).toFixed(1)}`).join(", ")}; cards ${CARDS.map((p) => apart(model(b, key, grades[at]!, height)[p]!, target[p]!).toFixed(1)).join(", ")}`);
  }
  return grades;
}

const r = (v: number): string => String(+v.toFixed(3));

/** Grades as grade.ts writes them. */
export function gradesText(grades: readonly Grade[]): string {
  return grades.map((g) => `  { name: "${g.name}", height: ${g.height}, tint: [${g.tint.map(r).join(", ")}], saturation: ${r(g.saturation)}, horizon: ${r(g.horizon)}, glow: ${r(g.glow)}, moonGlow: ${r(g.moonGlow)}, sun: [${g.sun.map(r).join(", ")}], sky: ${r(g.sky)} },`).join("\n");
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const file = args[0];
  if (!file) throw new Error("bun tools/sky/fit.ts KEYS.json [--only name,name]");
  const only = args.indexOf("--only") >= 0 ? args[args.indexOf("--only") + 1]!.split(",") : null;
  const painted = JSON.parse(readFileSync(resolve(file), "utf8")).keys as Record<string, { points: Record<string, number[]> }>;
  const paint = Object.fromEntries(Object.entries(painted).map(([n, k]) => [n, k.points]));
  const names = KEYS.map((k) => k.name).filter((n) => paint[n] && (!only || only.includes(n)));
  const grades = fit(paint, names);
  console.log(gradesText(grades));
}
