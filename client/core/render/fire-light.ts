// Fire with no texture read (planning/workstreams/rocket.md): a rocket's flame on a lathed cone and a blast's fireball on
// lumpy spheres, each worked out from where a point is on its mesh, how its surface faces the eye, its age and its seed.
// One ramp turns a temperature into light: white, yellow, orange, deep red, and nothing at all for soot.
//
// A draw of fire (packet.ts DRAW_FIRE) is instances of `core:fire_cone` or `core:fire_lobe` (tools/pack/fire.ts). An
// instance's twenty bytes say where it is and how it burns (`putFlame`, `putLobe`), and the draw's effect says which of
// the two it is, a flame's phase of the frame, and a blast's soot's shade and its heat. The vertex text shapes the mesh: a flame's length flutters, a
// fireball's outline boils. The fragment text gives light already weighed by how much of it shows, and how much of what
// is behind it it hides, which is little for fire and most for the soot it cools to.
//
// The functions are written twice: GLSL for the card, and the same arithmetic in TypeScript for the software renderer
// (tools/snap/raster.ts) and the tests, which run the GLSL's own text against it.

import { INSTANCE_BYTES } from "../../../shared/pack/pack.ts";
import { NOISE_GLSL, tiled } from "../texgen/noise.ts";
import { FRAME, FRAME_BLOCK } from "./packet.ts";
import { AMBIENT, DIFFUSE } from "./shading.ts";

/** What a draw of fire is, in its effect's x: a rocket's flame or a lobe of a fireball. */
export const FIRE_FLAME = 0;
export const FIRE_LOBE = 1;

/** A flame's flutter, bands and flecks all come round in this long, so its phase never jumps. */
export const FLAME_TURN_MS = 2560;
/** A flame's widest, as a share of its length, and metres from its nozzle to its first shock diamond: the next are farther apart. */
export const FLAME_WIDE = 0.1;
export const DIAMOND = 0.12;
/** How much longer and wider a flame is as its motor lights. */
export const IGNITE_LONG = 0.8;
export const IGNITE_WIDE = 0.5;
/** A flame's length is told in these to a metre, and a lobe's radius in these. */
export const FLAME_STEPS = 32;
export const LOBE_STEPS = 2048;
/** How far under a lobe's middle the ground is, is told in these to one of its radii; LOBE_NO_FLOOR says there is none. */
export const FLOOR_STEPS = 64;
export const LOBE_NO_FLOOR = 255;
/** The share of its radius over the ground within which a lobe fades into it, so the ground does not cut it flat. */
export const FLOOR_FADE = 0.35;
/** How much of what is behind it a flame hides where it shows whole, a fireball's fire, and its soot. */
export const FLAME_HIDES = 0.9;
export const FIRE_HIDES = 0.85;
export const SOOT_HIDES = 0.55;
/** Noise cells across a lobe's radius, how far they drift up in a lobe's life, and how many before the noise repeats. */
export const LOBE_CELLS = 2.3;
export const LOBE_FLOW = 1.5;
export const LOBE_PERIOD = 16;
/** The share of a lobe's life it has by the time it is its full size. */
export const LOBE_SWELL = 0.16;

/** A cone vertex's colour byte at the seam's far side, a whole turn: under the palette's regions, and a multiple of every level's columns. */
export const CONE_TURN = 228;

const TAU = 6.2831853;
/** The cone's outline: its radius at `t` along it, from 0 at the nozzle to 1 at its tip, 1 at its widest; and its slope. */
const WIDEST = 0.8369;
export const coneRadius = (t: number): number => ((1 - t) * (0.35 + 2.6 * t)) / WIDEST;
export const coneSlope = (t: number): number => (2.25 - 5.2 * t) / WIDEST;

const clamp = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
const fract = (v: number): number => v - Math.floor(v);
const smooth = (a: number, b: number, v: number): number => {
  const t = clamp((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const f = (v: number): string => (Number.isInteger(v) ? `${v}.0` : String(v));

/** The frame's phase for its flames, radians: once round in FLAME_TURN_MS. */
export function flamePhase(ms: number): number {
  return ((ms % FLAME_TURN_MS) / FLAME_TURN_MS) * TAU;
}

/** The light of something `t` hot, 0 for soot to 1 for white heat, into `out`. */
export function fireRamp(t: number, out: Float64Array | number[]): void {
  const c = clamp(t), c3 = c * c * c;
  out[0] = 6 * c * Math.sqrt(c);
  out[1] = 5.2 * c3;
  out[2] = 3.6 * c3 * c3;
}

const hot = [0, 0, 0];

/**
 * GLSL for light `c` that is its own, a fire's or a glow's, as a light target takes it: the finish multiplies light by
 * the hour's grade and holds colour back or brings it out (post.ts), and this undoes both beforehand, so fire is shown
 * alike at noon and at night and as a display tier shows it. After FRAME_BLOCK.
 */
export const UNGRADED = (c: string): string => `max(mix(vec3(dot(${c}, vec3(0.2126, 0.7152, 0.0722))), ${c}, 1.0 / max(fGrade.a, 0.5)), 0.0) / max(fGrade.rgb, vec3(0.25))`;

/** How much brighter than a display's white what is white hot is drawn into a light target, so that bloom takes it. */
export const FIRE_BLOOMS = 5;

/**
 * What a display shows of the energy in `e` (a ramp's, in place): each channel pressed under 1. With `target` it is the
 * light that value stands for, which the finish's tone curve and coding (post.ts) show as a display tier does, so fire
 * keeps its hue and its dark cracks there; and what is white hot is brighter yet, for bloom to take.
 */
export function fireShown(e: Float64Array | number[], target: boolean): void {
  for (let c = 0; c < 3; c++) {
    const d = 1 - Math.exp(-e[c]!);
    e[c] = target ? d * d * (0.76 + 0.24 * d) : d;
  }
  if (!target) return;
  const more = 1 + FIRE_BLOOMS * e[2]! * e[2]!;
  for (let c = 0; c < 3; c++) e[c] = e[c]! * more;
}

/**
 * A point of a rocket's flame, into `out`: its light weighed by how much shows, and in out[3] how much of what is
 * behind it it hides. `around` is where the point is round the plume, 0 to 1, `along` from the nozzle to the tip,
 * `facing` how squarely its surface faces the eye, `axial` how nearly the eye looks down the plume, and `metres` its
 * length. With `target` the light is as the finish takes it; without, as a display shows it.
 */
export function flameLight(out: Float64Array | number[], around: number, along: number, facing: number, power: number, ignite: number, seed: number, axial: number, phase: number, metres: number, target: boolean): void {
  const s = TAU * seed;
  // Seen down its length a plume is deep everywhere, and alight to its tip.
  const down = axial * axial * axial * axial;
  const fuel = Math.max(clamp(1 - along), 0.9 * down);
  const ripple = Math.sin(TAU * around + 17 * along - 8 * phase + s);
  const depth = clamp(facing + 0.9 * axial * axial - 0.1 + 0.14 * along * ripple);
  // Shock diamonds: close set and bright by the nozzle, farther apart and fainter along it, travelling out.
  const run = (along * metres) / DIAMOND;
  const beat = 0.5 + 0.5 * Math.cos(TAU * Math.sqrt(run * Math.sqrt(run)) - 8 * phase + s);
  const cells = beat * beat * beat * fuel * fuel;
  const spine = clamp(1.7 * depth - 0.2);
  const core = fuel * fuel * spine * spine * (0.86 + 0.62 * cells * spine * spine) * (1 + 0.6 * ignite);
  // Five lanes round the plume, each carrying one fleck out with its own phase and width.
  const lanes = around * 5, lane = Math.floor(lanes);
  const variant = fract((lane + 1) * 0.618034 + seed);
  const age = fract(phase * (3 / TAU) + variant);
  const sx = (lanes - lane - 0.5 - 0.2 * Math.sin(age * 5 + lane)) / (0.1 + 0.08 * variant);
  const sy = (along - 0.2 - 0.8 * age) / (0.02 + 0.03 * variant);
  const fleck = clamp(1 - sx * sx - sy * sy) * 4 * age * (1 - age) * clamp(3 * depth);
  const body = fuel * fuel * (3 - 2 * fuel) * Math.min(0.98, 1.45 * depth * depth);
  const cover = power * Math.max(body, fleck);
  // White at the nozzle's middle, pale yellow and orange along it, red only where it is thin.
  fireRamp(0.34 + 0.8 * core + 0.4 * fleck, hot);
  // It gives more light than it hides, so its thin parts glow orange and red and are not a brown veil.
  const glows = cover * (2 - cover);
  fireShown(hot, target);
  for (let c = 0; c < 3; c++) out[c] = hot[c]! * glows;
  out[3] = cover * FLAME_HIDES;
}

/** Closed-form bands in place of the noise, 0 to 1, for a card that should not pay for the noise's hashes. */
export function lobeBands(u: number, v: number, seed: number): number {
  const s = TAU * seed;
  return 0.5 + 0.28 * Math.sin(1.9 * u + 2.2 * Math.sin(1.3 * v + s)) + 0.22 * Math.sin(2.7 * v - 1.1 * u + 2 * s);
}

/**
 * The engine's value noise at a lobe's cell (u, v), 0 to 1: with `fine` two octaves of it, without, one and a closed-form
 * ripple in the finer one's place, which costs a weak card half as much.
 */
export function lobeNoise(u: number, v: number, seed: number, fine = true): number {
  const k = Math.floor(seed * 255) + 7, s = TAU * seed;
  // Bent, and the finer octave turned, so the noise's square cells do not show.
  const wu = u + 0.45 * Math.sin(1.7 * v + s), wv = v + 0.45 * Math.sin(1.3 * u + 2.1 * s);
  const coarse = tiled(wu, wv, LOBE_PERIOD, LOBE_PERIOD, k);
  if (fine) return 0.62 * coarse + 0.38 * tiled(1.6 * wu - 1.2 * wv, 1.2 * wu + 1.6 * wv, 2 * LOBE_PERIOD, 2 * LOBE_PERIOD, k + 31);
  return 0.62 * coarse + 0.38 * (0.5 + 0.5 * Math.sin(3.3 * wu - 2.4 * wv + s) * Math.sin(2.9 * wv + 2.1 * wu - 1.7 * s));
}

/**
 * A point of a fireball's lobe, into `out` as `flameLight` gives a flame's. (u, v) is the point's cell of the noise,
 * `lift` how far it is over the ground in the lobe's radii, `age` the lobe's from 0 to 1, `heat` how hot it began,
 * `tone` its soot's shade, and (lr, lg, lb) the light that falls on the soot. It begins white, breaks into fire with a
 * ragged edge, cools to soot with glowing cracks, opens into holes and is gone. `noise` is the octaves of value noise it
 * reads, none for bands alone, and `lit` says the light is light and not a flat tier's shade.
 */
export function lobeLight(out: Float64Array | number[], u: number, v: number, facing: number, lift: number, age: number, heat: number, seed: number, tone: number, fade: number, lr: number, lg: number, lb: number, noise: number, target: boolean, lit: boolean): void {
  const n = noise > 0 ? lobeNoise(u, v, seed, noise > 1) : lobeBands(u, v, seed);
  const front = clamp(facing);
  // The outline is eaten into where the noise is low, deepest while it burns hardest, so it is never the mesh's own.
  const peak = smooth(0.03, 0.15, age) * (1 - smooth(0.35, 0.6, age));
  const edge = smooth(0.02, 0.8, front * (0.45 - 0.25 * peak + (1.1 + 0.8 * peak) * n));
  const flash = 1 - smooth(0, 0.07, age);
  const t = clamp(heat * (0.98 - 1.55 * age + 0.35 * (front - 0.5) * (1 - age)) + (0.5 + 2.2 * age) * (n - 0.5) + flash);
  const soot = 1 - smooth(0.02, 0.16, t);
  const going = 1.1 * smooth(0.45, 1, age);
  const keep = smooth(going - 0.12, going + 0.12, n) * (1 - smooth(0.9, 1, age));
  // It fades into the ground it stands on.
  const cover = edge * keep * fade * smooth(0, FLOOR_FADE, lift);
  fireRamp(t, hot);
  fireShown(hot, target);
  const light = [lr, lg, lb];
  // Where little of it shows it glows less than it hides, so its thin edge is no red fringe on the sky behind.
  const rim = 0.35 + 0.65 * Math.min(1, 2 * cover);
  for (let c = 0; c < 3; c++) {
    const dark = target ? tone * light[c]! : lit ? Math.sqrt(Math.min(1, tone * light[c]!)) : Math.sqrt(tone) * light[c]!;
    out[c] = cover * (hot[c]! * rim + dark * soot * SOOT_HIDES);
  }
  out[3] = cover * (FIRE_HIDES + (SOOT_HIDES - FIRE_HIDES) * soot);
}

/** What lights a lobe's soot, as a frame has it: read from the frame block on a lit tier, else low poly's sun and light. */
export interface FireSun {
  lit: boolean;
  /** The frame's values (packet.ts FRAME), for a lit tier. */
  frame: Float32Array;
  /** Low poly's unit way to the sun, and its light. */
  sun: ArrayLike<number>;
  light: number;
}

/** The light on soot whose surface faces (nx, ny, nz), into `out`: after exposure on a lit tier, a shade on low poly. */
export function sootLight(out: Float64Array | number[], nx: number, ny: number, nz: number, env: FireSun): void {
  if (!env.lit) {
    out[0] = out[1] = out[2] = (AMBIENT + DIFFUSE * Math.max(0, nx * env.sun[0]! + ny * env.sun[1]! + nz * env.sun[2]!)) * env.light;
    return;
  }
  const fr = env.frame, e = fr[FRAME.exposure]!;
  const sun = 0.3 + 0.7 * Math.max(0, nx * fr[FRAME.sun]! + ny * fr[FRAME.sun + 1]! + nz * fr[FRAME.sun + 2]!);
  const moon = 0.3 + 0.7 * Math.max(0, nx * fr[FRAME.moon]! + ny * fr[FRAME.moon + 1]! + nz * fr[FRAME.moon + 2]!);
  const up = 0.5 + 0.5 * ny;
  for (let c = 0; c < 3; c++) out[c] = e * (fr[FRAME.sunColor + c]! * sun + fr[FRAME.moonColor + c]! * moon + fr[FRAME.skyBelow + c]! + (fr[FRAME.skyAbove + c]! - fr[FRAME.skyBelow + c]!) * up);
}

/** A vertex as the vertex text leaves it: where it is from the eye, its two varying numbers, how it faces the eye, the light on it, and how far it is over the ground. */
export const FIRE_VERTEX_FLOATS = 10;
/** What is the same over an instance, as the vertex text hands it on: four numbers and two. */
export const fireFlat = new Float64Array(6);

const boil = new Float64Array(4);
/**
 * How far a lobe's outline is pushed out or in toward the unit way (dx, dy, dz), -1 to 1, in boil[0], and how that
 * changes with the way in boil[1..3]: four slow waves, each lobe's out of step with every other's.
 */
function lobeBoil(dx: number, dy: number, dz: number, age: number, seed: number): void {
  const a1 = 3.1 * dx + 2.3 * dy + 0.7 * dz + TAU * seed + 5 * age;
  const a2 = -1.3 * dx - 2.6 * dy + 2.9 * dz + TAU * fract(seed * 7.31) - 4 * age;
  const a3 = 2.1 * dx - 0.9 * dy - 4.2 * dz + TAU * fract(seed * 3.17) + 7 * age;
  const a4 = 5.3 * dx + 4.1 * dy - 3.7 * dz + TAU * fract(seed * 5.71) - 9 * age;
  boil[0] = 0.44 * Math.sin(a1) + 0.28 * Math.sin(a2) + 0.15 * Math.sin(a3) + 0.13 * Math.sin(a4);
  const c1 = 0.44 * Math.cos(a1), c2 = 0.28 * Math.cos(a2), c3 = 0.15 * Math.cos(a3), c4 = 0.13 * Math.cos(a4);
  boil[1] = 3.1 * c1 - 1.3 * c2 + 2.1 * c3 + 5.3 * c4;
  boil[2] = 2.3 * c1 - 2.6 * c2 - 0.9 * c3 + 4.1 * c4;
  boil[3] = 0.7 * c1 + 2.9 * c2 - 4.2 * c3 - 3.7 * c4;
}

/** A lobe's radius at `age` of its life as a share of its full one: out fast, then slowly on. */
export function lobeSwell(age: number): number {
  const k = 1 - clamp(age / LOBE_SWELL);
  return (0.22 + 0.78 * (1 - k * k * k)) * (1 + 0.3 * age);
}

/**
 * A lobe's vertex whose place on the unit sphere is (dx, dy, dz), into `out` (FIRE_VERTEX_FLOATS) and `fireFlat`. The
 * instance is at `at` of `bytes`, as `putLobe` wrote it.
 */
export function lobeVertex(out: Float64Array, dx: number, dy: number, dz: number, bytes: Uint8Array, at: number, env: FireSun): void {
  const view = new DataView(bytes.buffer, bytes.byteOffset + at, INSTANCE_BYTES);
  const cx = view.getFloat32(0, true), cy = view.getFloat32(4, true), cz = view.getFloat32(8, true);
  const radius = view.getUint16(12, true) / LOBE_STEPS;
  const age = (bytes[at + 14]! + bytes[at + 15]! * 256) / 65535;
  const seed = bytes[at + 16]! / 255;
  const l = Math.hypot(dx, dy, dz) || 1;
  dx /= l;
  dy /= l;
  dz /= l;
  lobeBoil(dx, dy, dz, age, seed);
  const lump = 0.2 + 0.08 * age, h = boil[0]!;
  const floor = bytes[at + 17]! === LOBE_NO_FLOOR ? 100 : bytes[at + 17]! / FLOOR_STEPS;
  const r = radius * (1 + lump * h);
  const along = dx * boil[1]! + dy * boil[2]! + dz * boil[3]!;
  let nx = dx * (1 + lump * h) - lump * (boil[1]! - dx * along);
  let ny = dy * (1 + lump * h) - lump * (boil[2]! - dy * along);
  let nz = dz * (1 + lump * h) - lump * (boil[3]! - dz * along);
  const nl = Math.hypot(nx, ny, nz) || 1;
  nx /= nl;
  ny /= nl;
  nz /= nl;
  const x = cx + r * dx, y = cy + r * dy, z = cz + r * dz;
  const d = Math.hypot(x, y, z) || 1;
  out[0] = x;
  out[1] = y;
  out[2] = z;
  out[5] = -(nx * x + ny * y + nz * z) / d;
  // The noise lies in the plane the eye sees the lobe in, so it has no pole and no seam.
  const cl = Math.hypot(cx, cy, cz) || 1;
  const wx = cx / cl, wy = cy / cl, wz = cz / cl;
  let rx = wz, rz = -wx;
  const rl = Math.hypot(rx, rz);
  if (rl < 1e-4) {
    rx = 1;
    rz = 0;
  } else {
    rx /= rl;
    rz /= rl;
  }
  const ux = wy * rz, uy = wz * rx - wx * rz, uz = -wy * rx;
  const front = clamp(-(dx * wx + dy * wy + dz * wz));
  const k = LOBE_CELLS * (1.35 - 0.35 * front) * (1 - 0.22 * age);
  out[3] = (dx * rx + dz * rz) * k + LOBE_PERIOD * fract(seed * 3.7);
  out[4] = (dx * ux + dy * uy + dz * uz) * k - LOBE_FLOW * age + LOBE_PERIOD * fract(seed * 9.1);
  sootLight(light3, nx, ny, nz, env);
  out[6] = light3[0]!;
  out[7] = light3[1]!;
  out[8] = light3[2]!;
  out[9] = (1 + lump * h) * dy + floor;
  fireFlat[0] = age;
  fireFlat[1] = bytes[at + 18]! / 255;
  fireFlat[2] = seed;
  fireFlat[3] = fireFlat[4] = fireFlat[5] = 0;
}
const light3 = [0, 0, 0];

/**
 * A flame's vertex, at (lx, ly, lz) of the cone as it is modelled and `around` it (0 to 1), into `out` and `fireFlat`.
 * The instance is at `at` of `bytes`, as `putFlame` wrote it, and `phase` is the frame's (`flamePhase`).
 */
export function flameVertex(out: Float64Array, lx: number, ly: number, lz: number, around: number, bytes: Uint8Array, at: number, phase: number): void {
  const view = new DataView(bytes.buffer, bytes.byteOffset + at, INSTANCE_BYTES);
  const px = view.getFloat32(0, true), py = view.getFloat32(4, true), pz = view.getFloat32(8, true);
  const seed = view.getUint16(12, true) / 65535;
  let ax = (bytes[at + 14]! - 128) / 127, ay = (bytes[at + 15]! - 128) / 127, az = (bytes[at + 16]! - 128) / 127;
  const al = Math.hypot(ax, ay, az) || 1;
  ax /= al;
  ay /= al;
  az /= al;
  const metres = bytes[at + 17]! / FLAME_STEPS;
  const power = bytes[at + 18]! / 255, ignite = bytes[at + 19]! / 255;
  const s = TAU * seed;
  const long = metres * (1 + IGNITE_LONG * ignite) * (1 + 0.1 * Math.sin(3 * phase + s) + 0.06 * Math.sin(7 * phase + 4.1 * s));
  const wide = metres * FLAME_WIDE * (1 + IGNITE_WIDE * ignite);
  // Across the plume: level and square to it, and the third way.
  let sx = az, sy = 0, sz = -ax;
  if (Math.abs(ay) > 0.9) {
    sx = 0;
    sy = -az;
    sz = ay;
  }
  const sl = Math.hypot(sx, sy, sz) || 1;
  sx /= sl;
  sy /= sl;
  sz /= sl;
  const ox = ay * sz - az * sy, oy = az * sx - ax * sz, oz = ax * sy - ay * sx;
  // Its tip wags.
  const wag = lz * lz * 0.05 * long;
  const u = lx * wide + wag * Math.sin(5 * phase + s), v = ly * wide + wag * Math.cos(4 * phase + 1.7 * s);
  const x = px + ax * lz * long + sx * u + ox * v;
  const y = py + ay * lz * long + sy * u + oy * v;
  const z = pz + az * lz * long + sz * u + oz * v;
  const rl = Math.hypot(lx, ly) || 1;
  const slope = (coneSlope(lz) * wide) / long;
  let nx = (sx * lx + ox * ly) / rl - ax * slope, ny = (sy * lx + oy * ly) / rl - ay * slope, nz = (sz * lx + oz * ly) / rl - az * slope;
  const nl = Math.hypot(nx, ny, nz) || 1;
  nx /= nl;
  ny /= nl;
  nz /= nl;
  const d = Math.hypot(x, y, z) || 1;
  out[0] = x;
  out[1] = y;
  out[2] = z;
  out[3] = around;
  out[4] = lz;
  out[5] = -(nx * x + ny * y + nz * z) / d;
  out[6] = out[7] = out[8] = 0;
  out[9] = 1;
  const pl = Math.hypot(px, py, pz) || 1;
  fireFlat[0] = power;
  fireFlat[1] = ignite;
  fireFlat[2] = seed;
  fireFlat[3] = Math.abs(ax * px + ay * py + az * pz) / pl;
  fireFlat[4] = phase;
  fireFlat[5] = long;
}

/**
 * Writes a flame as instance `i` of `bytes`: its nozzle at (x, y, z) from the eye, the unit way (dx, dy, dz) it blows,
 * `metres` long, `power` from 0 for out to 1, `ignite` from 1 as its motor lights to 0, and its seed from 0 to 1.
 */
export function putFlame(bytes: Uint8Array, i: number, x: number, y: number, z: number, dx: number, dy: number, dz: number, metres: number, power: number, ignite: number, seed: number): void {
  const at = i * INSTANCE_BYTES;
  const view = new DataView(bytes.buffer, bytes.byteOffset + at, INSTANCE_BYTES);
  view.setFloat32(0, x, true);
  view.setFloat32(4, y, true);
  view.setFloat32(8, z, true);
  view.setUint16(12, Math.round(clamp(seed) * 65535), true);
  bytes[at + 14] = Math.round(dx * 127) + 128;
  bytes[at + 15] = Math.round(dy * 127) + 128;
  bytes[at + 16] = Math.round(dz * 127) + 128;
  bytes[at + 17] = Math.max(1, Math.min(255, Math.round(metres * FLAME_STEPS)));
  bytes[at + 18] = Math.round(clamp(power) * 255);
  bytes[at + 19] = Math.round(clamp(ignite) * 255);
}

/**
 * Writes a fireball's lobe as instance `i` of `bytes`: its middle at (x, y, z) from the eye, its radius now in metres,
 * `age` of its life from 0 to 1, its seed, how far under its middle the ground is in metres (Infinity for none), and how
 * much of it shows, 0 to 1. Its soot's shade and its heat are its draw's (the effect's z and w).
 */
export function putLobe(bytes: Uint8Array, i: number, x: number, y: number, z: number, radius: number, age: number, seed: number, floor: number, fade: number): void {
  const at = i * INSTANCE_BYTES;
  const view = new DataView(bytes.buffer, bytes.byteOffset + at, INSTANCE_BYTES);
  view.setFloat32(0, x, true);
  view.setFloat32(4, y, true);
  view.setFloat32(8, z, true);
  view.setUint16(12, Math.min(65535, Math.round(radius * LOBE_STEPS)), true);
  const a = Math.round(clamp(age) * 65535);
  bytes[at + 14] = a & 255;
  bytes[at + 15] = a >> 8;
  bytes[at + 16] = Math.round(clamp(seed) * 255);
  const under = (floor / Math.max(radius, 1e-3)) * FLOOR_STEPS;
  bytes[at + 17] = under < LOBE_NO_FLOOR - 0.5 ? Math.max(0, Math.round(under)) : LOBE_NO_FLOOR;
  bytes[at + 18] = Math.round(clamp(fade) * 255);
  bytes[at + 19] = 0;
}

/** The ramp and the two looks in GLSL. A text defines LIGHT_TARGET, FIRE_LIT and FIRE_NOISE before it as its frame has them. */
export const FIRE_GLSL = `
vec3 fireRamp(float t) {
  float c = clamp(t, 0.0, 1.0);
  float c3 = c * c * c;
  return vec3(6.0 * c * sqrt(c), 5.2 * c3, 3.6 * c3 * c3);
}
float fireShown(float e) {
  float d = 1.0 - exp(-e);
#ifdef LIGHT_TARGET
  return d * d * (0.76 + 0.24 * d);
#else
  return d;
#endif
}
float fireBlooms(float blue) {
#ifdef LIGHT_TARGET
  return 1.0 + ${f(FIRE_BLOOMS)} * blue * blue;
#else
  return 1.0;
#endif
}
vec4 flameLight(float around, float along, float facing, float power, float ignite, float seed, float axial, float phase, float metres) {
  float s = ${f(TAU)} * seed;
  float down = axial * axial * axial * axial;
  float fuel = max(clamp(1.0 - along, 0.0, 1.0), 0.9 * down);
  float ripple = sin(${f(TAU)} * around + 17.0 * along - 8.0 * phase + s);
  float depth = clamp(facing + 0.9 * axial * axial - 0.1 + 0.14 * along * ripple, 0.0, 1.0);
  float run = along * metres / ${f(DIAMOND)};
  float beat = 0.5 + 0.5 * cos(${f(TAU)} * sqrt(run * sqrt(run)) - 8.0 * phase + s);
  float cells = beat * beat * beat * fuel * fuel;
  float spine = clamp(1.7 * depth - 0.2, 0.0, 1.0);
  float core = fuel * fuel * spine * spine * (0.86 + 0.62 * cells * spine * spine) * (1.0 + 0.6 * ignite);
  float lanes = around * 5.0;
  float lane = floor(lanes);
  float variant = fract((lane + 1.0) * 0.618034 + seed);
  float age = fract(phase * ${f(3 / TAU)} + variant);
  float sx = (lanes - lane - 0.5 - 0.2 * sin(age * 5.0 + lane)) / (0.1 + 0.08 * variant);
  float sy = (along - 0.2 - 0.8 * age) / (0.02 + 0.03 * variant);
  float fleck = clamp(1.0 - sx * sx - sy * sy, 0.0, 1.0) * 4.0 * age * (1.0 - age) * clamp(3.0 * depth, 0.0, 1.0);
  float body = fuel * fuel * (3.0 - 2.0 * fuel) * min(0.98, 1.45 * depth * depth);
  float cover = power * max(body, fleck);
  vec3 hot = fireRamp(0.34 + 0.8 * core + 0.4 * fleck);
  float blue = fireShown(hot.b);
  float glows = cover * (2.0 - cover) * fireBlooms(blue);
  return vec4(fireShown(hot.r) * glows, fireShown(hot.g) * glows, blue * glows, cover * ${f(FLAME_HIDES)});
}
float lobeGrain(float u, float v, float seed) {
  float s = ${f(TAU)} * seed;
#ifdef FIRE_NOISE
  int k = int(floor(seed * 255.0)) + 7;
  float wu = u + 0.45 * sin(1.7 * v + s);
  float wv = v + 0.45 * sin(1.3 * u + 2.1 * s);
  float coarse = tiled(wu, wv, ${LOBE_PERIOD}, ${LOBE_PERIOD}, k);
#ifdef FIRE_FINE
  return 0.62 * coarse + 0.38 * tiled(1.6 * wu - 1.2 * wv, 1.2 * wu + 1.6 * wv, ${2 * LOBE_PERIOD}, ${2 * LOBE_PERIOD}, k + 31);
#else
  return 0.62 * coarse + 0.38 * (0.5 + 0.5 * sin(3.3 * wu - 2.4 * wv + s) * sin(2.9 * wv + 2.1 * wu - 1.7 * s));
#endif
#else
  return 0.5 + 0.28 * sin(1.9 * u + 2.2 * sin(1.3 * v + s)) + 0.22 * sin(2.7 * v - 1.1 * u + 2.0 * s);
#endif
}
float lobeDark(float tone, float light) {
#ifdef LIGHT_TARGET
  return tone * light;
#else
#ifdef FIRE_LIT
  return sqrt(min(1.0, tone * light));
#else
  return sqrt(tone) * light;
#endif
#endif
}
vec4 lobeLight(float u, float v, float facing, float lift, float age, float heat, float seed, float tone, float fade, float lr, float lg, float lb) {
  float n = lobeGrain(u, v, seed);
  float front = clamp(facing, 0.0, 1.0);
  float peak = smoothstep(0.03, 0.15, age) * (1.0 - smoothstep(0.35, 0.6, age));
  float edge = smoothstep(0.02, 0.8, front * (0.45 - 0.25 * peak + (1.1 + 0.8 * peak) * n));
  float flash = 1.0 - smoothstep(0.0, 0.07, age);
  float t = clamp(heat * (0.98 - 1.55 * age + 0.35 * (front - 0.5) * (1.0 - age)) + (0.5 + 2.2 * age) * (n - 0.5) + flash, 0.0, 1.0);
  float soot = 1.0 - smoothstep(0.02, 0.16, t);
  float going = 1.1 * smoothstep(0.45, 1.0, age);
  float keep = smoothstep(going - 0.12, going + 0.12, n) * (1.0 - smoothstep(0.9, 1.0, age));
  float cover = edge * keep * fade * smoothstep(0.0, ${f(FLOOR_FADE)}, lift);
  vec3 hot = fireRamp(t);
  float blue = fireShown(hot.b);
  float more = fireBlooms(blue) * (0.35 + 0.65 * min(1.0, 2.0 * cover));
  float dim = soot * ${f(SOOT_HIDES)};
  return vec4(cover * (fireShown(hot.r) * more + lobeDark(tone, lr) * dim), cover * (fireShown(hot.g) * more + lobeDark(tone, lg) * dim), cover * (blue * more + lobeDark(tone, lb) * dim), cover * (${f(FIRE_HIDES)} + ${f(SOOT_HIDES - FIRE_HIDES)} * soot));
}
`;

/** Only what the lobe's noise reads of the engine's (texgen/noise.ts): its hash, `wrapi`, `ease` and `tiled`. */
const TILED_GLSL = NOISE_GLSL.slice(0, NOISE_GLSL.indexOf("float fbm("));

/**
 * The vertex text of the fire program. It reads a flat mesh's vertices and the instance's twenty bytes as any flat draw's
 * are bound, and takes them as `putFlame` and `putLobe` wrote them.
 */
export const FIRE_VERTEX = `#version 300 es
layout(location=0) in vec3 aPos;
layout(location=1) in uint aColor;
layout(location=2) in vec3 iPos;
layout(location=3) in float iYaw;
layout(location=4) in uvec4 iRegA;
layout(location=5) in uvec2 iRegB;
uniform mat4 uViewProj;
uniform vec3 uCenter, uHalf;
uniform vec4 uEffect;
#ifdef FIRE_LIT
${FRAME_BLOCK}#else
uniform vec3 uSun;
uniform float uLight;
#endif
out vec2 vUv;
out float vFacing, vLift;
out vec3 vLight;
flat out vec4 vA;
flat out vec2 vB;
vec3 sootLight(vec3 n) {
#ifdef FIRE_LIT
  float sun = 0.3 + 0.7 * max(dot(n, fSun.xyz), 0.0), moon = 0.3 + 0.7 * max(dot(n, fMoon.xyz), 0.0);
  return fSunColor.w * (fSunColor.rgb * sun + fMoonColor.rgb * moon + mix(fSkyBelow.rgb, fSkyAbove.rgb, 0.5 + 0.5 * n.y));
#else
  return vec3((${f(AMBIENT)} + ${f(DIFFUSE)} * max(dot(n, uSun), 0.0)) * uLight);
#endif
}
void main() {
  vec3 l = uCenter + aPos * uHalf;
  vec3 p;
  if (uEffect.x > 0.5) {
    float radius = iYaw * ${f(65535 / LOBE_STEPS)};
    float age = (float(iRegA.x) + float(iRegA.y) * 256.0) / 65535.0, seed = float(iRegA.z) / 255.0;
    float under = iRegA.w == ${LOBE_NO_FLOOR}u ? 100.0 : float(iRegA.w) / ${f(FLOOR_STEPS)};
    vec3 d = normalize(l);
    float a1 = dot(d, vec3(3.1, 2.3, 0.7)) + ${f(TAU)} * seed + 5.0 * age;
    float a2 = dot(d, vec3(-1.3, -2.6, 2.9)) + ${f(TAU)} * fract(seed * 7.31) - 4.0 * age;
    float a3 = dot(d, vec3(2.1, -0.9, -4.2)) + ${f(TAU)} * fract(seed * 3.17) + 7.0 * age;
    float a4 = dot(d, vec3(5.3, 4.1, -3.7)) + ${f(TAU)} * fract(seed * 5.71) - 9.0 * age;
    float h = 0.44 * sin(a1) + 0.28 * sin(a2) + 0.15 * sin(a3) + 0.13 * sin(a4);
    vec3 g = 0.44 * cos(a1) * vec3(3.1, 2.3, 0.7) + 0.28 * cos(a2) * vec3(-1.3, -2.6, 2.9) + 0.15 * cos(a3) * vec3(2.1, -0.9, -4.2) + 0.13 * cos(a4) * vec3(5.3, 4.1, -3.7);
    float lump = 0.2 + 0.08 * age;
    vec3 n = normalize(d * (1.0 + lump * h) - lump * (g - d * dot(d, g)));
    p = iPos + radius * (1.0 + lump * h) * d;
    vFacing = -dot(n, normalize(p));
    vec3 w = normalize(iPos);
    vec2 r = vec2(w.z, -w.x);
    float rl = length(r);
    r = rl < 1.0e-4 ? vec2(1.0, 0.0) : r / rl;
    vec3 up = vec3(w.y * r.y, w.z * r.x - w.x * r.y, -w.y * r.x);
    float k = ${f(LOBE_CELLS)} * (1.35 - 0.35 * clamp(-dot(d, w), 0.0, 1.0)) * (1.0 - 0.22 * age);
    vUv = vec2(dot(d.xz, r), dot(d, up)) * k + vec2(${f(LOBE_PERIOD)} * fract(seed * 3.7), ${f(LOBE_PERIOD)} * fract(seed * 9.1) - ${f(LOBE_FLOW)} * age);
    vLight = sootLight(n);
    vLift = (1.0 + lump * h) * d.y + under;
    vA = vec4(age, float(iRegB.x) / 255.0, seed, 0.0);
    vB = vec2(0.0);
  } else {
    vec3 axis = normalize((vec3(iRegA.xyz) - 128.0) / 127.0);
    float metres = float(iRegA.w) / ${f(FLAME_STEPS)}, power = float(iRegB.x) / 255.0, ignite = float(iRegB.y) / 255.0;
    float phase = uEffect.y, s = ${f(TAU)} * iYaw;
    float reach = metres * (1.0 + ${f(IGNITE_LONG)} * ignite) * (1.0 + 0.1 * sin(3.0 * phase + s) + 0.06 * sin(7.0 * phase + 4.1 * s));
    float wide = metres * ${f(FLAME_WIDE)} * (1.0 + ${f(IGNITE_WIDE)} * ignite);
    vec3 side = normalize(abs(axis.y) > 0.9 ? vec3(0.0, -axis.z, axis.y) : vec3(axis.z, 0.0, -axis.x));
    vec3 over = cross(axis, side);
    float wag = l.z * l.z * 0.05 * reach;
    vec2 q = l.xy * wide + wag * vec2(sin(5.0 * phase + s), cos(4.0 * phase + 1.7 * s));
    p = iPos + axis * (l.z * reach) + side * q.x + over * q.y;
    vec2 rim = l.xy / max(length(l.xy), 1.0e-6);
    vec3 n = normalize(side * rim.x + over * rim.y - axis * (${f(2.25 / WIDEST)} - ${f(5.2 / WIDEST)} * l.z) * wide / reach);
    vFacing = -dot(n, normalize(p));
    vUv = vec2(float(aColor) / ${f(CONE_TURN)}, l.z);
    vLight = vec3(0.0);
    vLift = 1.0;
    vA = vec4(power, ignite, iYaw, abs(dot(axis, normalize(iPos))));
    vB = vec2(phase, reach);
  }
  gl_Position = uViewProj * vec4(p, 1.0);
}`;

/** The fragment text of the fire program. In the far depth range what the near one drew adds nothing (glsl.ts SEE_THROUGH_SPLIT). */
export const FIRE_FRAGMENT = `#version 300 es
precision highp float;
precision highp int;
in vec2 vUv;
in float vFacing, vLift;
in vec3 vLight;
flat in vec4 vA;
flat in vec2 vB;
uniform vec4 uEffect;
uniform float uFrom;
out vec4 o;
#ifdef LIGHT_TARGET
${FRAME_BLOCK}#endif
#ifdef FIRE_NOISE
${TILED_GLSL}#endif
${FIRE_GLSL}void main() {
  float z = 1.0 / gl_FragCoord.w;
  if (z + 0.5 * fwidth(z) < uFrom) discard;
  o = uEffect.x > 0.5 ? lobeLight(vUv.x, vUv.y, vFacing, vLift, vA.x, uEffect.w, vA.z, uEffect.z, vA.y, vLight.r, vLight.g, vLight.b)
    : flameLight(vUv.x, vUv.y, vFacing, vA.x, vA.y, vA.z, vA.w, vB.x, vB.y);
#ifdef LIGHT_TARGET
  o.rgb = ${UNGRADED("o.rgb")};
#endif
}`;
