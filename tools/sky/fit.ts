// Fits each mood key's light (grade.ts) to the key's three grey cards, in OKLab: the sun's tint, the sky's strength
// and, at sunset and dusk, the afterglow's share. Noon's light is the anchors' (D155) and is not fitted. The dome is
// not fitted: it is read from the keys (keys.ts). Prints the grades as grade.ts writes them, the cards, and how far
// the table lies from each key over the whole dome.
// Run: bun tools/sky/fit.ts [--only dawn,dusk]

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { FRAME, FRAME_FLOATS } from "../../client/core/render/packet.ts";
import { cardTakes, domeLight, isEvening, shownSky, skyFrame, slotHeight, sunDirection, sunHeight, type Sky } from "../../client/core/render/sky.ts";
import { readPng } from "../pack/png-read.ts";
import { SkyBuilder } from "./build.ts";
import { GRADES, type Grade } from "./grade.ts";
import { KEYS_DIR, MOON_CLEAR, SUN_CLEAR, between, elevationAt, headingAt, oklab, roundFrom } from "./keys.ts";

export const SKY_POINTS = ["zenith", "high", "toward", "away"] as const;
export const CARDS = ["lit", "shaded", "up"] as const;

/** How far apart two colours of 0 to 255 are, OKLab times 100. */
export function apart(a: readonly number[], b: readonly number[]): number {
  const x = oklab(a), y = oklab(b);
  return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
}

interface Point {
  heading: number;
  elevation: number;
}

export interface BaseKey {
  name: string;
  hour: number;
  lightBy: "sun" | "moon";
  sun: Point;
  moon: Point;
  points: Record<string, Point>;
}

/** The base pictures' points: where each key is read. */
export function basePoints(): BaseKey[] {
  return JSON.parse(readFileSync(resolve(KEYS_DIR, "base/points.json"), "utf8")).keys;
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

export interface DomeApart {
  /** The median and the 90th percentile of the distance over the clear sky, OKLab times 100, each pixel by its solid angle. */
  median: number;
  p90: number;
  /** The median toward the light (within 60 degrees round of it), away from it (past 120) and overhead (above 45 up). */
  toward: number;
  away: number;
  overhead: number;
}

/**
 * How far the table's dome lies from a key over the whole of its clear sky, as the game shows it: every `step`th pixel
 * of the key's sky above the horizon, past SUN_CLEAR and MOON_CLEAR of the discs. Clouds and stars are left in; the
 * median does not see them, the 90th percentile a little.
 */
export function domeApart(sky: Sky, key: BaseKey, step = 2): DomeApart {
  const img = readPng(resolve(KEYS_DIR, `${key.name}.png`));
  const base = readPng(resolve(KEYS_DIR, `base/${key.name}.png`));
  const sun = [0, 0, 0];
  sunDirection(key.hour, sun);
  const f = new Float32Array(FRAME_FLOATS);
  skyFrame(key.hour, sky, f);
  const k = f[FRAME.skyScale]! * f[FRAME.exposure]!;
  const all: [number, number][] = [], toward: [number, number][] = [], away: [number, number][] = [], overhead: [number, number][] = [];
  const c = [0, 0, 0], s = [0, 0, 0];
  for (let y = 0; y < img.height; y += step) {
    const e = elevationAt(y, img.height);
    if (e < 0) break;
    const w = Math.cos((e * Math.PI) / 180);
    for (let x = 0; x < img.width; x += step) {
      const b = (y * img.width + x) * base.channels;
      if (base.data[b] !== base.data[0] || base.data[b + 1] !== base.data[1] || base.data[b + 2] !== base.data[2]) continue;
      const here = { heading: headingAt(x, img.width), elevation: e };
      if (between(here, key.sun) < SUN_CLEAR || between(here, key.moon) < MOON_CLEAR) continue;
      domeLight(sky.table, sun, direction(here), c);
      shownSky(c.map((v) => v * k), s);
      const p = (y * img.width + x) * img.channels;
      const d = apart(s, [img.data[p]!, img.data[p + 1]!, img.data[p + 2]!]);
      all.push([d, w]);
      const a = roundFrom(here.heading, key.sun.heading);
      if (a < 60) (key.lightBy === "sun" ? toward : away).push([d, w]);
      if (a > 120) (key.lightBy === "sun" ? away : toward).push([d, w]);
      if (e > 45) overhead.push([d, w]);
    }
  }
  const at = (v: [number, number][], q: number): number => {
    v.sort((p, r) => p[0] - r[0]);
    const total = v.reduce((t, p) => t + p[1], 0);
    let run = 0;
    for (const [d, w] of v) if ((run += w) >= q * total) return d;
    return v.length ? v[v.length - 1]![0] : 0;
  };
  return { median: at(all, 0.5), p90: at(all, 0.9), toward: at(toward, 0.5), away: at(away, 0.5), overhead: at(overhead, 0.5) };
}

/** A key's cards as its own picture has them, read by the art director's reader (keys/points-read.json). */
export function keyCards(): Record<string, Record<string, number[]>> {
  const file = resolve(KEYS_DIR, "points-read.json");
  if (!existsSync(file)) return {};
  const keys = JSON.parse(readFileSync(file, "utf8")).keys as Record<string, { points: Record<string, number[]> }>;
  return Object.fromEntries(Object.entries(keys).map(([n, k]) => [n, k.points]));
}

/**
 * What the base pictures' grey 128 cards show under a table's light at an hour, as the game lights them: upright
 * toward the light's heading, upright away from it, and face up. The light is the sun, or with `moon` the moon.
 */
export function cardColours(sky: Sky, hour: number, moon: boolean): { lit: number[]; shaded: number[]; up: number[] } {
  const frame = new Float32Array(FRAME_FLOATS);
  skyFrame(hour, sky, frame);
  const e = frame[FRAME.exposure]!;
  const v = (at: number) => [frame[at]!, frame[at + 1]!, frame[at + 2]!];
  const light = v(moon ? FRAME.moonColor : FRAME.sunColor);
  const l = v(moon ? FRAME.moon : FRAME.sun);
  const above = v(FRAME.skyAbove);
  const below = v(FRAME.skyBelow);
  const across = Math.hypot(l[0]!, l[2]!);
  const face = (n: number[]) => {
    const takes = cardTakes(n, n, l);
    const out = [0, 0, 0];
    shownSky([0, 1, 2].map((k) => (light[k]! * takes.light + (below[k]! + (above[k]! - below[k]!) * (0.5 + 0.5 * n[1]!)) * takes.sky) * e), out);
    return out;
  };
  return { lit: face([l[0]! / across, 0, l[2]! / across]), shaded: face([-l[0]! / across, 0, -l[2]! / across]), up: face([0, 1, 0]) };
}

/** What the builder makes of a key's three cards at its own height, on screen. */
export function cardsOf(b: SkyBuilder, key: BaseKey, g: Grade): Record<string, number[]> {
  const height = sunHeight(key.hour);
  const sun = [0, 0, 0];
  sunDirection(key.hour, sun);
  const e = b.exposureAt(height, isEvening(sun), g);
  const l = b.light(height, isEvening(sun), g);
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
  return { lit: face([side, 0, 0]), shaded: face([-side, 0, 0]), up: face([0, 1, 0]) };
}

/** The numbers the search moves, as powers of e: the sun's tint, the sky's strength, then the afterglow's share. */
const BOUNDS: readonly (readonly [number, number])[] = [
  [-Math.log(3), Math.log(3)], [-Math.log(3), Math.log(3)], [-Math.log(3), Math.log(3)],
  [-Math.log(3), Math.log(3)],
  [0, 1],
];

function gradeOf(base: Grade, raw: number[], glow: boolean): Grade {
  const x = raw.map((v, i) => Math.max(BOUNDS[i]![0], Math.min(BOUNDS[i]![1], v)));
  return { ...base, sun: [Math.exp(x[0]!), Math.exp(x[1]!), Math.exp(x[2]!)], sky: Math.exp(x[3]!), afterglow: glow ? x[4]! : base.afterglow };
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

/**
 * Fits the light of `names` to their keys' cards, from `grades`. A key's sun tint and sky strength are held near 1, so
 * a key that says little about them leaves them as the physical sky has them.
 */
export function fit(names: readonly string[], grades: Grade[] = GRADES.map((g) => ({ ...g }))): Grade[] {
  const cards = keyCards();
  const b = new SkyBuilder(undefined, grades);
  for (const key of basePoints()) {
    if (!names.includes(key.name) || key.name === "noon" || !cards[key.name]) continue;
    const at = grades.findIndex((g) => g.name === key.name);
    const glow = key.name === "sunset" || key.name === "dusk";
    const start = grades[at]!;
    const cost = (x: number[]): number => {
      grades[at] = gradeOf(start, x, glow);
      const m = cardsOf(b, key, grades[at]!);
      let sum = 0;
      for (const p of CARDS) sum += apart(m[p]!, cards[key.name]![p]!) ** 2;
      for (let i = 0; i < 4; i++) sum += 4 * x[i]! * x[i]!;
      return sum;
    };
    const best = simplex(cost, [...start.sun.map(Math.log), Math.log(start.sky), start.afterglow], 0.2, 600);
    cost(best);
  }
  return grades;
}

const r = (v: number): string => String(+v.toFixed(3));

/** Grades as grade.ts writes them. */
export function gradesText(grades: readonly Grade[]): string {
  return grades.map((g) => `  { name: "${g.name}", height: ${g.height}, sun: [${g.sun.map(r).join(", ")}], sky: ${r(g.sky)}, afterglow: ${r(g.afterglow)} },`).join("\n");
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const only = args.indexOf("--only") >= 0 ? args[args.indexOf("--only") + 1]!.split(",") : null;
  const names = basePoints().map((k) => k.name).filter((n) => !only || only.includes(n));
  const grades = fit(names);
  const b = new SkyBuilder(undefined, grades);
  const { table, lights } = b.build();
  const sky: Sky = { table, lights };
  const cards = keyCards();
  for (const key of basePoints()) {
    const g = grades.find((x) => x.name === key.name)!;
    const m = cardsOf(b, key, g);
    const d = domeApart(sky, key);
    const f = (v: number): string => v.toFixed(1);
    console.log(`${key.name.padEnd(9)} dome median ${f(d.median)}, 90% ${f(d.p90)}; toward ${f(d.toward)}, away ${f(d.away)}, overhead ${f(d.overhead)}`);
    for (const p of CARDS) console.log(`    ${p.padEnd(7)} key ${cards[key.name]![p]!.map(Math.round).join(",")}  table ${m[p]!.map(Math.round).join(",")}  ${f(apart(m[p]!, cards[key.name]![p]!))}`);
  }
  console.log(gradesText(grades));
}
