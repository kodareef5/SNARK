// Makes the sky table: the physical sky (atmosphere.ts) for each of the table's sun heights, lit by the sun and by the
// moon opposite it, scaled to the anchors, graded (grade.ts), and over the exposure that makes a grey card facing up
// read as low poly's at that hour; and the light beside it, white-balanced to noon. Writes
// client/core/render/skytable.ts, which the game reads, and the table as a strip of its 32 slices,
// assets/source/core/sky/table.png, the zenith at the top of each.
// Run: bun tools/sky/build.ts

import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { CARD, LIGHT_FLOATS, MOON_RADIUS, SKY_SIZE, aroundOf, cardExposure, cardTakes, discUp, elevationOf, encodeTexel, heightOf, luminance, slotHeight, texelAt } from "../../client/core/render/sky.ts";
import { srgbToLinear } from "../../client/core/render/surface.ts";
import { encodePng } from "../snap/png.ts";
import { Atmosphere, EARTH, type Air } from "./atmosphere.ts";
import { GRADES, gradeAt, gradeDome, type Grade } from "./grade.ts";

/**
 * The air: the paper's, with five times its haze, an optical depth of 0.027 at sea level, which is clean sea air. The
 * paper's 0.005 is a twentieth of clear air's: it leaves a high sun with no glow round it and the noon horizon four to
 * five times as bright as the zenith, where published skies give two to three. Five times gives 2.5.
 */
export const AIR: Air = { ...EARTH, mieScatter: EARTH.mieScatter * 5, mieExtinct: EARTH.mieExtinct * 5 };
/** The full moon's light against the sun's. */
export const MOON = 2.5e-6;
/** The share of light the ground sends back up, onto surfaces facing down. */
export const GROUND = 0.2;
/** Today's sky colour, (150, 190, 230), as luminance: the noon sky 3 degrees up away from the sun shows it. */
export const HORIZON_ANCHOR = luminance([150, 190, 230].map((v) => srgbToLinear(v / 255)));
/** What a grey 128 card standing in the shade at noon shows, as light: 70 of 255 (D155). Sunlit and head on, it shows 128. */
export const SHADED = srgbToLinear(70 / 255);
/** Degrees under the horizon at which the afterglow is at its full share, and by which it is gone. */
const GLOW_FULL = 6;
const GLOW_GONE = 12;
/** Rings and steps round of the half sky the light of the sky above is summed over. */
const RINGS = 32;
const ROUND = 32;
const DEG = Math.PI / 180;
const NOON = heightOf(1);

type Rgb = [number, number, number];

function smooth(t: number): number {
  const x = Math.max(0, Math.min(1, t));
  return x * x * (3 - 2 * x);
}

export interface Light {
  sun: Rgb;
  moon: Rgb;
  above: Rgb;
  below: Rgb;
}

export interface Slice {
  /** SKY_SIZE squared texels, RGBA, laid out as one z of `texelAt`. */
  bytes: Uint8Array;
  /** LIGHT_FLOATS: the sun's, the moon's, the sky's above and below in the table's units, then the light a unit stands for. */
  lights: number[];
  exposure: number;
}

/** A direction at `elevation` degrees, `around` degrees round from +X toward +Z. */
function toward(elevation: number, around: number): number[] {
  const e = elevation * DEG, a = around * DEG;
  return [Math.cos(e) * Math.cos(a), Math.sin(e), Math.cos(e) * Math.sin(a)];
}

export class SkyBuilder {
  readonly atm: Atmosphere;
  readonly grades: readonly Grade[];
  /** The white balance, and the scales of the dome, the sun and the sky's light against the dome's. */
  readonly balance: Rgb = [1, 1, 1];
  dome = 1;
  sun = 1;
  sky = 1;
  /** What the card's exposure is at noon, which every exposure is divided by. */
  private noon = 1;
  private readonly horizon: number | undefined;
  private readonly skies = new Map<number, Float64Array>();
  private readonly c = new Float64Array(3);
  private readonly p = new Float64Array(6);
  private readonly m = new Float64Array(6);

  constructor(air: Air = AIR, grades: readonly Grade[] = GRADES, horizon: number | undefined = HORIZON_ANCHOR) {
    this.atm = new Atmosphere(air);
    this.grades = grades;
    this.horizon = horizon;
    this.anchor();
  }

  /** The exposure at a sun height, as its slice has it. */
  exposureAt(height: number, g: Grade = gradeAt(height, this.grades)): number {
    return this.cardExposure(height, this.light(height, g)) / this.noon;
  }

  private cardExposure(height: number, l: Light): number {
    return cardExposure(height, luminance(l.sun), luminance(l.moon), luminance(l.above));
  }

  /**
   * The physical sky with the sun at `height` degrees due +X, the sun's and the moon's added, before any scale: six
   * numbers, the whole and the part the haze sends on from the sun or the moon straight, its glow round them.
   */
  physical(height: number, view: readonly number[], out: Float64Array): void {
    const s = [Math.cos(height * DEG), Math.sin(height * DEG), 0];
    this.atm.sky(view, s, out);
    this.atm.sky(view, [-s[0]!, -s[1]!, 0], this.m);
    for (let k = 0; k < 6; k++) out[k] = out[k]! + MOON * this.m[k]!;
  }

  /**
   * The physical sky for a sun height at every texel of a slice and every cell of the half sky the light above is
   * summed over, made once.
   */
  private skyFor(height: number): Float64Array {
    let s = this.skies.get(height);
    if (s) return s;
    s = new Float64Array((SKY_SIZE * SKY_SIZE + RINGS * ROUND) * 6);
    let i = 0;
    for (let y = 0; y < SKY_SIZE; y++) for (let x = 0; x < SKY_SIZE; x++, i += 6) this.physical(height, toward(elevationOf(y / (SKY_SIZE - 1)), aroundOf(x / (SKY_SIZE - 1))), s.subarray(i, i + 6));
    for (let r = 0; r < RINGS; r++) for (let q = 0; q < ROUND; q++, i += 6) this.physical(height, toward(((r + 0.5) / RINGS) * 90, ((q + 0.5) / ROUND) * 180), s.subarray(i, i + 6));
    this.skies.set(height, s);
    return s;
  }

  /** Physical light `p` (six numbers at `at`) as the dome shows it before exposure: its haze glow graded, scaled, graded. */
  private graded(p: Float64Array, at: number, height: number, g: Grade, elevation: number, around: number, out: Float64Array): void {
    for (let k = 0; k < 3; k++) out[k] = (p[at + k]! + (g.haze - 1) * p[at + 3 + k]!) * this.dome;
    const v = toward(elevation, around);
    const cos = v[0]! * Math.cos(height * DEG) + v[1]! * Math.sin(height * DEG);
    gradeDome(out, g, elevation, Math.acos(Math.max(-1, Math.min(1, cos))) / DEG);
  }

  /** The dome before exposure at `elevation` and `around` degrees, for tools that look at it between texels. */
  domeAt(height: number, elevation: number, around: number, out: Float64Array): void {
    this.physical(height, toward(elevation, around), this.p);
    this.graded(this.p, 0, height, gradeAt(height, this.grades), elevation, around, out);
  }

  /** Sunlight at the ground with the sun at `height`, or moonlight, balanced and scaled, its disc partly set near the horizon. */
  private sunlight(height: number, g: Grade, moon: boolean): Rgb {
    this.atm.sunAtGround(Math.sin(height * DEG), this.c);
    const k = this.sun * (moon ? MOON * discUp(height, MOON_RADIUS) : discUp(height));
    return [0, 1, 2].map((i) => this.c[i]! * this.balance[i]! * k * g.sun[i]!) as Rgb;
  }

  /**
   * The afterglow the sun's slot carries through twilight: the graded dome's colour 3 degrees up toward the sun, as
   * strong as `afterglow` of the sky's light above, coming in as the sun's disc sets and gone by GLOW_GONE below.
   */
  private afterglow(height: number, g: Grade, above: Rgb): Rgb {
    const share = g.afterglow * (1 - discUp(height)) * smooth((height + GLOW_GONE) / (GLOW_GONE - GLOW_FULL));
    if (share <= 0) return [0, 0, 0];
    this.physical(height, toward(3, 0), this.p);
    this.graded(this.p, 0, height, g, 3, 0, this.c);
    const c = [0, 1, 2].map((k) => this.c[k]! * this.balance[k]!);
    const k = (share * luminance(above)) / Math.max(luminance(c), 1e-30);
    return c.map((v) => v * k) as Rgb;
  }

  /**
   * The light of one sun height as a frame block takes it, white-balanced. The sky's above is the dome over the upper
   * half, each direction by how squarely it falls on a surface facing up: its colour the graded dome's, its strength
   * the physical dome's, so a grade that brightens the dome brightens it against the land. A surface facing down sees
   * the ground, which sends back GROUND of all the light falling on it.
   */
  light(height: number, g: Grade = gradeAt(height, this.grades)): Light {
    const s = this.skyFor(height);
    const above: Rgb = [0, 0, 0];
    let plain = 0;
    let i = SKY_SIZE * SKY_SIZE * 6;
    for (let r = 0; r < RINGS; r++) {
      const e = ((r + 0.5) / RINGS) * 90;
      // A cell is a ring's height by its share of half the circle, and the other half mirrors it.
      const w = 2 * Math.sin(e * DEG) * Math.cos(e * DEG) * (Math.PI / 2 / RINGS) * (Math.PI / ROUND);
      for (let q = 0; q < ROUND; q++, i += 6) {
        plain += luminance(s.subarray(i, i + 3)) * this.dome * w;
        this.graded(s, i, height, g, e, ((q + 0.5) / ROUND) * 180, this.c);
        for (let k = 0; k < 3; k++) above[k] += this.c[k]! * w;
      }
    }
    const strength = (plain / Math.max(luminance(above), 1e-30)) * this.sky * g.sky;
    for (let k = 0; k < 3; k++) above[k] *= strength * this.balance[k]!;
    const glow = this.afterglow(height, g, above);
    const sun = this.sunlight(height, g, false).map((v, k) => v + glow[k]!) as Rgb;
    const moon = this.sunlight(-height, g, true);
    const up = Math.max(0, Math.sin(slotHeight(height) * DEG));
    const down = Math.max(0, -Math.sin(height * DEG));
    const below = [0, 1, 2].map((k) => GROUND * (sun[k]! * up + moon[k]! * down + above[k]!)) as Rgb;
    return { sun, moon, above, below };
  }

  /**
   * The anchors at noon. The physical dome 3 degrees up away from the sun has `horizon`'s luminance, before any grade,
   * which may then make it brighter or darker. Then, after the noon grade, a grey 128 card lit as surface.ts's `lit`
   * lights it, fully rough, shows 128 sunlit and seen head on, white, and 70 standing in its own shade, seen square on
   * (D155): the sun's light and the sky's are scaled to that. Without `horizon`, the sky's light on a surface is the
   * dome's own, summed, with no scale of its own, and the shade sets how bright the dome is. The white balance makes
   * the first white. It applies to the light and not to the dome, which keeps the colours the air gives it, as the
   * haze over the land does.
   */
  anchor(): void {
    const horizon = this.horizon;
    const g = gradeAt(NOON, this.grades);
    this.balance.fill(1);
    const s = Math.sin(NOON * DEG);
    const l = [Math.cos(NOON * DEG), s, 0];
    // Head on, and in the shade: the card upright, facing away from the sun.
    const head = cardTakes(l, l, l);
    const shade = cardTakes([-1, 0, 0], [-1, 0, 0], l);
    const facing = 0.5 + 0.5 * s;
    const k1 = (1 - facing) * GROUND;
    const point = new Float64Array(6);
    this.physical(NOON, toward(3, 180), point);
    for (let pass = 0; pass < 8; pass++) {
      this.dome = horizon === undefined ? 1 : horizon / luminance(point);
      const dome = this.dome;
      this.sun = 1;
      this.sky = 1;
      const one = this.light(NOON, g);
      const A = luminance(one.above);
      const S = luminance(one.sun);
      // The sky on a surface is above and below mixed by its normal's height, below being GROUND (sun s + above).
      // In the shade: shade.sky (above + below) / 2 = lin(70). Head on: head.light sun + head.sky (facing above +
      // (1 - facing) below) = lin(128). Two equations in the scales of the sun and of the sky's light.
      const a1 = (shade.sky * A * (1 + GROUND)) / 2, b1 = (shade.sky * GROUND * S * s) / 2;
      const a2 = head.sky * A * (facing + k1), b2 = S * (head.light + head.sky * k1 * s);
      this.sun = (CARD - (a2 * SHADED) / a1) / (b2 - (a2 * b1) / a1);
      const sky = (SHADED - b1 * this.sun) / a1;
      if (horizon === undefined) this.dome = dome * sky;
      else this.sky = sky;
      const lit = this.light(NOON, g);
      const on = [0, 1, 2].map((k) => lit.sun[k]! * head.light + (facing * lit.above[k]! + (1 - facing) * lit.below[k]!) * head.sky);
      const y = luminance(on);
      for (let k = 0; k < 3; k++) this.balance[k]! *= y / on[k]!;
    }
    this.noon = this.cardExposure(NOON, this.light(NOON, g));
  }

  /** Slice `z` of the table: its texels, its light and its exposure. */
  slice(z: number): Slice {
    const height = heightOf(z / (SKY_SIZE - 1));
    const g = gradeAt(height, this.grades);
    const l = this.light(height, g);
    const exposure = this.cardExposure(height, l) / this.noon;
    const bytes = new Uint8Array(SKY_SIZE * SKY_SIZE * 4);
    const s = this.skyFor(height);
    const c = this.c;
    for (let y = 0; y < SKY_SIZE; y++) {
      for (let x = 0; x < SKY_SIZE; x++) {
        this.graded(s, (y * SKY_SIZE + x) * 6, height, g, elevationOf(y / (SKY_SIZE - 1)), aroundOf(x / (SKY_SIZE - 1)), c);
        const o = texelAt(x, y, 0);
        encodeTexel([c[0]! * exposure, c[1]! * exposure, c[2]! * exposure], bytes, o);
      }
    }
    return { bytes, lights: [...l.sun, ...l.moon, ...l.above, ...l.below].map((v) => v * exposure).concat(1 / exposure), exposure };
  }

  build(): { table: Uint8Array; lights: Float32Array; exposures: number[] } {
    const table = new Uint8Array(SKY_SIZE ** 3 * 4);
    const lights = new Float32Array(SKY_SIZE * LIGHT_FLOATS);
    const exposures: number[] = [];
    for (let z = 0; z < SKY_SIZE; z++) {
      const s = this.slice(z);
      table.set(s.bytes, texelAt(0, 0, z));
      lights.set(s.lights, z * LIGHT_FLOATS);
      exposures.push(s.exposure);
    }
    return { table, lights, exposures };
  }
}

/** The table as a strip of its slices side by side, lowest sun first, the zenith at the top of each. */
export function tableStrip(table: Uint8Array): Uint8Array {
  const n = SKY_SIZE;
  const out = new Uint8Array(n * n * n * 4);
  for (let z = 0; z < n; z++) for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) out.set(table.subarray(texelAt(x, y, z), texelAt(x, y, z) + 4), ((n - 1 - y) * n * n + z * n + x) * 4);
  return out;
}

/** The text of client/core/render/skytable.ts for a table and its light. */
export function tableModule(table: Uint8Array, lights: Float32Array): string {
  const numbers = Array.from(lights, (v) => (v === 0 ? "0" : v.toPrecision(6))).join(", ");
  return `// Made by tools/sky/build.ts from the physical sky and the grade in tools/sky/grade.ts; run it again to change them.
// The table's bytes, texel by texel as sky.ts's texelAt orders them, and per slice the light of the sun, the moon, and
// the sky above and below in the table's units, and the light a unit stands for.

export const SKY_TABLE =
  "${Buffer.from(table).toString("base64")}";

export const SKY_LIGHTS: readonly number[] = [${numbers}];
`;
}

if (import.meta.main) {
  const t0 = performance.now();
  const b = new SkyBuilder();
  const t1 = performance.now();
  const { table, lights, exposures } = b.build();
  const t2 = performance.now();
  writeFileSync(resolve(import.meta.dir, "../../client/core/render/skytable.ts"), tableModule(table, lights));
  writeFileSync(resolve(import.meta.dir, "../../assets/source/core/sky/table.png"), encodePng(SKY_SIZE * SKY_SIZE, SKY_SIZE, tableStrip(table)));
  console.log(`anchors: dome ${b.dome.toFixed(3)}, sun ${b.sun.toFixed(4)}, sky ${b.sky.toFixed(4)}, white balance ${b.balance.map((v) => v.toFixed(4)).join(" ")}`);
  console.log(`exposure by slice: ${exposures.map((e) => e.toPrecision(3)).join(" ")}`);
  console.log(`atmosphere and anchors ${(t1 - t0).toFixed(0)} ms, table ${(t2 - t1).toFixed(0)} ms`);
}
