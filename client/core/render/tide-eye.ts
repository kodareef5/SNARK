// World-space sky optics, and the instruments' own lights. Over each instrument a beam leaves its emitter, ends in the
// knot of a storm 2,790 to 3,300 m up and feeds a figure of light on three sheets above it. Positions are relative to the
// actual observer, including a rider above the crown.
//
// Nothing here runs backwards and no two ignitions are alike. Every moving term is a turn that only advances or a flow
// that only travels outward on the site's clock; a figure's size follows a bloom that never shrinks, and it ends by
// fading where it stands. Each ignition takes a seed from the site and the cycle's number on the server's clock, so every
// observer sees the same one: the seed picks one of three figures for that instrument, never the one before, and its
// hand, size, pace and bearing.
import { EMITTERS, EYE_COLORS, EYE_FORMS, KEEL, LANTERN_MASTS, type TideEyeSite } from "../../../shared/world/tide-eye.ts";
import { FRAME, FRAME_BLOCK } from "./packet.ts";

export const EYE_PERIOD = 120;
export const EYE_SLOTS = 3;
/** Floats a site: where its figure's centre is, its phase and kind; its tint and power; its clock, bloom, seed and storm; its beam's foot, its heading and how lit it is. */
export const EYE_FLOATS = 16;
/** Metres over the datum of the figure's first sheet. */
export const EYE_SKY = 3450;
/** Metres over the datum of the storm's sheets under the figure: the knot the beam ends in, then the storm's three. */
const STORM_SHEETS = [2790, 3000, 3150, 3300] as const;
const KNOT_SHEET = STORM_SHEETS[0];
/** How hard the storm's turn winds its cloud into a spiral: radians a step of e in its distance from the axis. */
const STORM_WIND = 0.8;
/** The optical depth of the storm's thickest cloud, as the dome's cloudLit takes it: four times the low layer's, so it is heavier. */
export const STORM_DEPTH = 36;
/** How much of the figure's light comes through the storm under it where nothing of the sky does: it lights the cloud from above. */
const FIGURE_THROUGH = 0.12;
/** The colour of lightning in the cloud, and of a bolt. */
const FLASH = [0.72, 0.8, 1], BOLT = [0.85, 0.9, 1];
/** Lightning's clock: ticks a second. A tick may strike. */
const STRIKE_RATE = 1.7;
/** Octaves of the storm's noise where a tier does not say (`#define EYE_OCTAVES`). */
const OCTAVES = 4;

const pigments = { blue: [0.055, 0.40, 1], red: [1, 0.095, 0.055], green: [0.05, 0.90, 0.34] } as const;
const emerald = [0.015, 0.85, 0.20] as const;
const TAU = 2 * Math.PI;
const clamp = (v: number): number => Math.max(0, Math.min(1, v));
const smooth = (v: number): number => { const a = clamp(v); return a * a * (3 - 2 * a); };
const sstep = (a: number, b: number, x: number): number => smooth((x - a) / (b - a));
const fract = (v: number): number => v - Math.floor(v);
const mod = (a: number, b: number): number => a - b * Math.floor(a / b);
const mix = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Seconds within one site's cycle. Off, align, charge, ignite, hold and fade; every observer reads the server clock. */
export function eyePhase(seconds: number, site: TideEyeSite): number {
  return ((seconds + EYE_COLORS.indexOf(site.color) * 40) % EYE_PERIOD + EYE_PERIOD) % EYE_PERIOD;
}
/** How open the mechanism is, and with it whether the beam is lit. */
export function aperture(phase: number): number {
  return smooth((phase - 6) / 4) * smooth((120 - phase) / 4);
}
/** The figure's brightness: up over five seconds from the ninth, held, and fading from the twenty-eighth to the thirty-eighth. */
export function eyePower(phase: number): number {
  return smooth((phase - 9) / 5) * (1 - smooth((phase - 28) / 10));
}
/** The figure's size. It never shrinks: it opens fast, then drifts on outward as it fades. */
export function eyeBloom(phase: number): number {
  const a = Math.max(0, phase - 9);
  return 1 - Math.exp(-a / 3.2) + 0.012 * a;
}
/** The storm cell's weight: it gathers through the charge, thins after the fade, and a knot of it stays while the beam is lit, so the beam's end is never seen. */
export function eyeStorm(phase: number): number {
  return aperture(phase) * (0.35 + 0.65 * smooth((phase - 5) / 7) * (1 - smooth((phase - 32) / 14)));
}

/** Lower shutters rise first. Each bank takes three seconds to turn its blades, then closes in reverse order. */
export function shutterOpening(phase: number, bank: number): number {
  return smooth((phase - 5 - bank * 1.65) / 3.1) * smooth((120 - phase - bank * 1.65) / 3.1);
}

function bits(x: number, y: number, k: number): number {
  let h = (Math.imul(x | 0, 0x9e3779b1) ^ Math.imul(y | 0, 0x85ebca77) ^ Math.imul(k | 0, 0xc2b2ae3d)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0;
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39) >>> 0;
  return (h ^ (h >>> 15)) >>> 0;
}
/** 0 to 1 from a cell of whole numbers and a key, as the shader has it. */
export function eyeHash(x: number, y: number, k: number): number {
  return (bits(x, y, k) >>> 8) / 16777216;
}
function noise(x: number, y: number, k: number): number {
  const cx = Math.floor(x), cy = Math.floor(y);
  let fx = x - cx, fy = y - cy;
  fx = fx * fx * (3 - 2 * fx);
  fy = fy * fy * (3 - 2 * fy);
  return mix(mix(eyeHash(cx, cy, k), eyeHash(cx + 1, cy, k), fx), mix(eyeHash(cx, cy + 1, k), eyeHash(cx + 1, cy + 1, k), fx), fy);
}
function fbm(x: number, y: number, k: number, octaves: number): number {
  let a = 0.5, s = 0;
  for (let o = 0; o < octaves; o++) {
    s += a * noise(x, y, k + o);
    x = x * 2.03 + 17.3;
    y = y * 2.03 + 9.1;
    a *= 0.5;
  }
  return s / (1 - a * 2);
}

/** An ignition's seed, 0 to 1: the same for every observer of a site in a cycle. */
export function eyeSeed(site: TideEyeSite, cycle: number): number {
  return eyeHash(EYE_COLORS.indexOf(site.color) + 1, cycle, 77);
}
/**
 * Which of its three figures a site shows in a cycle. Each cycle steps one or two on from the last, by a pattern of 32
 * bits of the site's own, so no figure follows itself and their order is not a round.
 */
export function eyeFigure(site: TideEyeSite, cycle: number): number {
  const pattern = bits(EYE_COLORS.indexOf(site.color) + 1, 5, 31);
  const c = cycle + (1 << 20);
  const r = c & 31;
  let ones = 0;
  for (let b = 0; b <= r; b++) ones += (pattern >>> b) & 1;
  let all = 0;
  for (let b = 0; b < 32; b++) all += (pattern >>> b) & 1;
  return (c + (c >>> 5) * all + ones) % 3;
}

/**
 * The frame's sky lenses. `hold`, where given, is a display held at full power on a clock of its own, as the title's is:
 * seconds that only run forward.
 */
export function writeEyeSky(frame: Float32Array, sites: readonly TideEyeSite[], seconds: number, x: number, y: number, z: number, sextantScale = 1, hold: number | null = null): void {
  frame.fill(0, FRAME.eyes, FRAME.eyes + EYE_FLOATS * EYE_SLOTS);
  let count = 0;
  for (const site of sites) {
    const phase = eyePhase(seconds, site), open = aperture(phase);
    if (!open || count === EYE_SLOTS) continue;
    const held = hold !== null;
    const cycle = held ? 0 : Math.floor((seconds + EYE_COLORS.indexOf(site.color) * 40) / EYE_PERIOD);
    const at = FRAME.eyes + EYE_FLOATS * count++;
    const form = EYE_FORMS.indexOf(site.form), emitter = EMITTERS[form]!;
    const scale = site.form === "sextant" ? sextantScale : 1;
    const yaw = site.yaw * Math.PI / 32768, c = Math.cos(yaw), s = Math.sin(yaw);
    // The figure stands over the beam, and the beam on the emitter.
    frame[at] = site.x - x + emitter.x * scale * c;
    frame[at + 1] = EYE_SKY - y;
    frame[at + 2] = site.z - z - emitter.x * scale * s;
    // The instrument and the figure ride with the phase in one lane.
    frame[at + 3] = Math.min(phase, EYE_PERIOD - 0.0001) + (form + 3 * eyeFigure(site, cycle)) * EYE_PERIOD;
    frame.set(site.form === "lantern" && site.color === "green" ? emerald : pigments[site.color], at + 4);
    frame[at + 7] = held ? 1 : eyePower(phase);
    frame[at + 8] = held ? 20 + hold : phase;
    frame[at + 9] = held ? eyeBloom(20) : eyeBloom(phase);
    frame[at + 10] = eyeSeed(site, cycle);
    frame[at + 11] = held ? 1 : eyeStorm(phase);
    frame[at + 12] = site.y + KEEL + emitter.h * scale - y;
    frame[at + 13] = c;
    frame[at + 14] = s;
    frame[at + 15] = open;
  }
}

/** Whether lightning is striking at a site's clock, 0 to 1, and which strike it is. */
function strike(t: number, seed: number, power: number, storm: number, open: number, out: { id: number }): number {
  const tick = t * STRIKE_RATE + seed * 97, id = Math.floor(tick), f = tick - id;
  out.id = id;
  const chance = mix(0.06, 0.8, clamp(power * 1.2)) * sstep(0.3, 0.6, storm) + 0.04 * open;
  if (eyeHash(id, 7, Math.floor(seed * 4096)) >= chance) return 0;
  return Math.exp(-f * 7) * (0.55 + 0.45 * (fract(f * 9 + eyeHash(id, 3, 1)) >= 0.5 ? 1 : 0));
}

const struck = { id: 0 };

/**
 * The rows of an instrument's atlas its lights are built on (assets/source/core/structures/tide-eye/instrument.py): on
 * the glass a light is a tube, lit across by how it faces the eye; on the paving's a band lit across its width; on the
 * weathered porcelain's a dim divider.
 */
export const CHANNEL_STRIP = 4, CHANNEL_DIM = 7;
/** How far the energy in an instrument's channels has run by a site's clock, in metres: on at 2.2 m a second, and 20 m more over the charge. It only grows. */
const energyRun = (t: number, phase: number): number => 2.2 * t + 20 * sstep(4, 13, phase);
const ENERGY_WHITE = [1, 0.96, 0.9];
/** The channels' light after exposure: as bright as the old glow's, which was 2 to 3 where it was lit and more in a strike. */
const ENERGY_GAIN = 3.2;
/**
 * An instrument's own light at a camera-relative point of one of its channels, into `out` as light after exposure: energy
 * held in the channel, hot at its middle and falling off softly to its walls, threaded with filaments that run along it
 * and carried by packets that climb the instrument to its emitter (on the deck, run in to the console), closer and
 * quicker as it charges, breathing, surging at ignition and flickering with each strike by the site's pulse. Its colour
 * is the site's, white where it is hottest. `along` is metres along the channel, or NaN to take it from where the point
 * is on the instrument; `across` is 0 at the channel's middle and -1 and 1 at its walls (a tube's, by how it faces the
 * eye, is never under 0); `footprint` the metres a pixel spans.
 * With no site lit, nothing: the glow program then shows the light in its own colour.
 */
export function eyeEnergy(frame: Float32Array, x: number, y: number, z: number, along: number, across: number, footprint: number, out: Float64Array | number[]): void {
  let best = Infinity;
  out[0] = out[1] = out[2] = 0;
  for (let i = 0; i < EYE_SLOTS; i++) {
    const at = FRAME.eyes + i * EYE_FLOATS, stamp = frame[at + 3]!;
    if (stamp <= 0) continue;
    const dx = x - frame[at]!, dz = z - frame[at + 2]!, dd = dx * dx + dz * dz;
    if (dd >= best) continue;
    best = dd;
    const kind = Math.floor(stamp / EYE_PERIOD), phase = stamp - kind * EYE_PERIOD, form = kind % 3;
    const t = frame[at + 8]!, power = frame[at + 7]!, seed = frame[at + 10]!, open = frame[at + 15]!, cs = frame[at + 13]!, sn = frame[at + 14]!;
    const height = y - frame[at + 12]!;
    const charge = sstep(4, 9, phase) * (1 - sstep(9, 13, phase));
    const run = energyRun(t, phase), lit = strike(t, seed, power, frame[at + 11]!, open, struck);
    // Filaments: thin lines where two noises cross their middles, wandering as they run. A packet every 7 m with a hard
    // front and a long tail, and a surge 160 m long climbing the whole height; sparks racing along four times as fast,
    // one in three lengths of 2.5 m, each somewhere across; diodes under the glass. Sparks and diodes are seen close.
    let a = along, side = across * 2.6 + 13 * seed, turns = 1;
    let n1 = 0, n2 = 0, wave = 0, sparkAt = 0;
    if (Number.isNaN(a)) {
      // From where the point is: up the instrument, the filaments lying by where it is across it; and on the deck round
      // each ring and in along each spoke, as fronts of a spiral closing on the console, the filaments in a frame that
      // turns with them, so that nothing has a seam.
      const ex = EMITTERS[form]!.x, mx = dx + ex * cs, mz = dz - ex * sn, r = Math.hypot(mx, mz);
      a = height < -640 ? -r : height;
      side = 0.37 * (mx - mz);
      if (height < -640) {
        const th = Math.atan2(mz, mx + 1e-10), turn = th - 2.3 * run / Math.max(r, 3), turn2 = th - 4.1 * run / Math.max(r, 3);
        n1 = noise(r * Math.cos(turn) * 0.45, r * Math.sin(turn) * 0.45, 3);
        n2 = noise(r * Math.cos(turn2) * 1.3 + 7, r * Math.sin(turn2) * 1.3, 4);
        wave = 24 * th / TAU - r / 7 - 4.5 * run / 7;
        sparkAt = 96 * th / TAU - r / 2.5 - 9 * run / 2.5;
        turns = 24;
      }
    }
    if (turns === 1) {
      n1 = noise(a * 0.45 - 2.3 * run, side * 2.2, 3);
      n2 = noise(a * 1.3 - 4.1 * run, side * 3.7 + 7, 4);
      wave = (a - 4.5 * run) / 7;
      sparkAt = (a - 9 * run) / 2.5;
    }
    const beads = turns === 1 ? 0.92 + 0.08 * Math.cos(a * 31.4) * sstep(0.08, 0.02, footprint) : 1;
    const fil = 1 - Math.abs(2 * n1 - 1), fil2 = 1 - Math.abs(2 * n2 - 1);
    const threads = 0.7 * fil ** 6 + 0.5 * fil2 ** 8;
    const k = fract(wave);
    // Round a ring the fronts are counted round, so a packet is the same packet either side of where the count starts.
    const packet = Math.exp(-(1 - k) * 4) * sstep(1, 0.95, k) * (0.35 + 0.65 * eyeHash(mod(Math.floor(wave), turns === 1 ? 1e6 : turns), 17, 5));
    const surge = Math.pow(0.5 + 0.5 * Math.sin((a - 25 * run) * 0.039), 4);
    const cell = mod(Math.floor(sparkAt), turns === 1 ? 1e6 : 4 * turns), into = fract(sparkAt) * 2.5;
    const spark = eyeHash(cell, 23, 6) < 0.35 ? Math.exp(-(((into - 0.4 - 1.7 * eyeHash(cell, 29, 6)) / 0.12) ** 2) - (((across - 1.6 * eyeHash(cell, 31, 6) + 0.8) / 0.15) ** 2)) * sstep(0.15, 0.04, footprint) : 0;
    const pulse = open * (0.62 + 0.12 * Math.sin(1.25 * t) + 0.3 * power + (0.2 + 0.7 * charge) * surge + 1.3 * lit);
    const e = pulse * (0.3 + 1.1 * threads + (0.9 + 0.9 * charge + 0.3 * power) * packet + 1.4 * spark) * beads;
    const core = Math.exp(-across * across * 6), body = Math.exp(-across * across * 2.2);
    const hot = e * core, white = 0.9 * hot * hot;
    for (let c = 0; c < 3; c++) out[c] = ENERGY_GAIN * (frame[at + 4 + c]! * e * body * 1.45 + ENERGY_WHITE[c]! * white);
  }
}

/** The light an instrument's own display sends down on it, for a mirrored ray at a camera-relative point: the nearest site's tint by its power, most from straight up, in light before exposure. Nothing farther than 500 m from a site. */
export function eyeGlint(frame: Float32Array, out: Float64Array, x: number, z: number, up: number): void {
  let best = 250000;
  const exposure = Math.max(frame[FRAME.exposure]!, 1e-6);
  for (let i = 0; i < EYE_SLOTS; i++) {
    const at = FRAME.eyes + i * EYE_FLOATS;
    const dx = x - frame[at]!, dz = z - frame[at + 2]!, dd = dx * dx + dz * dz;
    if (frame[at + 3]! <= 0 || dd >= best) continue;
    best = dd;
    const share = (frame[at + 7]! * (0.25 + 0.75 * clamp(up)) * 0.55 + 0.05 * frame[at + 15]! * clamp(up)) / exposure;
    for (let c = 0; c < 3; c++) out[c] = frame[at + 4 + c]! * share;
  }
}

/** One beam's light at a ray: a hot core and a halo, beaded upward, risen from its foot as it charges and gone into the cell at its top. */
function beam(dx: number, dy: number, dz: number, ax: number, az: number, footY: number, top: number, power: number, phase: number, t: number, width: number): number {
  const den = Math.max(0.00001, dx * dx + dz * dz), along = (dx * ax + dz * az) / den, h = along * dy;
  if (along <= 0 || h <= footY || h >= top) return 0;
  const r = Math.hypot(dx * along - ax, dz * along - az), w = width * (2.4 + power * 4) + along * 0.0003;
  const up = h - footY, span = top - footY;
  const front = span * sstep(6, 9.5, phase);
  const body = (1 - sstep(front - 60, front, up)) * (1 - sstep(span - 300, span - 30, up));
  const beads = 0.78 + 0.22 * Math.sin(0.05 * up - 5.2 * t);
  return (Math.exp(-r / w) + 0.22 * Math.exp(-r / (5 * w))) * body * beads * (1 + 1.6 * Math.exp(-up / 45));
}

/**
 * How a cloud of the storm is lit, as the dome lights its own (atmosphere.ts cloudLit, `CloudLights`): `lit` puts its light
 * into `out` for its thickness, 0 to 1, its slope toward the light, the ray and the sky behind it; `way` is where the
 * light comes from and `relief` how much the slope toward it counts.
 */
export interface StormLit {
  readonly way: ArrayLike<number>;
  readonly relief: number;
  lit(out: number[], thick: number, relief: number, ray: ArrayLike<number>, behind: ArrayLike<number>): void;
}
/** Where nothing lights it as the dome lights its clouds: the sky behind it, darker where it is thick. */
const plainLit: StormLit = { way: [0, 1, 0], relief: 0, lit(out, thick, _relief, _ray, behind) {
  for (let c = 0; c < 3; c++) out[c] = behind[c]! * (0.9 - 0.55 * thick);
} };

/** The low layer's picture in cover and thickness where the dome has it, and its stand-in where not: value noise heaped as it heaps. */
function cumulus(u: number, v: number, k: number, octaves: number, out: number[]): void {
  const n = fbm(u * 7 + k * 17, v * 7 + k * 17, k * 5, octaves);
  out[0] = sstep(0.48, 0.68, n);
  out[1] = clamp((n - 0.5) * 2.6);
}
const reads = [[0, 0], [0, 0], [0, 0]];
/**
 * The storm's cloud over a point `qx, qz` km from its axis on sheet `sheet`, into `out` as how much it covers and how
 * thick it is, 0 to 1: the sky's heaped cloud, three reads of it at sizes from 2.4 to 5.9 km a picture, gathered about
 * the beam's end and wound into a spiral by a turn that only advances and is quicker near the middle; densest in a
 * wall about the knot, in arms further out, and no further than `reach`.
 */
function stormCloud(qx: number, qz: number, sheet: number, seed: number, dir: number, t: number, storm: number, reach: number, octaves: number, out: number[]): void {
  const r = Math.hypot(qx, qz);
  const a = dir * (STORM_WIND * Math.log(r + 0.3) - (0.02 + 0.035 * Math.exp(-1.6 * r)) * t) + TAU * fract(seed * 5.31 + sheet * 0.37);
  const ca = Math.cos(a), sa = Math.sin(a), wx = ca * qx - sa * qz, wz = sa * qx + ca * qz;
  const ox = fract(seed * 3.7 + sheet * 0.137) * 9, oz = fract(seed * 1.9 + sheet * 0.291) * 9;
  const s1 = reads[0]!, s2 = reads[1]!, s3 = reads[2]!;
  cumulus(wx * 0.17 + ox, wz * 0.17 + oz, 1, octaves, s1);
  cumulus((0.6 * wx - 0.8 * wz) * 0.32 + oz, (0.8 * wx + 0.6 * wz) * 0.32 + ox, 2, octaves, s2);
  cumulus((-0.5 * wx - 0.87 * wz) * 0.24 + ox * 0.7, (0.87 * wx - 0.5 * wz) * 0.24 + oz * 0.7, 3, octaves, s3);
  const cover = 1 - (1 - s1[0]!) * (1 - s2[0]!) * (1 - s3[0]!);
  const heap = clamp(Math.max(s1[1]!, s2[1]!, s3[1]!) * 1.2 + 0.15 * (s1[1]! + s2[1]! + s3[1]!));
  const arm = 0.5 + 0.5 * Math.cos((3 + Math.floor(fract(seed * 17.9) * 2)) * Math.atan2(wz, wx + 1e-10) + 2 * heap);
  const wall = 1 - sstep(0.25, 0.9, r), env = 1 - sstep(reach * 0.4, reach * 0.85, r);
  // As the storm thins its thinnest cloud goes first, down to the knot.
  const c = Math.max(clamp(cover * 2.1 - 0.9 * (1 - storm)) * mix(mix(0.3, 1, sstep(0.08, 0.6, arm)), 1, wall) * env, sstep(0.45, 0.15, r) * storm);
  out[0] = c * Math.min(1, storm * 3);
  out[1] = Math.max(heap * (0.4 + 0.6 * wall) * env, sstep(0.3, 0.1, r));
}
/** A bolt `u` metres beside its path at `v` metres along it, of length `len` and core width `w`: never quite straight, forking once. */
function bolt(u: number, v: number, id: number, len: number, w: number): number {
  if (v < 0 || v > len) return 0;
  const wob = (noise(v * 0.012, id * 3.1, 5) - 0.5) * 90 + (noise(v * 0.045, id * 1.7, 6) - 0.5) * 30 + (noise(v * 0.16, id * 0.7, 4) - 0.5) * 9;
  const main = Math.abs(u - wob);
  const at = len * (0.3 + 0.3 * eyeHash(id, 21, 3)), side = eyeHash(id, 23, 3) < 0.5 ? 1 : -1;
  const fork = v > at ? Math.abs(u - wob - side * (v - at) * 0.55 - (noise(v * 0.05, id * 2.3, 7) - 0.5) * 30) : 1e9;
  return (Math.exp(-main / w) + 0.12 * Math.exp(-main / (w * 14))) * (1 - sstep(len * 0.7, len, v)) + 0.7 * Math.exp(-fork / (w * 0.8)) * (1 - sstep(at + (len - at) * 0.5, len, v));
}
const sheetLit = [0, 0, 0], here = [0, 0], there = [0, 0], ray3 = [0, 0, 0];
/**
 * The storm over a site whose figure's middle is at `x, sky, z` from the eye, along ray `dx, dy, dz`: its light into
 * `out`, and how much of what is behind it shows. Four sheets from the lowest up, each the heaped cloud of the dome
 * lit as the dome lights its own (`lit`): the knot at the beam's end, and the storm 3,000, 3,150 and 3,300 m up, the
 * higher only where it is thick, so its heaps stand up toward the middle. Lightning on the site's strike clock lights
 * the cloud from inside about the strike, most where it is thin, crawls under the storm from the knot to the strike and
 * hangs from its edge; the beam lights the knot and the cloud over it in the site's colour.
 */
function stormLight(dx: number, dy: number, dz: number, x: number, sky: number, z: number, seed: number, dir: number, t: number, storm: number, power: number, open: number, tint: readonly number[], exposure: number, behind: ArrayLike<number>, lit: StormLit, px: number, octaves: number, out: number[]): number {
  out[0] = out[1] = out[2] = 0;
  if (storm <= 0.001) return 1;
  const reach = 1.2 + 1.5 * sstep(5, 12, t), camY = EYE_SKY - sky;
  ray3[0] = dx;
  ray3[1] = dy;
  ray3[2] = dz;
  const flash = strike(t, seed, power, storm, open, struck), id = struck.id;
  const ax = (eyeHash(id, 11, 2) - 0.5) * 1.5 * reach, az = (eyeHash(id, 13, 2) - 0.5) * 1.5 * reach;
  const adapt = (0.35 + 0.65 * sstep(2, 10, Math.log2(Math.max(1, exposure)))) * flash;
  let held = 1;
  for (let k = 0; k < STORM_SHEETS.length; k++) {
    const tt = (STORM_SHEETS[k]! - camY) / dy;
    if (tt <= 0) continue;
    const qx = (dx * tt - x) / 1000, qz = (dz * tt - z) / 1000, r = Math.hypot(qx, qz);
    if (r > reach) continue;
    let cover: number, thick: number, relief = 0;
    if (k === 0) {
      // The knot: dense where the beam ends, lumped by a little noise.
      cover = sstep(0.42, 0.12, r) * Math.min(1, storm * 3);
      thick = 0.55 + 0.45 * sstep(0.4, 0.1, r) - 0.25 * noise(qx * 14 + seed * 9, qz * 14, 8);
    } else {
      stormCloud(qx, qz, k, seed, dir, t, storm, reach, octaves, here);
      cover = here[0]!;
      thick = here[1]!;
      if (k > 1) cover *= sstep(0.2 + 0.25 * (k - 1), 0.5 + 0.25 * (k - 1), thick + 0.35 * sstep(1.1, 0.3, r));
      const side = Math.hypot(lit.way[0]!, lit.way[2]!);
      if (cover > 0.004 && lit.relief > 0 && side > 0.001) {
        // The slope toward the light, as the dome reads it off its own layer: thicker here than 120 m toward the light.
        stormCloud(qx + 0.12 * lit.way[0]! / side, qz + 0.12 * lit.way[2]! / side, k, seed, dir, t, storm, reach, octaves, there);
        relief = Math.max(-0.7, Math.min(0.7, (thick - there[1]!) * 3.5 * side)) * lit.relief;
      }
    }
    if (cover < 0.004) continue;
    lit.lit(sheetLit, thick, relief, ray3, behind);
    const glow = adapt * (3.2 * Math.exp(-Math.hypot(qx - ax, qz - az) / 0.45) + 0.12) * (0.35 + 0.65 * Math.exp(-1.5 * thick));
    const beamGlow = (0.5 + 0.9 * power) * open * (k === 0 ? 2.6 : k === 1 ? 1.2 : 0.3) * Math.exp(-r / (k === 0 ? 0.11 : 0.22));
    const a = cover * 0.95;
    for (let c = 0; c < 3; c++) out[c]! += held * a * (sheetLit[c]! * (k === 0 ? 0.55 : 1) + FLASH[c]! * glow + tint[c]! * beamGlow);
    held *= 1 - a;
  }
  if (flash > 0 && octaves > 2) {
    // Under the storm, a bolt crawls from the knot out to the strike.
    const tb = (STORM_SHEETS[1]! - 25 - camY) / dy;
    if (tb > 0) {
      const bx = dx * tb - x, bz = dz * tb - z, len = Math.hypot(ax, az) * 1000 + 200;
      const ux = ax * 1000 / Math.max(1, len - 200), uz = az * 1000 / Math.max(1, len - 200);
      const b = flash * 2.2 * bolt(bx * uz - bz * ux, bx * ux + bz * uz - 120, id, len, Math.max(3, 0.8 * tb * px));
      for (let c = 0; c < 3; c++) out[c]! += b * BOLT[c]!;
    }
    // And with most strikes another hangs from its edge, seen from wherever the eye is on the side nearer it.
    const ee = dx * dx + dz * dz, rb = 780 * reach, fb = -(x * dx + z * dz), disc = fb * fb - ee * (x * x + z * z - rb * rb);
    if (eyeHash(id, 31, 4) < 0.6 && ee > 1e-8 && disc > 0) {
      const tc = (-fb - Math.sqrt(disc)) / ee;
      if (tc > 0) {
        const hx = dx * tc - x, hz = dz * tc - z, th = Math.atan2(hz, hx) - Math.atan2(az, ax);
        const b = flash * 2.2 * bolt(Math.atan2(Math.sin(th), Math.cos(th)) * rb, STORM_SHEETS[1]! + 40 - dy * tc - camY, id + 7, 700 + 500 * eyeHash(id, 33, 4), Math.max(3, 0.8 * tc * px));
        for (let c = 0; c < 3; c++) out[c]! += held * b * BOLT[c]!;
      }
    }
  }
  return held;
}

const NO_SKY = [0, 0, 0];
const stormOut = [0, 0, 0];
// Called only on unobstructed sky pixels. Adds a ray's light to `out` and returns how much of the sky behind shows.
// `behind` is the sky's light behind the ray and `lit` how a cloud up there is lit (the dome's cloudLit, atmosphere.ts),
// in the units `out` is in; `px` is the angle a pixel spans.
export function eyeRadiance(frame: Float32Array, ray: ArrayLike<number>, out: Float64Array, behind: ArrayLike<number> = NO_SKY, octaves = OCTAVES, lit: StormLit = plainLit, px = 0.0015): number {
  let transmission = 1;
  const dx = ray[0]!, dy = ray[1]!, dz = ray[2]!;
  if (dy <= 0.002) return 1;
  for (let i = 0; i < EYE_SLOTS; i++) {
    const at = FRAME.eyes + i * EYE_FLOATS, stamp = frame[at + 3]!;
    if (stamp <= 0) continue;
    const kind = Math.floor(stamp / EYE_PERIOD), phase = stamp - kind * EYE_PERIOD, figure = Math.floor(kind / 3), form = kind - 3 * figure;
    const x = frame[at]!, sky = frame[at + 1]!, z = frame[at + 2]!, power = frame[at + 7]!;
    const t = frame[at + 8]!, bloom = frame[at + 9]!, seed = frame[at + 10]!, storm = frame[at + 11]!;
    const footY = frame[at + 12]!, cs = frame[at + 13]!, sn = frame[at + 14]!, open = frame[at + 15]!;
    const tint = [frame[at + 4]!, frame[at + 5]!, frame[at + 6]!];
    const dir = fract(seed * 3.7) < 0.5 ? 1 : -1, size = 0.85 + 0.35 * fract(seed * 7.13), speed = 0.8 + 0.5 * fract(seed * 13.71), off = TAU * fract(seed * 29.3);
    let glow = 0, white = 0, pupil = 1;
    const fringe = [0, 0, 0];
    // The figure, on three sheets 185 m apart.
    if (power > 0.001) for (let j = 0; j < 3; j++) {
      const k = j, dist = (sky + k * 185) / dy;
      const px = (dx * dist - x) / 1000, pz = (dz * dist - z) / 1000;
      if (dist <= 0 || Math.max(Math.abs(px), Math.abs(pz)) > 3.2) continue;
      const r = Math.hypot(px, pz), th = Math.atan2(pz, px + 1e-10);
      if (form === 2) {
        if (j === 0) pupil *= 1 - 0.8 * power * (1 - sstep(0.17, 0.54, r));
        if (figure === 1) {
          // Ribbons: three broad bands climbing a spiral, rayed along their length.
          const psi = dir * th - 1.2 * Math.log(r + 0.15) + 0.32 * speed * t + k * 0.5 + off;
          const d = Math.abs(fract(psi * 3 / TAU) - 0.5) * TAU / 3 * r * 0.64, wide = 0.09 + 0.16 * r;
          const far = 0.5 + 1.5 * bloom * size;
          const reach = sstep(0.15 + 0.04 * k, 0.4, r) * (1 - sstep(far - 0.6, far, r));
          const band = Math.exp(-d / wide), flutes = 0.5 + 0.5 * Math.cos(30 * d / wide + 9 * Math.log(r + 0.15) - 1.1 * t);
          glow += power * reach * band * (0.55 + 1.5 * flutes * flutes);
          white += power * reach * (0.35 * Math.exp(-d / 0.012) + 0.06 * band * flutes);
        } else if (figure === 2) {
          // Louvres: a ring of slats to each bank, opening in turn, each turning its own way.
          const ring = (0.38 + 0.42 * k) * (0.7 + 0.6 * bloom * size), e = r - ring;
          const opened = sstep(k * 0.22, k * 0.22 + 0.3, bloom);
          const spin = (j === 1 ? -1 : 1) * dir * 0.12 * speed * t + off;
          const along = fract((th + spin) * (9 + 3 * k) / TAU);
          const gap = sstep(0, 0.08, along) * (1 - sstep(0.72, 0.8, along));
          glow += power * opened * gap * Math.exp(-(e / 0.07) * (e / 0.07)) * (0.6 + 0.4 * along) * 2;
          white += power * opened * gap * 0.9 * Math.exp(-Math.abs(e - 0.05) / 0.01);
        } else {
          // Curtains: three pleated curtains about a dark throat, their folds drifting through one another in depth.
          const twist = th + 1.76 * Math.log(0.22 + r) - 0.17 * dir * speed * t - 0.27 * k + 0.12 * Math.sin(3 * th + 0.8 * r) + 0.21 * Math.sin(2 * th - 0.28 * k + 0.11 * t) + off;
          const pleat = Math.abs(Math.sin(1.5 * twist)) * Math.max(0.18, r);
          const outer = (0.65 + bloom * 1.43 * size) * (1 + 0.11 * Math.sin(3 * th + 0.23 * t));
          const reach = sstep(0.17 + k * 0.045, 0.49 + k * 0.045, r) * (1 - sstep(outer - 0.63, outer, r));
          const rail = pleat - (0.045 + 0.024 * k) * r, veil = Math.exp(-pleat / (0.105 + 0.105 * r));
          const flutes = 0.5 + 0.5 * Math.cos(25 * pleat + 1.6 * Math.sin(5 * th + 3.2 * r - 0.21 * t));
          pupil *= 1 - 0.24 * power * reach * veil;
          glow += power * reach * (veil * (0.83 + 1.48 * flutes * flutes) + 0.95 * Math.exp(-Math.abs(rail) / 0.027));
          white += power * reach * (0.40 * Math.exp(-Math.abs(rail) / 0.016) + 0.085 * veil * flutes);
        }
      } else if (form === 1) {
        const qx = px - 0.10 * k, qz = (pz + 0.07 * k) * 1.16;
        const rq = Math.hypot(qx, qz), theta = Math.atan2(qz, qx + 1e-10);
        if (figure === 2) {
          // Transit: the sight walks a graduated circle once round, and each mark it passes stays lit.
          const ring = 0.5 + 0.75 * bloom * size + k * 0.2, e = rq - ring;
          const gone = 0.42 * speed * Math.max(0, t - 9), rel = mod(dir * (theta - off), TAU);
          const lit = gone >= TAU ? 1 : 1 - sstep(gone - 0.05, gone, rel);
          const ticks = Math.pow(Math.max(0, Math.cos(48 * theta)), 16) * Math.exp(-Math.abs(e + 0.07) / 0.06);
          const major = Math.pow(Math.max(0, Math.cos(8 * theta)), 40) * Math.exp(-Math.abs(e + 0.11) / 0.1);
          glow += power * lit * (0.6 * Math.exp(-Math.abs(e) / 0.012) + 1.3 * ticks + 1.6 * major);
          const tip = Math.abs(mod(rel - gone + Math.PI, TAU) - Math.PI);
          white += power * 3.2 * Math.exp(-Math.hypot(tip * ring, e) / 0.07);
          if (j === 0) pupil *= 1 - 0.5 * power * (1 - sstep(-0.3, 0, e));
        } else {
          // Sweep: an open arc led by the white sight; as a Fan, fine rays stand from the beam to the arc behind it.
          const head = dir * 0.54 * speed * (t - 9) - k * 0.68 + off;
          const lag = mod(dir * (head - theta), TAU);
          const radius = 0.43 + bloom * 0.66 * size + k * 0.23 + 0.055 * Math.sin(2 * theta + k);
          const edge = rq - radius + 0.014 * Math.sin(9 * theta - dir * t * 0.64);
          const trail = (1 - sstep(2.1, 3.55, lag)) * sstep(0, 0.075, lag);
          const ticks = Math.pow(Math.max(0, Math.cos(24 * theta - k * 0.62)), 12);
          const core = Math.exp(-Math.abs(edge) / 0.023);
          glow += power * trail * (1.55 * Math.exp(-Math.abs(edge) / 0.092) + core + 1.58 * ticks * Math.exp(-Math.abs(edge + 0.082) / 0.076));
          if (figure === 1) glow += power * trail * 0.55 * Math.pow(0.5 + 0.5 * Math.cos(70 * theta + 3 * k), 24) * sstep(0.06, 0.2, rq) * (1 - sstep(radius - 0.08, radius, rq)) * (0.4 + 0.6 * rq / radius);
          const tip = Math.min(lag, TAU - lag);
          white += power * (3.4 * Math.exp(-Math.hypot(tip * radius, edge) / 0.077) + 0.45 * core * trail);
        }
      } else if (figure === 1) {
        // Coil: arms of a spiral unfurling from the beam, beads of light running out along them.
        const arms = 2 + Math.floor(fract(seed * 41.3) * 2.99);
        const psi = dir * th - 2.4 * Math.log(r + 0.08) + 0.55 * speed * t + k * 0.9 + off;
        const d = Math.abs(fract(psi * arms / TAU) - 0.5) * TAU / arms * r * 0.385;
        const far = (0.25 + 1.25 * bloom * size) * (1 + 0.1 * k);
        const reach = sstep(0.07, 0.2, r) * (1 - sstep(far - 0.45, far, r));
        const veil = Math.exp(-d / (0.035 + 0.07 * r)), stream = 0.5 + 0.5 * Math.cos(26 * Math.log(r + 0.08) - 3 * t + 5 * psi);
        glow += power * reach * veil * (0.7 + 2.2 * stream * stream);
        white += power * reach * (1.6 * Math.exp(-d / 0.008) + 0.12 * veil * stream);
        if (j === 0) pupil *= 1 - 0.7 * power * (1 - sstep(0.1, 0.42, r));
      } else if (figure === 2) {
        // Wings: a halo pinched at two sides and broad at the others, its rim split into colours.
        const ca = Math.cos(th - dir * 0.07 * speed * t - off), wing = Math.pow(Math.abs(ca), 0.7);
        const ring = (0.3 + 1.05 * bloom * size) * (1 + 0.12 * k) * (1 + 0.42 * ca * ca);
        const e = r - ring + 0.02 * Math.sin(7 * th - 1.3 * dir * t);
        const veil = Math.exp(-Math.abs(e) / (0.05 + 0.1 * wing));
        for (let c = 0; c < 3; c++) fringe[c]! += power * wing * 0.9 * Math.exp(-Math.abs(e + 0.04 * (c - 1)) / 0.03);
        glow += power * wing * veil * 0.9;
        white += power * wing * 1.4 * Math.exp(-Math.abs(e) / 0.008);
        if (j === 0) pupil *= 1 - 0.75 * power * (1 - sstep(-0.3, 0.05, e));
      } else {
        // Iris: twisting rims on counter-turning sheets about a dark pupil.
        const turn = th + dir * speed * t * (j === 1 ? -0.18 : 0.13) + k * 1.23 + off;
        const radius = (0.18 + 0.94 * bloom * size) * (1 + 0.13 * k + 0.08 * Math.sin(2 * turn) + 0.035 * Math.sin(3 * turn + k));
        const edge = r - radius;
        if (j === 0) pupil *= 1 - 0.78 * power * (1 - sstep(-0.26, 0.06, edge));
        if (Math.abs(edge) > 0.77) continue;
        const warp = edge + 0.026 * Math.sin(9 * turn + 7 * edge - t * 0.34) + 0.012 * Math.sin(19 * turn + t * 0.71);
        const fold = 0.36 + 0.64 * (0.5 + 0.5 * Math.cos(3 * turn + 4 * warp - k));
        const veil = Math.exp(-Math.abs(warp) / (0.06 + 0.115 * fold));
        const stream = 0.5 + 0.5 * Math.cos(38 * warp + 3 * turn + 1.45 * Math.sin(5 * turn + 11 * warp));
        glow += power * fold * veil * (0.60 + 2.65 * stream * stream);
        const bolt = warp + 0.015 * Math.sin(21 * turn + t) + 0.006 * Math.sin(47 * turn - t * 1.8);
        white += power * fold * (1.85 * Math.exp(-Math.abs(bolt) / 0.009) + 0.17 * veil * stream);
      }
    }
    // The storm under it, then the beam in front of all that, which ends in the storm's knot: one from the emitter, or
    // the Lantern's three from its masts.
    const held = stormLight(dx, dy, dz, x, sky, z, seed, dir, t, storm, power, open, tint, frame[FRAME.exposure]!, behind, lit, px, octaves, stormOut);
    const top = sky - (EYE_SKY - KNOT_SHEET);
    let shaft = 0;
    const beamLit = (0.5 + 0.9 * power) * open;
    if (form === 2) for (let b = 0; b < LANTERN_MASTS.length; b++) {
      const mx = LANTERN_MASTS[b]![0], mz = LANTERN_MASTS[b]![1];
      shaft += beam(dx, dy, dz, x + mx * cs + mz * sn, z - mx * sn + mz * cs, footY, top, power, phase, t, 0.7);
    }
    else shaft = beam(dx, dy, dz, x, z, footY, top, power, phase, t, 1);
    shaft *= beamLit;
    for (let c = 0; c < 3; c++) out[c]! += transmission * (stormOut[c]! + (held + FIGURE_THROUGH * (1 - held)) * (tint[c]! * glow + white + fringe[c]!)) + tint[c]! * shaft + 0.3 * power * Math.min(1, shaft * shaft);
    transmission *= pupil * held;
  }
  return transmission;
}

const g = (v: number): string => (Number.isInteger(v) ? `${v}.` : String(v));
const MASTS_GLSL = LANTERN_MASTS.map(([mx, mz]) => `shaft += eyeBeam(d, s.xz+vec2(${g(mx!)}*foot.y+${g(mz!)}*foot.z, ${g(-mx!)}*foot.z+${g(mz!)}*foot.y), foot.x, top, power, phase, t, .7);`).join("\n      ");

/** The site's hash, noise and lightning clock, which the instrument's own lights share with its sky. */
export const EYE_STRIKE_GLSL = `
#ifndef EYE_OCTAVES
#define EYE_OCTAVES ${OCTAVES}
#endif
float eyeHash(vec2 c, float k) {
  uint h = uint(int(c.x))*${0x9e3779b1}u ^ uint(int(c.y))*${0x85ebca77}u ^ uint(int(k))*${0xc2b2ae3d}u;
  h = (h ^ (h >> 15u))*${0x2c1b3c6d}u;
  h = (h ^ (h >> 12u))*${0x297a2d39}u;
  return float((h ^ (h >> 15u)) >> 8u)/16777216.;
}
float eyeStrike(float t, float seed, float power, float storm, float open, out float id) {
  float tick = t*${g(STRIKE_RATE)}+seed*97., f;
  id = floor(tick);
  f = tick-id;
  float chance = mix(.06,.8,clamp(power*1.2,0.,1.))*smoothstep(.3,.6,storm)+.04*open;
  if (eyeHash(vec2(id,7.),floor(seed*4096.)) >= chance) return 0.;
  return exp(-f*7.)*(.55+.45*step(.5,fract(f*9.+eyeHash(vec2(id,3.),1.))));
}
float eyeNoise(vec2 p, float k) {
  vec2 c = floor(p), f = p-c;
  f = f*f*(3.-2.*f);
  return mix(mix(eyeHash(c,k),eyeHash(c+vec2(1.,0.),k),f.x),mix(eyeHash(c+vec2(0.,1.),k),eyeHash(c+vec2(1.,1.),k),f.x),f.y);
}`;

/** `eyeGlint` as GLSL, after the frame block. */
export const EYE_GLINT_GLSL = `
vec3 eyeGlint(vec3 rel, vec3 ray) {
  float best = 250000.;
  vec3 glint = vec3(0.);
  for (int i=0; i<3; i++) {
    vec4 s = fEyes[i*4], tint = fEyes[i*4+1];
    vec2 away = rel.xz-s.xz;
    float dd = dot(away,away), up = clamp(ray.y,0.,1.);
    if (s.w <= 0. || dd >= best) continue;
    best = dd;
    glint = tint.rgb*(tint.w*(.25+.75*up)*.55+.05*fEyes[i*4+3].w*up);
  }
  return glint/max(fSunColor.w,1.e-6);
}`;

/** `eyeEnergy` as GLSL, after the frame block and EYE_STRIKE_GLSL: the light, and `along` below -1e9 to take it from where the point is. */
export const EYE_ENERGY_GLSL = `
vec3 eyeEnergy(vec3 rel, float along, float across, float footprint) {
  float best = 1.e30;
  vec3 light = vec3(0.);
  for (int i=0; i<3; i++) {
    vec4 s = fEyes[i*4], tint = fEyes[i*4+1], life = fEyes[i*4+2], foot = fEyes[i*4+3];
    vec2 away = rel.xz-s.xz;
    float dd = dot(away,away);
    if (s.w <= 0. || dd >= best) continue;
    best = dd;
    float kind = floor(s.w/120.), phase = s.w-120.*kind, form = kind-3.*floor(kind/3.), t = life.x, id;
    float height = rel.y-foot.x, a = along, side = across*2.6+13.*life.z, turns = 1., n1, n2, wave, sparkAt;
    float charge = smoothstep(4.,9.,phase)*(1.-smoothstep(9.,13.,phase));
    float run = 2.2*t+20.*smoothstep(4.,13.,phase), lit = eyeStrike(t,life.z,tint.w,life.w,foot.w,id);
    if (a < -1.e9) {
      float ex = form < .5 ? ${g(EMITTERS[0].x)} : form < 1.5 ? ${g(EMITTERS[1].x)} : ${g(EMITTERS[2].x)};
      vec2 m = away+ex*vec2(foot.y,-foot.z);
      float r = length(m);
      a = height < -640. ? -r : height;
      side = .37*(m.x-m.y);
      if (height < -640.) {
        float th = atan(m.y,m.x+1.e-10), turn = th-2.3*run/max(r,3.), turn2 = th-4.1*run/max(r,3.);
        n1 = eyeNoise(r*vec2(cos(turn),sin(turn))*.45,3.);
        n2 = eyeNoise(r*vec2(cos(turn2),sin(turn2))*1.3+vec2(7.,0.),4.);
        wave = 24.*th/6.2831853-r/7.-4.5*run/7.;
        sparkAt = 96.*th/6.2831853-r/2.5-9.*run/2.5;
        turns = 24.;
      }
    }
    if (turns == 1.) {
      n1 = eyeNoise(vec2(a*.45-2.3*run,side*2.2),3.);
      n2 = eyeNoise(vec2(a*1.3-4.1*run,side*3.7+7.),4.);
      wave = (a-4.5*run)/7.;
      sparkAt = (a-9.*run)/2.5;
    }
    float fil = 1.-abs(2.*n1-1.), fil2 = 1.-abs(2.*n2-1.);
    float threads = .7*pow(fil,6.)+.5*pow(fil2,8.);
    float k = fract(wave), every = turns == 1. ? 1.e6 : turns;
    float packet = exp(-(1.-k)*4.)*smoothstep(1.,.95,k)*(.35+.65*eyeHash(vec2(mod(floor(wave),every),17.),5.));
    float surge = pow(.5+.5*sin((a-25.*run)*.039),4.);
    float beads = turns == 1. ? .92+.08*cos(a*31.4)*smoothstep(.08,.02,footprint) : 1.;
    float cell = mod(floor(sparkAt),turns == 1. ? 1.e6 : 4.*turns), into = fract(sparkAt)*2.5;
    float sx = (into-.4-1.7*eyeHash(vec2(cell,29.),6.))/.12, sy = (across-1.6*eyeHash(vec2(cell,31.),6.)+.8)/.15;
    float spark = eyeHash(vec2(cell,23.),6.) < .35 ? exp(-sx*sx-sy*sy)*smoothstep(.15,.04,footprint) : 0.;
    float pulse = foot.w*(.62+.12*sin(1.25*t)+.3*tint.w+(.2+.7*charge)*surge+1.3*lit);
    float e = pulse*(.3+1.1*threads+(.9+.9*charge+.3*tint.w)*packet+1.4*spark)*beads;
    float hot = e*exp(-across*across*6.);
    light = ${g(ENERGY_GAIN)}*(tint.rgb*e*exp(-across*across*2.2)*1.45+vec3(${ENERGY_WHITE.map(g).join(",")})*.9*hot*hot);
  }
  return light;
}`;

export const EYE_SKY_GLSL = `${EYE_STRIKE_GLSL}
float eyeFbm(vec2 p, float k) {
  float a = .5, s = 0.;
  for (int o=0; o<EYE_OCTAVES; o++) {
    s += a*eyeNoise(p,k+float(o));
    p = p*2.03+vec2(17.3,9.1);
    a *= .5;
  }
  return s/(1.-a*2.);
}
float eyeBeam(vec3 d, vec2 axis, float footY, float top, float power, float phase, float t, float width) {
  float along = dot(d.xz,axis)/max(.00001,dot(d.xz,d.xz)), h = along*d.y;
  if (along <= 0. || h <= footY || h >= top) return 0.;
  float r = length(d.xz*along-axis), w = width*(2.4+power*4.)+along*.0003;
  float up = h-footY, span = top-footY, front = span*smoothstep(6.,9.5,phase);
  float body = (1.-smoothstep(front-60.,front,up))*(1.-smoothstep(span-300.,span-30.,up));
  return (exp(-r/w)+.22*exp(-r/(5.*w)))*body*(.78+.22*sin(.05*up-5.2*t))*(1.+1.6*exp(-up/45.));
}
#ifndef EYE_LIT
vec3 eyeCloudLit(float thick, float relief, vec3 d, vec3 behind) { return behind*(.9-.55*thick); }
#define EYE_WAY vec3(0.,1.,0.)
#define EYE_RELIEF 0.
#endif
const float EYE_SHEETS[${STORM_SHEETS.length}] = float[${STORM_SHEETS.length}](${STORM_SHEETS.map(g).join(",")});
bool eyePictured = false;
vec2 eyeCumulus(vec2 uv, float k, float lod) {
#ifdef EYE_PICTURE
  if (eyePictured) return textureLod(uLow, uv, lod).rg;
#endif
  float n = eyeFbm(uv*7.+k*17.,k*5.);
  return vec2(smoothstep(.48,.68,n),clamp((n-.5)*2.6,0.,1.));
}
vec2 eyeStormCloud(vec2 q, float sheet, float seed, float dir, float t, float storm, float reach, float lod) {
  float r = length(q);
  float a = dir*(${g(STORM_WIND)}*log(r+.3)-(.02+.035*exp(-1.6*r))*t)+6.2831853*fract(seed*5.31+sheet*.37);
  vec2 w = mat2(cos(a),sin(a),-sin(a),cos(a))*q, o = fract(vec2(seed*3.7+sheet*.137,seed*1.9+sheet*.291))*9.;
  vec2 s1 = eyeCumulus(w*.17+o,1.,lod+${g(Math.log2(0.17 / 0.32))});
  vec2 s2 = eyeCumulus(mat2(.6,.8,-.8,.6)*w*.32+o.yx,2.,lod);
  vec2 s3 = eyeCumulus(mat2(-.5,.87,-.87,-.5)*w*.24+o*.7,3.,lod+${g(Math.log2(0.24 / 0.32))});
  float cover = 1.-(1.-s1.x)*(1.-s2.x)*(1.-s3.x);
  float heap = clamp(max(max(s1.y,s2.y),s3.y)*1.2+.15*(s1.y+s2.y+s3.y),0.,1.);
  float arm = .5+.5*cos((3.+floor(fract(seed*17.9)*2.))*atan(w.y,w.x+1.e-10)+2.*heap);
  float wall = 1.-smoothstep(.25,.9,r), env = 1.-smoothstep(reach*.4,reach*.85,r);
  float c = max(clamp(cover*2.1-.9*(1.-storm),0.,1.)*mix(mix(.3,1.,smoothstep(.08,.6,arm)),1.,wall)*env,smoothstep(.45,.15,r)*storm);
  return vec2(c*min(1.,storm*3.),max(heap*(.4+.6*wall)*env,smoothstep(.3,.1,r)));
}
float eyeBolt(float u, float v, float id, float len, float w) {
  if (v < 0. || v > len) return 0.;
  float wob = (eyeNoise(vec2(v*.012,id*3.1),5.)-.5)*90.+(eyeNoise(vec2(v*.045,id*1.7),6.)-.5)*30.+(eyeNoise(vec2(v*.16,id*.7),4.)-.5)*9.;
  float main = abs(u-wob), at = len*(.3+.3*eyeHash(vec2(id,21.),3.)), side = eyeHash(vec2(id,23.),3.) < .5 ? 1. : -1.;
  float fork = v > at ? abs(u-wob-side*(v-at)*.55-(eyeNoise(vec2(v*.05,id*2.3),7.)-.5)*30.) : 1.e9;
  return (exp(-main/w)+.12*exp(-main/(w*14.)))*(1.-smoothstep(len*.7,len,v))+.7*exp(-fork/(w*.8))*(1.-smoothstep(at+(len-at)*.5,len,v));
}
vec4 eyeStorm(vec3 d, vec3 s, float seed, float dir, float t, float storm, float power, float open, vec3 tint, vec3 behind, float px) {
  vec3 light = vec3(0.);
  float held = 1.;
  if (storm <= .001) return vec4(light, held);
  float reach = 1.2+1.5*smoothstep(5.,12.,t), camY = ${g(EYE_SKY)}-s.y, id, flash = eyeStrike(t,seed,power,storm,open,id);
  vec2 at = (vec2(eyeHash(vec2(id,11.),2.),eyeHash(vec2(id,13.),2.))-.5)*1.5*reach;
  float adapt = (.35+.65*smoothstep(2.,10.,log2(max(1.,fSunColor.w))))*flash, side = length(EYE_WAY.xz);
  for (int k=0; k<${STORM_SHEETS.length}; k++) {
    float tt = (EYE_SHEETS[k]-camY)/d.y;
    vec2 q = (d.xz*tt-s.xz)*.001;
    float r = length(q);
    if (tt <= 0. || r > reach) continue;
    float cover, thick, relief = 0.;
    if (k == 0) {
      cover = smoothstep(.42,.12,r)*min(1.,storm*3.);
      thick = .55+.45*smoothstep(.4,.1,r)-.25*eyeNoise(vec2(q.x*14.+seed*9.,q.y*14.),8.);
    } else {
      float lod = log2(max(1.e-6,tt*px*.655));
      vec2 here = eyeStormCloud(q,float(k),seed,dir,t,storm,reach,lod);
      cover = here.x;
      thick = here.y;
      if (k > 1) cover *= smoothstep(.2+.25*float(k-1),.5+.25*float(k-1),thick+.35*smoothstep(1.1,.3,r));
      if (cover > .004 && EYE_RELIEF > 0. && side > .001) relief = clamp((thick-eyeStormCloud(q+.12*EYE_WAY.xz/side,float(k),seed,dir,t,storm,reach,lod+1.).y)*3.5*side,-.7,.7)*EYE_RELIEF;
    }
    if (cover < .004) continue;
    float glow = adapt*(3.2*exp(-length(q-at)/.45)+.12)*(.35+.65*exp(-1.5*thick));
    float beam = (.5+.9*power)*open*(k == 0 ? 2.6 : k == 1 ? 1.2 : .3)*exp(-r/(k == 0 ? .11 : .22));
    float a = cover*.95;
    light += held*a*(eyeCloudLit(thick,relief,d,behind)*(k == 0 ? .55 : 1.)+vec3(${FLASH.map(g).join(",")})*glow+tint*beam);
    held *= 1.-a;
  }
#if EYE_OCTAVES > 2
  if (flash > 0.) {
    float tb = (${g(STORM_SHEETS[1] - 25)}-camY)/d.y;
    if (tb > 0.) {
      vec2 b = d.xz*tb-s.xz;
      float len = length(at)*1000.+200.;
      vec2 u = at*1000./max(1.,len-200.);
      light += flash*2.2*eyeBolt(b.x*u.y-b.y*u.x,dot(b,u)-120.,id,len,max(3.,.8*tb*px))*vec3(${BOLT.map(g).join(",")});
    }
    float ee = dot(d.xz,d.xz), rb = 780.*reach, fb = -dot(s.xz,d.xz), disc = fb*fb-ee*(dot(s.xz,s.xz)-rb*rb);
    if (eyeHash(vec2(id,31.),4.) < .6 && ee > 1.e-8 && disc > 0.) {
      float tc = (-fb-sqrt(disc))/ee;
      vec2 h = d.xz*tc-s.xz;
      float th = atan(h.y,h.x)-atan(at.y,at.x);
      if (tc > 0.) light += held*flash*2.2*eyeBolt(atan(sin(th),cos(th))*rb,${g(STORM_SHEETS[1] + 40)}-d.y*tc-camY,id+7.,700.+500.*eyeHash(vec2(id,33.),4.),max(3.,.8*tc*px))*vec3(${BOLT.map(g).join(",")});
    }
  }
#endif
  return vec4(light, held);
}
vec4 eyeOptics(vec3 d, vec3 behind) {
  vec3 light = vec3(0.);
  float transmission = 1., px = length(fwidth(d));
  if (fEyes[0].w <= 0. || d.y <= .002) return vec4(light, transmission);
#ifdef EYE_PICTURE
  eyePictured = fHaze.w > 1.5 && textureSize(uLow, 0).x >= 512;
#endif
  for (int i=0; i<3; i++) {
    vec4 s = fEyes[i*4], tint = fEyes[i*4+1], life = fEyes[i*4+2], foot = fEyes[i*4+3];
    if (s.w <= 0.) continue;
    float kind = floor(s.w/120.), phase = s.w-120.*kind, figure = floor(kind/3.), form = kind-3.*figure;
    float power = tint.w, t = life.x, bloom = life.y, seed = life.z, storm = life.w, open = foot.w;
    float dir = fract(seed*3.7) < .5 ? 1. : -1., size = .85+.35*fract(seed*7.13), speed = .8+.5*fract(seed*13.71), off = 6.2831853*fract(seed*29.3);
    float glow = 0., white = 0., pupil = 1.;
    vec3 fringe = vec3(0.);
    if (power > .001) for (int j=0; j<3; j++) {
      float k = float(j), dist = (s.y+k*185.)/d.y;
      vec2 p = (d.xz*dist-s.xz)*.001;
      if (dist <= 0. || max(abs(p.x),abs(p.y)) > 3.2) continue;
      float r = length(p), th = atan(p.y,p.x+1.e-10);
      if (form == 2.) {
        if (j == 0) pupil *= 1.-.8*power*(1.-smoothstep(.17,.54,r));
        if (figure == 1.) {
          float psi = dir*th-1.2*log(r+.15)+.32*speed*t+k*.5+off;
          float dd = abs(fract(psi*3./6.2831853)-.5)*6.2831853/3.*r*.64, wide = .09+.16*r;
          float far = .5+1.5*bloom*size;
          float reach = smoothstep(.15+.04*k,.4,r)*(1.-smoothstep(far-.6,far,r));
          float band = exp(-dd/wide), flutes = .5+.5*cos(30.*dd/wide+9.*log(r+.15)-1.1*t);
          glow += power*reach*band*(.55+1.5*flutes*flutes);
          white += power*reach*(.35*exp(-dd/.012)+.06*band*flutes);
        } else if (figure == 2.) {
          float ring = (.38+.42*k)*(.7+.6*bloom*size), e = r-ring;
          float opened = smoothstep(k*.22,k*.22+.3,bloom);
          float spin = (j == 1 ? -1. : 1.)*dir*.12*speed*t+off;
          float along = fract((th+spin)*(9.+3.*k)/6.2831853);
          float gap = smoothstep(0.,.08,along)*(1.-smoothstep(.72,.8,along));
          glow += power*opened*gap*exp(-(e/.07)*(e/.07))*(.6+.4*along)*2.;
          white += power*opened*gap*.9*exp(-abs(e-.05)/.01);
        } else {
          float twist = th+1.76*log(.22+r)-.17*dir*speed*t-.27*k+.12*sin(3.*th+.8*r)+.21*sin(2.*th-.28*k+.11*t)+off;
          float pleat = abs(sin(1.5*twist))*max(.18,r);
          float outer = (.65+bloom*1.43*size)*(1.+.11*sin(3.*th+.23*t));
          float reach = smoothstep(.17+k*.045,.49+k*.045,r)*(1.-smoothstep(outer-.63,outer,r));
          float rail = pleat-(.045+.024*k)*r, veil = exp(-pleat/(.105+.105*r));
          float flutes = .5+.5*cos(25.*pleat+1.6*sin(5.*th+3.2*r-.21*t));
          pupil *= 1.-.24*power*reach*veil;
          glow += power*reach*(veil*(.83+1.48*flutes*flutes)+.95*exp(-abs(rail)/.027));
          white += power*reach*(.40*exp(-abs(rail)/.016)+.085*veil*flutes);
        }
      } else if (form == 1.) {
        vec2 q = vec2(p.x-.10*k,(p.y+.07*k)*1.16);
        float rq = length(q), theta = atan(q.y,q.x+1.e-10);
        if (figure == 2.) {
          float ring = .5+.75*bloom*size+k*.2, e = rq-ring;
          float gone = .42*speed*max(0.,t-9.), rel = mod(dir*(theta-off),6.2831853);
          float lit = gone >= 6.2831853 ? 1. : 1.-smoothstep(gone-.05,gone,rel);
          float ticks = pow(max(0.,cos(48.*theta)),16.)*exp(-abs(e+.07)/.06);
          float major = pow(max(0.,cos(8.*theta)),40.)*exp(-abs(e+.11)/.1);
          glow += power*lit*(.6*exp(-abs(e)/.012)+1.3*ticks+1.6*major);
          float tip = abs(mod(rel-gone+3.14159265,6.2831853)-3.14159265);
          white += power*3.2*exp(-length(vec2(tip*ring,e))/.07);
          if (j == 0) pupil *= 1.-.5*power*(1.-smoothstep(-.3,0.,e));
        } else {
          float head = dir*.54*speed*(t-9.)-k*.68+off;
          float lag = mod(dir*(head-theta),6.2831853);
          float radius = .43+bloom*.66*size+k*.23+.055*sin(2.*theta+k);
          float edge = rq-radius+.014*sin(9.*theta-dir*t*.64);
          float trail = (1.-smoothstep(2.1,3.55,lag))*smoothstep(0.,.075,lag);
          float ticks = pow(max(0.,cos(24.*theta-k*.62)),12.);
          float core = exp(-abs(edge)/.023);
          glow += power*trail*(1.55*exp(-abs(edge)/.092)+core+1.58*ticks*exp(-abs(edge+.082)/.076));
          if (figure == 1.) glow += power*trail*.55*pow(.5+.5*cos(70.*theta+3.*k),24.)*smoothstep(.06,.2,rq)*(1.-smoothstep(radius-.08,radius,rq))*(.4+.6*rq/radius);
          float tip = min(lag,6.2831853-lag);
          white += power*(3.4*exp(-length(vec2(tip*radius,edge))/.077)+.45*core*trail);
        }
      } else if (figure == 1.) {
        float arms = 2.+floor(fract(seed*41.3)*2.99);
        float psi = dir*th-2.4*log(r+.08)+.55*speed*t+k*.9+off;
        float dd = abs(fract(psi*arms/6.2831853)-.5)*6.2831853/arms*r*.385;
        float far = (.25+1.25*bloom*size)*(1.+.1*k);
        float reach = smoothstep(.07,.2,r)*(1.-smoothstep(far-.45,far,r));
        float veil = exp(-dd/(.035+.07*r)), stream = .5+.5*cos(26.*log(r+.08)-3.*t+5.*psi);
        glow += power*reach*veil*(.7+2.2*stream*stream);
        white += power*reach*(1.6*exp(-dd/.008)+.12*veil*stream);
        if (j == 0) pupil *= 1.-.7*power*(1.-smoothstep(.1,.42,r));
      } else if (figure == 2.) {
        float ca = cos(th-dir*.07*speed*t-off), wing = pow(abs(ca),.7);
        float ring = (.3+1.05*bloom*size)*(1.+.12*k)*(1.+.42*ca*ca);
        float e = r-ring+.02*sin(7.*th-1.3*dir*t);
        float veil = exp(-abs(e)/(.05+.1*wing));
        fringe += power*wing*.9*exp(-abs(vec3(e-.04,e,e+.04))/.03);
        glow += power*wing*veil*.9;
        white += power*wing*1.4*exp(-abs(e)/.008);
        if (j == 0) pupil *= 1.-.75*power*(1.-smoothstep(-.3,.05,e));
      } else {
        float turn = th+dir*speed*t*(j == 1 ? -.18 : .13)+k*1.23+off;
        float radius = (.18+.94*bloom*size)*(1.+.13*k+.08*sin(2.*turn)+.035*sin(3.*turn+k));
        float edge = r-radius;
        if (j == 0) pupil *= 1.-.78*power*(1.-smoothstep(-.26,.06,edge));
        if (abs(edge) > .77) continue;
        float warp = edge+.026*sin(9.*turn+7.*edge-t*.34)+.012*sin(19.*turn+t*.71);
        float fold = .36+.64*(.5+.5*cos(3.*turn+4.*warp-k));
        float veil = exp(-abs(warp)/(.06+.115*fold));
        float stream = .5+.5*cos(38.*warp+3.*turn+1.45*sin(5.*turn+11.*warp));
        glow += power*fold*veil*(.60+2.65*stream*stream);
        float bolt = warp+.015*sin(21.*turn+t)+.006*sin(47.*turn-t*1.8);
        white += power*fold*(1.85*exp(-abs(bolt)/.009)+.17*veil*stream);
      }
    }
    vec4 st = eyeStorm(d, s.xyz, seed, dir, t, storm, power, open, tint.rgb, behind, px);
    float top = s.y-${g(EYE_SKY - KNOT_SHEET)}, shaft = 0.;
    if (form == 2.) {
      ${MASTS_GLSL}
    } else shaft = eyeBeam(d, s.xz, foot.x, top, power, phase, t, 1.);
    shaft *= (.5+.9*power)*open;
    light += transmission*(st.rgb+(st.a+${g(FIGURE_THROUGH)}*(1.-st.a))*(tint.rgb*glow+white+fringe))+tint.rgb*shaft+.3*power*min(1.,shaft*shaft);
    transmission *= pupil*st.a;
  }
  return vec4(light, transmission);
}`;


// The lowest tier has a flat sky and no sky table or cloud textures.
export const EYE_DOME_VERTEX = `#version 300 es
uniform mat4 uViewProj;
out vec3 vRay;
void main() {
  vec2 at = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2)) * 2.0 - 1.0;
  vRay = inverse(mat3(uViewProj[0].xyw, uViewProj[1].xyw, uViewProj[2].xyw)) * vec3(at, 1.);
  gl_Position = vec4(at, 1., 1.);
}`;

export const EYE_DOME_FRAGMENT = `#version 300 es
#define EYE_OCTAVES 2
precision highp float;
in vec3 vRay;
uniform vec3 uSky;
out vec4 o;
${FRAME_BLOCK}${EYE_SKY_GLSL}
void main() {
  vec4 lens = fHaze.z < 0. ? vec4(0., 0., 0., 1.) : eyeOptics(normalize(vRay), uSky);
  o = vec4(mix(uSky * lens.a, vec3(1.), 1. - exp(-lens.rgb)), 1.);
}`;
