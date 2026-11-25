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
//   u8 version 2, u16 stretches, u16 corners
//   each stretch: u8 type, u8 flags, u16 seed; for its left side and then its right (of its drawn way): u8 kerb, u8 verge
//     and u8 walk in 1/8 m (the kerb from the centre line, the verge from the kerb, the walk from the verge's end) and
//     u8 kinds (kindsByte); u16 points, the first i32 x and z in 1/16 m, the rest i16 steps from the one before; then for
//     its left side and its right, its drops.
//   each corner: i32 x and z of its arc's centre in 1/16 m, u16 radius and u16 reach (centre to the kerbs' corner) in
//     1/64 m, i16 x and z of the way from its centre to each end of its arc (a's then b's) in 1/16384, u16 the stretch
//     whose section its walk takes and u8 that stretch's side; then its drops.
//   drops: where a kerb is let down flush with the road (kerbLines): u8 count, each u16 from and u16 to, stations along
//     its kerb line in 1/4 m, and u8 its kind (DROP_CROSSING, DROP_DRIVE, DROP_RAMP).

import { CHUNK_SIZE, SECTOR_CHUNKS } from "../coords.ts";
import { PI, TAU, detAtan2, detCos, detSin, len3 } from "../math/scalar.ts";
import { GROUND_CLASS } from "./vehicle-surface.ts";

export const STREETS_VERSION = 2;
/** Why a stretch of kerb is let down flush with the road (a drop): a crossing, a drive or a lot's way in, a corner's ramp. */
export const DROP_CROSSING = 1, DROP_DRIVE = 2, DROP_RAMP = 3;
/** Steps a metre of a drop's stations. */
const DROP_STEP = 4;
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
  /** Where each side's kerb is let down flush (kerbLines' drops): from, to and kind, three a drop, by stations along its kerb line. */
  readonly drops?: readonly [Float64Array | null, Float64Array | null];
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
  /** Where its kerb is let down flush: from, to and kind, three a drop, by stations along its arc from its a end. */
  readonly drops?: Float64Array | null;
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
  const dropBytes = (d: Float64Array | null | undefined): number => 1 + (d ? (d.length / 3) * 5 : 0);
  let n = 5;
  for (const s of part.stretches) n += 14 + (s.xz.length / 2 - 1) * 4 + 8 + dropBytes(s.drops?.[0]) + dropBytes(s.drops?.[1]);
  for (const c of part.corners) n += 23 + dropBytes(c.drops);
  const bytes = new Uint8Array(n), v = new DataView(bytes.buffer);
  let at = 0;
  const u8 = (x: number): void => { bytes[at++] = x; };
  const u16 = (x: number): void => { v.setUint16(at, x, true); at += 2; };
  const i16 = (x: number): void => {
    if (x < -32768 || x > 32767) throw new Error(`streets: a step of ${x / PLACE_STEP} m is longer than a part holds`);
    v.setInt16(at, x, true); at += 2;
  };
  const i32 = (x: number): void => { v.setInt32(at, x, true); at += 4; };
  const drops = (d: Float64Array | null | undefined): void => {
    const count = d ? d.length / 3 : 0;
    if (count > 255) throw new Error(`streets: a kerb of ${count} drops`);
    u8(count);
    for (let k = 0; k < count; k++) {
      u16(Math.max(0, Math.min(65535, Math.round(d![k * 3]! * DROP_STEP)))); u16(Math.max(0, Math.min(65535, Math.round(d![k * 3 + 1]! * DROP_STEP)))); u8(d![k * 3 + 2]!);
    }
  };
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
    drops(s.drops?.[0]); drops(s.drops?.[1]);
  }
  for (const c of part.corners) {
    i32(Math.round((c.cx - part.x0) * PLACE_STEP)); i32(Math.round((c.cz - part.z0) * PLACE_STEP));
    u16(Math.max(0, Math.min(65535, Math.round(c.radius * 64)))); u16(Math.max(0, Math.min(65535, Math.round(c.reach * 64))));
    for (const d of [c.ax, c.az, c.bx, c.bz]) i16(Math.round(d * 16384));
    u16(c.stretch); u8(c.side);
    drops(c.drops);
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
  const drops = (): Float64Array | null => {
    const count = u8();
    if (count === 0) return null;
    const d = new Float64Array(count * 3);
    for (let k = 0; k < count; k++) { d[k * 3] = u16() / DROP_STEP; d[k * 3 + 1] = u16() / DROP_STEP; d[k * 3 + 2] = u8(); }
    return d;
  };
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
    const left = drops(), right = drops();
    stretches.push({ type, flags, seed, sides, xz, ...(left || right ? { drops: [left, right] as const } : {}) });
  }
  const out: StreetCorner[] = [];
  for (let k = 0; k < corners; k++) {
    const cx = x0 + i32() / PLACE_STEP, cz = z0 + i32() / PLACE_STEP, radius = u16() / 64, reach = u16() / 64;
    const ax = i16() / 16384, az = i16() / 16384, bx = i16() / 16384, bz = i16() / 16384;
    const stretch = u16(), side = u8();
    if (stretch >= count || side > 1) throw new Error("streets: a corner names a stretch the part does not hold");
    const d = drops();
    out.push({ cx, cz, radius, reach, ax, az, bx, bz, stretch, side, ...(d ? { drops: d } : {}) });
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

  /**
   * The sectors a map has streets for, by key, each its square's chunks cx0, cz0, cx1, cz1, as a page lists them that
   * holds some at a time; none where each part is held as it is read (a server's, a build's).
   */
  private readonly listed = new Map<number, readonly number[]>();

  /** Lists sector `key`, whose square covers the map's chunks cx0 up to cx1 and cz0 up to cz1, as one the map has streets for. */
  list(key: number, cx0: number, cz0: number, cx1: number, cz1: number): void {
    this.listed.set(key, [cx0, cz0, cx1, cz1]);
  }

  /** Whether every listed sector whose square meets the box from (x0, z0) to (x1, z1) metres is held. */
  heldIn(x0: number, z0: number, x1: number, z1: number): boolean {
    const a0 = Math.floor(x0 / CHUNK_SIZE), b0 = Math.floor(z0 / CHUNK_SIZE), a1 = Math.floor(x1 / CHUNK_SIZE), b1 = Math.floor(z1 / CHUNK_SIZE);
    for (const [key, sq] of this.listed) if (a0 < sq[2]! && a1 >= sq[0]! && b0 < sq[3]! && b1 >= sq[1]! && !this.held.has(key)) return false;
    return true;
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
  /** Where it is let down flush with the road (a crossing, a drive, a corner's ramp): from, to and kind, three a drop, by station, or null. */
  readonly drops: Float64Array | null;
}

/** Metres between the points of a kerb line. */
export const KERB_STEP = 1;

/**
 * The kerb lines of a held part: each side of each stretch with a raised or worn kerb and each corner's arc, cut where
 * another carriageway or a corner takes the kerb (at junctions) into the runs that stand on the street's edge.
 *
 * - A stretch's kerb is its centre line offset by the kerb's distance as the ground's distance draws it (offsetLine):
 *   where the centre line bends, mitred on the inside of the bend and round the bend's point on the outside.
 * - A stretch's run ends where it comes into a corner's arc, at the arc's end itself, so the two meet end to end at one
 *   point and run on the same way there; and where two stretches of a street meet end to end with no corner and the
 *   same kerb, both runs end at the one point their offsets meet at.
 * - Each run's stations are metres along its own line from its stretch's start (a corner's from its arc's a end), so a
 *   piece's place on it does not move when a run is cut differently; its drops, where the part marks some (dropped
 *   kerbs at a crossing, a drive or a corner's ramp), are the stretches of stations it is let down flush over.
 *
 * `held` must hold the part. A stretch near a sector's edge is in the parts of every sector it reaches; each of its kerbs
 * is given here only for the part whose square holds the middle of that kerb's length on the held map, and a corner's for
 * the one that holds its arc's (ownerIs), so the lines of every part held together have each kerb once, and a cut that
 * holds a kerb has it as the whole map does, though the centre line runs outside the cut.
 */
export function kerbLines(held: StreetSectors, part: StreetsPart): KerbLine[] {
  const out: KerbLine[] = [];
  const p = new StreetPoint();
  const span = SECTOR_CHUNKS * CHUNK_SIZE;
  const mine = (x: number, z: number): boolean => x >= part.x0 && z >= part.z0 && x < part.x0 + span && z < part.z0 + span;
  // Open where no other carriageway or corner covers it (its own stretch's bends overlap its own kerb a little inside
  // them); an arc's ends are let off by its widths' rounding where it meets its stretches.
  const exposed = (x: number, z: number, own: Stretch | StreetCorner, slack: number): boolean => !streetAt(held, x, z, p, own) || p.d > -slack;
  const lines = (stretch: number, side: number, corner: number, pts: readonly number[], stations: readonly number[], open: (k: number) => boolean, from: StreetSide, s: Stretch, drops: Float64Array | null): void => {
    let start = -1;
    for (let k = 0; k <= pts.length / 2; k++) {
      const on = k < pts.length / 2 && open(k);
      if (on && start < 0) start = k;
      if (!on && start >= 0) {
        if (k - start >= 2) {
          const st = Float64Array.from(stations.slice(start, k));
          out.push({ stretch, side, corner, xz: Float64Array.from(pts.slice(start * 2, k * 2)), stations: st, kinds: from.kinds, verge: from.verge, walk: from.walk, seed: s.seed, type: s.type, drops: dropsWithin(drops, st[0]!, st[st.length - 1]!) });
        }
        start = -1;
      }
    }
  };
  const ends = endsOf(part);
  part.stretches.forEach((s, k) => {
    for (const side of [0, 1]) {
      const from = s.sides[side]!;
      if (kerbOf(from.kinds) === 1 || !ownerIs(held, beside(s.xz, from.kerb, side === 0 ? 1 : -1), mine)) continue;
      const line = { pts: [] as number[], stations: [] as number[], open: [] as number[] };
      offsetLine(s.xz, from.kerb, side === 0 ? 1 : -1, joinAt(part, ends, k, side, 0), joinAt(part, ends, k, side, 1), line.pts, line.stations);
      // Each point open where no other carriageway covers it and it is no corner's, and where a run comes into a corner
      // or out of one, the arc's end put in its place.
      for (let q = 0; q < line.stations.length; q++) line.open.push(exposed(line.pts[q * 2]!, line.pts[q * 2 + 1]!, s, 0.05) ? 1 : 0);
      meetCorners(held, line);
      lines(k, side, -1, line.pts, line.stations, (q) => line.open[q] === 1, from, s, s.drops?.[side] ?? null);
    }
  });
  part.corners.forEach((c, k) => {
    const s = part.stretches[c.stretch]!, from = s.sides[c.side];
    if (kerbOf(from.kinds) === 1) return;
    const pts: number[] = [], stations: number[] = [];
    arcLine(c, pts, stations);
    if (!ownerIs(held, pts, mine)) return;
    lines(c.stretch, c.side, k, pts, stations, (q) => exposed(pts[q * 2]!, pts[q * 2 + 1]!, c, 0.12), from, s, cornerDrops(held, c, pts, stations));
  });
  return out;
}

/** The drops of `drops` (from, to and kind, three a drop) that lie between `a` and `b`, cut to them; null where none do. */
function dropsWithin(drops: Float64Array | null, a: number, b: number): Float64Array | null {
  if (!drops) return null;
  const kept: number[] = [];
  for (let k = 0; k + 2 < drops.length; k += 3) {
    const from = Math.max(a, drops[k]!), to = Math.min(b, drops[k + 1]!);
    if (to > from) kept.push(from, to, drops[k + 2]!);
  }
  return kept.length > 0 ? Float64Array.from(kept) : null;
}

/**
 * A corner's arc let down flush its whole length where one of the carriageways it joins has a flush kerb (an alley, a
 * service road or a drive meeting the street): the drive's mouth, not a kerb rounding into it. Its stored drops otherwise.
 */
function cornerDrops(held: StreetSectors, c: StreetCorner, pts: readonly number[], stations: readonly number[]): Float64Array | null {
  const p = new StreetPoint();
  for (const e of [0, stations.length - 1]) {
    // A little way out from the arc's end into the street, the carriageway that meets it there.
    const x = pts[e * 2]!, z = pts[e * 2 + 1]!, dx = x - c.cx, dz = z - c.cz, l = Math.sqrt(dx * dx + dz * dz) || 1;
    if (streetAt(held, x + (dx / l) * 0.3, z + (dz / l) * 0.3, p, c) && kerbOf(p.kinds) === 1) return Float64Array.of(0, stations[stations.length - 1]!, DROP_DRIVE);
  }
  return c.drops ?? null;
}

/** A corner's arc from its a end round to its b end, a point at most KERB_STEP apart, with how far along it each is. */
export function arcLine(c: StreetCorner, pts: number[], stations: number[]): void {
  // A step at a time along the arc: its chord times 1.4 is more than its length up to a turn of 150 degrees. Each way
  // out is between the two ends' ways, put back on the circle.
  const gx = c.bx - c.ax, gz = c.bz - c.az, steps = Math.max(2, Math.ceil((Math.sqrt(gx * gx + gz * gz) * c.radius * 1.4) / KERB_STEP));
  for (let t = 0; t <= steps; t++) {
    const wx = c.ax + (gx * t) / steps, wz = c.az + (gz * t) / steps, l = Math.sqrt(wx * wx + wz * wz) || 1;
    const x = c.cx + (wx / l) * c.radius, z = c.cz + (wz / l) * c.radius;
    const dx = t === 0 ? 0 : x - pts[t * 2 - 2]!, dz = t === 0 ? 0 : z - pts[t * 2 - 1]!;
    pts.push(x, z);
    stations.push(t === 0 ? 0 : stations[t - 1]! + Math.sqrt(dx * dx + dz * dz));
  }
}

/**
 * Whether a kerb, a line of points held on `held`, is this part's to give (`mine` says whether a point is in its square):
 * the middle by length of what of it lies in a held sector, or its middle where none of it does. So a stretch of two
 * points across the map's edge is given by the sector it crosses, not by its end off the map, and the kerb of a road
 * whose centre line runs just past the map's edge by the sector the kerb itself lies in.
 */
function ownerIs(held: StreetSectors, xz: ArrayLike<number>, mine: (x: number, z: number) => boolean): boolean {
  // Its points every 4 m or nearer, and of those the ones on a held sector.
  const inside: number[] = [], all: number[] = [];
  for (let q = 2; q < xz.length; q += 2) {
    const ax = xz[q - 2]!, az = xz[q - 1]!, ex = xz[q]! - ax, ez = xz[q + 1]! - az, steps = Math.max(1, Math.ceil(Math.sqrt(ex * ex + ez * ez) / 4));
    for (let t = q === 2 ? 0 : 1; t <= steps; t++) {
      const x = ax + (ex * t) / steps, z = az + (ez * t) / steps;
      all.push(x, z);
      if (held.sectorOf(Math.floor(x / CHUNK_SIZE), Math.floor(z / CHUNK_SIZE))) inside.push(x, z);
    }
  }
  const pick = inside.length > 0 ? inside : all, m = (pick.length >> 2) * 2;
  return mine(pick[m]!, pick[m + 1]!);
}

/**
 * A centre line's points each moved `d` to its `sign` side (1 its left, as offsetLine has it) along its segment's own
 * normal, both ends of every segment: the kerb's line near enough to say which sector holds it, and the same in every
 * part that holds the stretch, as no join it meets moves it.
 */
function beside(xz: Float64Array, d: number, sign: number): Float64Array {
  const out = new Float64Array(Math.max(0, xz.length - 2) * 2);
  for (let q = 2; q < xz.length; q += 2) {
    const ex = xz[q]! - xz[q - 2]!, ez = xz[q + 1]! - xz[q - 1]!, l = Math.sqrt(ex * ex + ez * ez) || 1;
    const nx = (-ez / l) * sign * d, nz = (ex / l) * sign * d, at = (q - 2) * 2;
    out[at] = xz[q - 2]! + nx;
    out[at + 1] = xz[q - 1]! + nz;
    out[at + 2] = xz[q]! + nx;
    out[at + 3] = xz[q + 1]! + nz;
  }
  return out;
}

/** A stretch's ends by the place they stand: its index, and 0 for its first point, 1 for its last. */
function endsOf(part: StreetsPart): Map<string, number[]> {
  const ends = new Map<string, number[]>();
  part.stretches.forEach((s, k) => {
    for (const e of [0, 1]) {
      const q = e === 0 ? 0 : s.xz.length - 2, key = `${Math.round(s.xz[q]! * 16)},${Math.round(s.xz[q + 1]! * 16)}`;
      (ends.get(key) ?? ends.set(key, []).get(key)!).push(k * 2 + e);
    }
  });
  return ends;
}

/**
 * Where stretch `k`'s kerb on `side` ends at its end `e` (0 its first point, 1 its last) when a stretch of the same street
 * runs on from it there, with no other meeting it, the same kerb on the side that meets this one, and no more than a
 * quarter turn between them: the way that stretch's first segment leaves the point (into the stretch's own frame, as
 * if this one ran on along it), and its kerb's distance. Null where the kerb ends there as its own.
 */
function joinAt(part: StreetsPart, ends: Map<string, number[]>, k: number, side: number, e: number): Join | null {
  const s = part.stretches[k]!, q = e === 0 ? 0 : s.xz.length - 2;
  const at = ends.get(`${Math.round(s.xz[q]! * 16)},${Math.round(s.xz[q + 1]! * 16)}`) ?? [];
  if (at.length !== 2) return null;
  const other = at.find((v) => v !== k * 2 + e);
  if (other === undefined || other >> 1 === k) return null;
  const o = part.stretches[other >> 1]!, oe = other & 1;
  // Its side that runs on from this one's: a stretch drawn the same way round keeps its sides, one drawn against it swaps them.
  const same = oe !== e, oside = same ? side : 1 - side, mine = s.sides[side]!, theirs = o.sides[oside]!;
  if (Math.abs(theirs.kerb - mine.kerb) > 1e-6 || kerbOf(theirs.kinds) !== kerbOf(mine.kinds)) return null;
  // The way on, out of the meeting point, as this stretch runs: into the other where this one ends, out of the other's
  // far side where this one starts.
  const r = oe === 0 ? 2 : o.xz.length - 4, ox = o.xz[r]! - o.xz[oe === 0 ? 0 : o.xz.length - 2]!, oz = o.xz[r + 1]! - o.xz[oe === 0 ? 1 : o.xz.length - 1]!;
  const l = Math.sqrt(ox * ox + oz * oz);
  if (l <= 0) return null;
  // Out of the point into the other stretch (where this one ends) or into this one from it (where this one starts).
  const ux = e === 1 ? ox / l : -ox / l, uz = e === 1 ? oz / l : -oz / l;
  const sx = s.xz[e === 1 ? s.xz.length - 2 : 2]! - s.xz[e === 1 ? s.xz.length - 4 : 0]!, sz = s.xz[e === 1 ? s.xz.length - 1 : 3]! - s.xz[e === 1 ? s.xz.length - 3 : 1]!;
  const sl = Math.sqrt(sx * sx + sz * sz) || 1;
  // The round of a bend between them is drawn by one of the two, the same whichever part gives them.
  const draws = s.seed !== o.seed ? s.seed < o.seed : s.xz[0]! !== o.xz[0]! ? s.xz[0]! < o.xz[0]! : s.xz[1]! < o.xz[1]!;
  return (ux * sx + uz * sz) / sl < 0 ? null : { ux, uz, draws };
}

/** The way a stretch that runs on from an end leaves it (joinAt), and whether this one draws the round between them. */
interface Join { readonly ux: number; readonly uz: number; readonly draws: boolean }

/**
 * A centre line `xz` offset by `d` to its left (`sign` 1, a quarter counter-clockwise from the way it runs) or its right,
 * as the ground's distance draws its kerb: each segment's own offset, the inside of a bend cut where two meet (a segment
 * cut away whole where the bend is tighter than the offset), and round the bend's point on the outside. With `before`
 * or `after`, the way a stretch that runs on from its first or last point leaves it, so its end is where the two offsets
 * meet. Into `pts` a point every KERB_STEP or less, and into `stations` how far along the offset line each is.
 */
export function offsetLine(xz: Float64Array, d: number, sign: number, before: Join | null, after: Join | null, pts: number[], stations: number[]): void {
  // Each segment: its start and end on the centre line and its way; a neighbour beyond an end is a long segment of its
  // own way through the end point, its ghost, so the end is mitred or rounded to it.
  interface Seg { ax: number; az: number; ux: number; uz: number; length: number; ghost: boolean }
  const all: Seg[] = [];
  for (let q = 2; q < xz.length; q += 2) {
    const ax = xz[q - 2]!, az = xz[q - 1]!, ex = xz[q]! - ax, ez = xz[q + 1]! - az, l = Math.sqrt(ex * ex + ez * ez);
    if (l > 1e-6) all.push({ ax, az, ux: ex / l, uz: ez / l, length: l, ghost: false });
  }
  if (all.length === 0) return;
  const GHOST = 1e4, end = all[all.length - 1]!;
  if (before) all.unshift({ ax: all[0]!.ax - before.ux * GHOST, az: all[0]!.az - before.uz * GHOST, ux: before.ux, uz: before.uz, length: GHOST, ghost: true });
  if (after) all.push({ ax: end.ax + end.ux * end.length, az: end.az + end.uz * end.length, ux: after.ux, uz: after.uz, length: GHOST, ghost: true });
  // The offset of each kept, from `from` to `to` along it, and whether it is reached round the point it shares with the
  // one before (the outside of a bend).
  interface Kept { s: Seg; from: number; to: number; round: boolean }
  const kept: Kept[] = [];
  for (const s of all) {
    const piece: Kept = { s, from: 0, to: s.length, round: false };
    for (;;) {
      const top = kept[kept.length - 1];
      if (!top) break;
      const a = top.s, cross = a.ux * s.uz - a.uz * s.ux, dot = a.ux * s.ux + a.uz * s.uz;
      if (Math.abs(cross) < 1e-9 && dot > 0) break;
      if (cross * sign < 0 || dot < -0.999) {
        piece.round = true;
        break;
      }
      // The inside of a bend: where the two offset lines cross, along each from its start.
      const px = a.ax - a.uz * sign * d, pz = a.az + a.ux * sign * d, qx = s.ax - s.uz * sign * d, qz = s.az + s.ux * sign * d;
      const t = ((qx - px) * s.uz - (qz - pz) * s.ux) / cross, u = ((qx - px) * a.uz - (qz - pz) * a.ux) / cross;
      // The one before cut away whole: this one meets the one before it.
      if (t < top.from) {
        kept.pop();
        continue;
      }
      // This one cut away whole.
      if (u > piece.to) piece.from = Infinity;
      else {
        top.to = t;
        piece.from = u;
      }
      break;
    }
    if (piece.from <= piece.to) kept.push(piece);
  }
  let along = 0;
  const put = (x: number, z: number): void => {
    if (pts.length >= 2) {
      const dx = x - pts[pts.length - 2]!, dz = z - pts[pts.length - 1]!, l = Math.sqrt(dx * dx + dz * dz);
      if (l < 1e-6) return;
      along += l;
    }
    pts.push(x, z);
    stations.push(along);
  };
  kept.forEach((c, k) => {
    const s = c.s, nx = -s.uz * sign * d, nz = s.ux * sign * d;
    // Round the point shared with the one before, from where that one ends to where this one starts; where it is shared
    // with a stretch that runs on, by the one of the two that `draws` it, so it is drawn once.
    const prev = k > 0 ? kept[k - 1]!.s : null;
    if (c.round && prev && (prev.ghost ? before!.draws : s.ghost ? after!.draws : true)) {
      const ox = s.ax, oz = s.az, a0 = detAtan2(prev.ux * sign, -prev.uz * sign);
      let turn = detAtan2(s.ux * sign, -s.uz * sign) - a0;
      if (turn > PI) turn -= TAU;
      if (turn < -PI) turn += TAU;
      const steps = Math.ceil((Math.abs(turn) * d) / KERB_STEP);
      if (prev.ghost) put(ox - prev.uz * sign * d, oz + prev.ux * sign * d);
      for (let t = 1; t < steps; t++) put(ox + detCos(a0 + (turn * t) / steps) * d, oz + detSin(a0 + (turn * t) / steps) * d);
      if (s.ghost) put(ox + nx, oz + nz);
    }
    if (s.ghost) return;
    const l = c.to - c.from, steps = Math.max(1, Math.ceil(l / KERB_STEP));
    for (let t = 0; t <= steps; t++) put(s.ax + s.ux * (c.from + (l * t) / steps) + nx, s.az + s.uz * (c.from + (l * t) / steps) + nz);
  });
}

/** Whether (x, z) lies in corner `c`'s wedge: between the ways from its centre to its arc's two ends, within its reach. */
function inWedge(c: StreetCorner, x: number, z: number): boolean {
  const vx = x - c.cx, vz = z - c.cz;
  const turn = c.ax * c.bz - c.az * c.bx, s1 = c.ax * vz - c.az * vx, s2 = vx * c.bz - vz * c.bx;
  // Strictly between them: a point on the way to an arc's end is the run's, the arc's end itself among them.
  return (turn >= 0 ? s1 > 1e-6 && s2 > 1e-6 : s1 < -1e-6 && s2 < -1e-6) && vx * vx + vz * vz <= (c.reach + 1) * (c.reach + 1);
}

/** The corner held near (x, z) whose wedge holds it, or null: a stretch's kerb there is the corner's arc's to draw. */
function cornerAt(held: StreetSectors, x: number, z: number): StreetCorner | null {
  const cx = Math.floor(x / CHUNK_SIZE), cz = Math.floor(z / CHUNK_SIZE), h = held.sectorOf(cx, cz);
  if (!h) return null;
  const k = (cz - h.cz0) * h.w + cx - h.cx0;
  for (let n = h.first[k]!; n < h.first[k + 1]!; n++) {
    const item = h.near[n]!;
    if (item & CORNER_BIT && inWedge(h.part.corners[item & ~CORNER_BIT]!, x, z)) return h.part.corners[item & ~CORNER_BIT]!;
  }
  return null;
}

/**
 * A stretch's kerb points, `open` where its kerb is its own, closed anew where they lie in a corner's wedge, and the end of
 * the corner's arc put in where a run comes into the wedge or out of it, so the run and the arc meet there end to end:
 * the nearer of the arc's two ends, a point of the run whose station is as far on from the open point before it as it
 * lies from it.
 */
function meetCorners(held: StreetSectors, line: { pts: number[]; stations: number[]; open: number[] }): void {
  const { pts, stations, open } = line, n = stations.length;
  const corner = Array.from({ length: n }, (_, q) => cornerAt(held, pts[q * 2]!, pts[q * 2 + 1]!));
  const xz: number[] = [], st: number[] = [], on: number[] = [];
  for (let q = 0; q < n; q++) {
    const ok = !corner[q] && open[q] === 1 ? 1 : 0;
    const was = q > 0 && !corner[q - 1] && open[q - 1] === 1;
    // Into a corner from an open point, or out of one onto an open point.
    const c = was && !ok ? corner[q] : !was && ok && q > 0 ? corner[q - 1] : null;
    if (c) {
      const ax = pts[q * 2 - 2]!, az = pts[q * 2 - 1]!, bx = pts[q * 2]!, bz = pts[q * 2 + 1]!, mx = (ax + bx) / 2, mz = (az + bz) / 2;
      const ex = [c.cx + c.ax * c.radius, c.cx + c.bx * c.radius], ez = [c.cz + c.az * c.radius, c.cz + c.bz * c.radius];
      const e = len3(ex[0]! - mx, 0, ez[0]! - mz) <= len3(ex[1]! - mx, 0, ez[1]! - mz) ? 0 : 1;
      const fromA = len3(ex[e]! - ax, 0, ez[e]! - az), toB = len3(bx - ex[e]!, 0, bz - ez[e]!);
      const s = was ? stations[q - 1]! + fromA : stations[q]! - toB;
      if (fromA + toB < len3(bx - ax, 0, bz - az) + 0.3 && s > stations[q - 1]! && s < stations[q]!) {
        xz.push(ex[e]!, ez[e]!);
        st.push(s);
        on.push(1);
      }
    }
    xz.push(pts[q * 2]!, pts[q * 2 + 1]!);
    st.push(stations[q]!);
    on.push(ok);
  }
  line.pts = xz;
  line.stations = st;
  line.open = on;
}
