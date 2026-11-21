// What stands overhead: an arcade's slab, an awning, a roof or the floor of a storey over the ground. Under one the lit
// tiers take the sky's light down to what can be seen past its edges, mostly from its open sides, on static pieces, the
// ground and bodies alike (D334). The sky's openness (skyopen.ts) cannot see this: it is made of the city's outline, so
// the floor under an arcade read the street's sky.
//
// - The map: a window ROOF_SIDE metres a side round the camera, a cell a metre, made from the map's own pieces as the
//   far city holds them (CityStatics) when the camera has gone ROOF_MOVE from the middle of the one shown. A piece whose
//   underside stands ROOF_CLEAR or more over its ground roofs each cell whose middle its turned box covers; a cell keeps
//   the lowest underside over it. From each roofed cell, rays leave RAY_FROM over the floor along WAYS ways round and
//   HEIGHTS heights up, each an equal share of the sky; one gets out if it reaches a cell no roof covers before it
//   rises to the roof over where it is, and is taken as stopped after RAY_MOST metres under cover. What got out gives
//   the share of the sky a face turned up keeps there, the way most of it lies, and how much more a face turned that
//   way sees than one turned up. Walls are not in it, so a room deep in a building sees out through them, which keeps a
//   room's light kinder than it would be, never under ROOF_LEAST.
// - On the card: four bytes a cell on its own unit, filtered: the underside's height over the ground in sixteenths of a
//   metre, spread two cells past the roof's edge so the height a point is tested at does not fall away across it; the
//   share a face turned up keeps, 255 where nothing roofs it; and how much more a face turned sideways keeps along x and z,
//   from 128. A cell roofed by nothing keeps everything whatever way it faces, so the filter between a roofed cell and an
//   open one falls smoothly from the one to the other.
// - A point is under a roof when it is below the underside over it, and the share it keeps is the roof's for its face:
//   the share up, plus the more toward the open side, falling to none on a face turned up or down, never under
//   ROOF_LEAST. Over the last ROOF_FADE metres of the window it fades to nothing.
//
// The bake runs a slice at a time between frames, in at most ROOF_STEP_MS a frame, and goes on the card whole in one
// frame once made. The maths is here twice, as functions on numbers for the bake and the software rasterizer and as
// GLSL for the lit programs, which the software rasterizer is held to.

import { CHUNK_SIZE, YAW_UNITS, chunkCount, type MapDims } from "../../../shared/coords.ts";
import { TAU, detCos, detSin } from "../../../shared/math/scalar.ts";
import type { CityStatics, Gone } from "../../../shared/world/city.ts";
import type { Heightfield } from "../../../shared/world/heightfield.ts";
import { ROOF_AT, type FramePacket } from "./packet.ts";

/** Cells a side of the window, a metre each, and how far the camera goes from its middle before one is made round it again. */
export const ROOF_SIDE = 256;
export const ROOF_MOVE = 48;
/** The least height of a piece's underside over its ground for it to roof what is under it, and the most a roof holds. */
export const ROOF_CLEAR = 1.8;
export const ROOF_TOP = 255 / 16;
/** The least share of the sky's light a point under a roof keeps: what the floor and walls about it send back. */
export const ROOF_LEAST = 0.25;
/** Metres at the window's edge over which a roof's shade fades to nothing. */
export const ROOF_FADE = 16;
/** Metres under the underside over which a point goes from out from under it to under it. */
export const ROOF_UNDER = 0.4;
/** Bytes a cell. */
export const ROOF_BYTES = 4;
/** Milliseconds of a frame the bake may take, and the least between maps made again where they are for pieces gone. */
export const ROOF_STEP_MS = 3;
export const ROOF_EVERY = 5000;

/** Ways round and heights up the rays take, how high over the floor they leave, and how far they go under cover. */
const WAYS = 16;
const HEIGHTS = 3;
const RAY_FROM = 1;
const RAY_MOST = 16;
/** A cell the rays left, and the cells past a roof's edge its height is spread to. */
const SPREAD = 2;
const SIDE_ZERO = 128;
const SIDE_STEPS = 127;

/** A number as GLSL writes it. */
const g = (n: number): string => (Number.isInteger(n) ? n.toFixed(1) : String(n));

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
 * into `out`, row by row along z: made a slice at a time, yielding between slices. `gone` gives a chunk's pieces that
 * no longer stand.
 */
export function* roofSteps(city: CityStatics, hf: Heightfield, gone: (chunk: number) => Gone, x0: number, z0: number, side: number, out: Uint8Array): Generator<void, void> {
  const under = new Float32Array(side * side).fill(Infinity);
  const d: MapDims = city.dims;
  const i0 = Math.max(0, Math.floor(x0 / CHUNK_SIZE) - 1), i1 = Math.min(d.chunksX - 1, Math.floor((x0 + side) / CHUNK_SIZE) + 1);
  const j0 = Math.max(0, Math.floor(z0 / CHUNK_SIZE) - 1), j1 = Math.min(d.chunksZ - 1, Math.floor((z0 + side) / CHUNK_SIZE) + 1);
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) {
      const c = j * d.chunksX + i;
      if (c >= chunkCount(d)) continue;
      const lost = gone(c), from = city.first[c]!;
      for (let p = from; p < city.first[c + 1]!; p++) if (!lost || lost[p - from] !== 1) roofPiece(city, p, hf, x0, z0, side, under);
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
  for (let z = 0; z < side; z++) {
    for (let x = 0; x < side; x++) {
      const c = z * side + x;
      if (under[c] === Infinity) continue;
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
    yield;
  }
}

/** Marks in `under` each cell of the window whose middle piece `p`'s turned box covers, with its underside's height over the ground, where it roofs. */
function roofPiece(city: CityStatics, p: number, hf: Heightfield, x0: number, z0: number, side: number, under: Float32Array): void {
  const k = city.kind[p]!;
  const hx = city.halfX[k]!, hz = city.halfZ[k]!;
  if (hx * hz < 0.25) return;
  const px = city.x[p]!, pz = city.z[p]!;
  const rise = city.y[p]! - city.halfY[k]! - hf.heightAt(px, pz);
  if (rise < ROOF_CLEAR || rise > ROOF_TOP) return;
  const a = city.yaw[p]! * (TAU / YAW_UNITS), sn = detSin(a), cs = detCos(a);
  const ex = Math.abs(cs) * hx + Math.abs(sn) * hz, ez = Math.abs(sn) * hx + Math.abs(cs) * hz;
  const cx0 = Math.max(0, Math.floor(px - ex - x0)), cx1 = Math.min(side - 1, Math.floor(px + ex - x0));
  const cz0 = Math.max(0, Math.floor(pz - ez - z0)), cz1 = Math.min(side - 1, Math.floor(pz + ez - z0));
  for (let cz = cz0; cz <= cz1; cz++) {
    const dz = z0 + cz + 0.5 - pz;
    for (let cx = cx0; cx <= cx1; cx++) {
      const dx = x0 + cx + 0.5 - px;
      if (Math.abs(dx * cs - dz * sn) >= hx || Math.abs(dx * sn + dz * cs) >= hz) continue;
      const c = cz * side + cx;
      if (rise < under[c]!) under[c] = rise;
    }
  }
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
 * The share of the sky's light a camera-relative point keeps under what roofs it, 0 to 1, from the map as the card
 * holds it, `side` cells a side, filtered between the four about it as the card filters: `n` its face's normal and
 * `over` its height over the ground under it. 1 with no map or past the window. The twin of ROOF_GLSL's `roofOpen`.
 */
export function roofOpen(map: Uint8Array, side: number, frame: ArrayLike<number>, rx: number, rz: number, nx: number, ny: number, nz: number, over: number): number {
  const at = ROOF_AT;
  if (frame[at + 3]! <= 0 || side <= 0) return 1;
  const span = frame[at + 2]!;
  const u = (rx - frame[at]!) / span, v = (rz - frame[at + 1]!) / span;
  const inside = Math.min(1, Math.max(0, (Math.min(u, 1 - u, v, 1 - v) * span) / ROOF_FADE));
  if (inside <= 0) return 1;
  const tx = u * side - 0.5, tz = v * side - 0.5;
  const bx = Math.floor(tx), bz = Math.floor(tz), fx = tx - bx, fz = tz - bz;
  const byte = (i: number, j: number, b: number): number => map[(Math.min(side - 1, Math.max(0, j)) * side + Math.min(side - 1, Math.max(0, i))) * ROOF_BYTES + b]! / 255;
  const m = [0, 0, 0, 0];
  for (let b = 0; b < ROOF_BYTES; b++) m[b] = (byte(bx, bz, b) * (1 - fx) + byte(bx + 1, bz, b) * fx) * (1 - fz) + (byte(bx, bz + 1, b) * (1 - fx) + byte(bx + 1, bz + 1, b) * fx) * fz;
  const height = m[0]! * (255 / 16);
  const t = Math.min(1, Math.max(0, (over - height + ROOF_UNDER * 0.75) / ROOF_UNDER));
  const below = inside * (1 - t * t * (3 - 2 * t));
  const toward = (nx * (m[2]! * 255 - SIDE_ZERO) + nz * (m[3]! * 255 - SIDE_ZERO)) / SIDE_STEPS;
  const seen = Math.min(1, Math.max(ROOF_LEAST, m[1]! + toward * (1 - Math.abs(ny))));
  return 1 + (seen - 1) * below;
}

/** `roofOpen` as GLSL, which a lit program includes after the frame block, with ROOF defined on a tier that has roofs. */
export const ROOF_GLSL = `#ifdef ROOF
uniform highp sampler2D uRoof;
float roofOpen(vec3 rel, vec3 normal, float over) {
  if (fRoof.w <= 0.0) return 1.0;
  vec2 uv = (rel.xz - fRoof.xy) / fRoof.z;
  vec2 edge = min(uv, 1.0 - uv);
  float inside = clamp(min(edge.x, edge.y) * fRoof.z / ${g(ROOF_FADE)}, 0.0, 1.0);
  if (inside <= 0.0) return 1.0;
  vec4 m = texture(uRoof, uv);
  float below = inside * (1.0 - smoothstep(m.r * ${g(255 / 16)} - ${g(ROOF_UNDER * 0.75)}, m.r * ${g(255 / 16)} + ${g(ROOF_UNDER * 0.25)}, over));
  float toward = dot(normal.xz, m.zw * 255.0 - ${g(SIDE_ZERO)}) / ${g(SIDE_STEPS)};
  return mix(1.0, clamp(m.y + toward * (1.0 - abs(normal.y)), ${g(ROOF_LEAST)}, 1.0), below);
}
#else
float roofOpen(vec3 rel, vec3 normal, float over) {
  return 1.0;
}
#endif
`;

/**
 * The map round the camera on the page: the one on the card and where, the one being made and where, put on the card
 * whole once made, and whether pieces have gone since the one shown was asked for.
 */
export class RoofMap {
  /** Maps made, and the last one's milliseconds of making, summed over its slices. */
  readonly stats = { made: 0, ms: 0 };
  private shownMap: Uint8Array | null = null;
  private readonly shownAt = [0, 0];
  private sent = false;
  private making: Generator<void, void> | null = null;
  private makingMap: Uint8Array | null = null;
  private readonly makingAt = [0, 0];
  private makingMs = 0;
  private stale = false;
  private madeAt = -Infinity;

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
   * camera has gone ROOF_MOVE from the middle of the one shown, makes it on for ROOF_STEP_MS, puts the map on the card
   * once made, and says in the frame block where it is. `clock` is milliseconds from any fixed moment.
   */
  update(p: FramePacket, budget: { readonly left: number; spend(bytes: number): void }, city: CityStatics, hf: Heightfield, gone: (chunk: number) => Gone, cx: number, cz: number, clock: () => number): void {
    const f = p.frame, at = ROOF_AT;
    const half = ROOF_SIDE / 2;
    const away = !this.shownMap || Math.max(Math.abs(cx - this.shownAt[0]! - half), Math.abs(cz - this.shownAt[1]! - half)) >= ROOF_MOVE;
    if (!this.making && (away || (this.stale && clock() - this.madeAt >= ROOF_EVERY))) {
      this.stale = false;
      this.madeAt = clock();
      this.makingAt[0] = Math.round(cx / 8) * 8 - half;
      this.makingAt[1] = Math.round(cz / 8) * 8 - half;
      this.makingMap = new Uint8Array(ROOF_SIDE * ROOF_SIDE * ROOF_BYTES);
      this.making = roofSteps(city, hf, gone, this.makingAt[0]!, this.makingAt[1]!, ROOF_SIDE, this.makingMap);
      this.makingMs = 0;
    }
    if (this.making) {
      const start = clock();
      while (clock() - start < ROOF_STEP_MS) {
        if (!this.making.next().done) continue;
        this.making = null;
        this.shownMap = this.makingMap;
        this.shownAt[0] = this.makingAt[0]!;
        this.shownAt[1] = this.makingAt[1]!;
        this.sent = false;
        this.stats.made++;
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
    f[at + 3] = p.roofSide > 0 ? 1 : 0;
  }
}
