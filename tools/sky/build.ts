// Makes the sky table: for each of the table's slices, a sun height in the morning or the evening, the dome as the
// mood keys paint it (keys.ts), blended between the keys of that half of the day by the sun's height (grade.ts), as
// the game is to show it; and beside it the light, the physical sky's (atmosphere.ts) with the sun and the moon
// opposite it, scaled to the anchors, tinted per key and white-balanced to noon while the sun is high, and the
// exposure that makes a grey card facing up read as low poly's at that hour. Writes client/core/render/skytable.ts,
// which the game reads, and the table as a strip of its slices, assets/source/core/sky/table.png, midnight to noon to
// midnight, the zenith at the top of each.
// Run: bun tools/sky/build.ts

import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { FRAME, FRAME_FLOATS } from "../../client/core/render/packet.ts";
import { CARD, LIGHT_FLOATS, MOON_RADIUS, SKY_SIZE, SKY_SLICES, SUN_TOP, aroundCoord, aroundOf, cardExposure, cardTakes, decodeTexel, discUp, elevationOf, encodeTexel, hourOfSun, luminance, skyFrame, sliceCoord, sliceHeight, slotHeight, sunHeight, texelAt, upCoord } from "../../client/core/render/sky.ts";
import { skyLight, srgbToLinear } from "../../client/core/render/surface.ts";
import { encodePng } from "../snap/png.ts";
import { Atmosphere, EARTH, type Air } from "./atmosphere.ts";
import { EVENING, GRADES, MORNING, bracket, carried, gradeAt, type Grade } from "./grade.ts";
import { fill, keySkies, untone, type KeySky } from "./keys.ts";

/**
 * The air: the paper's, with five times its haze, an optical depth of 0.027 at sea level, which is clean sea air. The
 * paper's 0.005 is a twentieth of clear air's: it leaves a high sun with no glow round it and the noon horizon four to
 * five times as bright as the zenith, where published skies give two to three. Five times gives 2.5.
 */
export const AIR: Air = { ...EARTH, mieScatter: EARTH.mieScatter * 5, mieExtinct: EARTH.mieExtinct * 5 };
/** The full moon's light against the sun's. */
export const MOON = 2.5e-6;
/** The share of the light on it the ground sends back, and what stands on it: grass, sand and pale stone. */
export const GROUND = 0.3;
/**
 * The share of what a face on land sees above the horizon that is open sky. The rest is the land about it and what
 * stands on it, hills, trees, rocks and walls, which send back the ground's light.
 */
export const OPEN = 0.6;
/** What a grey 128 card standing in the shade at noon shows, as light: 70 of 255 (D155). Sunlit and head on, it shows 128. */
export const SHADED = srgbToLinear(70 / 255);
/** Degrees under the horizon at which the afterglow is at its full share, and by which it is gone. */
const GLOW_FULL = 6;
const GLOW_GONE = 12;
/** Degrees up from which the white balance is whole. */
const BALANCE_FULL = 15;
/** Rings and steps round of the half sky the sky's light is summed over. */
const RINGS = 32;
const ROUND = 32;
const TEXELS = SKY_SIZE * SKY_SIZE;
const DEG = Math.PI / 180;
const NOON = SUN_TOP;

type Rgb = [number, number, number];

function smooth(t: number): number {
  const x = Math.max(0, Math.min(1, t));
  return x * x * (3 - 2 * x);
}

/** A key's sky read between texels, at `elevation` and `around` degrees, into out[0..2]. */
function lookup(field: Float64Array, elevation: number, around: number, out: number[]): void {
  const n = SKY_SIZE - 1;
  const x = aroundCoord(around) * n, y = upCoord(elevation) * n;
  const i = Math.min(n - 1, Math.floor(x)), j = Math.min(n - 1, Math.floor(y));
  const u = x - i, v = y - j;
  for (let k = 0; k < 3; k++) {
    const at = (j * SKY_SIZE + i) * 3 + k;
    out[k] = (1 - v) * ((1 - u) * field[at]! + u * field[at + 3]!) + v * ((1 - u) * field[at + SKY_SIZE * 3]! + u * field[at + SKY_SIZE * 3 + 3]!);
  }
}

/** The light of one sun height, as the frame block's lanes take it (surface.ts `skyLight`). */
export interface Light {
  sun: Rgb;
  moon: Rgb;
  /** The sky's on a face up and on one facing down, the ground's, and the frame block's fSkySide, fSkySun and fSkyAlong. */
  above: Rgb;
  below: Rgb;
  side: Rgb;
  sunward: Rgb;
  along: Rgb;
}

export interface Slice {
  /** SKY_SIZE squared texels, RGBA, laid out as one z of `texelAt`. */
  bytes: Uint8Array;
  /** LIGHT_FLOATS: the sun's, the moon's and the sky's (`Light`) in the table's units, then the light a unit stands for. */
  lights: number[];
  exposure: number;
}

/** The physical sky summed over the half sky above for a face up and for upright faces round from the sun. */
interface SkySums {
  up: Rgb;
  ring: Rgb[];
}

/** Degrees round from the sun of the upright faces the light on a face turned sideways is fitted to; the other half mirrors them. */
const RING = [0, 45, 90, 135, 180];

/** A frame block holding `l`, the sun due +X, for evaluating surface.ts `skyLight` as the lit programs do. */
export function lightFrame(l: Light): Float32Array {
  const f = new Float32Array(FRAME_FLOATS);
  f[FRAME.moon] = -1;
  f.set(l.above, FRAME.skyAbove);
  f.set(l.below, FRAME.skyBelow);
  f.set(l.side, FRAME.skySide);
  f.set(l.sunward, FRAME.skySun);
  f.set(l.along, FRAME.skyAlong);
  return f;
}

/** A direction at `elevation` degrees, `around` degrees round from +X toward +Z. */
function toward(elevation: number, around: number): number[] {
  const e = elevation * DEG, a = around * DEG;
  return [Math.cos(e) * Math.cos(a), Math.sin(e), Math.cos(e) * Math.sin(a)];
}

export class SkyBuilder {
  readonly atm: Atmosphere;
  readonly grades: readonly Grade[];
  /** The white balance, and the scales of the sun's light and of the sky's against the physical sky's. */
  readonly balance: Rgb = [1, 1, 1];
  sun = 1;
  sky = 1;
  /** What the card's exposure is at noon, which every exposure is divided by. */
  private noon = 1;
  private readonly skies = new Map<number, Float64Array>();
  private readonly sums = new Map<number, SkySums>();
  /** Each key by name, and its clear sky as the game is to show it, light before the tone curve: per texel of its slice, three powers of e. */
  private readonly keys = new Map<string, KeySky>();
  private readonly painted = new Map<string, Float64Array>();
  /** Per slice either side of a key's hour, what is added to its texels, as powers of e, so the table read at that hour shows the key. */
  private readonly extra = new Map<number, Float64Array>();
  private readonly c = new Float64Array(3);
  private readonly m = new Float64Array(6);
  private readonly at = [0, 0];
  private readonly v = [0, 0, 0];

  constructor(air: Air = AIR, grades: readonly Grade[] = GRADES, keys: readonly KeySky[] = keySkies()) {
    this.atm = new Atmosphere(air);
    this.grades = grades;
    const t = [0, 0, 0];
    for (const key of keys) {
      const field = new Float64Array(TEXELS * 3);
      const known = Uint8Array.from(key.count, (c) => (c < 1 ? 0 : 1));
      for (let n = 0; n < TEXELS; n++) {
        untone(key.rgb.subarray(n * 3, n * 3 + 3), t);
        for (let k = 0; k < 3; k++) field[n * 3 + k] = Math.log(Math.max(t[k]!, 1e-6));
      }
      fill(field, known);
      this.keys.set(key.name, key);
      this.painted.set(key.name, field);
    }
    this.anchor();
    this.meet();
  }

  /** The grades a half of the sun's path passes through, in order of height. */
  path(evening: boolean): Grade[] {
    const names: readonly string[] = evening ? EVENING : MORNING;
    return this.grades.filter((g) => names.includes(g.name));
  }

  /**
   * The table is read between its slices: at a key's hour, between the slices either side, and the frame there turns a
   * unit of it into what is shown by a factor that is 1 only at a slice. Both slices get the same addition to their
   * texels, found over a few rounds, so that what is shown at the key's hour is the key: at its own hour, and in the
   * other half too where that half passes through it.
   */
  private meet(): void {
    const t = [0, 0, 0], got = [0, 0, 0];
    const lights = new Float32Array(SKY_SLICES * LIGHT_FLOATS);
    for (let z = 0; z < SKY_SLICES; z++) lights.set(this.lightOf(z).lights, z * LIGHT_FLOATS);
    const frame = new Float32Array(FRAME_FLOATS);
    for (const evening of [false, true]) for (const g of this.path(evening)) {
      const key = this.keys.get(g.name);
      if (!key) continue;
      const hour = hourOfSun(key.height, evening);
      skyFrame(hour, { table: new Uint8Array(0), lights }, frame);
      const shown = frame[FRAME.skyScale]! * frame[FRAME.exposure]!;
      const z = sliceCoord(sunHeight(hour), evening) * (SKY_SLICES - 1);
      const a = Math.min(SKY_SLICES - 2, Math.floor(z)), f = Math.round((z - a) * 256) / 256;
      if (f === 0 || f === 1) continue;
      if (this.extra.has(a) || this.extra.has(a + 1)) throw new Error(`the ${key.name} key shares a slice with another`);
      const extra = new Float64Array(TEXELS * 3);
      const known = Uint8Array.from(key.count, (c) => (c < 1 ? 0 : 1));
      for (let round = 0; round < 4; round++) {
        const A = this.slice(a).bytes, B = this.slice(a + 1).bytes;
        for (let n = 0; n < TEXELS; n++) {
          if (!known[n]) continue;
          const o = n * 4;
          decodeTexel(A[o]! * (1 - f) + B[o]! * f, A[o + 1]! * (1 - f) + B[o + 1]! * f, A[o + 2]! * (1 - f) + B[o + 2]! * f, A[o + 3]! * (1 - f) + B[o + 3]! * f, got);
          untone(key.rgb.subarray(n * 3, n * 3 + 3), t);
          for (let k = 0; k < 3; k++) extra[n * 3 + k] = extra[n * 3 + k]! + Math.log(Math.max(t[k]!, 1e-6) / Math.max(got[k]! * shown, 1e-6));
        }
        fill(extra, known);
        this.extra.set(a, extra);
        this.extra.set(a + 1, extra);
      }
    }
  }

  /**
   * The dome as shown at a sun height in the morning or the evening for a view, light before the tone curve: the keys
   * either side on that half's path blended as light by the sun's height, each carried along with the sun.
   */
  shown(height: number, evening: boolean, elevation: number, around: number, out: Float64Array | number[]): void {
    const path = this.path(evening);
    const { a, b, f } = bracket(height, path);
    out.fill(0);
    for (const [i, w] of [[a, 1 - f], [b, f]] as const) {
      const key = this.keys.get(path[i]!.name);
      if (w === 0 || !key) continue;
      carried(height, key.height, elevation, around, this.at);
      lookup(this.painted.get(key.name)!, this.at[0]!, this.at[1]!, this.v);
      for (let k = 0; k < 3; k++) out[k]! += w * Math.exp(this.v[k]!);
    }
  }

  /** The exposure at a sun height in the morning or the evening, as its slice has it. */
  exposureAt(height: number, evening: boolean, g: Grade = gradeAt(height, this.path(evening))): number {
    return this.cardExposure(height, this.light(height, evening, g)) / this.noon;
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

  /** The physical sky for a sun height at every cell of the half sky the light above is summed over, made once. */
  private skyFor(height: number): Float64Array {
    let s = this.skies.get(height);
    if (s) return s;
    s = new Float64Array(RINGS * ROUND * 6);
    for (let r = 0, i = 0; r < RINGS; r++) for (let q = 0; q < ROUND; q++, i += 6) this.physical(height, toward(((r + 0.5) / RINGS) * 90, ((q + 0.5) / ROUND) * 180), s.subarray(i, i + 6));
    this.skies.set(height, s);
    return s;
  }

  /** The dome before exposure at `elevation` and `around` degrees, for tools that look at it between texels. */
  domeAt(height: number, evening: boolean, elevation: number, around: number, out: Float64Array): void {
    this.shown(height, evening, elevation, around, out);
    const e = this.exposureAt(height, evening);
    for (let k = 0; k < 3; k++) out[k]! /= e;
  }

  /**
   * The white balance at a sun height: noon's, which makes noon's light white, while the sun is BALANCE_FULL degrees
   * up or more, fading as it drops and gone with the sun on the horizon, so twilight and moonlight reach the land in
   * the colours the sky shows.
   */
  private balanceAt(height: number): Rgb {
    const s = smooth(height / BALANCE_FULL);
    return this.balance.map((b) => b ** s) as Rgb;
  }

  /** Sunlight at the ground with the sun at `height`, or moonlight, balanced and scaled, its disc partly set near the horizon. */
  private sunlight(height: number, g: Grade, moon: boolean, balance: Rgb): Rgb {
    this.atm.sunAtGround(Math.sin(height * DEG), this.c);
    const k = this.sun * (moon ? MOON * discUp(height, MOON_RADIUS) : discUp(height));
    return [0, 1, 2].map((i) => this.c[i]! * balance[i]! * k * g.sun[i]!) as Rgb;
  }

  /**
   * The afterglow the sun's slot carries through twilight: the dome's colour 3 degrees up toward the sun, as
   * strong as `afterglow` of the sky's light above, coming in as the sun's disc sets and gone by GLOW_GONE below.
   */
  private afterglow(height: number, evening: boolean, g: Grade, above: Rgb, balance: Rgb): Rgb {
    const share = g.afterglow * (1 - discUp(height)) * smooth((height + GLOW_GONE) / (GLOW_GONE - GLOW_FULL));
    if (share <= 0) return [0, 0, 0];
    this.shown(height, evening, 3, 0, this.c);
    const c = [0, 1, 2].map((k) => this.c[k]! * balance[k]!);
    const k = (share * luminance(above)) / Math.max(luminance(c), 1e-30);
    return c.map((v) => v * k) as Rgb;
  }

  /**
   * The physical sky over the upper half summed for a face up and for upright faces RING degrees round from the sun,
   * each direction by its solid angle and how squarely it falls on the face, before any scale. Made once a height.
   */
  private skySums(height: number): SkySums {
    const made = this.sums.get(height);
    if (made) return made;
    const s = this.skyFor(height);
    const up: Rgb = [0, 0, 0];
    const ring: Rgb[] = RING.map(() => [0, 0, 0]);
    const faces = RING.map((a) => [Math.cos(a * DEG), Math.sin(a * DEG)]);
    for (let r = 0, i = 0; r < RINGS; r++) {
      const e = ((r + 0.5) / RINGS) * 90;
      const ce = Math.cos(e * DEG), se = Math.sin(e * DEG);
      // A cell's solid angle: a ring's height by its share of half the circle. The other half mirrors it.
      const cell = ce * (Math.PI / 2 / RINGS) * (Math.PI / ROUND);
      for (let q = 0; q < ROUND; q++, i += 6) {
        const a = ((q + 0.5) / ROUND) * Math.PI;
        const x = ce * Math.cos(a), z = ce * Math.sin(a);
        for (let k = 0; k < 3; k++) up[k] += s[i + k]! * 2 * se * cell;
        faces.forEach(([fx, fz], n) => {
          const w = (Math.max(0, fx! * x + fz! * z) + Math.max(0, fx! * x - fz! * z)) * cell;
          for (let k = 0; k < 3; k++) ring[n]![k]! += s[i + k]! * w;
        });
      }
    }
    const sums = { up, ring };
    this.sums.set(height, sums);
    return sums;
  }

  /**
   * The light of one sun height as a frame block takes it, white-balanced and tinted by the grade. The open sky's on a
   * face up is the physical sky over the upper half, each direction by how squarely it falls on the face. Its colour is
   * the physical sky's and not the dome's, as the keys have it: they paint the dome bluer than the shade it lights,
   * cool grey at noon, and blue on the far side at golden hour under a rose dome there. The ground sends back GROUND
   * of all the light on it, onto a face turned down, and from what stands about a face turned up, which sees OPEN of
   * the open sky. An upright face sees more of the bright low sky, and more on the sun's side than the far one: the
   * sky on upright faces round the sun is fitted with a part even round it, one that goes as the cosine of the way
   * round from the sun and one as the cosine of twice that, which holds a glow low on the sun's side as narrow as the
   * twilight's without darkening the far side.
   */
  light(height: number, evening: boolean, g: Grade = gradeAt(height, this.path(evening))): Light {
    const sums = this.skySums(height);
    const balance = this.balanceAt(height);
    const scale = (c: Rgb): Rgb => c.map((v, k) => v * this.sky * g.sky[k]! * balance[k]!) as Rgb;
    const open = scale(sums.up);
    const ring = sums.ring.map(scale);
    const moon = this.sunlight(-height, g, true, balance);
    const up = Math.max(0, Math.sin(slotHeight(height) * DEG));
    const down = Math.max(0, -Math.sin(height * DEG));
    // The ground is lit by the sky as any face up is, part of it the ground's own light sent back; the afterglow is
    // as strong as a share of that light on a face up without it.
    const ground = (sun: Rgb): { below: Rgb; above: Rgb } => {
      const below = [0, 1, 2].map((k) => (GROUND * (sun[k]! * up + moon[k]! * down + OPEN * open[k]!)) / (1 - GROUND * (1 - OPEN))) as Rgb;
      return { below, above: [0, 1, 2].map((k) => OPEN * open[k]! + (1 - OPEN) * below[k]!) as Rgb };
    };
    const lit = this.sunlight(height, g, false, balance);
    const glow = this.afterglow(height, evening, g, ground(lit).above, balance);
    const sun = lit.map((v, k) => v + glow[k]!) as Rgb;
    const { below, above } = ground(sun);
    // The ring at 0, 45, 90, 135 and 180 degrees, mirrored, as a mean and its first two cosines. Upright, a face turned
    // round from the sun by a gets the mean and the cosines' share; turned up or down, the cosine of twice a, the square
    // of the way round less the square across it, shrinks with the side's share, and so with fSkySide.
    const [h0, h45, h90, h135, h180] = ring as [Rgb, Rgb, Rgb, Rgb, Rgb];
    const mean = [0, 1, 2].map((k) => (h0[k]! + 2 * (h45[k]! + h90[k]! + h135[k]!) + h180[k]!) / 8);
    const twice = [0, 1, 2].map((k) => (h0[k]! - 2 * h90[k]! + h180[k]!) / 4);
    const side = mean.map((v, k) => OPEN * (v - open[k]! / 2 - twice[k]!)) as Rgb;
    const sunward = [0, 1, 2].map((k) => (OPEN * (h0[k]! - h180[k]! + Math.SQRT2 * (h45[k]! - h135[k]!))) / 4) as Rgb;
    const along = twice.map((v) => 2 * OPEN * v) as Rgb;
    return { sun, moon, above, below, side, sunward, along };
  }

  /**
   * The anchors at noon. A grey 128 card lit as surface.ts's `lit` lights it, fully rough, shows 128 sunlit and seen
   * head on, white, and 70 standing in its own shade, seen square on (D155): the sun's light and the sky's are scaled
   * to that. The white balance makes the first white. It applies to the light and not to the dome, which keeps the
   * colours the keys give it, as the haze over the land does.
   */
  anchor(): void {
    const g = gradeAt(NOON, this.path(false));
    this.balance.fill(1);
    const l = [Math.cos(NOON * DEG), Math.sin(NOON * DEG), 0];
    // Head on, and in the shade: the card upright, facing away from the sun.
    const head = { n: l, takes: cardTakes(l, l, l) };
    const shade = { n: [-1, 0, 0], takes: cardTakes([-1, 0, 0], [-1, 0, 0], l) };
    const on = (light: Light, card: typeof head): number[] => {
      const sky = [0, 0, 0];
      skyLight(sky, lightFrame(light), card.n);
      return [0, 1, 2].map((k) => light.sun[k]! * card.takes.light + sky[k]! * card.takes.sky);
    };
    for (let pass = 0; pass < 8; pass++) {
      // The light is the sun's scale times the light of the sun alone and the sky's times the sky's alone: two
      // equations in the two, in the shade lin(70) and head on lin(128).
      [this.sun, this.sky] = [1, 0];
      const bySun = this.light(NOON, false, g);
      [this.sun, this.sky] = [0, 1];
      const bySky = this.light(NOON, false, g);
      const [a1, b1, a2, b2] = [luminance(on(bySky, shade)), luminance(on(bySun, shade)), luminance(on(bySky, head)), luminance(on(bySun, head))];
      this.sun = (CARD - (a2 * SHADED) / a1) / (b2 - (a2 * b1) / a1);
      this.sky = (SHADED - b1 * this.sun) / a1;
      const lit = on(this.light(NOON, false, g), head);
      const y = luminance(lit);
      for (let k = 0; k < 3; k++) this.balance[k]! *= y / lit[k]!;
    }
    this.noon = this.cardExposure(NOON, this.light(NOON, false, g));
  }

  /** Slice `z`'s light, as the table holds it, and its exposure. */
  lightOf(z: number): { lights: number[]; exposure: number } {
    const { height, evening } = sliceHeight(z);
    const l = this.light(height, evening);
    const exposure = this.cardExposure(height, l) / this.noon;
    return { lights: [...l.sun, ...l.moon, ...l.above, ...l.below, ...l.side, ...l.sunward, ...l.along].map((v) => v * exposure).concat(1 / exposure), exposure };
  }

  /** Slice `z` of the table: its texels, its light and its exposure. */
  slice(z: number): Slice {
    const { height, evening } = sliceHeight(z);
    const { lights, exposure } = this.lightOf(z);
    const bytes = new Uint8Array(TEXELS * 4);
    const extra = this.extra.get(z);
    const c = this.c;
    for (let y = 0; y < SKY_SIZE; y++) {
      for (let x = 0; x < SKY_SIZE; x++) {
        const n = y * SKY_SIZE + x;
        this.shown(height, evening, elevationOf(y / (SKY_SIZE - 1)), aroundOf(x / (SKY_SIZE - 1)), c);
        if (extra) for (let k = 0; k < 3; k++) c[k]! *= Math.exp(extra[n * 3 + k]!);
        encodeTexel(c, bytes, texelAt(x, y, 0));
      }
    }
    return { bytes, lights, exposure };
  }

  build(): { table: Uint8Array; lights: Float32Array; exposures: number[] } {
    const table = new Uint8Array(SKY_SIZE * SKY_SIZE * SKY_SLICES * 4);
    const lights = new Float32Array(SKY_SLICES * LIGHT_FLOATS);
    const exposures: number[] = [];
    for (let z = 0; z < SKY_SLICES; z++) {
      const s = this.slice(z);
      table.set(s.bytes, texelAt(0, 0, z));
      lights.set(s.lights, z * LIGHT_FLOATS);
      exposures.push(s.exposure);
    }
    return { table, lights, exposures };
  }
}

/** The table as a strip of its slices side by side, midnight to noon to midnight, the zenith at the top of each. */
export function tableStrip(table: Uint8Array): Uint8Array {
  const n = SKY_SIZE, w = n * SKY_SLICES;
  const out = new Uint8Array(w * n * 4);
  for (let z = 0; z < SKY_SLICES; z++) for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) out.set(table.subarray(texelAt(x, y, z), texelAt(x, y, z) + 4), ((n - 1 - y) * w + z * n + x) * 4);
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
  writeFileSync(resolve(import.meta.dir, "../../assets/source/core/sky/table.png"), encodePng(SKY_SIZE * SKY_SLICES, SKY_SIZE, tableStrip(table)));
  console.log(`anchors: sun ${b.sun.toFixed(4)}, sky ${b.sky.toFixed(4)}, white balance ${b.balance.map((v) => v.toFixed(4)).join(" ")}`);
  console.log(`exposure by slice: ${exposures.map((e) => e.toPrecision(3)).join(" ")}`);
  console.log(`atmosphere and anchors ${(t1 - t0).toFixed(0)} ms, table ${(t2 - t1).toFixed(0)} ms`);
}
