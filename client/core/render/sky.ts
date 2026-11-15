// The sky on lit tiers. The sun keeps one path through the day: it rises in the east (-X), passes north of overhead (+Z)
// as high as low poly's sun at noon, and sets in the west (+X). The moon stands opposite it.
//
// The dome's colour, the haze's and the light on every surface come from one table made at build time (tools/sky):
// the sky by the sun's height, the view's elevation and how far round the view is from the sun, in an RGBA8 3D texture
// sampled with linear filtering, SKY_SIZE by SKY_SIZE by SKY_SLICES. The sun's axis holds the morning, from midnight to
// noon, then the evening, from noon to midnight, told apart by whether the sun is east or west. Beside it, per slice,
// the light of the sun, the moon and the sky above and below. Low poly keeps its own light, `flatLight`, and its own
// sky colour.

import { FRAME, FRAME_FLOATS } from "./packet.ts";
import { AMBIENT, DIFFUSE, NIGHT_LIGHT } from "./shading.ts";
import { SKY_LIGHTS, SKY_TABLE } from "./skytable.ts";
import { linearToSrgb, lit, srgbToLinear, tone } from "./surface.ts";

/** How far the sun's path leans toward +Z: its noon height is atan(1 / 0.43), low poly's, 66.7 degrees. */
const TILT = Math.atan(0.43);
/** Degrees of the sun's travel the light's direction moves by at a time, so shadows step rarely and evenly. */
export const SUN_STEP = 0.05;
/** The highest the sun climbs, in degrees: the table's slices run from this far below the horizon to this far above. */
export const SUN_TOP = (Math.asin(Math.cos(TILT)) * 180) / Math.PI;
/** Texels along the table's two sides across the sky: round from the sun, and up from the horizon. */
export const SKY_SIZE = 32;
/** Slices along the sun's axis: SKY_SIZE for the morning, from midnight to noon, then as many for the evening. */
export const SKY_SLICES = 2 * SKY_SIZE;
/**
 * Numbers per slice beside the table: the light of the sun, of the moon, of the sky above and below, three each,
 * in the table's units, so that between heights land and dome blend alike; then the light one unit stands for.
 */
export const LIGHT_FLOATS = 13;
/** The grey card the exposure is set by: 128 of 255, as light. */
export const CARD = srgbToLinear(128 / 255);
/** Half the sun's disc and half the moon's, degrees: each one's light fades over this either side of the horizon as it sets. */
export const SUN_RADIUS = 1;
export const MOON_RADIUS = 2;
/**
 * Degrees up the sun's slot of the frame block is held while the sun is lower: through twilight it carries the
 * afterglow, from low over the horizon toward the sunken sun, so a roof is not left black beside a lit wall.
 */
export const GLOW_HOLD = 2;

const DEG = Math.PI / 180;

/** Degrees the sun has travelled since it rose, at an hour of 0 to 24, in whole steps: 0 at six, 180 at eighteen. */
export function sunTravel(hour: number): number {
  const deg = ((((hour - 6) * 15) % 360) + 360) % 360;
  return (Math.round(deg / SUN_STEP) * SUN_STEP) % 360;
}

/** A unit vector toward the sun at an hour. */
export function sunDirection(hour: number, out: Float32Array | Float64Array | number[]): void {
  const t = sunTravel(hour) * DEG;
  out[0] = -Math.cos(t);
  out[1] = Math.sin(t) * Math.cos(TILT);
  out[2] = Math.sin(t) * Math.sin(TILT);
}

/** The sun's height above the horizon in degrees at an hour. */
export function sunHeight(hour: number): number {
  return Math.asin(Math.sin(sunTravel(hour) * DEG) * Math.cos(TILT)) / DEG;
}

/** The hour at which the sun stands `height` degrees up, before noon or after it, on the nearest step. */
export function hourOfSun(height: number, evening: boolean): number {
  const t = Math.asin(Math.max(-1, Math.min(1, Math.sin(height * DEG) / Math.cos(TILT)))) / DEG;
  const travel = Math.round((evening ? 180 - t : t) / SUN_STEP) * SUN_STEP;
  return (6 + ((travel + 360) % 360) / 15) % 24;
}

/**
 * Low poly's light at an hour: a unit vector toward its sun into `sun`, and the day's light, which it returns. Its sun
 * stands as high as it always has, and lies round the sky where the lit tiers' sun does (`sunDirection`): in the east
 * in the morning, the north at noon and the west in the evening. At night it is lit by a fixed moon, dimmer.
 */
export function flatLight(hour: number, sun: Float32Array): number {
  const up = Math.sin(((hour - 6) / 12) * Math.PI);
  const around = Math.cos(((hour - 6) / 12) * Math.PI);
  const dusk = Math.max(0, Math.min(1, (up + 0.1) / 0.4));
  if (up > 0.15) {
    const y = up / Math.hypot(around * 0.6, up, 0.43);
    sunDirection(hour, flatAim);
    const across = Math.sqrt(1 - y * y) / Math.hypot(flatAim[0]!, flatAim[2]!);
    sun[0] = flatAim[0]! * across;
    sun[1] = y;
    sun[2] = flatAim[2]! * across;
  } else {
    const l = Math.hypot(0.3, 0.8, 0.43);
    sun[0] = 0.3 / l;
    sun[1] = 0.8 / l;
    sun[2] = 0.43 / l;
  }
  return NIGHT_LIGHT + (1 - NIGHT_LIGHT) * dusk * dusk * (3 - 2 * dusk);
}

const flatAim = new Float64Array(3);
const flatSun = new Float32Array(3);

/** What low poly shows of a grey 128 card facing up in the open at an hour, 0 to 255. */
export function flatCard(hour: number): number {
  const light = flatLight(hour, flatSun);
  return 128 * (AMBIENT + DIFFUSE * Math.max(0, flatSun[1]!)) * light;
}

/** How far either side of where low poly's light leaps from its moon to its sun the card the lit tiers follow blends the two, in the sine `flatLight` calls up. */
const LEAP = 0.017;

/**
 * The card lit tiers are exposed to show at a sun height: low poly's, but where its light leaps from its fixed moon to
 * its sun (the sun 7.9 degrees up) blended over about a degree of the sun's height either side, so they do not leap too.
 */
export function cardTarget(height: number): number {
  const a = ((hourOfSun(height, false) - 6) / 12) * Math.PI;
  const up = Math.sin(a);
  const dusk = Math.max(0, Math.min(1, (up + 0.1) / 0.4));
  const light = NIGHT_LIGHT + (1 - NIGHT_LIGHT) * dusk * dusk * (3 - 2 * dusk);
  const moon = 0.8 / Math.hypot(0.3, 0.8, 0.43);
  const sun = up / Math.hypot(Math.cos(a) * 0.6, up, 0.43);
  const t = Math.max(0, Math.min(1, (up - 0.15 + LEAP) / (2 * LEAP)));
  return 128 * (AMBIENT + DIFFUSE * Math.max(0, moon + (sun - moon) * t * t * (3 - 2 * t))) * light;
}

// The table's three axes, each 0 to 1 across its texel centres: how far round from the sun's azimuth (x), the view's
// elevation (y), the sun's height in the morning and then in the evening (z). Each is sampled more finely where the
// sky changes fastest: near the sun's azimuth, near the horizon, and with the sun near the horizon; and the sun's
// height also where low poly's light leaps (`cardTarget`), so that between slices the exposure carries the dome as
// it is at the slices and does not brighten it with the land.

export function aroundCoord(degrees: number): number {
  return Math.sqrt(Math.max(0, Math.min(1, degrees / 180)));
}

export function aroundOf(t: number): number {
  return t * t * 180;
}

export function upCoord(elevation: number): number {
  return Math.sqrt(Math.max(0, Math.min(1, elevation / 90)));
}

export function elevationOf(t: number): number {
  return t * t * 90;
}

/** The sun's heights, degrees, over which slices gather, and the share of a half's slices added there. */
export const GATHER = [5, 8.5] as const;
export const GATHERED = 0.24;

/** Where a sun height lies along one half of the sun's axis, 0 at midnight to 1 at noon. */
export function sunCoord(height: number): number {
  const s = Math.max(-1, Math.min(1, height / SUN_TOP));
  const gathered = Math.max(0, Math.min(1, (height - GATHER[0]) / (GATHER[1] - GATHER[0])));
  return (0.5 + 0.5 * Math.sign(s) * Math.sqrt(Math.abs(s)) + GATHERED * gathered) / (1 + GATHERED);
}

export function heightOf(t: number): number {
  let lo = -SUN_TOP, hi = SUN_TOP;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (sunCoord(mid) < t) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** The sun's axis, 0 to 1 across all SKY_SLICES' centres, at a sun height in the morning or the evening. */
export function sliceCoord(height: number, evening: boolean): number {
  const z = sunCoord(height) * (SKY_SIZE - 1);
  return (evening ? SKY_SLICES - 1 - z : z) / (SKY_SLICES - 1);
}

/** Slice `z`'s sun height and half. */
export function sliceHeight(z: number): { height: number; evening: boolean } {
  const evening = z >= SKY_SIZE;
  return { height: heightOf((evening ? SKY_SLICES - 1 - z : z) / (SKY_SIZE - 1)), evening };
}

/** Whether a sun direction is the evening's: in the west, +X. */
export function isEvening(sun: ArrayLike<number>): boolean {
  return sun[0]! > 0;
}

/**
 * A slice holds the sky over the light a unit stands for at that sun height, about what exposure makes of it. A
 * texel's colour bytes hold it on the sRGB curve from 0 to SKY_LOW, as fine as the screen. A brighter one, round the
 * sun, keeps its hue there and holds in alpha how many times brighter it is, in even steps of up to SKY_STOPS doublings.
 */
export const SKY_LOW = 0.8;
export const SKY_STOPS = 7;

/** Writes a texel's four bytes at `at`. */
export function encodeTexel(c: Vec, out: Uint8Array, at: number): void {
  const peak = Math.max(c[0]!, c[1]!, c[2]!);
  const a = peak > SKY_LOW ? Math.min(255, Math.ceil((Math.log2(peak / SKY_LOW) / SKY_STOPS) * 255)) : 0;
  const scale = SKY_LOW * 2 ** ((a / 255) * SKY_STOPS);
  for (let k = 0; k < 3; k++) out[at + k] = Math.round(255 * linearToSrgb(Math.max(0, Math.min(1, c[k]! / scale))));
  out[at + 3] = a;
}

/** A texel, or a blend of texels, as numbers of 0 to 255, back to the sky. */
export function decodeTexel(r: number, g: number, b: number, a: number, out: Float32Array | Float64Array | number[]): void {
  const scale = SKY_LOW * 2 ** ((a / 255) * SKY_STOPS);
  out[0] = srgbToLinear(r / 255) * scale;
  out[1] = srgbToLinear(g / 255) * scale;
  out[2] = srgbToLinear(b / 255) * scale;
}

/** The byte of a texel's channel in a table laid out x fastest, then y, then z, four bytes a texel. */
export function texelAt(x: number, y: number, z: number): number {
  return ((z * SKY_SIZE + y) * SKY_SIZE + x) * 4;
}

const corner = new Float64Array(3);
const mixed = new Float64Array(4);

/**
 * Samples the table at (x, y, z), each 0 to 1 across texel centres, as a graphics card samples an RGBA8 3D texture with
 * linear filtering and edges clamped: the bytes are blended by weights held to 1/256, and the blend decoded after.
 */
export function sampleSky(table: Uint8Array, x: number, y: number, z: number, out: Float32Array | Float64Array | number[]): void {
  const ends = [SKY_SIZE - 1, SKY_SIZE - 1, SKY_SLICES - 1];
  const at = [x * ends[0]!, y * ends[1]!, z * ends[2]!];
  let i0 = 0, j0 = 0, k0 = 0;
  for (let a = 0; a < 3; a++) {
    const n = ends[a]!;
    const v = Math.max(0, Math.min(n, at[a]!));
    const base = Math.min(n - 1, Math.floor(v));
    corner[a] = Math.round((v - base) * 256) / 256;
    if (a === 0) i0 = base;
    else if (a === 1) j0 = base;
    else k0 = base;
  }
  const fx = corner[0]!, fy = corner[1]!, fz = corner[2]!;
  for (let c = 0; c < 4; c++) {
    let sum = 0;
    for (let dz = 0; dz < 2; dz++) {
      for (let dy = 0; dy < 2; dy++) {
        const w = (dz ? fz : 1 - fz) * (dy ? fy : 1 - fy);
        sum += w * ((1 - fx) * table[texelAt(i0, j0 + dy, k0 + dz) + c]! + fx * table[texelAt(i0 + 1, j0 + dy, k0 + dz) + c]!);
      }
    }
    mixed[c] = sum;
  }
  decodeTexel(mixed[0]!, mixed[1]!, mixed[2]!, mixed[3]!, out);
}

type Vec = ArrayLike<number>;

/** The table's coordinates for a view direction under a sun direction, both of length 1, into out[0..2]. */
export function skyCoords(sun: Vec, view: Vec, out: Float64Array | number[]): void {
  const lx = Math.hypot(view[0]!, view[2]!) * Math.hypot(sun[0]!, sun[2]!);
  const cos = lx > 1e-9 ? (view[0]! * sun[0]! + view[2]! * sun[2]!) / lx : 1;
  out[0] = aroundCoord(Math.acos(Math.max(-1, Math.min(1, cos))) / DEG);
  out[1] = upCoord(Math.asin(Math.max(-1, Math.min(1, view[1]!))) / DEG);
  out[2] = sliceCoord(Math.asin(Math.max(-1, Math.min(1, sun[1]!))) / DEG, isEvening(sun));
}

const coords = [0, 0, 0];

/**
 * The dome in a direction, in the table's units: times the frame's `skyScale` it is light, and times the exposure as
 * well, what the dome shows before the tone curve. Under the horizon it is the horizon's.
 */
export function domeLight(table: Uint8Array, sun: Vec, view: Vec, out: Float32Array | Float64Array | number[]): void {
  skyCoords(sun, view, coords);
  sampleSky(table, coords[0]!, coords[1]!, coords[2]!, out);
}

/** What haze is coloured: the dome 3 degrees up in the ray's direction, as light before exposure. */
export function hazeColor(table: Uint8Array, sun: Vec, ray: Vec, skyScale: number, out: Float32Array | Float64Array | number[]): void {
  const flat = Math.hypot(ray[0]!, ray[2]!) || 1;
  const c = Math.cos(3 * DEG) / flat;
  domeLight(table, sun, [ray[0]! * c, Math.sin(3 * DEG), ray[2]! * c], out);
  for (let k = 0; k < 3; k++) out[k]! *= skyScale;
}

export interface Sky {
  /** The table, SKY_SIZE by SKY_SIZE by SKY_SLICES RGBA8 texels laid out as `texelAt` says. */
  table: Uint8Array;
  /** LIGHT_FLOATS per slice of the table. */
  lights: Float32Array;
}

let made: Sky | null = null;

const BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function fromBase64(text: string): Uint8Array {
  const value = new Uint8Array(128);
  for (let i = 0; i < 64; i++) value[BASE64.charCodeAt(i)] = i;
  const out = new Uint8Array(Math.floor((text.replace(/=+$/, "").length * 3) / 4));
  for (let i = 0, o = 0; i < text.length; i += 4) {
    const n = (value[text.charCodeAt(i)]! << 18) | (value[text.charCodeAt(i + 1)]! << 12) | (value[text.charCodeAt(i + 2)]! << 6) | value[text.charCodeAt(i + 3)]!;
    if (o < out.length) out[o++] = n >> 16;
    if (o < out.length) out[o++] = (n >> 8) & 255;
    if (o < out.length) out[o++] = n & 255;
  }
  return out;
}

/** The table and its light, as tools/sky/build.ts made them. */
export function theSky(): Sky {
  return (made ??= { table: fromBase64(SKY_TABLE), lights: Float32Array.from(SKY_LIGHTS) });
}

/** Light after exposure as the screen shows it, 0 to 255: the tone curve, then sRGB. */
export function shownSky(c: Vec, out: Float32Array | Float64Array | number[]): void {
  tone(out, c);
  for (let k = 0; k < 3; k++) out[k] = 255 * linearToSrgb(Math.max(0, Math.min(1, out[k]!)));
}

/** Luminance of linear light. */
export function luminance(c: Vec): number {
  return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
}

/** How much of a disc of `radius` degrees stands above the horizon at a height, 0 to 1. */
export function discUp(height: number, radius = SUN_RADIUS): number {
  const t = Math.max(0, Math.min(1, (height + radius) / (2 * radius)));
  return t * t * (3 - 2 * t);
}

/** The way the light in the sun's slot comes from with the sun at a height: from the sun, or held GLOW_HOLD degrees up toward it. */
export function slotHeight(height: number): number {
  return Math.max(height, GLOW_HOLD);
}

/**
 * The light at a sun height in the morning or the evening, blended between the slices either side as the table blends
 * them: the light of the sun, the moon, and the sky above and below in the table's units, then the light a unit
 * stands for, by its logarithm.
 */
function lightsAt(lights: Float32Array, height: number, evening: boolean, out: Float64Array): void {
  const v = sliceCoord(height, evening) * (SKY_SLICES - 1);
  const k = Math.min(SKY_SLICES - 2, Math.floor(v));
  const f = v - k;
  const a = k * LIGHT_FLOATS, b = a + LIGHT_FLOATS;
  for (let i = 0; i < LIGHT_FLOATS - 1; i++) out[i] = lights[a + i]! * (1 - f) + lights[b + i]! * f;
  out[LIGHT_FLOATS - 1] = Math.exp(Math.log(lights[a + LIGHT_FLOATS - 1]!) * (1 - f) + Math.log(lights[b + LIGHT_FLOATS - 1]!) * f);
}

const blend = new Float64Array(LIGHT_FLOATS);
const sunAt = new Float64Array(3);
const light = new Float64Array(12);

const UP = [0, 1, 0];
const takes = new Float64Array(3);
const GREY = [CARD, CARD, CARD];
/** A frame block of one light: 1 from the way `cardTakes` is given, or a sky of 1 from every side. */
const unit = new Float32Array(FRAME_FLOATS);

/**
 * What a grey 128 card, fully rough and not metal, sends to the eye as surface.ts's `lit` lights it: per unit of a
 * light's strength from `l`, and per unit of the sky's light on it. `n` is its normal and `v` the way to the eye.
 */
export function cardTakes(n: Vec, v: Vec, l: Vec): { light: number; sky: number } {
  unit.fill(0);
  unit.set([l[0]!, l[1]!, l[2]!], FRAME.sun);
  unit.fill(1, FRAME.sunColor, FRAME.sunColor + 3);
  // A fully rough highlight mirrors nothing, so what the sky shows in the reflected direction does not matter.
  lit(takes, GREY, [0, 1, 0], n, v, unit, UP);
  const light = takes[0]!;
  unit.fill(0, FRAME.sunColor, FRAME.sunColor + 3);
  unit.fill(1, FRAME.skyAbove, FRAME.skyAbove + 3);
  unit.fill(1, FRAME.skyBelow, FRAME.skyBelow + 3);
  lit(takes, GREY, [1, 1, 0], n, v, unit, UP);
  return { light, sky: takes[0]! };
}

/**
 * The exposure that makes a grey 128 card facing up in the open, seen from above, show `cardTarget`, given the
 * luminance of the light of the sun, the moon and the sky above. Under the tone curve's knee, where the card always is,
 * exposure is all that lies between them. Every exposure is this over noon's, so that it is 1 at noon and a card a step
 * or two brighter than low poly's.
 */
export function cardExposure(height: number, sun: number, moon: number, above: number): number {
  const s = Math.sin(height * DEG), c = Math.cos(height * DEG);
  const held = slotHeight(height) * DEG;
  const bySun = cardTakes(UP, UP, [Math.cos(held), Math.sin(held), 0]);
  const byMoon = cardTakes(UP, UP, [-c, -s, 0]);
  return srgbToLinear(cardTarget(height) / 255) / (sun * bySun.light + moon * byMoon.light + above * bySun.sky);
}

/** The light at a sun height in the morning or the evening into `light`, and the exposure there before noon's divides it. */
function lightAt(lights: Float32Array, height: number, evening: boolean): number {
  lightsAt(lights, height, evening, blend);
  for (let i = 0; i < 12; i++) light[i] = blend[i]! * blend[LIGHT_FLOATS - 1]!;
  return cardExposure(height, luminance([light[0]!, light[1]!, light[2]!]), luminance([light[3]!, light[4]!, light[5]!]), luminance([light[6]!, light[7]!, light[8]!]));
}

/** The exposure at an hour. */
export function exposureFor(hour: number, lights: Float32Array): number {
  sunDirection(hour, sunAt);
  return lightAt(lights, sunHeight(hour), isEvening(sunAt)) / lightAt(lights, SUN_TOP, false);
}

/** Where the sun is, for a frame block: fTrueSun, the moon's direction turned round. The sun's slot is its light. */
export function trueSun(frame: Float32Array, out: Float32Array | Float64Array | number[]): void {
  out[0] = -frame[FRAME.moon]!;
  out[1] = -frame[FRAME.moon + 1]!;
  out[2] = -frame[FRAME.moon + 2]!;
}

/**
 * Fills the sky's part of a frame block for an hour: the sun's slot and the moon's, their light and the sky's,
 * exposure, and the table's scale. The moon stands opposite the sun, so the sun itself, for its disc and for looking
 * the table up, is `trueSun`; the sun's slot is the light from the sun's side, held GLOW_HOLD degrees up through
 * twilight, when it carries the afterglow and casts nothing.
 */
export function skyFrame(hour: number, sky: Sky, frame: Float32Array): void {
  const f = FRAME;
  sunDirection(hour, sunAt);
  const h = sunHeight(hour);
  const noon = lightAt(sky.lights, SUN_TOP, false);
  frame[f.exposure] = lightAt(sky.lights, h, isEvening(sunAt)) / noon;
  const flat = Math.hypot(sunAt[0]!, sunAt[2]!);
  const held = slotHeight(h) * DEG;
  const slot = h >= GLOW_HOLD ? sunAt : [(sunAt[0]! / flat) * Math.cos(held), Math.sin(held), (sunAt[2]! / flat) * Math.cos(held)];
  for (let k = 0; k < 3; k++) {
    frame[f.sun + k] = slot[k]!;
    frame[f.moon + k] = -sunAt[k]!;
    frame[f.sunColor + k] = light[k]!;
    frame[f.moonColor + k] = light[3 + k]!;
    frame[f.skyAbove + k] = light[6 + k]!;
    frame[f.skyBelow + k] = light[9 + k]!;
  }
  frame[f.casting] = discUp(h);
  frame[f.skyScale] = blend[LIGHT_FLOATS - 1]!;
}

const g = (n: number): string => (Number.isInteger(n) ? n.toFixed(1) : String(n));

/** The table's lookup as GLSL, the twin of `domeLight`: `skyLook` gives the dome in the table's units for a view and a sun. */
export const SKY_GLSL = `vec3 skyDecode(vec4 v) {
  return mix(v.rgb / 12.92, pow((v.rgb + 0.055) / 1.055, vec3(2.4)), step(0.04045, v.rgb)) * ${g(SKY_LOW)} * exp2(v.a * ${g(SKY_STOPS)});
}
vec3 skyLook(highp sampler3D table, vec3 view, vec3 sun) {
  float lx = length(view.xz) * length(sun.xz);
  float around = lx > 1e-9 ? sqrt(acos(clamp(dot(view.xz, sun.xz) / lx, -1.0, 1.0)) / 3.14159265) : 0.0;
  float up = sqrt(clamp(asin(clamp(view.y, -1.0, 1.0)) / 1.57079633, 0.0, 1.0));
  float height = degrees(asin(clamp(sun.y, -1.0, 1.0)));
  float s = clamp(height / ${g(SUN_TOP)}, -1.0, 1.0);
  float gathered = clamp((height - ${g(GATHER[0])}) / ${g(GATHER[1] - GATHER[0])}, 0.0, 1.0);
  float along = (0.5 + 0.5 * sign(s) * sqrt(abs(s)) + ${g(GATHERED)} * gathered) / ${g(1 + GATHERED)} * ${g(SKY_SIZE - 1)};
  float slice = sun.x > 0.0 ? ${g(SKY_SLICES - 1)} - along : along;
  vec3 t = (vec3(vec2(around, up) * ${g(SKY_SIZE - 1)}, slice) + 0.5) / vec3(${g(SKY_SIZE)}, ${g(SKY_SIZE)}, ${g(SKY_SLICES)});
  return skyDecode(texture(table, t));
}`;
