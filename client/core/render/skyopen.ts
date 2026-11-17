// How much of the sky a place sees, and how near a standing thing is to the ground under it, by which the lit tiers
// scale the sky's light and its reflection (surface.ts lit's occlusion). The sun's light is the shadows' alone. Both are
// made of the city's outline as the far shadow holds it (farshadow.ts): a building is the column of its 4 m cells' tops
// down to the ground, so nothing is hidden under a roof or inside a frame, and a creature hides nothing. A window's
// reveal or a box's joint waits for a pass over the picture.
//
// - The measure: over each cell of the far shadow's grid, the share of the sky its city hides from the top of its
//   column, how much more of it lies toward +x than -x and toward +z than -z, and how it falls with height. Lines are
//   swept from the buildings' tops along OPEN_WAYS ways round and OPEN_HEIGHTS heights up the sky, each an equal share
//   of the sky's solid angle, as the far shadow sweeps along the sun; a cell takes each line that passes over its top.
//   The ground hides nothing, so open ground beside no building is as it was. Over open ground the hidden share falls
//   with the square of the height over the ground, as it does in a street, which keeps its walls hidden until near
//   their tops, to none at a height fitted to its area over height. A cell a building stands in takes its ground's
//   shares from the cells round it, and falls from that to its roof's own, so a lookup beside a wall or under a roof's
//   edge reads the street's.
// - A wall reads the share hidden on the side it faces, so its own building, which its sky's light already leaves out,
//   is not counted again, and a tower in the open keeps its light.
// - Contact: a standing thing's sky is taken down over the last CONTACT_BAND metres over the ground under it, on its
//   faces not turned up, so a deck or a roof is not darkened as ground is. The ground is the whole map's heights picture
//   on the card, split as the ground's tiles split it.
// - On the card: four bytes a cell on its own unit, filtered: the share hidden at the ground, the fourth root of how fast
//   it falls with the square of height, never under 1 where there is a measure, and how much more is hidden toward +x
//   and toward +z, from 128. A cell with its second byte 0 hides nothing and holds no contact, so a texture not yet
//   made, or not yet all sent, takes no light away.
//
// It is made where the far shadow's map is swept, on the far city's workers in the browser, when the statics come, and
// again when pieces that stood are gone, at most once every OPEN_EVERY.

import type { Heightfield } from "../../../shared/world/heightfield.ts";
import { FRAME, type FramePacket } from "./packet.ts";

/** Ways round the sky the measure sweeps, and heights up it, each band of heights an equal share of the sky's solid angle. */
export const OPEN_WAYS = 16;
export const OPEN_HEIGHTS = 4;
/** The share of the sky's light a place loses with all its sky hidden: the rest is light the street sends back. */
export const OPEN_STRENGTH = 0.55;
/** Cells a lookup is moved out across the ground along a surface's normal, so a wall reads the street before it more than its own cell. */
export const OPEN_OUT = 0.5;
/**
 * The most the hidden share falls with the square of the height that the bytes hold, a square metre (all of it gone 4 m
 * up), and how far a line must pass over a cell's top to hide its sky, in metres.
 */
export const BEND_MOST = 0.0625;
export const OPEN_SLACK = 0.5;
/** Metres a cell's top stands over its ground for a building to stand in it. */
export const SOLID_RISE = 1;
/** How much of the sky's light the foot of a standing thing loses, and over how many metres over the ground that goes. */
export const CONTACT = 0.35;
export const CONTACT_BAND = 1.5;
/** The least time between measures made again for pieces gone, in milliseconds. */
export const OPEN_EVERY = 30000;

/** Bytes a cell of the measure. */
export const OPEN_BYTES = 4;
/** The third and fourth bytes' zero, and their steps from it to a whole share. */
const SIDE_ZERO = 128;
const SIDE_STEPS = 254;

/** A number as GLSL writes it. */
const g = (n: number): string => (Number.isInteger(n) ? n.toFixed(1) : String(n));

/** What a measure is: its cells across and down, and OPEN_BYTES a cell, row by row. */
export interface OpenMap {
  readonly w: number;
  readonly h: number;
  readonly bytes: Uint8Array;
}

let lines = new Float64Array(0);

/**
 * Sweeps lines along the unit way (dx, dz) from `cast`, the tops of the cells buildings stand in and 0 for the rest,
 * over `top`, `w` by `h` cells, one set for each of `rises`, the units of the heights a line climbs a cell across the
 * ground. At each cell a line passes over by more than `slack` units it adds `weight` to `hidden`, `weight` times how far
 * over to `over`, and `weight` toward the way's side along x and z to `sideX` and `sideZ`. A cell takes the line nearest
 * its middle before that line meets the cell itself, as farshadow.ts `sweep` does.
 */
function sweepSky(top: Uint16Array, cast: Uint16Array, w: number, h: number, dx: number, dz: number, rises: readonly number[], slack: number, weight: number, sums: { hidden: Float32Array; over: Float32Array; sideX: Float32Array; sideZ: Float32Array }): void {
  const { hidden, over, sideX, sideZ } = sums;
  const alongX = Math.abs(dx) >= Math.abs(dz);
  const a = alongX ? dx : dz, b = alongX ? dz : dx;
  const major = alongX ? w : h, minor = alongX ? h : w;
  const slope = b / a;
  const k = rises.length;
  const drops = rises.map((r) => r / Math.abs(a));
  const wx = Math.sign(dx) * weight, wz = Math.sign(dz) * weight;
  const di = alongX ? 1 : w, dj = alongX ? w : 1;
  const span = (minor + 2 * major) * k;
  if (lines.length < span) lines = new Float64Array(span);
  lines.fill(-Infinity, 0, span);
  for (let n = 0; n < major; n++) {
    const i = a > 0 ? major - 1 - n : n;
    const q = Math.round(-slope * i) + major;
    for (let j = 0; j < minor; j++) {
      const c = i * di + j * dj;
      const t = top[c]!, up = cast[c]!;
      for (let e = 0, at = (j + q) * k; e < k; e++, at++) {
        const line = lines[at]!;
        if (line > t + slack) {
          hidden[c]! += weight;
          over[c]! += weight * (line - t);
          sideX[c]! += wx;
          sideZ[c]! += wz;
        }
        lines[at] = (line > up ? line : up) - drops[e]!;
      }
    }
  }
}

let spare = new Float32Array(0);

/** `a`, `w` by `h`, filtered by a tent over each cell and the two either side, along each axis, its edges held. */
function soften(a: Float32Array, w: number, h: number): void {
  if (spare.length < w * h) spare = new Float32Array(w * h);
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) spare[j * w + i] = (a[j * w + Math.max(0, i - 1)]! + 2 * a[j * w + i]! + a[j * w + Math.min(w - 1, i + 1)]!) / 4;
  }
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) a[j * w + i] = (spare[Math.max(0, j - 1) * w + i]! + 2 * spare[j * w + i]! + spare[Math.min(h - 1, j + 1) * w + i]!) / 4;
  }
}

/**
 * The measure of a map's solid heights and ground (farshadow.ts chunkSolid), `nx` by `nz` cells of `cell` metres in
 * `unit` metres a step, its cells pooled `k` a side: a coarse cell's top the highest of its own, its ground their mean.
 */
export function openMeasure(solid: Uint16Array, ground: Uint16Array, nx: number, nz: number, k: number, cell: number, unit: number): OpenMap {
  const w = Math.ceil(nx / k), h = Math.ceil(nz / k);
  let top = solid, floor = ground;
  if (k > 1) {
    top = new Uint16Array(w * h);
    const sum = new Float64Array(w * h), count = new Uint16Array(w * h);
    for (let j = 0; j < nz; j++) {
      for (let i = 0; i < nx; i++) {
        const at = Math.floor(j / k) * w + Math.floor(i / k);
        if (solid[j * nx + i]! > top[at]!) top[at] = solid[j * nx + i]!;
        sum[at]! += ground[j * nx + i]!;
        count[at]!++;
      }
    }
    floor = Uint16Array.from(sum, (s, c) => Math.round(s / count[c]!));
  }
  const standing = Uint8Array.from(top, (t, c) => ((t - floor[c]!) * unit > SOLID_RISE ? 1 : 0));
  const cast = Uint16Array.from(top, (t, c) => (standing[c] ? t : 0));
  const sums = { hidden: new Float32Array(w * h), over: new Float32Array(w * h), sideX: new Float32Array(w * h), sideZ: new Float32Array(w * h) };
  const { hidden, over, sideX, sideZ } = sums;
  const weight = 1 / (OPEN_WAYS * OPEN_HEIGHTS);
  const rises = Array.from({ length: OPEN_HEIGHTS }, (_, e) => (cell * k * Math.tan(Math.asin((e + 0.5) / OPEN_HEIGHTS))) / unit);
  for (let r = 0; r < OPEN_WAYS; r++) {
    const way = ((r + 0.5) / OPEN_WAYS) * 2 * Math.PI;
    sweepSky(top, cast, w, h, Math.cos(way), Math.sin(way), rises, OPEN_SLACK / unit, weight, sums);
  }
  // Open ground: the share hidden at the ground, and how fast it falls with the square of height, so that its area over
  // height is the swept one: share (1 - (y / top)^2) has the area 2/3 share top.
  const share = new Float32Array(w * h), reach = new Float32Array(w * h);
  const queue = new Int32Array(w * h);
  let tail = 0;
  for (let c = 0; c < w * h; c++) {
    if (standing[c]) {
      sideX[c] = sideZ[c] = 0;
      continue;
    }
    share[c] = Math.min(1, hidden[c]!);
    reach[c] = over[c]! > 0 ? (1.5 * over[c]! * unit) / share[c]! : 0;
    queue[tail++] = c;
  }
  // A building's cells take their ground's shares from the cells round them, nearest first, and fall from that to their
  // roof's own share at their top.
  const filled = Uint8Array.from(standing, (s) => 1 - s);
  for (let head = 0; head < tail; head++) {
    const c = queue[head]!;
    const i = c % w, j = (c - i) / w;
    for (const [ni, nj] of [[i - 1, j], [i + 1, j], [i, j - 1], [i, j + 1]] as const) {
      if (ni < 0 || nj < 0 || ni >= w || nj >= h) continue;
      const n = nj * w + ni;
      if (filled[n] !== 0) continue;
      let count = 0;
      for (const [mi, mj] of [[ni - 1, nj], [ni + 1, nj], [ni, nj - 1], [ni, nj + 1]] as const) {
        const m = mj * w + mi;
        if (mi < 0 || mj < 0 || mi >= w || mj >= h || filled[m] === 0) continue;
        share[n]! += share[m]!;
        sideX[n]! += sideX[m]!;
        sideZ[n]! += sideZ[m]!;
        count++;
      }
      share[n]! /= count;
      sideX[n]! /= count;
      sideZ[n]! /= count;
      filled[n] = 1;
      queue[tail++] = n;
    }
  }
  // The ground's shares softened over the cells next to each, so that where an outline steps across a wall turned to the
  // grid the ground beside it does not step with it; it is gone at the same height.
  for (const a of [share, sideX, sideZ]) soften(a, w, h);
  const bytes = new Uint8Array(w * h * OPEN_BYTES);
  for (let c = 0; c < w * h; c++) {
    const rise = standing[c] ? (top[c]! - floor[c]!) * unit : reach[c]!;
    const bend = rise > 0 ? Math.max(0, share[c]! - (standing[c] ? Math.min(1, hidden[c]!) : 0)) / (rise * rise) : 0;
    bytes[c * 4] = Math.round(share[c]! * 255);
    bytes[c * 4 + 1] = Math.max(1, Math.round(Math.sqrt(Math.sqrt(Math.min(1, bend / BEND_MOST))) * 255));
    bytes[c * 4 + 2] = SIDE_ZERO + Math.round(sideX[c]! * SIDE_STEPS);
    bytes[c * 4 + 3] = SIDE_ZERO + Math.round(sideZ[c]! * SIDE_STEPS);
  }
  return { w, h, bytes };
}

/**
 * The share of the sky's light a camera-relative point gets, 0 to 1, from the measure as the card holds it, `w` by `h`
 * cells, filtered between the four about it as the card filters: its face's normal (nx, nz across the ground, ny up)
 * moves the lookup out and turns it to the side it faces, `over` is its height over the ground under it (0 for the
 * ground), and `contact` is 1 for a thing that stands, 0 for one that does not, such as a body. Where the card holds no
 * measure it takes nothing. The twin of SKY_OPEN_GLSL's `skyOpen`.
 */
export function skyOpen(map: Uint8Array, w: number, h: number, frame: Float32Array, rx: number, rz: number, nx: number, ny: number, nz: number, over: number, contact: number): number {
  const s = Math.abs(frame[FRAME.farScale]!);
  if (s <= 0) return 1;
  const m = [0, 0, 0, 0];
  if (w > 0 && h > 0) {
    const tx = rx * s + frame[FRAME.farAt]! + nx * OPEN_OUT - 0.5, tz = rz * s + frame[FRAME.farAt + 1]! + nz * OPEN_OUT - 0.5;
    const bx = Math.floor(tx), bz = Math.floor(tz);
    const fx = tx - bx, fz = tz - bz;
    const at = (i: number, j: number, b: number): number => map[(Math.min(h - 1, Math.max(0, j)) * w + Math.min(w - 1, Math.max(0, i))) * OPEN_BYTES + b]! / 255;
    for (let b = 0; b < OPEN_BYTES; b++) m[b] = (at(bx, bz, b) * (1 - fx) + at(bx + 1, bz, b) * fx) * (1 - fz) + (at(bx, bz + 1, b) * (1 - fx) + at(bx + 1, bz + 1, b) * fx) * fz;
  }
  const known = m[1]! >= 0.5 / 255 ? 1 : 0;
  const toward = known * (nx * (m[2]! * 255 - SIDE_ZERO) + nz * (m[3]! * 255 - SIDE_ZERO)) / SIDE_STEPS;
  const up = Math.max(over, 0);
  const hidden = Math.min(1, Math.max(0, m[0]! + toward - m[1]! ** 4 * BEND_MOST * up * up));
  const near = Math.min(1, Math.max(0, 1 - over / CONTACT_BAND));
  return (1 - OPEN_STRENGTH * hidden) * (1 - known * contact * CONTACT * near * near * (1 - Math.max(ny, 0)));
}

/** Far over anything, for a point with no ground known under it. */
const NO_GROUND = 1e6;

/**
 * How far a camera-relative point stands over the ground under it, in metres, from the whole map's heights picture,
 * every `coarse`-th sample (terrain.ts COARSE), as the ground's tiles split its cells: the twin of OVER_GROUND_GLSL's
 * `overGround`, which takes the field's floor, step and the picture's spacing from `uField`.
 */
export function overGround(hf: Heightfield, coarse: number, frame: Float32Array, camY: number, rx: number, ry: number, rz: number): number {
  const s = Math.abs(frame[FRAME.farScale]!);
  if (s <= 0) return NO_GROUND;
  const spacing = hf.cell * coarse;
  const lastX = Math.ceil((hf.nx - 1) / coarse), lastZ = Math.ceil((hf.nz - 1) / coarse);
  const u = Math.min(lastX, Math.max(0, (rx * s + frame[FRAME.farAt]!) / (s * spacing)));
  const v = Math.min(lastZ, Math.max(0, (rz * s + frame[FRAME.farAt + 1]!) / (s * spacing)));
  const i = Math.min(Math.floor(u), lastX - 1), j = Math.min(Math.floor(v), lastZ - 1);
  const fu = u - i, fv = v - j;
  const at = (a: number, b: number): number => hf.heights[Math.min(b * coarse, hf.nz - 1) * hf.nx + Math.min(a * coarse, hf.nx - 1)]!;
  const h00 = at(i, j), h11 = at(i + 1, j + 1);
  const q = fu >= fv ? h00 + (at(i + 1, j) - h00) * fu + (h11 - at(i + 1, j)) * fv : h00 + (h11 - at(i, j + 1)) * fu + (at(i, j + 1) - h00) * fv;
  return ry + camY - (hf.minY + q * hf.stepY);
}

/**
 * The lookups as GLSL, which a lit program includes after the frame block and SHADOW_GLSL, whose names for the far
 * shadow's lanes it reads: where the camera is on the grid, and its texels a metre, of either sign.
 */
export const SKY_OPEN_GLSL = `uniform highp sampler2D uSkyOpen;
float skyOpen(vec3 rel, vec3 normal, float over, float contact) {
  float s = abs(fFarScale);
  if (s <= 0.0) return 1.0;
  vec4 m = texture(uSkyOpen, (rel.xz * s + fFarAt + normal.xz * ${g(OPEN_OUT)}) / vec2(textureSize(uSkyOpen, 0)));
  float known = m.y >= ${g(0.5 / 255)} ? 1.0 : 0.0;
  float toward = known * dot(normal.xz, m.zw * 255.0 - ${g(SIDE_ZERO)}) / ${g(SIDE_STEPS)};
  float up = max(over, 0.0), bend = m.y * m.y;
  float hidden = clamp(m.x + toward - bend * bend * ${g(BEND_MOST)} * up * up, 0.0, 1.0);
  float near = clamp(1.0 - over / ${g(CONTACT_BAND)}, 0.0, 1.0);
  return (1.0 - ${g(OPEN_STRENGTH)} * hidden) * (1.0 - known * contact * ${g(CONTACT)} * near * near * (1.0 - max(normal.y, 0.0)));
}
`;

/** `overGround` as GLSL, for a program that does not draw the ground: `uField` is the field's floor, step, the picture's spacing and the camera's height. */
export const OVER_GROUND_GLSL = `uniform vec4 uField;
uniform highp usampler2D uGroundHeight;
float overGround(vec3 rel) {
  float s = abs(fFarScale);
  if (s <= 0.0 || uField.z <= 0.0) return ${g(NO_GROUND)};
  vec2 last = vec2(textureSize(uGroundHeight, 0) - 1);
  vec2 c = clamp((rel.xz * s + fFarAt) / (s * uField.z), vec2(0.0), last);
  ivec2 k = ivec2(min(floor(c), last - 1.0));
  vec2 f = c - vec2(k);
  float h00 = float(texelFetch(uGroundHeight, k, 0).r), h11 = float(texelFetch(uGroundHeight, k + 1, 0).r);
  float h;
  if (f.x >= f.y) {
    float h10 = float(texelFetch(uGroundHeight, k + ivec2(1, 0), 0).r);
    h = h00 + (h10 - h00) * f.x + (h11 - h10) * f.y;
  } else {
    float h01 = float(texelFetch(uGroundHeight, k + ivec2(0, 1), 0).r);
    h = h00 + (h11 - h01) * f.x + (h01 - h00) * f.y;
  }
  return rel.y + uField.w - uField.x - h * uField.y;
}
`;

/**
 * The measure of one map on the page: the latest made, for which cell, put on the card a frame's allowance of rows at a
 * time, and whether pieces have gone since it was asked for.
 */
export class SkyOpen {
  /** Measures made, and the last one's milliseconds where it was made here. */
  readonly stats = { made: 0, ms: 0 };
  private map: OpenMap | null = null;
  private mapCell = 0;
  private askedCell = 0;
  private askedAt = -Infinity;
  /** Pieces have gone since the measure asked for last. */
  private stale = false;
  /** The next row of the latest to put on the card, and whether the last frame had it on the card. */
  private row = 0;
  private shown = false;

  /** Whether the latest is all on the card, and none is being made. */
  get whole(): boolean {
    return this.map !== null && this.shown && this.row >= this.map.h && this.mapCell === this.askedCell;
  }

  /** After a lost context: the latest goes on the card again. */
  reset(): void {
    this.shown = false;
  }

  /** Notes that pieces that stood are gone. */
  changed(): void {
    this.stale = true;
  }

  /** Whether a measure should be asked for at `now` (milliseconds) for a grid of `cell` metres. */
  due(cell: number, now: number): boolean {
    return this.askedCell !== cell || (this.stale && now - this.askedAt >= OPEN_EVERY);
  }

  asked(cell: number, now: number): void {
    this.askedCell = cell;
    this.askedAt = now;
    this.stale = false;
  }

  got(map: OpenMap, ms = 0): void {
    this.map = map;
    this.mapCell = this.askedCell;
    this.row = 0;
    this.stats.made++;
    this.stats.ms = ms;
  }

  /**
   * Says on the packet how big the measure on the card is for a grid of `cell` metres, none while there is none for it,
   * as on a frame of low poly (cell 0), when the card lets it go, and puts rows of the latest on it from `budget`'s
   * allowance, from the first again where the last frame did not have it.
   */
  upload(p: FramePacket, budget: { readonly left: number; spend(bytes: number): void }, cell: number): void {
    const map = this.map;
    if (!map || this.mapCell !== cell) {
      this.shown = false;
      return;
    }
    if (!this.shown) this.row = 0;
    this.shown = true;
    p.openWidth = map.w;
    p.openHeight = map.h;
    if (this.row >= map.h) return;
    const row = map.w * OPEN_BYTES;
    const rows = Math.min(map.h - this.row, Math.floor(budget.left / row));
    if (rows <= 0) return;
    p.openMap = map.bytes.subarray(this.row * row, (this.row + rows) * row);
    p.openRow = this.row;
    p.openRows = rows;
    budget.spend(rows * row);
    this.row += rows;
  }
}
