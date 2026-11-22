// The streets as lines (planning/workstreams/streets.md): every stretch of a street on the ground, its centre line, and on
// each side where its kerb is, how wide its verge and its walk are and what they are. A map's build fits them to its data,
// names each one's type by its rules and the city's overlay (tools/mapworld/streets/), and carries them in a streets part
// for each sector a street reaches (mapfile.ts). The same lines then give:
//
// - the ground's edges between street, verge and walk, straight at any angle: a page works out the signed distance to
//   the kerb at each 2 m sample round the camera from them (chunkPlanes) and the ground's text draws each edge where
//   the distance between four samples crosses it (client/core/render/streets.ts, world-surfaces.ts STREETS_GLSL);
// - what a wheel meets at a street's and a walk's edge, on the server and in the page's own car (groundClassAt);
// - the build's own 2 m samples, painted from the same distances, so the phones' stepped ground agrees;
// - the kerb lines with their stations, which a kerb piece bent along the street stands on (kerbLines).
//
// A part's places are from its square's corner, in the map's metres (x and z), so a part reads the same in any cut.
//
// The part, little-endian:
//   u8 version 1, u16 stretches, u16 corners
//   each stretch: u8 type, u8 flags, u16 seed; for its left side and then its right (of its drawn way): u8 kerb, u8 verge
//     and u8 walk in 1/8 m (the kerb from the centre line, the verge from the kerb, the walk from the verge's end) and
//     u8 kinds (kindsByte); u16 points, the first i32 x and z in 1/16 m, the rest i16 steps from the one before.
//   each corner: i32 x and z of its arc's centre in 1/16 m, u16 radius and u16 reach (centre to the kerbs' corner) in
//     1/64 m, i16 x and z of the way from its centre to each end of its arc (a's then b's) in 1/16384, u16 the stretch
//     whose section its walk takes and u8 that stretch's side.

import { CHUNK_SIZE, SECTOR_CHUNKS } from "../coords.ts";
import { GROUND_CLASS } from "./vehicle-surface.ts";

export const STREETS_VERSION = 1;
/** What lies between a kerb and its walk, or on a median's side; the order is a kinds byte's. */
export const VERGES = ["none", "planted", "grass", "dirt", "paved", "gravel"] as const;
export type Verge = (typeof VERGES)[number];
/** A walk: none, one of its width, or one from its verge to the building line. */
export const WALKS = ["none", "walk", "full"] as const;
export type Walk = (typeof WALKS)[number];
/** A kerb: raised, flush with the road (a highway's shoulder, an alley's edge), or raised and broken down. */
export const KERBS = ["raised", "flush", "worn"] as const;
export type Kerb = (typeof KERBS)[number];
/**
 * The ground's tints (shared/pack/palette.ts) a verge of each kind takes, the first the most common: as the build paints
 * its samples (tools/mapworld/tint.ts) and as the ground's text draws a verge no sample of it lies in. A paved verge or
 * median is poured concrete, the walks' finish in its second shade.
 */
export const VERGE_TINTS: readonly (readonly number[])[] = [[], [197, 196], [150, 151], [102, 103], [231, 1], [101, 100]];
/** A paved verge's kind, whose concrete is laid out in panels along the street as a walk's is. */
export const PAVED_VERGE = 4;
/** A walk's tint where no sample of it lies near, the sidewalk's; and a carriageway's, the street's. */
export const WALK_TINT = 1;
export const STREET_TINT = 85;
/** A side's kinds in a byte: its verge in bits 0 to 2, its walk in 3 and 4, its kerb in 5 and 6. */
export const kindsByte = (verge: number, walk: number, kerb: number): number => (verge & 7) | ((walk & 3) << 3) | ((kerb & 3) << 5);
export const vergeOf = (kinds: number): number => kinds & 7;
export const walkOf = (kinds: number): number => (kinds >> 3) & 3;
export const kerbOf = (kinds: number): number => (kinds >> 5) & 3;
/** A stretch's flags: one way, one of a pair of one-way carriageways with a median between. */
export const STREET_ONE_WAY = 1;
export const STREET_PAIRED = 2;
/** Steps a metre of a side's widths, and of a place. */
export const SIDE_STEP = 8;
export const PLACE_STEP = 16;
/** The most a step between two points may be, in metres: the build cuts a longer one. */
export const LONGEST_STEP = 2000;
/**
 * Metres past a kerb that a stretch's distances are worked out to, past its verge and walk: a sample's four take the
 * walk's far edge straight between them up to a cell's diagonal away. The furthest any reaches is STREET_REACH.
 */
export const STREET_MARGIN = 3;
export const STREET_REACH = 32;

/** A side of a stretch: the kerb's distance from the centre line, the verge's and the walk's widths, in metres; its kinds. */
export interface StreetSide {
  readonly kerb: number;
  readonly verge: number;
  readonly walk: number;
  readonly kinds: number;
}

/** A stretch of a street between two junctions, as a part holds it: its line as x and z pairs in the map's metres. */
export interface Stretch {
  readonly type: number;
  readonly flags: number;
  readonly seed: number;
  readonly sides: readonly [StreetSide, StreetSide];
  readonly xz: Float64Array;
}

/**
 * A corner where two streets meet, rounded on an arc (tools/mapworld/corners.ts): its centre, its radius at the kerb, how
 * far its centre is from where the two kerbs would meet, the unit ways from its centre to its arc's two ends, and the
 * stretch and side whose section its walk takes. Between those two ways and within `reach` of the centre, ground
 * outside the arc is street and inside it the walk's.
 */
export interface StreetCorner {
  readonly cx: number;
  readonly cz: number;
  readonly radius: number;
  readonly reach: number;
  readonly ax: number;
  readonly az: number;
  readonly bx: number;
  readonly bz: number;
  readonly stretch: number;
  readonly side: number;
}

/** A sector's streets: its square's corner in the map's metres, its stretches and its corners. */
export interface StreetsPart {
  readonly x0: number;
  readonly z0: number;
  readonly stretches: readonly Stretch[];
  readonly corners: readonly StreetCorner[];
}

const clampByte = (v: number): number => Math.max(0, Math.min(255, Math.round(v)));

/** A side as a part holds it: its widths at SIDE_STEP. */
export function heldSide(kerb: number, verge: number, walk: number, kinds: number): StreetSide {
  return { kerb: clampByte(kerb * SIDE_STEP) / SIDE_STEP, verge: clampByte(verge * SIDE_STEP) / SIDE_STEP, walk: clampByte(walk * SIDE_STEP) / SIDE_STEP, kinds: kinds & 255 };
}

/** The bytes of a sector's streets, its places from (x0, z0). */
export function encodeStreets(part: StreetsPart): Uint8Array {
  let n = 5;
  for (const s of part.stretches) n += 14 + (s.xz.length / 2 - 1) * 4 + 8;
  n += part.corners.length * 23;
  const bytes = new Uint8Array(n), v = new DataView(bytes.buffer);
  let at = 0;
  const u8 = (x: number): void => { bytes[at++] = x; };
  const u16 = (x: number): void => { v.setUint16(at, x, true); at += 2; };
  const i16 = (x: number): void => {
    if (x < -32768 || x > 32767) throw new Error(`streets: a step of ${x / PLACE_STEP} m is longer than a part holds`);
    v.setInt16(at, x, true); at += 2;
  };
  const i32 = (x: number): void => { v.setInt32(at, x, true); at += 4; };
  u8(STREETS_VERSION);
  u16(part.stretches.length);
  u16(part.corners.length);
  for (const s of part.stretches) {
    u8(s.type); u8(s.flags); u16(s.seed & 65535);
    for (const side of s.sides) { u8(clampByte(side.kerb * SIDE_STEP)); u8(clampByte(side.verge * SIDE_STEP)); u8(clampByte(side.walk * SIDE_STEP)); u8(side.kinds); }
    const points = s.xz.length / 2;
    if (points < 2 || points > 65535) throw new Error(`streets: a stretch of ${points} points`);
    u16(points);
    let px = Math.round((s.xz[0]! - part.x0) * PLACE_STEP), pz = Math.round((s.xz[1]! - part.z0) * PLACE_STEP);
    i32(px); i32(pz);
    for (let k = 1; k < points; k++) {
      const qx = Math.round((s.xz[k * 2]! - part.x0) * PLACE_STEP), qz = Math.round((s.xz[k * 2 + 1]! - part.z0) * PLACE_STEP);
      i16(qx - px); i16(qz - pz);
      px = qx; pz = qz;
    }
  }
  for (const c of part.corners) {
    i32(Math.round((c.cx - part.x0) * PLACE_STEP)); i32(Math.round((c.cz - part.z0) * PLACE_STEP));
    u16(Math.max(0, Math.min(65535, Math.round(c.radius * 64)))); u16(Math.max(0, Math.min(65535, Math.round(c.reach * 64))));
    for (const d of [c.ax, c.az, c.bx, c.bz]) i16(Math.round(d * 16384));
    u16(c.stretch); u8(c.side);
  }
  if (at !== n) throw new Error("streets: a part's bytes are not as many as it holds");
  return bytes;
}

/** A sector's streets from its bytes, its places from (x0, z0), as the map's metres they stand for. Throws past their end. */
export function decodeStreets(bytes: Uint8Array, x0: number, z0: number): StreetsPart {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let at = 0;
  const need = (n: number): void => { if (at + n > bytes.length) throw new RangeError("streets: a part runs past its end"); };
  const u8 = (): number => { need(1); return bytes[at++]!; };
  const u16 = (): number => { need(2); at += 2; return v.getUint16(at - 2, true); };
  const i16 = (): number => { need(2); at += 2; return v.getInt16(at - 2, true); };
  const i32 = (): number => { need(4); at += 4; return v.getInt32(at - 4, true); };
  const version = u8();
  if (version !== STREETS_VERSION) throw new Error(`streets: version ${version} is not one this build reads`);
  const count = u16(), corners = u16();
  const stretches: Stretch[] = [];
  for (let k = 0; k < count; k++) {
    const type = u8(), flags = u8(), seed = u16();
    const side = (): StreetSide => ({ kerb: u8() / SIDE_STEP, verge: u8() / SIDE_STEP, walk: u8() / SIDE_STEP, kinds: u8() });
    const sides = [side(), side()] as const;
    const points = u16();
    if (points < 2) throw new Error("streets: a stretch of fewer than two points");
    const xz = new Float64Array(points * 2);
    let px = i32(), pz = i32();
    xz[0] = x0 + px / PLACE_STEP; xz[1] = z0 + pz / PLACE_STEP;
    for (let p = 1; p < points; p++) {
      px += i16(); pz += i16();
      xz[p * 2] = x0 + px / PLACE_STEP; xz[p * 2 + 1] = z0 + pz / PLACE_STEP;
    }
    stretches.push({ type, flags, seed, sides, xz });
  }
  const out: StreetCorner[] = [];
  for (let k = 0; k < corners; k++) {
    const cx = x0 + i32() / PLACE_STEP, cz = z0 + i32() / PLACE_STEP, radius = u16() / 64, reach = u16() / 64;
    const ax = i16() / 16384, az = i16() / 16384, bx = i16() / 16384, bz = i16() / 16384;
    const stretch = u16(), side = u8();
    if (stretch >= count || side > 1) throw new Error("streets: a corner names a stretch the part does not hold");
    out.push({ cx, cz, radius, reach, ax, az, bx, bz, stretch, side });
  }
  if (at !== bytes.length) throw new Error("streets: a part runs on past what it holds");
  return { x0, z0, stretches, corners: out };
}

/** How far past its kerb a side's distances are worked out: past its verge and walk by STREET_MARGIN, at most STREET_REACH. */
export const sideReach = (s: StreetSide): number => Math.min(STREET_REACH, s.verge + s.walk + STREET_MARGIN);

/** A sector's streets as held: the part, and for each of its square's chunks on the map the stretches and corners near it. */
interface Held {
  readonly part: StreetsPart;
  readonly cx0: number;
  readonly cz0: number;
  readonly w: number;
  readonly d: number;
  /** Chunk k's items are near[first[k]] up to near[first[k + 1]]: a stretch's index, or a corner's with CORNER_BIT. */
  readonly first: Uint32Array;
  readonly near: Uint32Array;
}
const CORNER_BIT = 0x80000000;
/** Changes StreetSectors keeps, each its version and the chunks it touched; one further back is all of them. */
const CHANGES_KEPT = 64;

/**
 * The streets of the sectors held (Heightfield `streets`): a page's, those round the camera as their parts come; a
 * server's and a build's, every sector. Asked at a point (streetAt) or a chunk of samples at a time (chunkPlanes).
 */
export class StreetSectors {
  private readonly held = new Map<number, Held>();
  private last: Held | null = null;
  /** Counts each part that comes or goes, so what was worked out from them knows to work it out again. */
  version = 0;
  /**
   * The last CHANGES_KEPT changes, five numbers each: the version it made, and the chunks cx0, cz0 up to cx1, cz1 whose
   * points and planes it can have changed, which are its sector's square and no more. A chunk's planes and a point's
   * distance are read from the part of the sector whose square holds it alone (sectorOf), and `put` lists each stretch
   * and corner only on its own square's chunks. A neighbour's stretch that reaches over the square's edge (at most 63.9 m
   * past its centre line: a kerb of 31.9 m and sideReach's 32 m; a corner its reach and a metre more, and its side's) is
   * in this sector's part too, as the build writes every stretch and corner whose reach meets a square into its part
   * (tools/mapworld/streets/plan.ts), so what it draws here comes and goes with this part.
   */
  private readonly changes: number[] = [];

  private changed(cx0: number, cz0: number, cx1: number, cz1: number): void {
    this.version++;
    if (this.changes.length >= CHANGES_KEPT * 5) this.changes.splice(0, 5);
    this.changes.push(this.version, cx0, cz0, cx1, cz1);
  }

  /**
   * The chunks whose points and planes can have changed since `version`, into `out` as cx0, cz0, cx1, cz1 a change (each
   * from its first chunk up to the one past its last); false where the changes kept do not reach back that far, and all
   * are to be worked out again.
   */
  changedSince(version: number, out: number[]): boolean {
    out.length = 0;
    if (version === this.version) return true;
    if (version > this.version || this.changes.length === 0 || this.changes[0]! > version + 1) return false;
    for (let k = 0; k < this.changes.length; k += 5) if (this.changes[k]! > version) out.push(this.changes[k + 1]!, this.changes[k + 2]!, this.changes[k + 3]!, this.changes[k + 4]!);
    return true;
  }

  /** Holds sector `key`'s streets, whose square covers the map's chunks cx0 up to cx1 and cz0 up to cz1. */
  put(key: number, part: StreetsPart, cx0: number, cz0: number, cx1: number, cz1: number): void {
    const w = cx1 - cx0, d = cz1 - cz0, lists: number[][] = Array.from({ length: w * d }, () => []);
    const add = (item: number, lx: number, lz: number, hx: number, hz: number): void => {
      const a0 = Math.max(cx0, Math.floor(lx / CHUNK_SIZE)), a1 = Math.min(cx1 - 1, Math.floor(hx / CHUNK_SIZE));
      const b0 = Math.max(cz0, Math.floor(lz / CHUNK_SIZE)), b1 = Math.min(cz1 - 1, Math.floor(hz / CHUNK_SIZE));
      for (let b = b0; b <= b1; b++) for (let a = a0; a <= a1; a++) lists[(b - cz0) * w + a - cx0]!.push(item);
    };
    part.stretches.forEach((s, k) => {
      const r = Math.max(s.sides[0].kerb + sideReach(s.sides[0]), s.sides[1].kerb + sideReach(s.sides[1]));
      let lx = Infinity, lz = Infinity, hx = -Infinity, hz = -Infinity;
      for (let p = 0; p < s.xz.length; p += 2) {
        lx = Math.min(lx, s.xz[p]!); hx = Math.max(hx, s.xz[p]!);
        lz = Math.min(lz, s.xz[p + 1]!); hz = Math.max(hz, s.xz[p + 1]!);
      }
      add(k, lx - r, lz - r, hx + r, hz + r);
    });
    part.corners.forEach((c, k) => {
      const s = part.stretches[c.stretch]!.sides[c.side];
      const r = c.reach + 1 + sideReach(s);
      add((k | CORNER_BIT) >>> 0, c.cx - r, c.cz - r, c.cx + r, c.cz + r);
    });
    const first = new Uint32Array(w * d + 1);
    for (let k = 0; k < lists.length; k++) first[k + 1] = first[k]! + lists[k]!.length;
    const near = new Uint32Array(first[w * d]!);
    for (let k = 0; k < lists.length; k++) near.set(lists[k]!, first[k]!);
    // A sector held again under another square (none is) changes both: the two together.
    const had = this.held.get(key);
    this.held.set(key, { part, cx0, cz0, w, d, first, near });
    this.last = null;
    if (had) this.changed(Math.min(cx0, had.cx0), Math.min(cz0, had.cz0), Math.max(cx1, had.cx0 + had.w), Math.max(cz1, had.cz0 + had.d));
    else this.changed(cx0, cz0, cx1, cz1);
  }

  drop(key: number): void {
    const had = this.held.get(key);
    if (!had) return;
    this.held.delete(key);
    this.last = null;
    this.changed(had.cx0, had.cz0, had.cx0 + had.w, had.cz0 + had.d);
  }

  has(key: number): boolean {
    return this.held.has(key);
  }

  /** Every part held, for whatever reads all of them (kerb lines, a report). */
  parts(): StreetsPart[] {
    return [...this.held.values()].map((h) => h.part);
  }

  /** The held sector with chunk (cx, cz), or null. */
  sectorOf(cx: number, cz: number): Held | null {
    let h = this.last;
    if (h && cx >= h.cx0 && cz >= h.cz0 && cx < h.cx0 + h.w && cz < h.cz0 + h.d) return h;
    h = null;
    for (const s of this.held.values()) if (cx >= s.cx0 && cz >= s.cz0 && cx < s.cx0 + s.w && cz < s.cz0 + s.d) { h = s; break; }
    if (h) this.last = h;
    return h;
  }
}

/**
 * Where a point stands among the streets (streetAt): `d`, signed metres to the nearest kerb, less than 0 on a
 * carriageway; that kerb's side's verge and walk widths, its kinds, its stretch's type and seed; the way along the
 * kerb there (x, z, a unit); and whether any stretch is near at all.
 */
export class StreetPoint {
  near = false;
  d = Infinity;
  verge = 0;
  walk = 0;
  kinds = 0;
  type = 0;
  seed = 0;
  alongX = 1;
  alongZ = 0;
}

/**
 * The streets at map point (x, z): the least of the signed distances to every carriageway near it (its centre line's
 * distance less its kerb's on that side, so a carriageway's end is round) and to every corner's fill (its radius less
 * the distance from its centre, between its two ends and within its reach), and the section of the side that gives it.
 * Into `out`; false where no street is held near. `skip`, a stretch or a corner of the held parts, is left out.
 */
export function streetAt(held: StreetSectors, x: number, z: number, out: StreetPoint, skip: Stretch | StreetCorner | null = null): boolean {
  out.near = false;
  out.d = Infinity;
  const cx = Math.floor(x / CHUNK_SIZE), cz = Math.floor(z / CHUNK_SIZE);
  const h = held.sectorOf(cx, cz);
  if (!h) return false;
  const k = (cz - h.cz0) * h.w + cx - h.cx0;
  const { stretches, corners } = h.part;
  let best = Infinity, from: StreetSide | null = null, owner: Stretch | null = null, ux = 1, uz = 0;
  for (let n = h.first[k]!; n < h.first[k + 1]!; n++) {
    const item = h.near[n]!;
    if (item & CORNER_BIT) {
      const c = corners[item & ~CORNER_BIT]!, f = c === skip ? Infinity : cornerFill(c, x, z);
      if (f < best) {
        best = f; owner = stretches[c.stretch]!; from = owner.sides[c.side];
        const vx = x - c.cx, vz = z - c.cz, r = Math.sqrt(vx * vx + vz * vz) || 1;
        ux = -vz / r; uz = vx / r;
      }
      continue;
    }
    const s = stretches[item]!, p = s.xz;
    if (s === skip) continue;
    for (let q = 2; q < p.length; q += 2) {
      const ax = p[q - 2]!, az = p[q - 1]!, ex = p[q]! - ax, ez = p[q + 1]! - az, l2 = ex * ex + ez * ez;
      if (l2 <= 0) continue;
      const rx = x - ax, rz = z - az, t = Math.max(0, Math.min(1, (rx * ex + rz * ez) / l2));
      const ox = rx - ex * t, oz = rz - ez * t, side = ex * rz - ez * rx > 0 ? 0 : 1;
      const sd = Math.sqrt(ox * ox + oz * oz) - s.sides[side].kerb;
      if (sd < best) {
        const l = Math.sqrt(l2);
        best = sd; owner = s; from = s.sides[side]; ux = ex / l; uz = ez / l;
      }
    }
  }
  if (!from || !owner) return false;
  out.near = true;
  out.d = best;
  out.verge = from.verge;
  out.walk = from.walk;
  out.kinds = from.kinds;
  out.type = owner.type;
  out.seed = owner.seed;
  out.alongX = ux;
  out.alongZ = uz;
  return true;
}

/** A corner's fill at (x, z): its radius less the distance from its centre between its arc's ends and within its reach, else Infinity. */
export function cornerFill(c: StreetCorner, x: number, z: number): number {
  const vx = x - c.cx, vz = z - c.cz;
  const turn = c.ax * c.bz - c.az * c.bx, s1 = c.ax * vz - c.az * vx, s2 = vx * c.bz - vz * c.bx;
  if (!(turn >= 0 ? s1 >= 0 && s2 >= 0 : s1 <= 0 && s2 <= 0)) return Infinity;
  const r = Math.sqrt(vx * vx + vz * vz);
  return r > c.reach + 1 ? Infinity : c.radius - r;
}

/** A wheel's class from the streets where they say (GROUND_CLASS), or -1 where the ground's own cell does, given that cell's. */
const VERGE_CLASS = [-1, GROUND_CLASS.GROUND, GROUND_CLASS.GROUND, GROUND_CLASS.GROUND, GROUND_CLASS.PAVING, GROUND_CLASS.GRAVEL];
const point = new StreetPoint();

/**
 * What a wheel at (x, z) meets as the streets lie, given the class of the ground's own 4 m cell there (Heightfield
 * groundClassAt): asphalt on a carriageway, the verge's ground and the walk's paving across their bands, and past them
 * the cell's own, but no street or walk of the cell's stepped 4 m where the streets' lines say there is none. Water, sand
 * and mud in the cell are kept: a flooded street is still a pool.
 */
export function streetClass(held: StreetSectors, x: number, z: number, cell: number): number {
  if (!streetAt(held, x, z, point)) return cell;
  if (cell === GROUND_CLASS.SAND || cell === GROUND_CLASS.MUD) return cell;
  const d = point.d;
  if (d < 0) return GROUND_CLASS.ASPHALT;
  if (d < point.verge) return VERGE_CLASS[vergeOf(point.kinds)] ?? cell;
  if (d < point.verge + point.walk) return walkOf(point.kinds) > 0 ? GROUND_CLASS.PAVING : cell;
  return d < point.verge + point.walk + 2 && (cell === GROUND_CLASS.ASPHALT || cell === GROUND_CLASS.PAVING) ? GROUND_CLASS.GROUND : cell;
}

/** Samples along a chunk's side, and bytes of a chunk's planes a sample, in each of its two pictures. */
export const CHUNK_SIDE = CHUNK_SIZE / 2;
export const PLANE_BYTES = 4;
/** Metres a step of a distance in the planes, and the most either way they hold. */
export const PLANE_STEP = 16;
export const PLANE_MOST = 8;
/** A distance as the first picture holds it: 0 for PLANE_MOST or more past it, so a picture of zeros is no street near. */
export const planeByte = (d: number): number => Math.max(0, Math.min(255, Math.round(128 - d * PLANE_STEP)));
export const planeMetres = (b: number): number => (128 - b) / PLANE_STEP;
/** A chunk's tag in its samples, which tells a chunk from another held in the same place of a picture round the camera. */
export const chunkTag = (cx: number, cz: number): number => ((cx >> 4) & 3) | (((cz >> 4) & 3) << 2);
/**
 * The way along a kerb in a byte, half a turn of it (a kerb's way and its opposite are one), by the diamond angle, which
 * needs no trigonometry: 0 along x, 64 along z, 128 along x again.
 */
export function alongByte(x: number, z: number): number {
  if (z < 0 || (z === 0 && x < 0)) { x = -x; z = -z; }
  const p = x >= 0 ? z / (x + z || 1) : 1 + -x / (-x + z || 1);
  return Math.round(p * 64) & 255;
}

const best = new Float32Array(CHUNK_SIDE * CHUNK_SIDE);
const who = new Int32Array(CHUNK_SIDE * CHUNK_SIDE);
const way = new Float32Array(CHUNK_SIDE * CHUNK_SIDE * 2);

/**
 * The streets at chunk (cx, cz)'s samples, CHUNK_SIDE a side from its corner (sample (32 cx + i, 32 cz + j) at map metres
 * (2 i, 2 j) from it), as two pictures of PLANE_BYTES a sample row by row:
 *
 * - `dist`, filtered where it is drawn: the signed distance to the kerb, to the verge's far edge and to the walk's far
 *   edge (planeByte), and a fourth byte kept at 0 for what comes next;
 * - `kinds`, read at the nearest sample: the side's kinds, its chunk's tag with its stretch's type over it, the way along
 *   the kerb (alongByte) and its stretch's seed.
 *
 * Every byte is 0 where no street is near. False, and nothing written, where no sector of the chunk is held.
 */
export function chunkPlanes(held: StreetSectors, cx: number, cz: number, dist: Uint8Array, kinds: Uint8Array): boolean {
  const h = held.sectorOf(cx, cz);
  dist.fill(0, 0, CHUNK_SIDE * CHUNK_SIDE * PLANE_BYTES);
  kinds.fill(0, 0, CHUNK_SIDE * CHUNK_SIDE * PLANE_BYTES);
  if (!h) return false;
  const k = (cz - h.cz0) * h.w + cx - h.cx0;
  if (h.first[k] === h.first[k + 1]) return true;
  const { stretches, corners } = h.part;
  const x0 = cx * CHUNK_SIZE, z0 = cz * CHUNK_SIZE, n = CHUNK_SIDE;
  best.fill(Infinity);
  who.fill(-1);
  // Each stretch's segments over the samples within their reach, the least distance kept with whose side it is.
  for (let m = h.first[k]!; m < h.first[k + 1]!; m++) {
    const item = h.near[m]!;
    if (item & CORNER_BIT) continue;
    const s = stretches[item]!, p = s.xz;
    const r = Math.max(s.sides[0].kerb + sideReach(s.sides[0]), s.sides[1].kerb + sideReach(s.sides[1]));
    for (let q = 2; q < p.length; q += 2) {
      const ax = p[q - 2]!, az = p[q - 1]!, bx = p[q]!, bz = p[q + 1]!, ex = bx - ax, ez = bz - az, l2 = ex * ex + ez * ez;
      if (l2 <= 0) continue;
      const i0 = Math.max(0, Math.ceil((Math.min(ax, bx) - r - x0) / 2)), i1 = Math.min(n - 1, Math.floor((Math.max(ax, bx) + r - x0) / 2));
      const j0 = Math.max(0, Math.ceil((Math.min(az, bz) - r - z0) / 2)), j1 = Math.min(n - 1, Math.floor((Math.max(az, bz) + r - z0) / 2));
      if (i0 > i1 || j0 > j1) continue;
      const l = Math.sqrt(l2), ux = ex / l, uz = ez / l;
      for (let j = j0; j <= j1; j++) {
        const rz = z0 + j * 2 - az;
        for (let i = i0; i <= i1; i++) {
          const rx = x0 + i * 2 - ax, t = Math.max(0, Math.min(1, (rx * ex + rz * ez) / l2));
          const ox = rx - ex * t, oz = rz - ez * t, side = ex * rz - ez * rx > 0 ? 0 : 1;
          const sd = Math.sqrt(ox * ox + oz * oz) - s.sides[side].kerb, at = j * n + i;
          if (sd < best[at]!) { best[at] = sd; who[at] = item * 2 + side; way[at * 2] = ux; way[at * 2 + 1] = uz; }
        }
      }
    }
  }
  for (let m = h.first[k]!; m < h.first[k + 1]!; m++) {
    const item = h.near[m]!;
    if (!(item & CORNER_BIT)) continue;
    const c = corners[item & ~CORNER_BIT]!, r = c.reach + 1;
    const i0 = Math.max(0, Math.ceil((c.cx - r - x0) / 2)), i1 = Math.min(n - 1, Math.floor((c.cx + r - x0) / 2));
    const j0 = Math.max(0, Math.ceil((c.cz - r - z0) / 2)), j1 = Math.min(n - 1, Math.floor((c.cz + r - z0) / 2));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const x = x0 + i * 2, z = z0 + j * 2, f = cornerFill(c, x, z), at = j * n + i;
      if (f < best[at]!) {
        const vx = x - c.cx, vz = z - c.cz, len = Math.sqrt(vx * vx + vz * vz) || 1;
        best[at] = f; who[at] = c.stretch * 2 + c.side; way[at * 2] = -vz / len; way[at * 2 + 1] = vx / len;
      }
    }
  }
  const tag = chunkTag(cx, cz);
  for (let at = 0; at < n * n; at++) {
    const o = who[at]!;
    if (o < 0) continue;
    const s = stretches[o >> 1]!, side = s.sides[o & 1], d = best[at]!;
    if (d > side.verge + side.walk + STREET_MARGIN) continue;
    const b = at * PLANE_BYTES;
    dist[b] = planeByte(d);
    dist[b + 1] = planeByte(d - side.verge);
    dist[b + 2] = planeByte(d - side.verge - side.walk);
    kinds[b] = side.kinds;
    kinds[b + 1] = tag | ((s.type & 15) << 4);
    kinds[b + 2] = alongByte(way[at * 2]!, way[at * 2 + 1]!);
    kinds[b + 3] = s.seed & 255;
  }
  return true;
}

/**
 * A stretch of kerb a piece may stand along: the stretch and the side it is the kerb of (or the corner it rounds), its
 * points as x and z pairs in the map's metres and each one's station, metres along it from its stretch's start on that
 * side's kerb (a corner's from its arc's a end), and the side's section.
 */
export interface KerbLine {
  readonly stretch: number;
  readonly side: number;
  /** -1 for a stretch's kerb, else the corner's index in its part. */
  readonly corner: number;
  readonly xz: Float64Array;
  readonly stations: Float64Array;
  readonly kinds: number;
  readonly verge: number;
  readonly walk: number;
  readonly seed: number;
  readonly type: number;
}

/** Metres between the points of a kerb line. */
export const KERB_STEP = 1;

/**
 * The kerb lines of a held part: each side of each stretch with a raised or worn kerb, its centre line offset by the
 * kerb's distance, and each corner's arc, cut where another carriageway or a corner's fill takes the kerb (at junctions)
 * into the runs that stand on the street's edge. Each run's stations are measured along its own line from its start, so a
 * piece's place on it does not move when a run is cut differently. `held` must hold the part. A stretch near a sector's
 * edge is in the parts of both sectors; it is given here only for the part whose square holds its middle point, and a
 * corner for the one that holds its centre, so the lines of every part held together have each kerb once.
 */
export function kerbLines(held: StreetSectors, part: StreetsPart): KerbLine[] {
  const out: KerbLine[] = [];
  const p = new StreetPoint();
  // Open where no other carriageway or corner covers it (its own stretch's bends overlap its own kerb a little inside them).
  const exposed = (x: number, z: number, own: Stretch | StreetCorner): boolean => !streetAt(held, x, z, p, own) || p.d > -0.05;
  const runs = (stretch: number, side: number, corner: number, pts: number[], stations: number[], from: StreetSide, s: Stretch): void => {
    const own = corner < 0 ? s : part.corners[corner]!;
    let start = -1;
    for (let k = 0; k <= pts.length / 2; k++) {
      const open = k < pts.length / 2 && exposed(pts[k * 2]!, pts[k * 2 + 1]!, own);
      if (open && start < 0) start = k;
      if (!open && start >= 0) {
        if (k - start >= 2) out.push({ stretch, side, corner, xz: Float64Array.from(pts.slice(start * 2, k * 2)), stations: Float64Array.from(stations.slice(start, k)), kinds: from.kinds, verge: from.verge, walk: from.walk, seed: s.seed, type: s.type });
        start = -1;
      }
    }
  };
  const span = SECTOR_CHUNKS * CHUNK_SIZE;
  const mine = (x: number, z: number): boolean => x >= part.x0 && z >= part.z0 && x < part.x0 + span && z < part.z0 + span;
  part.stretches.forEach((s, k) => {
    const m = (s.xz.length >> 2) * 2;
    if (!mine(s.xz[m]!, s.xz[m + 1]!)) return;
    for (const side of [0, 1]) {
      const from = s.sides[side]!;
      if (kerbOf(from.kinds) === 1) continue;
      const sign = side === 0 ? 1 : -1, pts: number[] = [], stations: number[] = [];
      let along = 0;
      for (let q = 2; q < s.xz.length; q += 2) {
        const ax = s.xz[q - 2]!, az = s.xz[q - 1]!, ex = s.xz[q]! - ax, ez = s.xz[q + 1]! - az, l = Math.sqrt(ex * ex + ez * ez);
        if (l <= 0) continue;
        const nx = (-ez / l) * sign * from.kerb, nz = (ex / l) * sign * from.kerb;
        const steps = Math.max(1, Math.ceil(l / KERB_STEP));
        for (let t = q === 2 ? 0 : 1; t <= steps; t++) {
          pts.push(ax + (ex * t) / steps + nx, az + (ez * t) / steps + nz);
          stations.push(along + (l * t) / steps);
        }
        along += l;
      }
      runs(k, side, -1, pts, stations, from, s);
    }
  });
  part.corners.forEach((c, k) => {
    const s = part.stretches[c.stretch]!, from = s.sides[c.side];
    if (kerbOf(from.kinds) === 1 || !mine(c.cx, c.cz)) return;
    // From the a end round to the b end, a step at a time along the arc: its chord times 1.4 is more than its length up
    // to a turn of 150 degrees. Each way out is between the two ends' ways, put back on the circle.
    const gx = c.bx - c.ax, gz = c.bz - c.az, steps = Math.max(2, Math.ceil((Math.sqrt(gx * gx + gz * gz) * c.radius * 1.4) / KERB_STEP));
    const pts: number[] = [], stations: number[] = [];
    for (let t = 0; t <= steps; t++) {
      const wx = c.ax + (gx * t) / steps, wz = c.az + (gz * t) / steps, l = Math.sqrt(wx * wx + wz * wz) || 1;
      const x = c.cx + (wx / l) * c.radius, z = c.cz + (wz / l) * c.radius;
      const dx = t === 0 ? 0 : x - pts[t * 2 - 2]!, dz = t === 0 ? 0 : z - pts[t * 2 - 1]!;
      pts.push(x, z);
      stations.push(t === 0 ? 0 : stations[t - 1]! + Math.sqrt(dx * dx + dz * dz));
    }
    runs(c.stretch, c.side, k, pts, stations, from, s);
  });
  return out;
}
