// An orb's screen (shared/world/orb.ts): a great ball whose skin shows scenes, or a video (the screen scene, below). A
// scene is played from no picture: each pixel works its colour out from where it is on the ball (a unit vector in the
// orb's own frame), the scene's clock and the pixel's footprint. A scene treats the ball as a ball, has no seam and no pole, and drops its fine detail as the
// footprint grows, so it costs less and does not shimmer far off.
//
// Close up the picture is LED pucks on a brick grid of rings with a dark trellis between; a change of scene is a front
// that crosses the skin and shows one scene or the other at a pixel, never both; and the screen's level follows the
// frame's exposure, so it reads at noon and blooms at night. By night the ball lights what is round it in the colour of
// what it shows, and what mirrors shows the ball in that colour at any hour (OrbCast, orb-light.ts).
//
// Everything is written twice: GLSL for the program `orb` (programs.ts), and the same arithmetic in TypeScript for the
// software renderer (tools/snap/raster.ts), the tests and the contact sheet (tools/orb/sheet.ts). This file comes after
// the first frame (orb-late.ts).

import type { SupplyList } from "../../../shared/sim/supply.ts";
import { POSE_BRAKING, POSE_FLYING, POSE_LANDED, newPose, supplyPose } from "../../../shared/sim/supply.ts";
import { trackColour } from "../../../shared/video/clip.ts";
import { ORB_HOLD, ORB_WIPE, orbShow, type OrbShow, type OrbSite } from "../../../shared/world/orb.ts";
import { CAST_PHASE, EYE_PERIOD, eyeKnot, type TideEyeSite } from "../../../shared/world/tide-eye.ts";
import { linearToSrgb, srgbToLinear } from "./color-space.ts";
import { ORB_COLOUR, ORB_SEEN } from "./orb-light.ts";
import { FRAME, FRAME_BLOCK, ORB_AT, ORB_LANES } from "./packet.ts";
import { sunDirection } from "./sky.ts";
import { GRADED, TONE, graded, tone } from "./surface.ts";
import { EYE_SKY, aperture, eyePhase, eyePower, eyeSeed, eyeStorm, strike } from "./tide-eye.ts";

/** The radius the shell's mesh is made at, in metres. */
export const ORB_SHELL = 78;
/** The Watcher's look is held between these, as the sine of its height over level: about 25 degrees up and 12 down. */
export const GAZE_LIFT = 0.42, GAZE_DIP = -0.2;
/** Metres past which the ball is drawn at its coarsest level: it is under a hundred pixels across there. */
export const ORB_FAR = 2000;
/** Octaves of a scene's noise where a tier does not say (`#define ORB_OCTAVES`). */
export const ORB_OCTAVES = 4;

// ---- The level: the screen's white as light after exposure, by the frame's exposure. Tune these from real frames.
/** White at noon, when exposure is 1: under bloom's threshold, pucks and all, so the picture reads in the sun. */
export const ORB_NOON = 1.15;
/** White on a dark night: at bloom's threshold, so a scene's whites and what it makes brighter than white glow, and its colours are not washed out. */
export const ORB_NIGHT = 2;
/** The stops of exposure over noon's between which the level rises from the one to the other. */
export const ORB_DAY_STOPS = 1.5;
export const ORB_NIGHT_STOPS = 9;
/** White on low poly, which has no exposure and shows it through the tone curve alone. */
export const ORB_FLAT = 1;

// ---- The pucks.
/** Metres between pucks along a ring, and between rings. */
export const PUCK = 0.4;
/** A puck's radius as a share of that. */
export const PUCK_FILL = 0.44;
/** Pixels a puck spans under which the grid is not drawn, and from which it is drawn in full. */
export const PUCK_FROM = 1.5;
export const PUCK_TO = 3;
/** What the trellis between pucks gives back of the day's light, as light after exposure. */
export const TRELLIS = 0.05;
/** How much brighter a puck is than the plain picture, so near and far are as bright: the grid's cell over the puck's disc. */
const PUCK_GAIN = 1 / (Math.PI * PUCK_FILL * PUCK_FILL);

/** Seconds a scene's clock is moved on by for each showing, so no two showings are alike, and the clock's wrap while one scene is held for good. */
const CLOCK_SPREAD = 900;
const HELD_WRAP = 1920;
/** The iris's edge and the slit's half height, as sines of the angle from where the eye looks, and how far the lids stand open. */
const IRIS = 0.66;
const SLIT = 0.44;
const LID = 0.82;

const TAU = 2 * Math.PI;
const clamp = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
const mix = (a: number, b: number, t: number): number => a + (b - a) * t;
const sstep = (a: number, b: number, x: number): number => {
  const t = clamp((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

const A = 0x9e3779b1, B = 0x85ebca77, C = 0xc2b2ae3d, D = 0x27d4eb2f, E = 0x2c1b3c6d, F = 0x297a2d39;
/** A cell of whole numbers and a key as 32 bits, as the shader has them. */
export function orbBits(x: number, y: number, z: number, k: number): number {
  let h = (Math.imul(x | 0, A) ^ Math.imul(y | 0, B) ^ Math.imul(z | 0, C) ^ Math.imul(k | 0, D)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), E) >>> 0;
  h = Math.imul(h ^ (h >>> 12), F) >>> 0;
  return (h ^ (h >>> 15)) >>> 0;
}
/** 0 to 1 from a cell and a key. */
export function orbHash(x: number, y: number, z: number, k: number): number {
  return (orbBits(x, y, z, k) >>> 8) / 16777216;
}
/** Value noise in space, 0 to 1: a point on the ball reads it where it is, so it has no seam. */
export function orbNoise(x: number, y: number, z: number, k: number): number {
  const cx = Math.floor(x), cy = Math.floor(y), cz = Math.floor(z);
  let fx = x - cx, fy = y - cy, fz = z - cz;
  fx = fx * fx * (3 - 2 * fx);
  fy = fy * fy * (3 - 2 * fy);
  fz = fz * fz * (3 - 2 * fz);
  const near = mix(mix(orbHash(cx, cy, cz, k), orbHash(cx + 1, cy, cz, k), fx), mix(orbHash(cx, cy + 1, cz, k), orbHash(cx + 1, cy + 1, cz, k), fx), fy);
  const far = mix(mix(orbHash(cx, cy, cz + 1, k), orbHash(cx + 1, cy, cz + 1, k), fx), mix(orbHash(cx, cy + 1, cz + 1, k), orbHash(cx + 1, cy + 1, cz + 1, k), fx), fy);
  return mix(near, far, fz);
}
/** How much of a noise of `cells` to a unit of direction is kept at a footprint: all of it, to none once a pixel spans half a cell. */
const keepAt = (cells: number, fp: number): number => 1 - sstep(0.25, 0.5, cells * fp);
/** Noise heaped in octaves about a half, each dropped as the footprint reaches it; `cells` is the first octave's to a unit. */
function fbm(x: number, y: number, z: number, k: number, cells: number, fp: number, octaves: number): number {
  let a = 0.5, s = 0;
  for (let o = 0; o < octaves; o++) {
    const keep = keepAt(cells, fp);
    if (keep <= 0) break;
    s += a * (orbNoise(x, y, z, k + o) - 0.5) * keep;
    x = x * 2.03 + 17.3;
    y = y * 2.03 + 9.1;
    z = z * 2.03 + 5.7;
    cells *= 2.03;
    a *= 0.5;
  }
  return 0.5 + s / (1 - Math.pow(2, -octaves));
}
/** A step at `e`, never sharper than `w` or the footprint. */
const edge = (e: number, x: number, w: number, fp: number): number => {
  const h = Math.max(w, fp);
  return sstep(e - h, e + h, x);
};
/** A line of half width `w`, `d` from its middle: as the footprint passes its width it widens and dims, keeping its light. */
const line = (d: number, w: number, fp: number): number => {
  const h = Math.max(w, fp);
  return (Math.exp((-d * d) / (h * h)) * w) / h;
};
const cell = [0, 0, 0];
/**
 * The cells round a place's own past the eight nearest it, three numbers each: along each axis the place's own cell (0),
 * its neighbour on the side the place is nearer (1) or on the far side (-1). Those with fewest far sides come first.
 */
const FAR_CELLS: number[] = [];
for (let far = 1; far <= 3; far++) {
  for (let i = 0; i < 27; i++) {
    const o = [(i % 3) - 1, (Math.floor(i / 3) % 3) - 1, Math.floor(i / 9) - 1];
    if (o.filter((v) => v < 0).length === far) FAR_CELLS.push(o[0]!, o[1]!, o[2]!);
  }
}
let nearest = 1, second = 1, nearestIs = 0;
/** Takes the point of cell (cx, cy, cz) into the nearest two of the place (x, y, z). */
function cellPoint(cx: number, cy: number, cz: number, k: number, x: number, y: number, z: number): void {
  const h = orbBits(cx, cy, cz, k);
  const dx = cx + (h & 255) / 255 - x, dy = cy + ((h >>> 8) & 255) / 255 - y, dz = cz + ((h >>> 16) & 255) / 255 - z;
  const d = dx * dx + dy * dy + dz * dz;
  if (d < nearest) {
    second = nearest;
    nearest = d;
    nearestIs = (h >>> 24) / 255;
  } else if (d < second) second = d;
}
/**
 * Points scattered one to a cell of space: how far the nearest and the next nearest are from a place, in cells, and the
 * nearest's own number, 0 to 1, into `cell`. Where the two are as far, the place is on the wall between their plates.
 *
 * Every point within a cell's width of the place is in the 27 cells round its own, so the two distances, held to 1 at
 * the most, are those of all space and change smoothly from cell to cell. The eight cells nearest the place are looked
 * at first; each of the other 19 only where its nearest corner is nearer than the second point found, which is some
 * five of them.
 */
function cells(x: number, y: number, z: number, k: number): void {
  const bx = Math.floor(x), by = Math.floor(y), bz = Math.floor(z);
  const sx = x - bx < 0.5 ? -1 : 1, sy = y - by < 0.5 ? -1 : 1, sz = z - bz < 0.5 ? -1 : 1;
  nearest = second = 1;
  nearestIs = 0;
  for (let i = 0; i < 8; i++) cellPoint(bx + sx * (i & 1), by + sy * ((i >> 1) & 1), bz + sz * (i >> 2), k, x, y, z);
  // How far the far side's cell is along each axis; the near side's is the rest of a cell's width.
  const gx = 0.5 + Math.abs(x - bx - 0.5), gy = 0.5 + Math.abs(y - by - 0.5), gz = 0.5 + Math.abs(z - bz - 0.5);
  if (Math.min(gx, gy, gz) ** 2 < second) {
    for (let i = 0; i < FAR_CELLS.length; i += 3) {
      const ox = FAR_CELLS[i]!, oy = FAR_CELLS[i + 1]!, oz = FAR_CELLS[i + 2]!;
      const ax = ox < 0 ? gx : ox * (1 - gx), ay = oy < 0 ? gy : oy * (1 - gy), az = oz < 0 ? gz : oz * (1 - gz);
      if (ax * ax + ay * ay + az * az < second) cellPoint(bx + sx * ox, by + sy * oy, bz + sz * oz, k, x, y, z);
    }
  }
  cell[0] = Math.sqrt(nearest);
  cell[1] = Math.sqrt(second);
  cell[2] = nearestIs;
}
/** `cells` for a test: the nearest's distance, the next nearest's and the nearest's number, into `out`. */
export function orbCells(x: number, y: number, z: number, k: number, out: number[]): void {
  cells(x, y, z, k);
  out[0] = cell[0]!;
  out[1] = cell[1]!;
  out[2] = cell[2]!;
}
/** A crater in each cell of space the ball passes through, as a change of its ground's brightness: a dark floor and a bright rim. */
function craters(x: number, y: number, z: number, k: number, per: number, fp: number): number {
  const cx = Math.floor(x), cy = Math.floor(y), cz = Math.floor(z), h = orbBits(cx, cy, cz, k);
  const r = 0.12 + 0.16 * orbHash(cx, cy, cz, k + 1);
  const d = Math.hypot(x - cx - 0.3 - (0.4 * (h & 255)) / 255, y - cy - 0.3 - (0.4 * ((h >>> 8) & 255)) / 255, z - cz - 0.3 - (0.4 * ((h >>> 16) & 255)) / 255) / r;
  const soft = (fp * per) / r;
  return (0.2 * line(d - 0.92, 0.09, soft) - 0.1 * (1 - edge(0.85, d, 0.05, soft))) * keepAt(per * 1.5, fp);
}

const g = (v: number): string => (Number.isInteger(v) ? `${v}.` : String(v));

/** The kit as GLSL, after the frame block. */
const KIT_GLSL = `
#ifndef ORB_OCTAVES
#define ORB_OCTAVES ${ORB_OCTAVES}
#endif
uint orbBits(vec3 c, float k) {
  uint h = uint(int(c.x))*${A}u ^ uint(int(c.y))*${B}u ^ uint(int(c.z))*${C}u ^ uint(int(k))*${D}u;
  h = (h ^ (h >> 15u))*${E}u;
  h = (h ^ (h >> 12u))*${F}u;
  return h ^ (h >> 15u);
}
float orbHash(vec3 c, float k) {
  return float(orbBits(c,k) >> 8u)/16777216.;
}
vec3 orbBytes(uint h) {
  return vec3(float(h & 255u),float((h >> 8u) & 255u),float((h >> 16u) & 255u))/255.;
}
float orbNoise(vec3 p, float k) {
  vec3 c = floor(p), f = p-c;
  f = f*f*(3.-2.*f);
  float lo = mix(mix(orbHash(c,k),orbHash(c+vec3(1.,0.,0.),k),f.x),mix(orbHash(c+vec3(0.,1.,0.),k),orbHash(c+vec3(1.,1.,0.),k),f.x),f.y);
  float hi = mix(mix(orbHash(c+vec3(0.,0.,1.),k),orbHash(c+vec3(1.,0.,1.),k),f.x),mix(orbHash(c+vec3(0.,1.,1.),k),orbHash(c+vec3(1.,1.,1.),k),f.x),f.y);
  return mix(lo,hi,f.z);
}
float orbKeep(float cells, float fp) {
  return 1.-smoothstep(.25,.5,cells*fp);
}
float orbFbm(vec3 p, float k, float cells, float fp) {
  float a = .5, s = 0.;
  for (int o=0; o<ORB_OCTAVES; o++) {
    float keep = orbKeep(cells,fp);
    if (keep <= 0.) break;
    s += a*(orbNoise(p,k+float(o))-.5)*keep;
    p = p*2.03+vec3(17.3,9.1,5.7);
    cells *= 2.03;
    a *= .5;
  }
  return .5+s/(1.-exp2(-float(ORB_OCTAVES)));
}
float orbEdge(float e, float x, float w, float fp) {
  float h = max(w,fp);
  return smoothstep(e-h,e+h,x);
}
float orbLine(float d, float w, float fp) {
  float h = max(w,fp);
  return exp(-d*d/(h*h))*w/h;
}
vec3 orbTurn(vec3 n, float a) {
  float c = cos(a), s = sin(a);
  return vec3(c*n.x-s*n.z,n.y,s*n.x+c*n.z);
}
const vec3 ORB_FAR_CELLS[19] = vec3[19](${Array.from({ length: 19 }, (_, i) => `vec3(${FAR_CELLS[i * 3]},${FAR_CELLS[i * 3 + 1]},${FAR_CELLS[i * 3 + 2]})`).join(",")});
void orbCell(vec3 c, vec3 p, float k, inout vec3 f) {
  uint h = orbBits(c,k);
  vec3 to = c+orbBytes(h)-p;
  float d = dot(to,to);
  if (d < f.x) f = vec3(d,f.x,float(h >> 24u)/255.);
  else if (d < f.y) f.y = d;
}
vec3 orbCells(vec3 p, float k) {
  vec3 own = floor(p), side = step(.5,p-own)*2.-1., f = vec3(1.,1.,0.);
  for (int i=0; i<8; i++) orbCell(own+side*vec3(float(i & 1),float((i >> 1) & 1),float(i >> 2)),p,k,f);
  vec3 gap = .5+abs(p-own-.5), far = gap*gap, near = (1.-gap)*(1.-gap);
  if (min(far.x,min(far.y,far.z)) < f.y) for (int i=0; i<19; i++) {
    vec3 o = ORB_FAR_CELLS[i];
    if (dot(max(-o,0.),far)+dot(max(o,0.),near) < f.y) orbCell(own+side*o,p,k,f);
  }
  return vec3(sqrt(f.x),sqrt(f.y),f.z);
}
float orbCraters(vec3 p, float k, float per, float fp) {
  vec3 c = floor(p);
  float r = .12+.16*orbHash(c,k+1.);
  float d = length(p-c-.3-.4*orbBytes(orbBits(c,k)))/r, soft = fp*per/r;
  return (.2*orbLine(d-.92,.09,soft)-.1*(1.-orbEdge(.85,d,.05,soft)))*orbKeep(per*1.5,fp);
}`;

// ---- The scenes. Each puts its colour, linear and about 0 to 1, into `out`: `n` is the direction on the ball in the
// orb's frame, `t` the scene's clock in seconds, `fp` the pixel's footprint in units of direction, and `f` the frame
// block, whose orb lanes hold what the scene follows.

/** Where the eye looks, the blue eye's power; the way to the sun, the tide; where a change starts, a strike; its number. */
const GAZE = ORB_AT + 12, POWER = ORB_AT + 15, SUN = ORB_AT + 16, FILL = ORB_AT + 19, FLASH = ORB_AT + 23, STRIKE = ORB_AT + 24;

/**
 * Watcher: a reptile's eye that is the whole ball. Its iris faces where it looks, gold at the slit and green at its rim,
 * with fibres running out; the slit is narrow by day and under the eye's power and wide by night; scaled skin is round it
 * and behind it, and its lids meet in a blink.
 */
function watcher(out: number[], f: ArrayLike<number>, nx: number, ny: number, nz: number, t: number, fp: number): void {
  const gx = f[GAZE]!, gy = f[GAZE + 1]!, gz = f[GAZE + 2]!;
  // Right is across the gaze and level, up along the ball from it.
  let rx = gz + 1e-4, rz = -gx;
  const rl = Math.hypot(rx, rz);
  rx /= rl;
  rz /= rl;
  const ux = gy * rz, uy = gz * rx - gx * rz, uz = -gy * rx;
  const x = nx * rx + nz * rz, y = nx * ux + ny * uy + nz * uz, c = nx * gx + ny * gy + nz * gz;
  const s = Math.hypot(x, y), r = c >= 0 ? s : 2 - s;
  // The skin: scales, each its own green, dark between, and wet red where it meets the iris.
  const mott = orbNoise(nx * 5 + 4.3, ny * 5 + 4.3, nz * 5 + 4.3, 12), bend = (mott - 0.5) * 1.5, fine = keepAt(24, fp);
  // The scales are read only where a pixel is fine enough to show them.
  let scale = 0.5, seam = 1;
  if (fine > 0) {
    cells(nx * 24 + bend, ny * 24 + bend, nz * 24 + bend, 15);
    scale = mix(0.5, cell[2]!, fine);
    seam = 1 - 0.7 * Math.min(line(cell[1]! - cell[0]!, 0.05, fp * 24), 1) * fine;
  }
  const sk = 0.6 * scale + 0.4 * mott;
  const skin0 = mix(0.025, 0.07, sk) * seam, skin1 = mix(0.05, 0.1, sk) * seam, skin2 = mix(0.02, 0.03, sk) * seam;
  const wet = 1 - edge(IRIS + 0.09, r, 0.05, fp);
  out[0] = mix(skin0, 0.3, wet);
  out[1] = mix(skin1, 0.035, wet);
  out[2] = mix(skin2, 0.02, wet);
  const iris = 1 - edge(IRIS, r, 0.008, fp);
  if (iris > 0) {
    const inv = 1 / Math.max(s, 1e-4), px = x * inv, py = y * inv, around = fp / Math.max(s, 0.05);
    const f1 = mix(0.5, orbNoise(px * 7, py * 7, r * 3, 13), keepAt(7, around));
    const f2 = mix(0.5, orbNoise(px * 19, py * 19, r * 8, 14), keepAt(19, around));
    const fib = 0.6 * f1 + 0.4 * f2, q = r / IRIS;
    const warm = sstep(0.25, 0.8, q), green = 0.75 * sstep(0.62, 0.98, q);
    const lum = (0.4 + 0.9 * fib * fib) * (1 - 0.85 * sstep(0.86, 1, q));
    // The slit: narrow by day and under the eye's power, wide by night, breathing.
    const day = sstep(-0.1, 0.1, f[SUN + 1]!);
    const a = mix(0.2, 0.04, day) * (1 - 0.5 * f[POWER]!) * (1 + 0.08 * Math.sin(t * 0.7));
    const pd = (Math.abs(x) / a + (y * y) / (SLIT * SLIT) - 1) * a;
    const pupil = 1 - edge(0, pd, 0.006, fp), ring = 0.5 * Math.exp(-Math.max(pd, 0) / 0.03);
    const ir = mix((mix(mix(1, 0.62, warm), 0.2, green)) * lum + ring, 0.004, pupil);
    const ig = mix((mix(mix(0.74, 0.2, warm), 0.34, green)) * lum + 0.85 * ring, 0.003, pupil);
    const ib = mix((mix(mix(0.1, 0.015, warm), 0.04, green)) * lum + 0.4 * ring, 0.002, pupil);
    out[0] = mix(out[0]!, ir, iris);
    out[1] = mix(out[1]!, ig, iris);
    out[2] = mix(out[2]!, ib, iris);
  }
  // A window of light on the wet of it, up and across from the slit.
  let wx = gx + 0.32 * ux + 0.22 * rx, wy = gy + 0.32 * uy, wz = gz + 0.32 * uz + 0.22 * rz;
  const wl = Math.hypot(wx, wy, wz);
  wx /= wl;
  wy /= wl;
  wz /= wl;
  const glint = 1.2 * (1 - edge(0.0045, 1 - (nx * wx + ny * wy + nz * wz), 0.0008, fp * 0.095));
  // The lids meet across the eye in a blink, some seconds apart and never on a beat.
  const beat = t / 7.3, k = Math.floor(beat);
  const since = (beat - k) * 7.3 - 1 - 4.5 * orbHash(k, 3, 0, 11);
  const blink = sstep(0, 0.1, since) * (1 - sstep(0.14, 0.4, since));
  const open = mix(LID, -0.02, blink);
  const lid = edge(open, Math.abs(y), 0.004, fp) * sstep(0, 0.05, blink), rim = line(Math.abs(y) - open, 0.012, fp);
  out[0] = mix(out[0]! + glint, 0.75 * skin0 + 0.2 * rim, lid);
  out[1] = mix(out[1]! + glint, 0.75 * skin1 + 0.12 * rim, lid);
  out[2] = mix(out[2]! + glint, 0.75 * skin2 + 0.05 * rim, lid);
}

const WATCHER_GLSL = `
vec3 orbWatcher(vec3 n, float t, float fp) {
  vec3 look = fOrb[3].xyz;
  vec3 right = vec3(look.z+1.e-4,0.,-look.x);
  right /= length(right.xz);
  vec3 up = cross(look,right);
  float x = dot(n,right), y = dot(n,up), c = dot(n,look);
  float s = length(vec2(x,y)), r = c >= 0. ? s : 2.-s;
  float mott = orbNoise(n*5.+4.3,12.), fine = orbKeep(24.,fp);
  float scale = .5, seam = 1.;
  if (fine > 0.) {
    vec3 sc = orbCells(n*24.+(mott-.5)*1.5,15.);
    scale = mix(.5,sc.z,fine);
    seam = 1.-.7*min(orbLine(sc.y-sc.x,.05,fp*24.),1.)*fine;
  }
  float sk = .6*scale+.4*mott;
  vec3 skin = mix(vec3(.025,.05,.02),vec3(.07,.1,.03),sk)*seam;
  float wet = 1.-orbEdge(${g(IRIS + 0.09)},r,.05,fp);
  vec3 col = mix(skin,vec3(.3,.035,.02),wet);
  float iris = 1.-orbEdge(${g(IRIS)},r,.008,fp);
  if (iris > 0.) {
    vec2 u = vec2(x,y)/max(s,1.e-4);
    float around = fp/max(s,.05);
    float f1 = mix(.5,orbNoise(vec3(u*7.,r*3.),13.),orbKeep(7.,around));
    float f2 = mix(.5,orbNoise(vec3(u*19.,r*8.),14.),orbKeep(19.,around));
    float fib = .6*f1+.4*f2, q = r/${g(IRIS)};
    float warm = smoothstep(.25,.8,q), green = .75*smoothstep(.62,.98,q);
    float lum = (.4+.9*fib*fib)*(1.-.85*smoothstep(.86,1.,q));
    float day = smoothstep(-.1,.1,fOrb[4].y);
    float a = mix(.2,.04,day)*(1.-.5*fOrb[3].w)*(1.+.08*sin(t*.7));
    float pd = (abs(x)/a+y*y/${g(SLIT * SLIT)}-1.)*a;
    float pupil = 1.-orbEdge(0.,pd,.006,fp), ring = .5*exp(-max(pd,0.)/.03);
    vec3 ic = mix(mix(vec3(1.,.74,.1),vec3(.62,.2,.015),warm),vec3(.2,.34,.04),green)*lum+vec3(1.,.85,.4)*ring;
    col = mix(col,mix(ic,vec3(.004,.003,.002),pupil),iris);
  }
  vec3 win = normalize(look+.32*up+.22*right);
  col += 1.2*(1.-orbEdge(.0045,1.-dot(n,win),.0008,fp*.095));
  float beat = t/7.3, k = floor(beat);
  float since = (beat-k)*7.3-1.-4.5*orbHash(vec3(k,3.,0.),11.);
  float blink = smoothstep(0.,.1,since)*(1.-smoothstep(.14,.4,since));
  float open = mix(${g(LID)},-.02,blink);
  float lid = orbEdge(open,abs(y),.004,fp)*smoothstep(0.,.05,blink), rim = orbLine(abs(y)-open,.012,fp);
  return mix(col,.75*skin+vec3(.2,.12,.05)*rim,lid);
}`;

const turned = [0, 0, 0];
/** `n` turned about the ball's axis by `a`, into `turned`. */
function turn(nx: number, ny: number, nz: number, a: number): void {
  const c = Math.cos(a), s = Math.sin(a);
  turned[0] = c * nx - s * nz;
  turned[1] = ny;
  turned[2] = s * nx + c * nz;
}

/**
 * Moon: by night a moon, its craters and seas lit from where the sun is, so its terminator is the sky's; by day a
 * banded planet turning on the ball's axis, with a great spot. As day comes the planet rises over the ball from its
 * sunward side, and a pixel shows the one or the other.
 */
function moon(out: number[], f: ArrayLike<number>, nx: number, ny: number, nz: number, t: number, fp: number, octaves: number): void {
  const sx = f[SUN]!, sy = f[SUN + 1]!, sz = f[SUN + 2]!;
  const day = sstep(-0.1, 0.1, sy);
  // Lit from where the sun is, held near the horizon by night, so the ball has a phase from every side.
  const ly = Math.max(sy, -0.14), ll = Math.hypot(sx, ly, sz);
  const lit = (nx * sx + ny * ly + nz * sz) / ll, front = 1.1 - 2.2 * day;
  // A dark limb where the planet meets the moon.
  const limb = sstep(0, Math.max(0.02, fp), Math.abs(lit - front));
  if (lit > front) {
    turn(nx, ny, nz, t * 0.04);
    const qx = turned[0]!, qy = turned[1]!, qz = turned[2]!;
    const warp = fbm(qx * 2.2 + 2.7, qy * 6.5 + 2.7, qz * 2.2 + 2.7, 21, 6.5, fp, octaves);
    const band = qy * 8 + (warp - 0.5) * 2.4, bands = 1 - sstep(0.1, 0.2, fp);
    const s1 = 0.5 + 0.5 * Math.sin(band * 2.3) * bands, s2 = 0.5 + 0.5 * Math.sin(band * 0.83 + 1.3) * bands;
    // Its great spot rides with it.
    const dx = qx - 0.975, dy = qy - 0.22;
    const spot = 1 - edge(1, Math.sqrt((dx * dx + qz * qz) / 0.085 + (dy * dy) / 0.017), 0.1, fp * 7);
    const cap = sstep(0.72, 0.96, Math.abs(qy)), shade = (0.3 + 0.7 * sstep(-0.35, 0.45, lit)) * limb, red = 0.75 + 0.5 * warp;
    out[0] = mix(mix(mix(mix(0.62, 0.95, s1), 0.55, 0.55 * s2 * s2), 0.8 * red, spot), 0.4, cap) * shade;
    out[1] = mix(mix(mix(mix(0.3, 0.8, s1), 0.62, 0.55 * s2 * s2), 0.2 * red, spot), 0.46, cap) * shade;
    out[2] = mix(mix(mix(mix(0.13, 0.56, s1), 0.66, 0.55 * s2 * s2), 0.08 * red, spot), 0.58, cap) * shade;
    return;
  }
  const m = fbm(nx * 2.3 + 3.1, ny * 2.3 + 3.1, nz * 2.3 + 3.1, 25, 2.3, fp, octaves);
  const ground = mix(0.18, 0.52, sstep(0.42, 0.6, m)) + craters(nx * 2.6 + 1.7, ny * 2.6 + 1.7, nz * 2.6 + 1.7, 29, 2.6, fp) + 0.6 * craters(nx * 7.5 + 4.1, ny * 7.5 + 4.1, nz * 7.5 + 4.1, 31, 7.5, fp);
  const albedo = Math.max(ground, 0.03) * limb, shade = sstep(-0.06, 0.22, lit) * (0.7 + 0.3 * Math.max(lit, 0));
  // Its night side keeps earthshine enough to read from every side of the city.
  out[0] = albedo * (0.98 * shade + 0.2);
  out[1] = albedo * (0.95 * shade + 0.25);
  out[2] = albedo * (0.86 * shade + 0.36);
}

const MOON_GLSL = `
vec3 orbMoon(vec3 n, float t, float fp) {
  vec3 sun = fOrb[4].xyz;
  float day = smoothstep(-.1,.1,sun.y);
  vec3 l = normalize(vec3(sun.x,max(sun.y,-.14),sun.z));
  float lit = dot(n,l), front = 1.1-2.2*day;
  float limb = smoothstep(0.,max(.02,fp),abs(lit-front));
  if (lit > front) {
    vec3 q = orbTurn(n,t*.04);
    float warp = orbFbm(vec3(q.x*2.2,q.y*6.5,q.z*2.2)+2.7,21.,6.5,fp);
    float band = q.y*8.+(warp-.5)*2.4, bands = 1.-smoothstep(.1,.2,fp);
    float s1 = .5+.5*sin(band*2.3)*bands, s2 = .5+.5*sin(band*.83+1.3)*bands;
    vec3 col = mix(mix(vec3(.62,.3,.13),vec3(.95,.8,.56),s1),vec3(.55,.62,.66),.55*s2*s2);
    vec2 d = vec2(q.x-.975,q.y-.22);
    float spot = 1.-orbEdge(1.,sqrt((d.x*d.x+q.z*q.z)/.085+d.y*d.y/.017),.1,fp*7.);
    col = mix(col,vec3(.8,.2,.08)*(.75+.5*warp),spot);
    col = mix(col,vec3(.4,.46,.58),smoothstep(.72,.96,abs(q.y)));
    return col*(.3+.7*smoothstep(-.35,.45,lit))*limb;
  }
  float m = orbFbm(n*2.3+3.1,25.,2.3,fp);
  float ground = mix(.18,.52,smoothstep(.42,.6,m))+orbCraters(n*2.6+1.7,29.,2.6,fp)+.6*orbCraters(n*7.5+4.1,31.,7.5,fp);
  return max(ground,.03)*limb*(vec3(.98,.95,.86)*smoothstep(-.06,.22,lit)*(.7+.3*max(lit,0.))+vec3(.2,.25,.36));
}`;

/**
 * Core: magma under cracked plates. Heat moves slowly under them and beats climb the ball; with the blue eye's power the
 * cracks widen, finer ones open and the beats come hard.
 */
function core(out: number[], f: ArrayLike<number>, nx: number, ny: number, nz: number, t: number, fp: number): void {
  const power = f[POWER]!;
  const heat = orbNoise(nx * 1.7 + 0.031 * t, ny * 1.7 + 0.023 * t, nz * 1.7 - 0.019 * t, 33);
  const beat = 0.5 + 0.5 * Math.sin(2.1 * t - 5 * ny);
  const drive = 0.3 + 0.4 * heat + power * (0.4 + 0.6 * beat * beat), w = 0.02 + 0.035 * drive;
  cells(nx * 3.1 + 7.7, ny * 3.1 + 7.7, nz * 3.1 + 7.7, 31);
  const wall = cell[1]! - cell[0]!, own = cell[2]!;
  // Cracks between the plates, and finer ones where it is hot, which are read only there.
  const fine = sstep(0.35, 0.7, heat + 0.3 * power);
  let crack = line(wall, w, fp * 3.1);
  if (fine > 0) {
    cells(nx * 8.3 + 2.1, ny * 8.3 + 2.1, nz * 8.3 + 2.1, 32);
    crack += 0.7 * line(cell[1]! - cell[0]!, 0.6 * w, fp * 8.3) * fine;
  }
  const temp = crack * (0.5 + drive), hot = sstep(0.15, 0.7, temp), white = sstep(0.9, 1.8, temp);
  // The plates: dark, each its own shade, glowing a little near its cracks.
  const shade = 0.5 + own, under = 0.35 * Math.exp(-wall / 0.09) * drive, over = Math.min(crack, 1);
  out[0] = mix(0.022 * shade + 0.3 * under, mix(mix(0.45, 1, hot), 1.25, white), over);
  out[1] = mix(0.02 * shade + 0.022 * under, mix(mix(0.015, 0.28, hot), 0.9, white), over);
  out[2] = mix(0.02 * shade, mix(mix(0, 0.02, hot), 0.45, white), over);
}

const CORE_GLSL = `
vec3 orbCore(vec3 n, float t, float fp) {
  float power = fOrb[3].w;
  float heat = orbNoise(n*1.7+vec3(.031,.023,-.019)*t,33.);
  float beat = .5+.5*sin(2.1*t-5.*n.y);
  float drive = .3+.4*heat+power*(.4+.6*beat*beat), w = .02+.035*drive;
  vec3 big = orbCells(n*3.1+7.7,31.);
  float wall = big.y-big.x, fine = smoothstep(.35,.7,heat+.3*power), crack = orbLine(wall,w,fp*3.1);
  if (fine > 0.) {
    vec3 small = orbCells(n*8.3+2.1,32.);
    crack += .7*orbLine(small.y-small.x,.6*w,fp*8.3)*fine;
  }
  float temp = crack*(.5+drive);
  vec3 magma = mix(mix(vec3(.45,.015,0.),vec3(1.,.28,.02),smoothstep(.15,.7,temp)),vec3(1.25,.9,.45),smoothstep(.9,1.8,temp));
  vec3 plate = vec3(.022,.02,.02)*(.5+big.z)+vec3(.3,.022,0.)*.35*exp(-wall/.09)*drive;
  return mix(plate,magma,min(crack,1.));
}`;

const at = [0, 0, 0];
/** Where on the ball strike `id` lands, into `at`: anywhere round it, mostly over its middle. */
export function strikeAt(id: number): readonly number[] {
  const x = orbHash(id, 1, 0, 44) - 0.5 + 1e-3, y = orbHash(id, 2, 0, 44) * 0.7 - 0.1 + 1e-3, z = orbHash(id, 3, 0, 44) - 0.5 + 1e-3;
  const l = Math.hypot(x, y, z);
  at[0] = x / l;
  at[1] = y / l;
  at[2] = z / l;
  return at;
}

/**
 * Storm: a thunderhead in glass. Cloud heaps toward the top of the ball, turning and churning, with rain falling under
 * it; it flickers with heat lightning of its own, and when the blue eye strikes, the cloud is lit from inside about the
 * strike and a bolt hangs down the ball from it, never straight, forking once.
 */
function storm(out: number[], f: ArrayLike<number>, nx: number, ny: number, nz: number, t: number, fp: number, octaves: number): void {
  turn(nx, ny, nz, t * 0.03);
  const cl = fbm(turned[0]! * 2.6, turned[1]! * 2.6 + 0.05 * t, turned[2]! * 2.6, 41, 2.6, fp, octaves) + 0.3 * ny - 0.06;
  const thick = sstep(0.42, 0.6, cl), tops = sstep(0.55, 0.85, cl);
  const rain = mix(0.5, orbNoise(nx * 17, ny * 2.5 + 0.9 * t, nz * 17, 47), keepAt(17, fp));
  out[0] = mix(0.006 + 0.05 * rain * rain, mix(0.04, 0.32, tops), thick);
  out[1] = mix(0.01 + 0.07 * rain * rain, mix(0.055, 0.38, tops), thick);
  out[2] = mix(0.024 + 0.11 * rain * rain, mix(0.1, 0.52, tops), thick);
  // Heat lightning of its own between the eye's strikes.
  let glow = 0, bolt = 0;
  const tick = t * 0.9, k = Math.floor(tick);
  if (orbHash(k, 5, 0, 48) < 0.7) {
    strikeAt(k + 100);
    glow = 0.9 * Math.exp(-(tick - k) * 5) * Math.exp(-(1 - (nx * at[0]! + ny * at[1]! + nz * at[2]!)) * 2.5);
  }
  const flash = f[FLASH]!;
  if (flash > 0) {
    const id = f[STRIKE]!;
    strikeAt(id);
    const tx = at[0]!, ty = at[1]!, tz = at[2]!;
    glow += flash * Math.exp(-(1 - (nx * tx + ny * ty + nz * tz)) * 3);
    // Down the ball from the strike: how far down a place is, and how far to the side of the bolt's wandering path.
    let sx = tz + 1e-4, sz = -tx;
    const sl = Math.hypot(sx, sz);
    sx /= sl;
    sz /= sl;
    const down = ty - ny, side = (nx - tx) * sx + (nz - tz) * sz;
    const path = (orbNoise(down * 7, id, 0, 49) - 0.5) * 0.22 + (orbNoise(down * 23, id, 3, 49) - 0.5) * 0.07 * keepAt(23, fp);
    const len = 0.5 + 0.5 * orbHash(id, 4, 0, 44), fork = len * (0.25 + 0.3 * orbHash(id, 6, 0, 44)), way = orbHash(id, 7, 0, 44) < 0.5 ? -0.6 : 0.6;
    const d = Math.abs(side - path), d2 = Math.abs(side - path - way * (down - fork));
    const near = sstep(0, 0.2, nx * tx + nz * tz) * sstep(0, 0.03, down);
    bolt = flash * near * ((line(d, 0.006, fp) + 0.25 * Math.exp(-d / 0.05)) * (1 - sstep(0.8 * len, len, down)) + (down > fork ? 0.6 * line(d2, 0.004, fp) * (1 - sstep(fork + 0.5 * (len - fork), len, down)) : 0));
  }
  // The cloud takes the light inside it, the rain a little, and the bolt shows where the cloud is thin.
  const lit = glow * (0.15 + 1.1 * thick * (1.2 - 0.7 * tops)) + 3 * bolt * (1 - 0.7 * thick);
  out[0]! += 0.72 * lit;
  out[1]! += 0.8 * lit;
  out[2]! += lit;
}

const STORM_GLSL = `
vec3 orbAt(float id) {
  return normalize(vec3(orbHash(vec3(id,1.,0.),44.)-.5,orbHash(vec3(id,2.,0.),44.)*.7-.1,orbHash(vec3(id,3.,0.),44.)-.5)+1.e-3);
}
vec3 orbStorm(vec3 n, float t, float fp) {
  float cl = orbFbm(orbTurn(n,t*.03)*2.6+vec3(0.,.05*t,0.),41.,2.6,fp)+.3*n.y-.06;
  float thick = smoothstep(.42,.6,cl), tops = smoothstep(.55,.85,cl);
  float rain = mix(.5,orbNoise(vec3(n.x*17.,n.y*2.5+.9*t,n.z*17.),47.),orbKeep(17.,fp));
  vec3 col = mix(vec3(.006,.01,.024)+vec3(.05,.07,.11)*rain*rain,mix(vec3(.04,.055,.1),vec3(.32,.38,.52),tops),thick);
  float glow = 0., bolt = 0.;
  float tick = t*.9, k = floor(tick);
  if (orbHash(vec3(k,5.,0.),48.) < .7) glow = .9*exp(-(tick-k)*5.)*exp(-(1.-dot(n,orbAt(k+100.)))*2.5);
  float flash = fOrb[5].w;
  if (flash > 0.) {
    float id = fOrb[6].x;
    vec3 top = orbAt(id);
    glow += flash*exp(-(1.-dot(n,top))*3.);
    vec2 side = vec2(top.z+1.e-4,-top.x);
    side /= length(side);
    float down = top.y-n.y, off = dot(n.xz-top.xz,side);
    float path = (orbNoise(vec3(down*7.,id,0.),49.)-.5)*.22+(orbNoise(vec3(down*23.,id,3.),49.)-.5)*.07*orbKeep(23.,fp);
    float len = .5+.5*orbHash(vec3(id,4.,0.),44.), fork = len*(.25+.3*orbHash(vec3(id,6.,0.),44.)), way = orbHash(vec3(id,7.,0.),44.) < .5 ? -.6 : .6;
    float d = abs(off-path), d2 = abs(off-path-way*(down-fork));
    float by = smoothstep(0.,.2,dot(n.xz,top.xz))*smoothstep(0.,.03,down);
    bolt = flash*by*((orbLine(d,.006,fp)+.25*exp(-d/.05))*(1.-smoothstep(.8*len,len,down))+(down > fork ? .6*orbLine(d2,.004,fp)*(1.-smoothstep(fork+.5*(len-fork),len,down)) : 0.));
  }
  return col+vec3(.72,.8,1.)*(glow*(.15+1.1*thick*(1.2-.7*tops))+3.*bolt*(1.-.7*thick));
}`;

/**
 * Tide: the ball as a glass of water that fills through the blue eye's cycle and drains as its cast leaves, so from far
 * off it is a gauge of the time to the next drop. Waves run on the waterline; over it is the hour's sky, with the sun or
 * the moon where each stands and stars by night; under it the water is lit near its surface and dark below.
 */
function tide(out: number[], f: ArrayLike<number>, nx: number, ny: number, nz: number, t: number, fp: number, octaves: number): void {
  const sx = f[SUN]!, sy = f[SUN + 1]!, sz = f[SUN + 2]!;
  const day = sstep(-0.1, 0.1, sy);
  const w1 = orbNoise(nx * 5, nz * 5, 0.5 * t, 51), w2 = orbNoise(nx * 13 + 0.6 * t, nz * 13, 0.9 * t, 52);
  const surf = mix(-0.47, 0.93, f[FILL]!) + 0.04 * (w1 - 0.5) + 0.016 * (w2 - 0.5) * keepAt(13, fp);
  // Sky and water meet over a pixel's width, so the waterline does not step far off.
  const d = ny - surf, soft = Math.max(0.004, fp), sky = sstep(-soft, soft, d), top = line(d, 0.009, fp);
  out[0] = out[1] = out[2] = 0;
  if (sky > 0) {
    const h = Math.max(d, 0) / (1.02 - surf), sd = nx * sx + ny * sy + nz * sz, dusk = 0.8 * (1 - sstep(0, 0.3, Math.abs(sy))), up = sstep(0, 0.9, h);
    const sun = Math.exp(-(1 - sd) * 28) * day, moonlight = Math.exp(-(1 + sd) * 45) * (1 - day);
    out[0] = sky * (mix(mix(mix(0.05, 0.72, day), 1, dusk), mix(0.006, 0.14, day), up) + sun + 0.55 * moonlight);
    out[1] = sky * (mix(mix(mix(0.07, 0.84, day), 0.46, dusk), mix(0.01, 0.36, day), up) + 0.8 * sun + 0.65 * moonlight);
    out[2] = sky * (mix(mix(mix(0.16, 0.95, day), 0.16, dusk), mix(0.035, 0.85, day), up) + 0.5 * sun + 0.85 * moonlight);
    // Stars by night, one to a cell in seventy.
    const cx = Math.floor(nx * 36), cy = Math.floor(ny * 36), cz = Math.floor(nz * 36);
    if (day < 1 && orbHash(cx, cy, cz, 53) > 0.986) {
      const star = sky * (1 - day) * (1 - sstep(0.05, 0.22, Math.hypot(nx * 36 - cx - 0.5, ny * 36 - cy - 0.5, nz * 36 - cz - 0.5))) * keepAt(36, fp) * sstep(0, 0.3, h);
      out[0]! += 0.8 * star;
      out[1]! += 0.85 * star;
      out[2]! += star;
    }
  }
  if (sky < 1) {
    // Water: lit near its surface, dark below, with light moving in it.
    const under = Math.min(d, 0), c = fbm(nx * 4 + 6.1, ny * 1.2 - 0.04 * t + 6.1, nz * 4 + 6.1, 54, 4, fp, octaves);
    const deep = 1 - Math.exp(under * 2.4), light = sstep(0.52, 0.78, c) * Math.exp(under * 2.6);
    out[0]! += (1 - sky) * (mix(0.03, 0, deep) + 0.05 * light);
    out[1]! += (1 - sky) * (mix(0.42, 0.03, deep) + 0.25 * light);
    out[2]! += (1 - sky) * (mix(0.5, 0.14, deep) + 0.22 * light);
  }
  // The bright line of its surface.
  out[0]! += 1.1 * top;
  out[1]! += 1.3 * top;
  out[2]! += 1.3 * top;
}

const TIDE_GLSL = `
vec3 orbTide(vec3 n, float t, float fp) {
  vec3 sun = fOrb[4].xyz;
  float day = smoothstep(-.1,.1,sun.y);
  float w1 = orbNoise(vec3(n.x*5.,n.z*5.,.5*t),51.), w2 = orbNoise(vec3(n.x*13.+.6*t,n.z*13.,.9*t),52.);
  float surf = mix(-.47,.93,fOrb[4].w)+.04*(w1-.5)+.016*(w2-.5)*orbKeep(13.,fp);
  float d = n.y-surf, soft = max(.004,fp), sky = smoothstep(-soft,soft,d);
  vec3 col = vec3(0.);
  if (sky > 0.) {
    float h = max(d,0.)/(1.02-surf), sd = dot(n,sun), dusk = .8*(1.-smoothstep(0.,.3,abs(sun.y)));
    vec3 low = mix(mix(vec3(.05,.07,.16),vec3(.72,.84,.95),day),vec3(1.,.46,.16),dusk);
    vec3 over = mix(low,mix(vec3(.006,.01,.035),vec3(.14,.36,.85),day),smoothstep(0.,.9,h));
    over += vec3(1.,.8,.5)*exp(-(1.-sd)*28.)*day+vec3(.55,.65,.85)*exp(-(1.+sd)*45.)*(1.-day);
    vec3 cell = floor(n*36.);
    if (day < 1. && orbHash(cell,53.) > .986) over += vec3(.8,.85,1.)*(1.-day)*(1.-smoothstep(.05,.22,length(n*36.-cell-.5)))*orbKeep(36.,fp)*smoothstep(0.,.3,h);
    col = sky*over;
  }
  if (sky < 1.) {
    float under = min(d,0.), c = orbFbm(vec3(n.x*4.,n.y*1.2-.04*t,n.z*4.)+6.1,54.,4.,fp);
    col += (1.-sky)*(mix(vec3(.03,.42,.5),vec3(0.,.03,.14),1.-exp(under*2.4))+vec3(.05,.25,.22)*smoothstep(.52,.78,c)*exp(under*2.6));
  }
  return col+vec3(1.1,1.3,1.3)*orbLine(d,.009,fp);
}`;

// ---- The screen: a video or its poster (client/core/video/player.ts) on unit 29, which the programme never picks. The
// picture wraps the ball as the real Sphere's does: its columns run round by longitude and its rows by height, so from
// the street the rows are evenly spaced. It is laid as copies round the ball, each about the half a viewer sees. Facing
// turns them so a copy's middle faces each viewer; fixed holds them to the ball. Fill covers the ball; fit keeps the
// picture's shape and glows in its nearest edge's colour where it does not reach.

/** The screen's number among the scenes, past the programme's five (shared/world/orb.ts ORB_SCENES). */
export const ORB_SCREEN = 5;
/** The glow round the picture: its brightness at the edge, and how fast it falls off, a picture's half height at a time. */
const GLOW = 0.25;
const GLOW_FADE = 3.5;
/** The share of the edges' colour the glow gives the ball's mean where the picture does not cover it. */
const GLOW_SHARE = 0.2;
/** What the before side of a change from one clip to the next shows: the screen dark. */
const DARK = 0.01;
/** The most copies round the ball, for a tall picture. */
const MOST_COPIES = 12;

/**
 * The screen's lanes, after the scenes': the longitude a copy's middle faces, the copies round the ball, and the mode
 * (0 none, 1 facing, 2 fixed); the picture's half width in longitude, its middle's height and its half height (heights
 * as the sine of latitude); two spare lanes, then fill (1) or fit (0); the texture's used rect (scale u, v, offset u, v);
 * the picture's texels across and up, its aspect and the highest mip level the texture holds; the top edge's colour;
 * the right edge's and 1 where the before side of a change is dark; the bottom edge's; the left edge's; the mean the
 * ball shows (for the light it casts) and the share of it the picture covers. Directions are in the orb's frame.
 */
export const SCREEN_AT = ORB_AT + 32;
export const SCREEN_LANES = 11;
/** The lane the player sets once it knows which levels the texture holds this frame. */
export const SCREEN_LOD = SCREEN_AT + 23;

/** A picture as the twin reads it: linear colour, three floats a texel, top row first, with its mip levels after. */
export interface ScreenPicture {
  readonly width: number;
  readonly height: number;
  readonly levels: readonly Float32Array[];
}

/** A picture from sRGB bytes, four a texel, top row first, with mip levels made by halving as the card's are. */
export function screenPicture(width: number, height: number, rgba: ArrayLike<number>): ScreenPicture {
  const first = new Float32Array(width * height * 3);
  for (let i = 0; i < width * height; i++) for (let c = 0; c < 3; c++) first[i * 3 + c] = srgbToLinear(rgba[i * 4 + c]! / 255);
  const levels = [first];
  let w = width, h = height;
  while (w > 1 || h > 1) {
    const nw = Math.max(1, w >> 1), nh = Math.max(1, h >> 1), from = levels.at(-1)!, to = new Float32Array(nw * nh * 3);
    for (let y = 0; y < nh; y++) for (let x = 0; x < nw; x++) for (let c = 0; c < 3; c++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += from[(Math.min(h - 1, y * 2 + (k >> 1)) * w + Math.min(w - 1, x * 2 + (k & 1))) * 3 + c]!;
      to[(y * nw + x) * 3 + c] = s / 4;
    }
    levels.push(to);
    w = nw;
    h = nh;
  }
  return { width, height, levels };
}

/** The highest mip level of a picture `width` by `height`. */
export const topLevel = (width: number, height: number): number => Math.floor(Math.log2(Math.max(1, width, height)));

/** Level `k` of `p` at (s, t), filtered between texels and held at the edges, into `texel` added by `w`. */
function readLevel(p: ScreenPicture, k: number, s: number, t: number, w: number, out: number[]): void {
  const lw = Math.max(1, p.width >> k), lh = Math.max(1, p.height >> k), data = p.levels[k]!;
  const x = Math.max(0, Math.min(lw - 1, s * lw - 0.5)), y = Math.max(0, Math.min(lh - 1, t * lh - 0.5));
  const x0 = Math.floor(x), y0 = Math.floor(y), x1 = Math.min(lw - 1, x0 + 1), y1 = Math.min(lh - 1, y0 + 1), fx = x - x0, fy = y - y0;
  for (let c = 0; c < 3; c++) {
    const a = mix(data[(y0 * lw + x0) * 3 + c]!, data[(y0 * lw + x1) * 3 + c]!, fx), b = mix(data[(y1 * lw + x0) * 3 + c]!, data[(y1 * lw + x1) * 3 + c]!, fx);
    out[c]! += mix(a, b, fy) * w;
  }
}
/** `p` at (s, t) and level `lod`, between levels as the card's LINEAR_MIPMAP_LINEAR has it, into `out`. */
function readPicture(p: ScreenPicture, s: number, t: number, lod: number, out: number[]): void {
  out[0] = out[1] = out[2] = 0;
  const l = Math.max(0, Math.min(p.levels.length - 1, lod)), k = Math.floor(l), f = l - k;
  readLevel(p, k, s, t, 1 - f, out);
  if (f > 0 && k + 1 < p.levels.length) readLevel(p, k + 1, s, t, f, out);
}

/** The picture the twin shows on the screen scene, as the texture on unit 29 holds it; with none it shows the glow alone. */
let twinPicture: ScreenPicture | null = null;
export function setScreenPicture(p: ScreenPicture | null): void {
  twinPicture = p;
}

/** Where a direction on the ball falls on the picture: u and v, -1 to 1 across it, and its latitude's cosine held off 0. */
export const screenUv = [0, 0, 0];
/** The picture's (u, v) at direction (dx, dy, dz) on the ball into `screenUv`, with the cosine of its latitude; false with no screen. */
export function orbScreenUv(f: ArrayLike<number>, dx: number, dy: number, dz: number): boolean {
  if (f[SCREEN_AT + 3]! < 0.5) return false;
  const copies = f[SCREEN_AT + 1]!, at = ((Math.atan2(dx, dz + 1e-12) - f[SCREEN_AT]!) * copies) / TAU + 0.5;
  const y = Math.max(-1, Math.min(1, dy));
  screenUv[0] = (((at - Math.floor(at)) * 2 - 1) * (Math.PI / copies)) / f[SCREEN_AT + 4]!;
  screenUv[1] = (y - f[SCREEN_AT + 5]!) / f[SCREEN_AT + 6]!;
  screenUv[2] = Math.max(Math.sqrt(1 - y * y), 0.05);
  return true;
}

/** The glow off the picture's edges at (u, v), by the picture's half sizes, into `out`. */
function glow(out: number[], f: ArrayLike<number>, u: number, v: number, sx: number, sy: number): void {
  const ox = (Math.max(Math.abs(u) - 1, 0) * sx) / sy, oy = Math.max(Math.abs(v) - 1, 0);
  const side = u > 0 ? SCREEN_AT + 28 : SCREEN_AT + 36, cap = v > 0 ? SCREEN_AT + 24 : SCREEN_AT + 32;
  const w = oy / (ox + oy + 1e-6), k = GLOW * Math.exp(-GLOW_FADE * Math.hypot(ox, oy));
  for (let c = 0; c < 3; c++) out[c] = mix(f[side + c]!, f[cap + c]!, w) * k;
}

const glowed = [0, 0, 0];
/** The screen at direction (dx, dy, dz), its colour into `out`: the twin of `orbScreen`. Without `picture` it is dark. */
function screen(out: number[], f: ArrayLike<number>, dx: number, dy: number, dz: number, fp: number, picture: boolean): void {
  out[0] = out[1] = out[2] = picture ? 0 : DARK;
  if (!picture || !orbScreenUv(f, dx, dy, dz)) return;
  const u = screenUv[0]!, v = screenUv[1]!, across = screenUv[2]!;
  // The picture's half sizes in metres where the ball is widest, and the metres a pixel spans on the skin.
  const radius = Math.max(f[ORB_AT + 3]!, 1), sx = f[SCREEN_AT + 4]! * radius, sy = f[SCREEN_AT + 6]! * radius, metres = fp * radius;
  const iu = Math.max(-1, Math.min(1, u)), iv = Math.max(-1, Math.min(1, v));
  const s = f[SCREEN_AT + 18]! + (0.5 + 0.5 * iu) * f[SCREEN_AT + 16]!, t = f[SCREEN_AT + 19]! + (0.5 - 0.5 * iv) * f[SCREEN_AT + 17]!;
  // Columns close up toward the top and rows spread out, so the level takes the denser of the two.
  const texels = Math.max(f[SCREEN_AT + 20]! / (2 * sx * across), (f[SCREEN_AT + 21]! * across) / (2 * sy));
  const lod = Math.max(0, Math.min(f[SCREEN_AT + 23]!, Math.log2(Math.max(metres * texels, 1e-6))));
  if (twinPicture) readPicture(twinPicture, s, t, lod, out);
  if (f[SCREEN_AT + 15]! > 0.5) return;
  glow(glowed, f, u, v, sx, sy);
  // The picture's edge is soft over a pixel.
  const soft = Math.max(metres / sy, 0.002), inside = sstep(1 + soft, 1 - soft, Math.abs(u)) * sstep(1 + soft, 1 - soft, Math.abs(v));
  for (let c = 0; c < 3; c++) out[c] = mix(glowed[c]!, out[c]!, inside);
}

const SCREEN_GLSL = `
uniform highp sampler2D uScreen;
vec3 orbGlow(vec2 uv, vec2 size) {
  vec2 over = max(abs(uv)-1.,0.)*vec2(size.x/size.y,1.);
  vec3 side = uv.x > 0. ? fOrb[15].rgb : fOrb[17].rgb, cap = uv.y > 0. ? fOrb[14].rgb : fOrb[16].rgb;
  return mix(side,cap,over.y/(over.x+over.y+1.e-6))*${g(GLOW)}*exp(-${g(GLOW_FADE)}*length(over));
}
vec3 orbScreen(vec3 dir, float fp, bool picture) {
  float radius = max(fOrb[0].w,1.), copies = fOrb[8].y;
  if (!picture || fOrb[8].w < .5) return vec3(picture ? 0. : ${g(DARK)});
  float at = (atan(dir.x,dir.z+1.e-12)-fOrb[8].x)*copies*${g(1 / TAU)}+.5, y = clamp(dir.y,-1.,1.);
  float across = max(sqrt(1.-y*y),.05), metres = fp*radius;
  vec2 size = fOrb[9].xz*radius;
  vec2 uv = vec2((fract(at)*2.-1.)*${g(Math.PI)}/(copies*fOrb[9].x),(y-fOrb[9].y)/fOrb[9].z);
  vec2 st = fOrb[12].zw+vec2(.5+.5*clamp(uv.x,-1.,1.),.5-.5*clamp(uv.y,-1.,1.))*fOrb[12].xy;
  float texels = max(fOrb[13].x/(2.*size.x*across),fOrb[13].y*across/(2.*size.y));
  vec3 pic = textureLod(uScreen,st,clamp(log2(max(metres*texels,1.e-6)),0.,fOrb[13].w)).rgb;
  if (fOrb[11].w > .5) return pic;
  float soft = max(metres/size.y,.002);
  vec2 e = smoothstep(1.+soft,1.-soft,abs(uv));
  return mix(orbGlow(uv,size),pic,e.x*e.y);
}`;


/** Scene `which` (its place in ORB_SCENES, or ORB_SCREEN) at a direction, its colour into `out`. */
export function orbScene(out: number[], f: ArrayLike<number>, which: number, nx: number, ny: number, nz: number, t: number, fp: number, octaves = ORB_OCTAVES, picture = true): void {
  if (which < 0.5) watcher(out, f, nx, ny, nz, t, fp);
  else if (which < 1.5) moon(out, f, nx, ny, nz, t, fp, octaves);
  else if (which < 2.5) core(out, f, nx, ny, nz, t, fp);
  else if (which < 3.5) storm(out, f, nx, ny, nz, t, fp, octaves);
  else if (which < 4.5) tide(out, f, nx, ny, nz, t, fp, octaves);
  else screen(out, f, nx, ny, nz, fp, picture);
}

/** A puck: its ring from the top, how many its ring holds, its centre's direction, and how far a point is from that centre in pucks. */
export interface Puck {
  ring: number;
  count: number;
  x: number;
  y: number;
  z: number;
  off: number;
}
/** How many rings a ball of `radius` has from pole to pole. */
export const puckRings = (radius: number): number => Math.max(8, Math.round((Math.PI * radius) / PUCK));
/**
 * The puck a direction falls on, on a ball of `radius`. Rings lie PUCK apart from the top down; each holds as many pucks
 * as fit its own length, evenly, so the spacing is the same at every height, and every other ring is half a puck on.
 */
export function orbPuck(nx: number, ny: number, nz: number, radius: number, out: Puck): Puck {
  const rings = puckRings(radius);
  const down = (Math.acos(Math.max(-1, Math.min(1, ny))) / Math.PI) * rings;
  const ring = Math.min(Math.floor(down), rings - 1);
  const polar = ((ring + 0.5) * Math.PI) / rings, wide = Math.sin(polar);
  const count = Math.max(1, Math.round((TAU * radius * wide) / PUCK));
  const half = 0.5 * (ring - 2 * Math.floor(ring / 2));
  const u = (Math.atan2(nx, nz) / TAU) * count + half, cell = Math.floor(u);
  const round = ((cell + 0.5 - half) / count) * TAU;
  out.ring = ring;
  out.count = count;
  out.x = wide * Math.sin(round);
  out.y = Math.cos(polar);
  out.z = wide * Math.cos(round);
  out.off = Math.hypot(((u - cell - 0.5) * TAU * radius * wide) / count, ((down - ring - 0.5) * Math.PI * radius) / rings) / PUCK;
  return out;
}

const PUCK_GLSL = `
vec4 orbPuck(vec3 n, float radius) {
  float rings = max(8.,floor(3.14159265*radius/${g(PUCK)}+.5));
  float down = acos(clamp(n.y,-1.,1.))/3.14159265*rings;
  float ring = min(floor(down),rings-1.);
  float polar = (ring+.5)*3.14159265/rings, wide = sin(polar);
  float count = max(1.,floor(6.2831853*radius*wide/${g(PUCK)}+.5));
  float brick = .5*(ring-2.*floor(ring/2.));
  float u = atan(n.x,n.z+1.e-12)/6.2831853*count+brick, cell = floor(u);
  float lon = (cell+.5-brick)/count*6.2831853;
  return vec4(wide*sin(lon),cos(polar),wide*cos(lon),length(vec2((u-cell-.5)*6.2831853*radius*wide/count,(down-ring-.5)*3.14159265*radius/rings))/${g(PUCK)});
}`;

/** Which scene the change shows at a direction: the new one behind its front, the one before ahead of it. */
export function orbPick(f: ArrayLike<number>, nx: number, ny: number, nz: number): number {
  const across = 0.5 - 0.5 * (nx * f[ORB_AT + 20]! + ny * f[ORB_AT + 21]! + nz * f[ORB_AT + 22]!);
  return across < f[ORB_AT + 10]! * 1.1 - 0.05 ? f[ORB_AT + 8]! : f[ORB_AT + 9]!;
}

/**
 * The screen's white as light after exposure, at a frame's exposure (1 at noon, some tens of thousands on a dark
 * night): ORB_NOON by day, rising with the stops of exposure to ORB_NIGHT. Low poly has no exposure and takes ORB_FLAT.
 */
export function orbLevel(exposure: number): number {
  if (!(exposure > 0)) return ORB_FLAT;
  return mix(ORB_NOON, ORB_NIGHT, sstep(ORB_DAY_STOPS, ORB_NIGHT_STOPS, Math.log2(Math.max(1, exposure))));
}
/** The same as light before exposure, which is what the screen gives out: a real screen turned far down by night. */
export const orbRaw = (exposure: number): number => (exposure > 0 ? orbLevel(exposure) / exposure : ORB_FLAT);

const picture = [0, 0, 0];
const puck: Puck = { ring: 0, count: 0, x: 0, y: 0, z: 0, off: 0 };
/**
 * The screen's light at a camera-relative point of the shell, into `out` as light after exposure: the twin of the
 * program's `main`. `footprint` is the metres a pixel spans there; `octaves` and `pucks` are the tier's.
 */
export function orbLight(f: ArrayLike<number>, x: number, y: number, z: number, footprint: number, out: number[] | Float64Array, octaves = ORB_OCTAVES, pucks = true): void {
  const radius = Math.max(f[ORB_AT + 3]!, 1);
  const ax = x - f[ORB_AT]!, ay = y - f[ORB_AT + 1]!, az = z - f[ORB_AT + 2]!, al = Math.hypot(ax, ay, az) || 1;
  const cs = f[ORB_AT + 4]!, sn = f[ORB_AT + 5]!;
  const nx = (cs * ax - sn * az) / al, ny = ay / al, nz = (sn * ax + cs * az) / al;
  let dx = nx, dy = ny, dz = nz, fp = footprint / radius, cover = 1;
  const show = pucks ? sstep(PUCK_FROM, PUCK_TO, PUCK / Math.max(footprint, 1e-5)) : 0;
  if (show > 0) {
    // A puck shows the picture at its own middle, and nothing finer than itself.
    orbPuck(nx, ny, nz, radius, puck);
    dx = puck.x;
    dy = puck.y;
    dz = puck.z;
    fp = Math.max(fp, PUCK / radius);
    cover = 1 - edge(PUCK_FILL, puck.off, 0.06, footprint / PUCK);
  }
  // The change crosses the skin from the point facing the eye, and a pixel shows one scene or the other.
  const across = 0.5 - 0.5 * (dx * f[ORB_AT + 20]! + dy * f[ORB_AT + 21]! + dz * f[ORB_AT + 22]!), wipe = f[ORB_AT + 10]!, front = wipe * 1.1 - 0.05;
  const on = across < front;
  orbScene(picture, f, on ? f[ORB_AT + 8]! : f[ORB_AT + 9]!, dx, dy, dz, on ? f[ORB_AT + 6]! : f[ORB_AT + 7]!, fp, octaves, on || !(f[SCREEN_AT + 31]! > 0.5));
  // The front itself is a line of light.
  const e = (across - front) / Math.max(0.012, fp), lead = wipe < 1 ? Math.exp(-e * e) : 0;
  const level = f[ORB_AT + 11]!, sy = f[SUN + 1]!;
  const lit = TRELLIS * sstep(-0.1, 0.1, sy) * (0.3 + 0.7 * Math.max(nx * f[SUN]! + ny * sy + nz * f[SUN + 2]!, 0));
  out[0] = (picture[0]! + 0.75 * lead) * level;
  out[1] = (picture[1]! + 0.9 * lead) * level;
  out[2] = (picture[2]! + lead) * level;
  for (let c = 0; c < 3; c++) out[c] = mix(out[c]!, out[c]! * cover * PUCK_GAIN + lit * (1 - cover), show);
}

const toned = [0, 0, 0];
/**
 * `light` as a frame with no light target shows it, 0 to 255 into `out`: by the grade's gain, the tone curve and the
 * grade where the frame has one, as every lit program shows its light, and by the tone curve alone on low poly.
 */
export function orbShown(out: number[] | Float64Array | Uint8ClampedArray, light: ArrayLike<number>, f: Float32Array, at = 0): void {
  const grading = f[FRAME.gamma]! > 0;
  for (let c = 0; c < 3; c++) toned[c] = light[c]! * (grading ? f[FRAME.grade + c]! : 1);
  tone(toned, toned);
  if (grading) graded(toned, f);
  for (let c = 0; c < 3; c++) out[at + c] = 255 * linearToSrgb(clamp(toned[c]!));
}

/** The program's fragment text: the frame block, the kit, the scenes, the pucks, the change and the level. */
export const ORB_FRAGMENT = `#version 300 es
precision highp float;
precision highp int;
in vec3 vRel;
out vec4 o;
${FRAME_BLOCK}${TONE}${GRADED}${KIT_GLSL}${WATCHER_GLSL}${MOON_GLSL}${CORE_GLSL}${STORM_GLSL}${TIDE_GLSL}${PUCK_GLSL}${SCREEN_GLSL}
vec3 orbScene(float which, vec3 n, float t, float fp, bool picture) {
  if (which < .5) return orbWatcher(n,t,fp);
  if (which < 1.5) return orbMoon(n,t,fp);
  if (which < 2.5) return orbCore(n,t,fp);
  if (which < 3.5) return orbStorm(n,t,fp);
  if (which < 4.5) return orbTide(n,t,fp);
  return orbScreen(n,fp,picture);
}
void main() {
  float radius = max(fOrb[0].w,1.);
  vec3 away = normalize(vRel-fOrb[0].xyz);
  vec3 n = vec3(fOrb[1].x*away.x-fOrb[1].y*away.z,away.y,fOrb[1].y*away.x+fOrb[1].x*away.z), dir = n;
  float metres = length(fwidth(vRel)), fp = metres/radius, cover = 1., show = 0.;
#ifdef ORB_PUCKS
  show = smoothstep(${g(PUCK_FROM)},${g(PUCK_TO)},${g(PUCK)}/max(metres,1.e-5));
  if (show > 0.) {
    vec4 puck = orbPuck(n,radius);
    dir = puck.xyz;
    fp = max(fp,${g(PUCK)}/radius);
    cover = 1.-orbEdge(${g(PUCK_FILL)},puck.w,.06,metres/${g(PUCK)});
  }
#endif
  float across = .5-.5*dot(dir,fOrb[5].xyz), front = fOrb[2].z*1.1-.05;
  bool on = across < front;
  vec3 col = orbScene(on ? fOrb[2].x : fOrb[2].y,dir,on ? fOrb[1].z : fOrb[1].w,fp,on || fOrb[15].w < .5);
  float e = (across-front)/max(.012,fp);
  if (fOrb[2].z < 1.) col += vec3(.75,.9,1.)*exp(-e*e);
  vec3 light = col*fOrb[2].w;
  vec3 sun = fOrb[4].xyz;
  light = mix(light,light*cover*${g(PUCK_GAIN)}+${g(TRELLIS)}*smoothstep(-.1,.1,sun.y)*(.3+.7*max(dot(n,sun),0.))*(1.-cover),show);
#ifdef LIGHT_TARGET
  o = vec4(light,1.);
#else
  o = vec4(encoded(clamp(fFinish.x > 0. ? graded(tone(light*fGrade.rgb)) : tone(light),0.,1.)),1.);
#endif
}`;

// ---- The frame's lanes.

/** The orb of `sites` whose centre is nearest the eye at (x, y, z): its place in the list, or -1. */
export function nearestOrb(sites: readonly OrbSite[], x: number, y: number, z: number): number {
  let best = -1, least = Infinity;
  for (let i = 0; i < sites.length; i++) {
    const s = sites[i]!, d = Math.hypot(s.x - x, s.y + s.centre - y, s.z - z);
    if (d < least) {
      least = d;
      best = i;
    }
  }
  return best;
}

/** How full the tide is at the blue eye's phase, 0 to 1: it drains in five seconds as the cast leaves, then fills until the next. */
export function orbFill(phase: number): number {
  const since = (((phase - CAST_PHASE) % EYE_PERIOD) + EYE_PERIOD) % EYE_PERIOD;
  return since < 5 ? 1 - sstep(0, 5, since) : (since - 5) / (EYE_PERIOD - 5);
}

/** What the screen holds for writeOrb (client/core/video/player.ts), as plain numbers. */
export interface OrbScreen {
  /** The clip shown, its number in the manifest, or -1 for the scenes. */
  shows: number;
  /** The picture the texture holds, in texels, 0 for none, and the texture's own size. */
  width: number;
  height: number;
  texWidth: number;
  texHeight: number;
  /** The highest mip level the texture holds made from this picture. */
  levels: number;
  /** Facing turns the copies to each viewer; fixed holds them to the ball. */
  facing: boolean;
  fill: boolean;
  /** The clip's colour track (shared/video/clip.ts) and the seconds into the clip. */
  track: Uint8Array | null;
  seconds: number;
  /** The camera's up, in the world. */
  upX: number;
  upY: number;
  upZ: number;
}

/** The screen's wrap, from `screenWrap`: copies round the ball, the picture's half width in longitude, its middle's height and half height, and the share of the ball it covers. */
export const wrap = { copies: 2, halfWide: Math.PI / 2, middle: 0, halfHigh: 1, cover: 1 };
/**
 * The wrap of a picture of `aspect` on a ball the ground cuts at height `low` (the sine of its latitude there). The
 * copies are as many as make a copy, seen from in front, nearest the picture's shape; at least two, so a copy is never
 * wider than what a viewer sees. Fill stretches the picture over its copy; fit narrows or shortens it to keep its shape.
 */
export function screenWrap(aspect: number, low: number, fill: boolean): typeof wrap {
  const high = 1 - low;
  const seen = (k: number): number => (2 * Math.sin(Math.PI / k)) / high;
  let copies = 2;
  for (let k = 3; k <= MOST_COPIES; k++) if (Math.abs(Math.log(seen(k) / aspect)) < Math.abs(Math.log(seen(copies) / aspect))) copies = k;
  let halfWide = Math.PI / copies, halfHigh = high / 2;
  if (!fill && aspect < seen(copies)) halfWide = Math.asin(Math.min(1, (aspect * high) / 2));
  else if (!fill) halfHigh = Math.sin(Math.PI / copies) / aspect;
  wrap.copies = copies;
  wrap.halfWide = halfWide;
  wrap.middle = (low + 1) / 2;
  wrap.halfHigh = halfHigh;
  wrap.cover = ((halfWide * copies) / Math.PI) * ((2 * halfHigh) / high);
  return wrap;
}

/** Where the ground cuts the ball, as the sine of the latitude there. */
export const groundLine = (site: OrbSite): number => Math.max(-1, Math.min(0.5, -site.centre / Math.max(site.radius, 1)));

/** What the screen showed and since when, so a change between scenes and a clip, or two clips, is a wipe. */
const shown = { key: -1, at: -Infinity, before: 0, dark: false };
const edge3 = [0, 0, 0];

/**
 * The screen's lanes for `screen` seen from the eye at (ex, ey, ez) from the ball's centre in the orb's frame, the
 * camera's up turned into it by (cs, sn). Facing turns the copies to the eye's side; from over the top, to the side the
 * camera's up leaves behind, so the picture stands up on the screen and never spins.
 */
function screenLanes(frame: Float32Array, screen: OrbScreen, site: OrbSite, ex: number, ey: number, ez: number, cs: number, sn: number): void {
  const at = SCREEN_AT, aspect = screen.width / Math.max(1, screen.height);
  const w = screenWrap(aspect, groundLine(site), screen.fill);
  frame[at + 1] = w.copies;
  frame[at + 3] = screen.facing ? 1 : 2;
  frame[at + 4] = w.halfWide;
  frame[at + 5] = w.middle;
  frame[at + 6] = w.halfHigh;
  frame[at + 15] = screen.fill ? 1 : 0;
  frame[at + 16] = screen.width / Math.max(1, screen.texWidth);
  frame[at + 17] = screen.height / Math.max(1, screen.texHeight);
  frame[at + 20] = screen.width;
  frame[at + 21] = screen.height;
  frame[at + 22] = aspect;
  frame[at + 23] = screen.levels;
  // The edges' colours and the mean, linear, at the clip's time.
  const track = screen.track ?? new Uint8Array(0);
  let er = 0, eg = 0, eb = 0;
  for (let part = 1; part < 5; part++) {
    trackColour(track, screen.seconds, part, edge3);
    const to = at + 24 + (part - 1) * 4;
    for (let c = 0; c < 3; c++) frame[to + c] = srgbToLinear(edge3[c]!);
    er += frame[to]!;
    eg += frame[to + 1]!;
    eb += frame[to + 2]!;
  }
  trackColour(track, screen.seconds, 0, edge3);
  frame[at + 40] = w.cover * srgbToLinear(edge3[0]!) + (1 - w.cover) * GLOW_SHARE * er / 4;
  frame[at + 41] = w.cover * srgbToLinear(edge3[1]!) + (1 - w.cover) * GLOW_SHARE * eg / 4;
  frame[at + 42] = w.cover * srgbToLinear(edge3[2]!) + (1 - w.cover) * GLOW_SHARE * eb / 4;
  frame[at + 43] = w.cover;
  if (!screen.facing) return;
  const side = Math.hypot(ex, ez), over = sstep(0.8, 0.98, ey / Math.max(Math.hypot(ex, ey, ez), 1e-6));
  const ux = cs * screen.upX - sn * screen.upZ, uz = sn * screen.upX + cs * screen.upZ, up = Math.hypot(ux, uz);
  let fx = 0, fz = 0;
  if (side > 1e-6) {
    fx += ((1 - over) * ex) / side;
    fz += ((1 - over) * ez) / side;
  }
  if (up > 1e-6) {
    fx -= (over * ux) / up;
    fz -= (over * uz) / up;
  }
  frame[at] = Math.atan2(fx, fz + 1e-12);
}

/**
 * Texels of the picture a pixel spans where the ball is widest as the lanes have it, with `pixel` the radians a pixel
 * spans and the pucks shown where the tier draws them: over 1, the texture wants its mip levels.
 */
export function screenTexels(frame: ArrayLike<number>, pixel: number, pucks: boolean): number {
  const radius = frame[ORB_AT + 3]!;
  if (!(frame[SCREEN_AT + 3]! > 0.5) || !(radius > 0)) return 0;
  const far = Math.hypot(frame[ORB_AT]!, frame[ORB_AT + 1]!, frame[ORB_AT + 2]!);
  const skin = Math.max(1, far - radius) * pixel, metres = Math.max(skin, pucks && PUCK / Math.max(skin, 1e-5) > PUCK_FROM ? PUCK : 0);
  return metres * Math.max(frame[SCREEN_AT + 20]! / (2 * Math.max(frame[SCREEN_AT + 4]!, 1e-3) * radius), frame[SCREEN_AT + 21]! / (2 * Math.max(frame[SCREEN_AT + 6]!, 1e-3) * radius));
}

const BLUE = { color: "blue" } as const;
const show: OrbShow = { scene: 0, before: 0, wipe: 1 };
const pose = newPose();
const sunAt = [0, 0, 0], look = [0, 0, 0];
const struck = { id: 0 };

/** `look` leant toward the point (x, y, z) from the orb's centre by `w`, and made a unit again. */
function lean(x: number, y: number, z: number, w: number): void {
  const l = Math.hypot(x, y, z);
  if (l < 1e-6 || w <= 0) return;
  const lx = look[0]! * (1 - w) + (x / l) * w, ly = look[1]! * (1 - w) + (y / l) * w, lz = look[2]! * (1 - w) + (z / l) * w;
  const ll = Math.hypot(lx, ly, lz);
  if (ll < 1e-3) return;
  look[0] = lx / ll;
  look[1] = ly / ll;
  look[2] = lz / ll;
}

/**
 * Fills the frame's orb lanes (packet.ts fOrb) for the orb nearest the eye at (x, y, z), from what every client holds:
 * the server's clock `seconds` and its `hour`, the map's Tide Eyes and the supply drops' list at `tick`. `only` holds one
 * scene (shared/world/orb.ts orbShow) and `gain` scales the screen's level, 0 for dark.
 *
 * The Watcher looks at a supply drop in flight, else at the blue eye's figure by its power, else at the sun or the moon,
 * and glides from one to the next.
 */
export function writeOrb(frame: Float32Array, sites: readonly OrbSite[] | undefined, eyes: readonly TideEyeSite[], seconds: number, hour: number, x: number, y: number, z: number, supply: SupplyList | null, tick: number, rate: number, only = -1, gain = 1, screen: OrbScreen | null = null): void {
  frame.fill(0, ORB_AT, ORB_AT + ORB_LANES * 4);
  const nearest = sites ? nearestOrb(sites, x, y, z) : -1;
  if (nearest < 0) return;
  const site = sites![nearest]!, cx = site.x, cy = site.y + site.centre, cz = site.z;
  const yaw = (site.yaw * Math.PI) / 32768, cs = Math.cos(yaw), sn = Math.sin(yaw);
  frame[ORB_AT] = cx - x;
  frame[ORB_AT + 1] = cy - y;
  frame[ORB_AT + 2] = cz - z;
  frame[ORB_AT + 3] = site.radius;
  frame[ORB_AT + 4] = cs;
  frame[ORB_AT + 5] = sn;
  // A scene's clock starts with its showing, moved on by the showing's own share; one held for good wraps.
  orbShow(seconds, show, only);
  const since = seconds - CAST_PHASE, slot = Math.floor(since / ORB_HOLD), into = since - slot * ORB_HOLD;
  frame[ORB_AT + 6] = only >= 0 ? ((seconds % HELD_WRAP) + HELD_WRAP) % HELD_WRAP : into + CLOCK_SPREAD * orbHash(slot, 7, 0, 3);
  frame[ORB_AT + 7] = only >= 0 ? frame[ORB_AT + 6]! : into + ORB_HOLD + CLOCK_SPREAD * orbHash(slot - 1, 7, 0, 3);
  frame[ORB_AT + 8] = show.scene;
  frame[ORB_AT + 9] = show.before;
  frame[ORB_AT + 10] = show.wipe;
  frame[ORB_AT + 11] = orbLevel(frame[FRAME.exposure]!) * gain;
  // A clip, its poster or the scenes: a change of what shows is a wipe, from what showed.
  // With no screen at all, nothing is wiped from.
  if (!screen) shown.key = -1;
  const key = screen && screen.shows >= 0 && screen.width > 0 ? screen.shows : -1;
  if (key !== shown.key) {
    shown.dark = shown.key >= 0 && key >= 0;
    shown.before = shown.key >= 0 ? ORB_SCREEN : show.scene;
    shown.key = key;
    shown.at = seconds;
  }
  const wiped = (seconds - shown.at) / ORB_WIPE;
  if (!(wiped >= 0) || wiped >= 1) shown.at = -Infinity;
  const wiping = wiped >= 0 && wiped < 1;
  if (key >= 0 || wiping) {
    if (key >= 0) {
      frame[ORB_AT + 7] = frame[ORB_AT + 6]!;
      frame[ORB_AT + 6] = screen!.seconds;
      frame[ORB_AT + 8] = ORB_SCREEN;
    }
    frame[ORB_AT + 9] = wiping ? shown.before : ORB_SCREEN;
    frame[ORB_AT + 10] = wiping ? wiped : 1;
    frame[SCREEN_AT + 31] = wiping && shown.dark ? 1 : 0;
  }
  if (screen && screen.width > 0) {
    const ex = -frame[ORB_AT]!, ey = -frame[ORB_AT + 1]!, ez = -frame[ORB_AT + 2]!;
    screenLanes(frame, screen, site, cs * ex - sn * ez, ey, sn * ex + cs * ez, cs, sn);
  }
  // The blue eye's clock runs whether the map has a blue eye or not.
  let blue: TideEyeSite | null = null;
  for (let i = 0; i < eyes.length && !blue; i++) if (eyes[i]!.color === "blue") blue = eyes[i]!;
  const phase = eyePhase(seconds, BLUE), power = eyePower(phase);
  sunDirection(hour, sunAt);
  // The sun by day and the moon, opposite it, by night: between them the look passes over the top.
  const up = sstep(-0.05, 0.05, sunAt[1]!), over = 4 * up * (1 - up), side = 2 * up - 1;
  look[0] = side * sunAt[0]!;
  look[1] = side * sunAt[1]! + over;
  look[2] = side * sunAt[2]!;
  lean(look[0]!, look[1]!, look[2]!, 1);
  let ox = 0, oz = 1;
  if (blue) {
    const knot = eyeKnot(blue);
    lean(knot.x - cx, EYE_SKY - cy, knot.z - cz, power);
    ox = blue.x - cx;
    oz = blue.z - cz;
    frame[ORB_AT + 23] = strike(phase, eyeSeed(blue, Math.floor(seconds / EYE_PERIOD)), power, eyeStorm(phase), aperture(phase), struck);
    frame[ORB_AT + 24] = struck.id;
  }
  if (supply) {
    for (const row of supply.rows) {
      supplyPose(row, tick, rate, pose);
      const landed = pose.state === POSE_LANDED;
      if (pose.state !== POSE_FLYING && pose.state !== POSE_BRAKING && !(landed && pose.since < 3)) continue;
      lean(pose.x - cx, pose.y - cy, pose.z - cz, sstep(0, 1.2, (tick - row.release) / rate) * (landed ? 1 - sstep(0, 3, pose.since) : 1));
      break;
    }
  }
  // The eye strains up at what is overhead but keeps its heading and stays where the streets can see it.
  const ol = Math.hypot(ox, oz) || 1, flat = Math.hypot(look[0]!, look[2]!);
  const lift = Math.min(GAZE_LIFT, Math.max(GAZE_DIP, look[1]!)), out = Math.sqrt(1 - lift * lift);
  look[0] = out * (flat < 1e-3 ? ox / ol : look[0]! / flat);
  look[2] = out * (flat < 1e-3 ? oz / ol : look[2]! / flat);
  look[1] = lift;
  // Directions go into the orb's own frame, which its heading turns.
  frame[ORB_AT + 12] = cs * look[0]! - sn * look[2]!;
  frame[ORB_AT + 13] = look[1]!;
  frame[ORB_AT + 14] = sn * look[0]! + cs * look[2]!;
  frame[ORB_AT + 15] = power;
  frame[ORB_AT + 16] = cs * sunAt[0]! - sn * sunAt[2]!;
  frame[ORB_AT + 17] = sunAt[1]!;
  frame[ORB_AT + 18] = sn * sunAt[0]! + cs * sunAt[2]!;
  frame[ORB_AT + 19] = orbFill(phase);
  // A change starts level with the ball's middle, on the side the blue eye stands.
  frame[ORB_AT + 20] = (cs * ox - sn * oz) / ol;
  frame[ORB_AT + 22] = (sn * ox + cs * oz) / ol;
}

// ---- The light the ball casts by night and shows in a mirror (orb-light.ts): its colour.

/**
 * Directions the screen's mean is read at, spread evenly over the ball, in MEAN_PARTS parts of 32 that each cover it:
 * one part is read at a time, so a reading costs 32 looks at a scene, and the mean is of all of them. Fewer miss the
 * mean of a scene whose light is in thin lines, as Core's is, by half.
 */
const MEAN_WAYS = 128;
const MEAN_PARTS = 4;
/** The footprint they are read with: a pixel's from about 300 m, where the scenes still show all they have. */
const MEAN_FOOTPRINT = 0.01;
/** Seconds in which every part is read once, and the seconds the colour takes to follow the mean. */
const MEAN_EVERY = 0.1;
const MEAN_EASE = 0.15;
/** The front of a change is a line of light: its share of the ball's skin. */
const LEAD_SHARE = 0.0213;
/** How many times the screen's own light the ball casts on what is round it. Tune it from real frames. */
export const ORB_CAST = 8;

const ways = new Float32Array(MEAN_WAYS * 3);
for (let i = 0; i < MEAN_WAYS; i++) {
  const y = 1 - (2 * (i + 0.5)) / MEAN_WAYS, r = Math.sqrt(1 - y * y), a = i * 2.39996323;
  ways[i * 3] = r * Math.cos(a);
  ways[i * 3 + 1] = y;
  ways[i * 3 + 2] = r * Math.sin(a);
}
const seen = [0, 0, 0];
const whole = new Float64Array(MEAN_PARTS * 3);

/** The sum of what the screen shows at part `part` of the directions, linear and before its level, into `out` from `at`. */
function orbPart(out: Float64Array, at: number, f: ArrayLike<number>, part: number): void {
  let r = 0, g = 0, b = 0;
  const front = f[ORB_AT + 10]! * 1.1 - 0.05;
  for (let i = part * 3; i < MEAN_WAYS * 3; i += MEAN_PARTS * 3) {
    const x = ways[i]!, y = ways[i + 1]!, z = ways[i + 2]!;
    const on = 0.5 - 0.5 * (x * f[ORB_AT + 20]! + y * f[ORB_AT + 21]! + z * f[ORB_AT + 22]!) < front, which = on ? f[ORB_AT + 8]! : f[ORB_AT + 9]!;
    // The screen's mean is the clip's colour track's, the same for every viewer and with no picture read back.
    if (which > 4.5) {
      const dark = !on && f[SCREEN_AT + 31]! > 0.5;
      r += dark ? DARK : f[SCREEN_AT + 40]!;
      g += dark ? DARK : f[SCREEN_AT + 41]!;
      b += dark ? DARK : f[SCREEN_AT + 42]!;
      continue;
    }
    orbScene(seen, f, which, x, y, z, on ? f[ORB_AT + 6]! : f[ORB_AT + 7]!, MEAN_FOOTPRINT, 2);
    r += seen[0]!;
    g += seen[1]!;
    b += seen[2]!;
  }
  out[at] = r;
  out[at + 1] = g;
  out[at + 2] = b;
}

/** The mean from the parts' sums, with the line of light a change's front is. */
function meanOf(out: Float64Array | number[], parts: Float64Array, f: ArrayLike<number>): void {
  const lead = f[ORB_AT + 10]! < 1 ? LEAD_SHARE : 0;
  for (let c = 0; c < 3; c++) {
    let sum = 0;
    for (let k = 0; k < MEAN_PARTS; k++) sum += parts[k * 3 + c]!;
    out[c] = sum / MEAN_WAYS + (c === 0 ? 0.75 : c === 1 ? 0.9 : 1) * lead;
  }
}

/** The mean of what the screen shows over the whole ball, linear and before its level, into `out`: the lanes' scenes read at every direction. */
export function orbMean(out: Float64Array | number[], f: ArrayLike<number>): void {
  for (let k = 0; k < MEAN_PARTS; k++) orbPart(whole, k * 3, f, k);
  meanOf(out, whole, f);
}

/**
 * How much of the ball's cast light shows, 0 by day to 1 on a dark night: by the stops of exposure the level rises
 * over, since by day the sun drowns it; on low poly, which has no exposure, by the sun's height.
 */
export function orbNight(exposure: number, sunY: number): number {
  return exposure > 0 ? sstep(ORB_DAY_STOPS, ORB_NIGHT_STOPS, Math.log2(Math.max(1, exposure))) : 1 - sstep(-0.1, 0.1, sunY);
}

/**
 * The colour of the light an orb casts and shows in a mirror, kept from frame to frame: the screen's mean, a part of it
 * read at a time and followed smoothly, so it never steps; by the screen's level, and for the cast light by the night.
 */
export class OrbCast {
  private readonly parts = new Float64Array(MEAN_PARTS * 3);
  private readonly wanted = new Float64Array(3);
  private readonly mean = new Float64Array(3);
  private part = 0;
  /** The scene's clock, in ms, when a part was last read and at the frame before. */
  private read = -Infinity;
  private last = -Infinity;
  /** The screen's mean light by night, as light after exposure: what the halo shows. Zero by day, with no orb and with its gain at nothing. */
  readonly shown = new Float64Array(3);

  /**
   * Brings the colour to `now` ms and writes it into the frame's lanes, which `writeOrb` has filled: the cast light's
   * (orb-light.ts ORB_COLOUR) and, on a lit frame, what a mirror shows of the ball (ORB_SEEN).
   */
  step(frame: Float32Array, now: number): void {
    const shown = this.shown, mean = this.mean;
    shown[0] = shown[1] = shown[2] = 0;
    const exposure = frame[FRAME.exposure]!, level = frame[ORB_AT + 11]!, night = orbNight(exposure, frame[SUN + 1]!);
    if (!(frame[ORB_AT + 3]! > 0)) {
      this.last = -Infinity;
      return;
    }
    // A mirror shows the ball dark too, where its screen is off.
    const seen = exposure > 0;
    if (seen) frame[ORB_SEEN + 3] = 1;
    // Dark, or by day with nothing to mirror it: nothing is read, and the next frame it shows takes the mean whole.
    if (!(level > 0) || !(seen || night > 0)) {
      this.last = -Infinity;
      return;
    }
    // A clock that stands still or runs back is a tool's or a new world's: every part is read and the mean taken whole.
    const still = !(now > this.last), dt = (now - this.last) / 1000;
    if (still || dt > 1) {
      for (let k = 0; k < MEAN_PARTS; k++) orbPart(this.parts, k * 3, frame, k);
      this.read = now;
    } else if (now - this.read >= (MEAN_EVERY * 1000) / MEAN_PARTS) {
      orbPart(this.parts, this.part * 3, frame, this.part);
      this.part = (this.part + 1) % MEAN_PARTS;
      this.read = now;
    }
    meanOf(this.wanted, this.parts, frame);
    const k = still || dt > 1 ? 1 : 1 - Math.exp(-dt / MEAN_EASE);
    this.last = now;
    for (let c = 0; c < 3; c++) {
      mean[c] = mean[c]! + (this.wanted[c]! - mean[c]!) * k;
      shown[c] = mean[c]! * level * night;
      if (exposure > 0) {
        frame[ORB_COLOUR + c] = (shown[c]! * ORB_CAST) / exposure;
        if (seen) frame[ORB_SEEN + c] = (mean[c]! * level) / exposure;
      }
    }
  }
}
