// World-space sky optics. Over each instrument a beam leaves its emitter, enters a storm cell 3,300 m up and feeds a
// figure of light on three sheets above it. Positions are relative to the actual observer, including a rider above the
// crown.
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
/** Metres over the datum of the figure's first sheet, and how far under it the storm cell's sheet is. */
export const EYE_SKY = 3450;
const CELL_UNDER = 150;
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
/** How bright an instrument's own lights are at a camera-relative point: the nearest lit site's breath, the bands that climb it as it charges, its surge, and a flicker with each strike. 1 with no site lit. */
export function eyePulse(frame: Float32Array, x: number, y: number, z: number): number {
  let best = Infinity, pulse = 1;
  for (let i = 0; i < EYE_SLOTS; i++) {
    const at = FRAME.eyes + i * EYE_FLOATS, stamp = frame[at + 3]!;
    if (stamp <= 0) continue;
    const dx = x - frame[at]!, dz = z - frame[at + 2]!, dd = dx * dx + dz * dz;
    if (dd >= best) continue;
    best = dd;
    const phase = mod(stamp, EYE_PERIOD), t = frame[at + 8]!, power = frame[at + 7]!, open = frame[at + 15]!;
    const up = clamp(1 - (frame[at + 12]! - y) / 660);
    const charge = sstep(4, 9, phase) * (1 - sstep(9, 13, phase));
    const breath = 0.78 + 0.14 * Math.sin(1.25 * t);
    // Bands of light climb the instrument to its emitter; on the deck, far under it, they run in to the console.
    const climb = Math.pow(0.5 + 0.5 * Math.sin(up < 0.03 ? Math.sqrt(dd) * 0.13 + (2.2 + 5 * charge) * t : 26 * up - (2.2 + 5 * charge) * t), 3);
    pulse = open * (breath + (0.25 + 0.9 * charge) * climb + 0.35 * power + 1.3 * strike(t, frame[at + 10]!, power, frame[at + 11]!, open, struck));
  }
  return pulse;
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

const NO_AMBIENT = [0, 0, 0];
// Called only on unobstructed sky pixels. Adds a ray's light to `out` and returns how much of the sky behind shows.
// `ambient` is the light a cloud up there would show, in the units `out` is in.
export function eyeRadiance(frame: Float32Array, ray: ArrayLike<number>, out: Float64Array, ambient: ArrayLike<number> = NO_AMBIENT, octaves = OCTAVES): number {
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
    // The storm cell under it: a swirl of cloud, a knot at its middle, and lightning.
    const top = sky - CELL_UNDER, sd = top / dy;
    const qx = (dx * sd - x) / 1000, qz = (dz * sd - z) / 1000, rq = Math.hypot(qx, qz);
    let cover = 0, thick = 0, flash = 0, fork = 0;
    if (storm > 0.001 && sd > 0 && rq < 3.4) {
      const ang = dir * 0.03 * t + 1.3 * Math.log(rq + 0.25), ca = Math.cos(ang), sa = Math.sin(ang);
      const n = 0.7 * fbm((ca * qx - sa * qz) * 1.9 + seed * 37, (sa * qx + ca * qz) * 1.9 + seed * 37, 3, octaves)
        + 0.3 * fbm(qx * 4.3 - dir * 0.021 * t + 11, qz * 4.3 - dir * 0.013 * t + 11, 9, octaves);
      const reach = 1.2 + 1.5 * sstep(5, 12, t), th = mix(0.66, 0.4, storm) + 0.2 * rq / reach;
      const body = n + 0.5 * (1 - sstep(0.16, 0.5, rq));
      cover = sstep(th, th + 0.26, body) * (1 - sstep(reach * 0.72, reach, rq)) * Math.min(1, storm * 3);
      thick = clamp((body - th) / 0.42);
      const lit = strike(t, seed, power, storm, open, struck);
      if (lit > 0) {
        const id = struck.id;
        const ax = (eyeHash(id, 11, 2) - 0.5) * 1.5 * reach, az = (eyeHash(id, 13, 2) - 0.5) * 1.5 * reach;
        flash = lit * Math.exp(-Math.hypot(qx - ax, qz - az) / 0.5);
        if (octaves > 2) {
          // A bolt crawls from the knot out toward the strike, never quite straight, and forks part way.
          const a0 = Math.atan2(qz, qx + 1e-10) - Math.atan2(az, ax + 1e-10), a = Math.atan2(Math.sin(a0), Math.cos(a0));
          const len = Math.hypot(ax, az) + 0.25;
          const wob = (noise(rq * 9, id * 3.1, 5) - 0.5) * 0.34 + (noise(rq * 31, id * 1.7, 6) - 0.5) * 0.1;
          const across = Math.abs(a * rq + wob * sstep(0, 0.3, rq));
          const branch = Math.abs((a - 0.35 * sstep(len * 0.35, len, rq)) * rq + wob * 0.8);
          const run = sstep(0.03, 0.1, rq) * (1 - sstep(len * 0.85, len, rq));
          fork = lit * run * (Math.exp(-across / 0.006) + 0.6 * Math.exp(-branch / 0.005) * (rq >= len * 0.35 ? 1 : 0));
        }
      }
    }
    // The beam, in front of all that: one from the emitter, or the Lantern's three from its masts.
    let shaft = 0;
    const lit = (0.5 + 0.9 * power) * open;
    if (form === 2) for (let b = 0; b < LANTERN_MASTS.length; b++) {
      const mx = LANTERN_MASTS[b]![0], mz = LANTERN_MASTS[b]![1];
      shaft += beam(dx, dy, dz, x + mx * cs + mz * sn, z - mx * sn + mz * cs, footY, top, power, phase, t, 0.7);
    }
    else shaft = beam(dx, dy, dz, x, z, footY, top, power, phase, t, 1);
    shaft *= lit;
    const under = open * 0.9 * Math.exp(-rq / 0.3) * (0.35 + 0.65 * thick) + power * 0.7 * (1 - thick) * (1 - thick);
    for (let c = 0; c < 3; c++) {
      const figureLight = tint[c]! * glow + white + fringe[c]!;
      const cloud = ambient[c]! * (0.5 - 0.38 * thick) + tint[c]! * under + ([0.72, 0.8, 1][c]! + 0.35 * tint[c]!) * flash * 2.4;
      out[c]! += transmission * (figureLight * (1 - 0.85 * cover) + cloud * cover + ([0.85, 0.9, 1][c]! + 0.3 * tint[c]!) * fork) + tint[c]! * shaft + 0.3 * power * Math.min(1, shaft * shaft);
    }
    transmission *= pupil * (1 - cover);
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

/** `eyePulse` as GLSL, after the frame block and EYE_STRIKE_GLSL. */
export const EYE_PULSE_GLSL = `
float eyePulse(vec3 rel) {
  float best = 1.e30, pulse = 1.;
  for (int i=0; i<3; i++) {
    vec4 s = fEyes[i*4], tint = fEyes[i*4+1], life = fEyes[i*4+2], foot = fEyes[i*4+3];
    vec2 away = rel.xz-s.xz;
    float dd = dot(away,away);
    if (s.w <= 0. || dd >= best) continue;
    best = dd;
    float phase = mod(s.w,120.), t = life.x, id;
    float up = clamp(1.-(foot.x-rel.y)/660.,0.,1.);
    float charge = smoothstep(4.,9.,phase)*(1.-smoothstep(9.,13.,phase));
    float climb = pow(.5+.5*sin(up < .03 ? sqrt(dd)*.13+(2.2+5.*charge)*t : 26.*up-(2.2+5.*charge)*t),3.);
    pulse = foot.w*(.78+.14*sin(1.25*t)+(.25+.9*charge)*climb+.35*tint.w+1.3*eyeStrike(t,life.z,tint.w,life.w,foot.w,id));
  }
  return pulse;
}`;

export const EYE_SKY_GLSL = `${EYE_STRIKE_GLSL}
float eyeNoise(vec2 p, float k) {
  vec2 c = floor(p), f = p-c;
  f = f*f*(3.-2.*f);
  return mix(mix(eyeHash(c,k),eyeHash(c+vec2(1.,0.),k),f.x),mix(eyeHash(c+vec2(0.,1.),k),eyeHash(c+vec2(1.,1.),k),f.x),f.y);
}
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
vec4 eyeOptics(vec3 d, vec3 ambient) {
  vec3 light = vec3(0.);
  float transmission = 1.;
  if (fEyes[0].w <= 0. || d.y <= .002) return vec4(light, transmission);
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
    float top = s.y-${g(CELL_UNDER)}, sd = top/d.y;
    vec2 q = (d.xz*sd-s.xz)*.001;
    float rq = length(q), cover = 0., thick = 0., flash = 0., fork = 0.;
    if (storm > .001 && sd > 0. && rq < 3.4) {
      float ang = dir*.03*t+1.3*log(rq+.25), ca = cos(ang), sa = sin(ang);
      float n = .7*eyeFbm(vec2(ca*q.x-sa*q.y,sa*q.x+ca*q.y)*1.9+seed*37.,3.)+.3*eyeFbm(q*4.3-dir*vec2(.021,.013)*t+11.,9.);
      float reach = 1.2+1.5*smoothstep(5.,12.,t), th = mix(.66,.4,storm)+.2*rq/reach;
      float body = n+.5*(1.-smoothstep(.16,.5,rq));
      cover = smoothstep(th,th+.26,body)*(1.-smoothstep(reach*.72,reach,rq))*min(1.,storm*3.);
      thick = clamp((body-th)/.42,0.,1.);
      float id, lit = eyeStrike(t,seed,power,storm,open,id);
      if (lit > 0.) {
        vec2 at = (vec2(eyeHash(vec2(id,11.),2.),eyeHash(vec2(id,13.),2.))-.5)*1.5*reach;
        flash = lit*exp(-length(q-at)/.5);
#if EYE_OCTAVES > 2
        float a0 = atan(q.y,q.x+1.e-10)-atan(at.y,at.x+1.e-10), a = atan(sin(a0),cos(a0));
        float len = length(at)+.25;
        float wob = (eyeNoise(vec2(rq*9.,id*3.1),5.)-.5)*.34+(eyeNoise(vec2(rq*31.,id*1.7),6.)-.5)*.1;
        float across = abs(a*rq+wob*smoothstep(0.,.3,rq));
        float branch = abs((a-.35*smoothstep(len*.35,len,rq))*rq+wob*.8);
        float run = smoothstep(.03,.1,rq)*(1.-smoothstep(len*.85,len,rq));
        fork = lit*run*(exp(-across/.006)+.6*exp(-branch/.005)*step(len*.35,rq));
#endif
      }
    }
    float shaft = 0.;
    if (form == 2.) {
      ${MASTS_GLSL}
    } else shaft = eyeBeam(d, s.xz, foot.x, top, power, phase, t, 1.);
    shaft *= (.5+.9*power)*open;
    vec3 cloud = ambient*(.5-.38*thick)+tint.rgb*(open*.9*exp(-rq/.3)*(.35+.65*thick)+power*.7*(1.-thick)*(1.-thick))+(vec3(.72,.8,1.)+.35*tint.rgb)*flash*2.4;
    light += transmission*((tint.rgb*glow+white+fringe)*(1.-.85*cover)+cloud*cover+(vec3(.85,.9,1.)+.3*tint.rgb)*fork)+tint.rgb*shaft+.3*power*min(1.,shaft*shaft);
    transmission *= pupil*(1.-cover);
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
  vec4 lens = fHaze.z < 0. ? vec4(0., 0., 0., 1.) : eyeOptics(normalize(vRay), uSky * .8);
  o = vec4(mix(uSky * lens.a, vec3(1.), 1. - exp(-lens.rgb)), 1.);
}`;
