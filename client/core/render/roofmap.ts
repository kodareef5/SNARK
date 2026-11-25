// The map of what stands overhead round the camera (roof.ts): made from the map's own pieces in slices between frames,
// and put on the card whole once made. It is kept out of the script a page waits for before its first frame (D873),
// like the far city it is made from, and comes to the scene with it (city-late.ts).
//
// The second layer's fourth byte is how much of each cell's ground the sun is on, made again when the sun has moved
// SUN_MOVE: the pieces' tops over the ground (each piece's box grown by half a cell, so a thin wall is whole) as a
// height field, a ray from each cell's ground toward the sun over it, then softened over the cells about each by
// SUN_SOFTEN tents, so that what is lit falls off over a couple of metres and a face's light from the ground does not
// show the shadows' edges. Bodies and trees are not in it: the shadow maps add them near the ground (roof.ts).

import { CHUNK_SIZE, YAW_UNITS, chunkCount, type MapDims } from "../../../shared/coords.ts";
import { TAU, detCos, detSin } from "../../../shared/math/scalar.ts";
import type { CityStatics, CityTable, Gone } from "../../../shared/world/city.ts";
import type { Heightfield } from "../../../shared/world/heightfield.ts";
import { linearToSrgb } from "./color-space.ts";
import { ROOF_AT, type FramePacket } from "./packet.ts";
import { GROUND, ROOF_BYTES, ROOF_LAYERS, ROOF_SIDE, SIDE_STEPS, SIDE_ZERO } from "./roof.ts";

/** How far the camera goes from the window's middle before one is made round it again, in metres. */
export const ROOF_MOVE = 48;
/** The least height of a piece's underside over its ground for it to roof what is under it, and the most a roof holds. */
export const ROOF_CLEAR = 1.8;
export const ROOF_TOP = 255 / 16;
/**
 * Slices of the bake a frame takes, a chunk's pieces or SLICE_CELLS roofed cells' rays each, about a tenth of a
 * millisecond on an M5, so that a frame is the same whatever the machine; and the least milliseconds of the scene's
 * clock between maps made again where they are for pieces gone.
 */
export const ROOF_STEPS = 24;
export const ROOF_EVERY = 5000;
const SLICE_CELLS = 32;
/** Cells a slice of the sun's rays takes, and how far the sun moves before they are cast again, in radians. */
const SUN_CELLS = 64;
export const SUN_MOVE = (0.5 * Math.PI) / 180;
/** Metres over its ground a cell's top stands for its ground to be under it and out of the sun, the height a ray leaves the ground at, and the tents it is softened by. */
const SUN_UNDER = 0.3;
const SUN_FROM = 0.2;
const SUN_SOFTEN = 2;

/** Ways round and heights up the rays take, how high over the floor they leave, and how far they go under cover. */
const WAYS = 16;
const HEIGHTS = 3;
const RAY_FROM = 1;
const RAY_MOST = 16;
/** The cells past a roof's edge its height is spread to. */
const SPREAD = 2;
/** The most a piece lying on the ground stands over it, in metres, for its colour to be the ground's. */
const LYING = 0.6;
/** The sky table's ground as an sRGB byte. */
const GREY_BYTE = Math.round(linearToSrgb(GROUND) * 255);
/** The rays' ways across the ground and how far each climbs a metre, each height's share of an upward face's light and of an upright face's. */
const rayX = new Float64Array(WAYS * HEIGHTS), rayZ = new Float64Array(WAYS * HEIGHTS), rayRise = new Float64Array(WAYS * HEIGHTS);
const rayUp = new Float64Array(WAYS * HEIGHTS), rayFlat = new Float64Array(WAYS * HEIGHTS);
for (let w = 0; w < WAYS; w++) {
  for (let e = 0; e < HEIGHTS; e++) {
    const a = ((w + 0.5) / WAYS) * TAU, up = (e + 0.5) / HEIGHTS, flat = Math.sqrt(1 - up * up);
    const r = w * HEIGHTS + e;
    rayX[r] = Math.cos(a);
    rayZ[r] = Math.sin(a);
    rayRise[r] = up / flat;
    rayUp[r] = up;
    rayFlat[r] = flat;
  }
}
const UP_ALL = rayUp.reduce((s, v) => s + v, 0);

/**
 * The window of `side` cells a side from world corner (x0, z0) of `city`'s standing pieces over `hf`, ROOF_BYTES a cell
 * into `out`, row by row along z, its ROOF_LAYERS one after the other: made a slice at a time, yielding between slices.
 * `gone` gives a chunk's pieces that no longer stand, and `palette` the colours, four bytes each, the ground's tint and
 * a piece's colour name; with none the ground is the sky table's grey.
 */
export function* roofSteps(city: CityStatics, hf: Heightfield, gone: (chunk: number) => Gone, x0: number, z0: number, side: number, out: Uint8Array, palette: Uint8Array | null = null, tops: Float32Array = new Float32Array(side * side), sun: ArrayLike<number> | null = null): Generator<void, void> {
  const under = new Float32Array(side * side).fill(Infinity);
  tops.fill(0);
  // The ground's colour: its tint at the nearest sample, then the highest flat piece lying on it.
  const ground = out.subarray(side * side * ROOF_BYTES);
  const lying = new Float32Array(side * side).fill(-Infinity);
  for (let c = 0; c < side * side; c++) {
    const x = c % side, z = (c - x) / side;
    const i = Math.min(hf.nx - 1, Math.max(0, Math.round((x0 + x + 0.5) / hf.cell))), j = Math.min(hf.nz - 1, Math.max(0, Math.round((z0 + z + 0.5) / hf.cell)));
    groundColour(ground, c, palette, palette && hf.tinted ? hf.tintOf(i, j) : -1);
  }
  const d: MapDims = city.dims;
  const i0 = Math.max(0, Math.floor(x0 / CHUNK_SIZE) - 1), i1 = Math.min(d.chunksX - 1, Math.floor((x0 + side) / CHUNK_SIZE) + 1);
  const j0 = Math.max(0, Math.floor(z0 / CHUNK_SIZE) - 1), j1 = Math.min(d.chunksZ - 1, Math.floor((z0 + side) / CHUNK_SIZE) + 1);
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) {
      const c = j * d.chunksX + i;
      if (c >= chunkCount(d)) continue;
      const t = city.rows(c), lost = gone(c), from = t?.from(c) ?? 0;
      for (let p = from; t && p < t.to(c); p++) if (!lost || lost[p - from] !== 1) roofPiece(city, t, p, hf, x0, z0, side, under, lying, ground, palette, tops);
      yield;
    }
  }
  // The underside's height spread past a roof's edge, so a point's test against it holds across the filter.
  const height = Float32Array.from(under, (u) => (u === Infinity ? 0 : u));
  for (let pass = 0; pass < SPREAD; pass++) {
    const from = Float32Array.from(height);
    for (let c = 0; c < side * side; c++) {
      if (under[c] !== Infinity) continue;
      const x = c % side, z = (c - x) / side;
      let most = from[c]!;
      if (x > 0) most = Math.max(most, from[c - 1]!);
      if (x < side - 1) most = Math.max(most, from[c + 1]!);
      if (z > 0) most = Math.max(most, from[c - side]!);
      if (z < side - 1) most = Math.max(most, from[c + side]!);
      height[c] = most;
    }
  }
  for (let c = 0; c < side * side; c++) {
    out[c * ROOF_BYTES] = Math.min(255, Math.round(height[c]! * 16));
    out[c * ROOF_BYTES + 1] = 255;
    out[c * ROOF_BYTES + 2] = SIDE_ZERO;
    out[c * ROOF_BYTES + 3] = SIDE_ZERO;
  }
  const got = new Uint8Array(WAYS * HEIGHTS);
  let cells = 0;
  for (let z = 0; z < side; z++) {
    for (let x = 0; x < side; x++) {
      const c = z * side + x;
      if (under[c] === Infinity) continue;
      if (++cells % SLICE_CELLS === 0) yield;
      let up = 0, vx = 0, vz = 0;
      for (let r = 0; r < WAYS * HEIGHTS; r++) {
        got[r] = rayOut(under, side, x + 0.5, z + 0.5, rayX[r]!, rayZ[r]!, rayRise[r]!) ? 1 : 0;
        if (got[r] === 0) continue;
        up += rayUp[r]!;
        vx += rayFlat[r]! * rayX[r]!;
        vz += rayFlat[r]! * rayZ[r]!;
      }
      const share = up / UP_ALL, way = Math.hypot(vx, vz);
      let more = 0;
      if (way > 1e-9) {
        // How much of an upright face's sky gets out when it faces the way most of it does, less what a face up keeps.
        let seen = 0, all = 0;
        for (let r = 0; r < WAYS * HEIGHTS; r++) {
          const w = rayFlat[r]! * Math.max(0, (rayX[r]! * vx + rayZ[r]! * vz) / way);
          all += w;
          if (got[r] === 1) seen += w;
        }
        more = Math.max(0, Math.min(1, seen / all) - share);
      }
      out[c * ROOF_BYTES + 1] = Math.round(share * 255);
      out[c * ROOF_BYTES + 2] = SIDE_ZERO + Math.round(way > 1e-9 ? (more * vx * SIDE_STEPS) / way : 0);
      out[c * ROOF_BYTES + 3] = SIDE_ZERO + Math.round(way > 1e-9 ? (more * vz * SIDE_STEPS) / way : 0);
    }
  }
  yield* sunSteps(tops, side, sun, out);
}

/**
 * How much of each cell's ground the sun is on, into the fourth byte of `out`'s second layer, from `tops`, the pieces'
 * tops over the ground, `side` cells a side, for `sun`, the unit vector toward it, or all of it with no sun up: a slice
 * of SUN_CELLS cells at a time.
 */
export function* sunSteps(tops: Float32Array, side: number, sun: ArrayLike<number> | null, out: Uint8Array): Generator<void, void> {
  const lit = new Float32Array(side * side).fill(1);
  const flat = sun ? Math.hypot(sun[0]!, sun[2]!) : 0;
  if (sun && sun[1]! > 0) {
    let most = 0;
    for (let c = 0; c < side * side; c++) most = Math.max(most, tops[c]!);
    const dx = flat > 1e-6 ? sun[0]! / flat : 0, dz = flat > 1e-6 ? sun[2]! / flat : 0, rise = flat > 1e-6 ? sun[1]! / flat : Infinity;
    for (let c = 0; c < side * side; c++) {
      if (c % SUN_CELLS === SUN_CELLS - 1) yield;
      if (tops[c]! > SUN_UNDER) {
        lit[c] = 0;
        continue;
      }
      const x = (c % side) + 0.5, z = Math.floor(c / side) + 0.5;
      for (let r = 1; SUN_FROM + rise * r <= most; r++) {
        const i = Math.floor(x + dx * r), j = Math.floor(z + dz * r);
        if (i < 0 || j < 0 || i >= side || j >= side) break;
        if (tops[j * side + i]! > SUN_FROM + rise * r) {
          lit[c] = 0;
          break;
        }
      }
    }
  }
  const spare = new Float32Array(side * side);
  for (let pass = 0; pass < SUN_SOFTEN; pass++) {
    for (let c = 0; c < side * side; c++) {
      const x = c % side;
      spare[c] = (lit[x > 0 ? c - 1 : c]! + 2 * lit[c]! + lit[x < side - 1 ? c + 1 : c]!) / 4;
    }
    for (let c = 0; c < side * side; c++) lit[c] = (spare[c >= side ? c - side : c]! + 2 * spare[c]! + spare[c < side * (side - 1) ? c + side : c]!) / 4;
  }
  const ground = out.subarray(side * side * ROOF_BYTES);
  for (let c = 0; c < side * side; c++) ground[c * ROOF_BYTES + 3] = Math.round(lit[c]! * 255);
}

/**
 * Marks in `under` each cell of the window whose middle piece `p`'s turned box covers, with its underside's height over
 * the ground, where it roofs; and where it lies flat on the ground and is the highest such, gives the cell its colour
 * in `ground`, its top's height in `lying`.
 */
function roofPiece(city: CityStatics, t: CityTable, p: number, hf: Heightfield, x0: number, z0: number, side: number, under: Float32Array, lying: Float32Array, ground: Uint8Array, palette: Uint8Array | null, tops: Float32Array): void {
  const k = t.kind[p]!;
  const hx = city.halfX[k]!, hz = city.halfZ[k]!;
  const px = t.x[p]!, pz = t.z[p]!;
  const floor = hf.heightAt(px, pz);
  const rise = t.y[p]! - city.halfY[k]! - floor, top = t.y[p]! + city.halfY[k]! - floor;
  const lies = palette !== null && top < LYING && rise < LYING;
  const roofs = hx * hz >= 0.25 && rise >= ROOF_CLEAR && rise <= ROOF_TOP;
  // What stands over the ground keeps the sun off it, a piece grown by half a cell so a thin wall is whole.
  const blocks = top >= LYING && hx * hz >= 0.01;
  if (!lies && !roofs && !blocks) return;
  const a = t.yaw[p]! * (TAU / YAW_UNITS), sn = detSin(a), cs = detCos(a);
  const ex = Math.abs(cs) * hx + Math.abs(sn) * hz + 0.5, ez = Math.abs(sn) * hx + Math.abs(cs) * hz + 0.5;
  const cx0 = Math.max(0, Math.floor(px - ex - x0)), cx1 = Math.min(side - 1, Math.floor(px + ex - x0));
  const cz0 = Math.max(0, Math.floor(pz - ez - z0)), cz1 = Math.min(side - 1, Math.floor(pz + ez - z0));
  for (let cz = cz0; cz <= cz1; cz++) {
    const dz = z0 + cz + 0.5 - pz;
    for (let cx = cx0; cx <= cx1; cx++) {
      const dx = x0 + cx + 0.5 - px;
      const across = Math.abs(dx * cs - dz * sn), along = Math.abs(dx * sn + dz * cs);
      const c = cz * side + cx;
      if (blocks && across < hx + 0.5 && along < hz + 0.5 && top > tops[c]!) tops[c] = top;
      if (across >= hx || along >= hz) continue;
      if (roofs) {
        if (rise < under[c]!) under[c] = rise;
      } else if (lies && top > lying[c]!) {
        lying[c] = top;
        groundColour(ground, c, palette, city.color[k]!);
      }
    }
  }
}

/** Puts palette colour `index` as cell `c`'s ground colour, or the sky table's grey with no palette or index. */
function groundColour(ground: Uint8Array, c: number, palette: Uint8Array | null, index: number): void {
  for (let b = 0; b < 3; b++) ground[c * ROOF_BYTES + b] = palette && index >= 0 ? palette[index * 4 + b]! : GREY_BYTE;
}

/** `sun` into `out`, 0 0 0 for none. */
function sunOf(sun: ArrayLike<number> | null, out: Float64Array): void {
  out[0] = sun ? sun[0]! : 0;
  out[1] = sun ? sun[1]! : 0;
  out[2] = sun ? sun[2]! : 0;
}

/** Whether the sun has moved SUN_MOVE from `was` (0 0 0 for none), or come up or gone down. */
function moved(was: Float64Array, sun: ArrayLike<number> | null): boolean {
  const none = was[0] === 0 && was[1] === 0 && was[2] === 0;
  if (!sun || none) return !sun !== none;
  return was[0]! * sun[0]! + was[1]! * sun[1]! + was[2]! * sun[2]! < Math.cos(SUN_MOVE);
}

/** Whether a ray from (x, z), in cells, RAY_FROM over the floor, along (dx, dz) climbing `rise` a metre, gets out from under cover. */
function rayOut(under: Float32Array, side: number, x: number, z: number, dx: number, dz: number, rise: number): boolean {
  for (let r = 1; r <= RAY_MOST; r++) {
    const i = Math.floor(x + dx * r), j = Math.floor(z + dz * r);
    if (i < 0 || j < 0 || i >= side || j >= side) return true;
    const u = under[j * side + i]!;
    if (u === Infinity) return true;
    if (RAY_FROM + rise * r >= u) return false;
  }
  return false;
}

/**
 * The map round the camera on the page: the one on the card and where, the one being made and where, put on the card
 * whole once made, and whether pieces have gone since the one shown was asked for.
 */
export class RoofMap {
  /** Maps made, and the last one's milliseconds of making, summed over its slices, and times its ground was lit again for the sun. */
  readonly stats = { made: 0, ms: 0, lit: 0 };
  private shownMap: Uint8Array | null = null;
  private readonly shownAt = [0, 0];
  private sent = false;
  private making: Generator<void, void> | null = null;
  private makingMap: Uint8Array | null = null;
  private readonly makingAt = [0, 0];
  private makingMs = 0;
  private stale = false;
  private madeAt = -Infinity;
  /** The pieces' tops of the map shown and of the one being made, and the sun the shown one's ground was lit for (0 0 0 for none). */
  private shownTops: Float32Array | null = null;
  private makingTops: Float32Array | null = null;
  private readonly litFor = new Float64Array(3);
  private readonly makingFor = new Float64Array(3);
  private lighting: Generator<void, void> | null = null;
  /** The colours the ground's tint and the pieces name, four bytes each (the pack's palette), or null for the grey ground. */
  palette: Uint8Array | null = null;

  /** Whether the map round the camera is made and on the card: none is being made, and the one shown has gone. */
  get whole(): boolean {
    return this.shownMap !== null && this.making === null && this.lighting === null && this.sent;
  }

  /** After a lost context: the one shown goes on the card again. */
  reset(): void {
    this.sent = false;
  }

  /** Notes that pieces that stood are gone: the window is made again where it is. */
  changed(): void {
    this.stale = true;
  }

  /**
   * Each frame on a tier with roofs, with the camera at (cx, cz): begins a map round it where none is shown or the
   * camera has gone ROOF_MOVE from the middle of the one shown, or lights the shown one's ground again where `sun`, the
   * unit vector toward the sun while it casts, else null, has moved SUN_MOVE; makes ROOF_STEPS slices of either, puts
   * the map on the card once made, and says in the frame block where it is: fRoof.w 2 while it is on the card, for the
   * roof and the light from the ground both, 1 for the roof alone (`?off=bounce`), 0 for neither. `now` is the scene's
   * clock and `clock` the page's, which only times the slices, both in milliseconds.
   */
  update(p: FramePacket, budget: { readonly left: number; spend(bytes: number): void }, city: CityStatics, hf: Heightfield, gone: (chunk: number) => Gone, cx: number, cz: number, now: number, clock: () => number, sun: ArrayLike<number> | null = null): void {
    const f = p.frame, at = ROOF_AT;
    const half = ROOF_SIDE / 2;
    const away = !this.shownMap || Math.max(Math.abs(cx - this.shownAt[0]! - half), Math.abs(cz - this.shownAt[1]! - half)) >= ROOF_MOVE;
    if (!this.making && (away || (this.stale && now - this.madeAt >= ROOF_EVERY))) {
      this.stale = false;
      this.madeAt = now;
      this.makingAt[0] = Math.round(cx / 8) * 8 - half;
      this.makingAt[1] = Math.round(cz / 8) * 8 - half;
      this.makingMap = new Uint8Array(ROOF_SIDE * ROOF_SIDE * ROOF_BYTES * ROOF_LAYERS);
      this.makingTops = new Float32Array(ROOF_SIDE * ROOF_SIDE);
      sunOf(sun, this.makingFor);
      this.making = roofSteps(city, hf, gone, this.makingAt[0]!, this.makingAt[1]!, ROOF_SIDE, this.makingMap, this.palette, this.makingTops, sun);
      this.makingMs = 0;
      this.lighting = null;
    }
    if (!this.making && !this.lighting && this.shownMap && this.shownTops && moved(this.litFor, sun)) {
      sunOf(sun, this.makingFor);
      this.lighting = sunSteps(this.shownTops, ROOF_SIDE, sun, this.shownMap);
    }
    if (this.making || this.lighting) {
      const start = clock();
      for (let k = 0; k < ROOF_STEPS; k++) {
        if (this.making) {
          if (!this.making.next().done) continue;
          this.making = null;
          this.shownMap = this.makingMap;
          this.shownTops = this.makingTops;
          this.shownAt[0] = this.makingAt[0]!;
          this.shownAt[1] = this.makingAt[1]!;
          this.stats.made++;
        } else {
          if (!this.lighting!.next().done) continue;
          this.lighting = null;
          this.stats.lit++;
        }
        this.litFor.set(this.makingFor);
        this.sent = false;
        break;
      }
      this.makingMs += clock() - start;
      if (!this.making) this.stats.ms = this.makingMs;
    }
    const map = this.shownMap;
    if (map && !this.sent && budget.left >= map.length) {
      p.roofMap = map;
      budget.spend(map.length);
      this.sent = true;
    }
    p.roofSide = map && this.sent ? ROOF_SIDE : 0;
    f[at] = this.shownAt[0]! - cx;
    f[at + 1] = this.shownAt[1]! - cz;
    f[at + 2] = ROOF_SIDE;
    f[at + 3] = p.roofSide > 0 ? 2 : 0;
  }
}
