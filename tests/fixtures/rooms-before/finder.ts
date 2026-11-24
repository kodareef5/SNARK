// client/core/render/rooms.ts as it stood on 2026-11-24, before it was made faster: tests/build/rooms-equal.test.ts walks the two side
// by side. It is not kept up with the one in use: a change of answers there is made here too, or this test goes.
//
// A base's interior: the pieces of a chunk seen only from rooms its own pieces close. A piece of a base has a key in
// its frame's lattice, and the rooms are found on those keys alone (shared/world/lattice/rooms.ts), frame by frame, from
// the pieces of each frame that stand in this chunk. Air over a face that reaches past the chunk is outside air, so a
// chunk's border hides nothing. A piece is shell where air it bounds, or any its mesh reaches, is outside air; the rest
// is seen only from inside its rooms. A piece with no key closes nothing, and is interior where its mesh stands in rooms.

import type { Registry } from "../../../shared/content/registry.ts";
import { CHUNK_SIZE, STRUCT_UNITS } from "../../../shared/coords.ts";
import { LEVEL_UNITS, worldOf } from "../../../shared/world/lattice/basis.ts";
import { HALF_SIDE_M, LEVEL_M, type FormTable } from "../../../shared/world/lattice/forms.ts";
import type { Frame, Frames } from "../../../shared/world/lattice/frames.ts";
import { SIDE, facesOverlap, keyLvl } from "../../../shared/world/lattice/module.ts";
import { Enclosure } from "./enclosure.ts";
import type { ChunkTable } from "../../../shared/world/structures.ts";

/** What a kind is to the rooms it stands among. A thing closes nothing a mesh's reach is asked of, and is judged by where its mesh stands. */
const THING = 0;
const SLAB = 1;
const SIDE_PIECE = 2;
const SHUT = 3;
const OPEN = 4;

/** Per door slot: open when the rooms were found, and between outside air and an inside room then. */
export const DOOR_OPEN = 1;
export const DOOR_FRONTIER = 2;

/** Lattice units of a chunk's side, and yaw units of a quarter turn. */
const SPAN = CHUNK_SIZE * STRUCT_UNITS;
const QUARTER = 16384;
/**
 * Metres a mesh may reach past a room's side, and down into its floor, and still be hidden. A wall is seen into between
 * its boards: an inner wall's end 0.1 m into an outer one shows from outside.
 */
const IN_SIDE = 0.005;
const IN_FLOOR = 0.05;
/** Air a side's mesh reaches besides the two sides it stands between: round its ends, over its top, under its foot, or any other. */
const REACH_ENDS = 1;
const REACH_UP = 2;
const REACH_DOWN = 4;
const REACH_ELSE = 8;
/** Half-sides a bucket of a base's faces is wide. */
const BUCKET = SIDE;
const EPS = 1e-9;

const world = new Int32Array(2);
const tuples = new Int32Array(16);
const others = new Int32Array(16);
const clipA = new Float64Array(32);
const clipB = new Float64Array(32);

/** The area of a polygon of `n` corners in `poly` from `at`, cut to the box from (u0, v0) to (u1, v1). */
function areaIn(poly: Float64Array, at: number, n: number, u0: number, v0: number, u1: number, v1: number): number {
  let from = clipA;
  let to = clipB;
  for (let i = 0; i < 2 * n; i++) from[i] = poly[at + i]!;
  // Each side of the box in turn keeps what is on its inner side: u or v, at least or at most a bound.
  for (let side = 0; side < 4 && n > 0; side++) {
    const axis = side & 1;
    const bound = side === 0 ? u0 : side === 1 ? v0 : side === 2 ? u1 : v1;
    const sign = side < 2 ? 1 : -1;
    let kept = 0;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const a = (from[2 * i + axis]! - bound) * sign;
      const b = (from[2 * j + axis]! - bound) * sign;
      if (a >= 0) {
        to[2 * kept] = from[2 * i]!;
        to[2 * kept + 1] = from[2 * i + 1]!;
        kept++;
      }
      if (a >= 0 !== b >= 0) {
        const s = a / (a - b);
        to[2 * kept] = from[2 * i]! + s * (from[2 * j]! - from[2 * i]!);
        to[2 * kept + 1] = from[2 * i + 1]! + s * (from[2 * j + 1]! - from[2 * i + 1]!);
        kept++;
      }
    }
    n = kept;
    const swap = from;
    from = to;
    to = swap;
  }
  let twice = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    twice += from[2 * i]! * from[2 * j + 1]! - from[2 * j]! * from[2 * i + 1]!;
  }
  return Math.abs(twice) / 2;
}

/**
 * One frame's part in a chunk: its rooms, and its faces with room air over them laid out to be found from a place. A
 * place is told in the frame's own half-sides: `u` along its +X and `v` along its +Z from its origin, and levels up.
 */
class Base {
  readonly gid: number;
  readonly enc: Enclosure;
  /** The frame's vectors and origin in lattice units, its +X a half-side long, that vector's squared length, its yaw, and half-sides in a metre. */
  private readonly basis: Int32Array;
  private readonly ox: number;
  private readonly oy: number;
  private readonly oz: number;
  private readonly ax: number;
  private readonly az: number;
  private readonly l2: number;
  readonly yaw: number;
  readonly per: number;
  /** Whether the chunk's last finding flooded it and found its air changed. */
  moved = false;
  /** Faces with room air: each one's face in `enc`, its corners as (u, v) going round from +u toward +v, how many, and 0 or a number squares of one tiling share. */
  faces = 0;
  private face = new Int32Array(0);
  private poly = new Float64Array(0);
  private corners = new Uint8Array(0);
  private tiling = new Uint8Array(0);
  /** The faces by bucket: the buckets from (bu, bv), `nu` by `nv`, each one's faces in `items` from `start`. */
  private bu = 0;
  private bv = 0;
  private nu = 0;
  private nv = 0;
  private start = new Int32Array(1);
  private items = new Int32Array(0);
  /** Per face, the ask that last looked at it; and the faces an ask found. */
  private seen = new Int32Array(0);
  private asks = 0;
  private hit: number[] = [];

  constructor(f: Frame, forms: FormTable, x0: number, z0: number) {
    this.gid = f.gid;
    this.basis = f.basis;
    this.ox = f.ox;
    this.oy = f.oy;
    this.oz = f.oz;
    this.ax = f.basis[0]!;
    this.az = f.basis[1]!;
    this.l2 = this.ax * this.ax + this.az * this.az;
    this.yaw = f.yaw;
    this.per = STRUCT_UNITS / Math.sqrt(this.l2);
    this.enc = new Enclosure(forms);
    const basis = f.basis;
    const left = x0 * STRUCT_UNITS, back = z0 * STRUCT_UNITS;
    // Air over a face that reaches past the chunk is open to what the chunk does not hold.
    this.enc.open = (corners, n) => {
      for (let k = 0; k < n; k++) {
        worldOf(basis, f.ox, f.oz, corners, 4 * k, world, 0);
        if (world[0]! < left || world[1]! < back || world[0]! > left + SPAN || world[1]! > back + SPAN) return true;
      }
      return false;
    };
  }

  /** A place in metres along the frame's own +X, in half-sides from its origin; and `v`, along its +Z. */
  u(x: number, z: number): number {
    return ((x * STRUCT_UNITS - this.ox) * this.ax + (z * STRUCT_UNITS - this.oz) * this.az) / this.l2;
  }

  v(x: number, z: number): number {
    return ((z * STRUCT_UNITS - this.oz) * this.ax - (x * STRUCT_UNITS - this.ox) * this.az) / this.l2;
  }

  /** A height in metres as the frame's levels. */
  level(y: number): number {
    return (y * STRUCT_UNITS - this.oy) / LEVEL_UNITS;
  }

  /** Lays out the faces the last flood left with room air, and grows `box` (metres) round their rooms. */
  index(box: Float64Array): void {
    const enc = this.enc;
    const w = enc.found;
    this.faces = 0;
    if (w.inside === 0) return;
    if (this.face.length < w.faces) {
      this.face = new Int32Array(w.faces);
      this.poly = new Float64Array(w.faces * 8);
      this.corners = new Uint8Array(w.faces);
      this.tiling = new Uint8Array(w.faces);
      this.seen = new Int32Array(w.faces);
    }
    this.seen.fill(0);
    this.asks = 0;
    let u0 = Infinity, v0 = Infinity, u1 = -Infinity, v1 = -Infinity;
    for (let g = 0; g < w.faces; g++) {
      const first = w.first[g]!;
      let low = Infinity, high = -Infinity;
      for (let c = first; first >= 0 && c < first + w.count[g]!; c++) {
        if (w.room[c]! < 0) continue;
        low = Math.min(low, w.lo[c]!);
        high = Math.max(high, w.hi[c]!);
      }
      if (low > high) continue;
      const i = this.faces++;
      const n = enc.faceCorners(g, tuples);
      this.face[i] = g;
      this.corners[i] = n;
      // A square along the frame's own axes tiles with every other whose corner is a whole number of sides from its own.
      const straight = n === 4 && tuples[1] === 0 && tuples[2] === 0 && tuples[4] === tuples[0]! + SIDE && tuples[5] === 0 && tuples[6] === 0 && tuples[7] === tuples[3];
      this.tiling[i] = straight ? 1 + (tuples[0]! & 1) + 2 * (tuples[3]! & 1) : 0;
      for (let k = 0; k < n; k++) {
        worldOf(this.basis, this.ox, this.oz, tuples, 4 * k, world, 0);
        const dx = world[0]! - this.ox, dz = world[1]! - this.oz;
        const u = (dx * this.ax + dz * this.az) / this.l2, v = (dz * this.ax - dx * this.az) / this.l2;
        this.poly[i * 8 + 2 * k] = u;
        this.poly[i * 8 + 2 * k + 1] = v;
        u0 = Math.min(u0, u);
        v0 = Math.min(v0, v);
        u1 = Math.max(u1, u);
        v1 = Math.max(v1, v);
        const x = world[0]! / STRUCT_UNITS, z = world[1]! / STRUCT_UNITS;
        box[0] = Math.min(box[0]!, x);
        box[2] = Math.min(box[2]!, z);
        box[3] = Math.max(box[3]!, x);
        box[5] = Math.max(box[5]!, z);
      }
      box[1] = Math.min(box[1]!, (this.oy + low * LEVEL_UNITS) / STRUCT_UNITS);
      box[4] = Math.max(box[4]!, (this.oy + high * LEVEL_UNITS) / STRUCT_UNITS);
    }
    this.bu = Math.floor(u0 / BUCKET);
    this.bv = Math.floor(v0 / BUCKET);
    this.nu = Math.floor(u1 / BUCKET) - this.bu + 1;
    this.nv = Math.floor(v1 / BUCKET) - this.bv + 1;
    const buckets = this.nu * this.nv;
    if (this.start.length < buckets + 1) this.start = new Int32Array(buckets + 1);
    const start = this.start.fill(0, 0, buckets + 1);
    let total = 0;
    // Counted into the slot after each bucket's, summed to each bucket's end, then set down from its end backward.
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < this.faces; i++) {
        let a0 = Infinity, b0 = Infinity, a1 = -Infinity, b1 = -Infinity;
        for (let k = 0; k < this.corners[i]!; k++) {
          a0 = Math.min(a0, this.poly[i * 8 + 2 * k]!);
          a1 = Math.max(a1, this.poly[i * 8 + 2 * k]!);
          b0 = Math.min(b0, this.poly[i * 8 + 2 * k + 1]!);
          b1 = Math.max(b1, this.poly[i * 8 + 2 * k + 1]!);
        }
        for (let b = Math.floor(b0 / BUCKET) - this.bv; b <= Math.floor(b1 / BUCKET) - this.bv; b++) {
          for (let a = Math.floor(a0 / BUCKET) - this.bu; a <= Math.floor(a1 / BUCKET) - this.bu; a++) {
            if (pass === 0) start[b * this.nu + a + 1]!++;
            else this.items[--start[b * this.nu + a + 1]!] = i;
          }
        }
      }
      if (pass === 1) break;
      for (let b = 0; b < buckets; b++) start[b + 1]! += start[b]!;
      total = start[buckets]!;
      if (this.items.length < total) this.items = new Int32Array(total);
    }
    // Each slot now holds the start of the bucket before it.
    start.copyWithin(0, 1, buckets + 1);
    start[buckets] = total;
  }

  /** Whether laid-out face `i` and the box from (u0, v0) to (u1, v1) share a point. */
  private meets(i: number, u0: number, v0: number, u1: number, v1: number): boolean {
    const p = this.poly, at = i * 8, n = this.corners[i]!;
    let a0 = Infinity, b0 = Infinity, a1 = -Infinity, b1 = -Infinity;
    for (let k = 0; k < n; k++) {
      a0 = Math.min(a0, p[at + 2 * k]!);
      a1 = Math.max(a1, p[at + 2 * k]!);
      b0 = Math.min(b0, p[at + 2 * k + 1]!);
      b1 = Math.max(b1, p[at + 2 * k + 1]!);
    }
    if (a1 < u0 || a0 > u1 || b1 < v0 || b0 > v1) return false;
    if (this.tiling[i] !== 0) return true;
    // A side with the whole box on its outer side parts them.
    for (let k = 0; k < n; k++) {
      const j = (k + 1) % n;
      const su = p[at + 2 * j]! - p[at + 2 * k]!, sv = p[at + 2 * j + 1]! - p[at + 2 * k + 1]!;
      const c0 = su * (v0 - p[at + 2 * k + 1]!), c1 = su * (v1 - p[at + 2 * k + 1]!);
      const d0 = sv * (u0 - p[at + 2 * k]!), d1 = sv * (u1 - p[at + 2 * k]!);
      if (Math.max(c0, c1) - Math.min(d0, d1) < -EPS) return false;
    }
    return true;
  }

  /** The laid-out faces the box from (u0, v0) to (u1, v1) meets, to `hit`. */
  private find(u0: number, v0: number, u1: number, v1: number): number[] {
    const hit = this.hit;
    hit.length = 0;
    const ask = ++this.asks;
    const a0 = Math.max(0, Math.floor(u0 / BUCKET) - this.bu), a1 = Math.min(this.nu - 1, Math.floor(u1 / BUCKET) - this.bu);
    const b0 = Math.max(0, Math.floor(v0 / BUCKET) - this.bv), b1 = Math.min(this.nv - 1, Math.floor(v1 / BUCKET) - this.bv);
    for (let b = b0; b <= b1; b++) {
      for (let a = a0; a <= a1; a++) {
        for (let at = this.start[b * this.nu + a]!; at < this.start[b * this.nu + a + 1]!; at++) {
          const i = this.items[at]!;
          if (this.seen[i] === ask) continue;
          this.seen[i] = ask;
          if (this.meets(i, u0, v0, u1, v1)) hit.push(i);
        }
      }
    }
    return hit;
  }

  /** Whether a room's air is in the box from (u0, v0) to (u1, v1), from level `l0` up to `l1`, its sides and its bounds counted in. */
  reaches(u0: number, v0: number, u1: number, v1: number, l0: number, l1: number): boolean {
    if (this.faces === 0) return false;
    const w = this.enc.found;
    for (const i of this.find(u0, v0, u1, v1)) {
      const g = this.face[i]!;
      for (let c = w.first[g]!, end = c + w.count[g]!; c < end; c++) if (w.room[c]! >= 0 && w.lo[c]! <= l1 && w.hi[c]! > l0) return true;
    }
    return false;
  }

  /** Whether room air fills the box from (u0, v0) to (u1, v1) over the levels from `l0` up to `l1`: every face under it has it at each, and they cover it. */
  holds(u0: number, v0: number, u1: number, v1: number, l0: number, l1: number): boolean {
    if (this.faces === 0) return false;
    // A box with no width is asked as a sliver.
    u1 = Math.max(u1, u0 + 1e-6);
    v1 = Math.max(v1, v0 + 1e-6);
    const hit = this.find(u0, v0, u1, v1);
    let got = 0, tiling = -1, kept = 0;
    for (const i of hit) {
      // A square along the frame's axes runs from its first corner to its third.
      const p = this.poly, at = i * 8;
      const area = this.tiling[i] !== 0 ? Math.max(0, Math.min(u1, p[at + 4]!) - Math.max(u0, p[at]!)) * Math.max(0, Math.min(v1, p[at + 5]!) - Math.max(v0, p[at + 1]!)) : areaIn(p, at, this.corners[i]!, u0, v0, u1, v1);
      if (area <= 0) continue;
      if (this.enc.filled(this.face[i]!, l0, l1) !== 1) return false;
      got += area;
      tiling = tiling < 0 || tiling === this.tiling[i] ? this.tiling[i]! : 0;
      hit[kept++] = i;
    }
    if (got < (u1 - u0) * (v1 - v0) * (1 - 1e-6)) return false;
    // Faces of two tilings may lie over one another, and their areas then say nothing: so none may.
    for (let p = 0; tiling === 0 && p < kept; p++) {
      const n = this.enc.faceCorners(this.face[hit[p]!]!, tuples);
      for (let q = p + 1; q < kept; q++) if (facesOverlap(tuples, 0, n, others, 0, this.enc.faceCorners(this.face[hit[q]!]!, others))) return false;
    }
    return true;
  }
}

/**
 * A chunk's rooms, kept with what is drawn of it: each frame's part of them, and per slot what its frame was told of it,
 * so that after a few pieces change only theirs are told again. Asked each frame whether the camera is near an inside one.
 */
export class Rooms {
  /** The chunk's version they stand at, or -1 where they are to be found whole. */
  version = -1;
  readonly bases: Base[] = [];
  /** Per slot: its base in `bases`, or -1; the kind and key that base was told; and its face or edge there, or -1. */
  base = new Int16Array(0);
  kind = new Uint16Array(0);
  k0 = new Uint32Array(0);
  k1 = new Uint32Array(0);
  element = new Int32Array(0);
  /** Per slot, 0 for a piece seen only from inside rooms; and each door's DOOR_ flags. */
  shell = new Uint8Array(0);
  readonly doors = new Map<number, number>();
  /** Whether any room is inside, whether `shell` stands for every slot, and the box round those rooms in metres. */
  inside = false;
  sorted = false;
  readonly box = new Float64Array(6);

  /** Whether a ball of `r` metres about (x, y, z) reaches an inside room. */
  near(x: number, y: number, z: number, r: number): boolean {
    const box = this.box;
    if (!this.inside || x < box[0]! - r || y < box[1]! - r || z < box[2]! - r || x > box[3]! + r || y > box[4]! + r || z > box[5]! + r) return false;
    for (const b of this.bases) {
      const u = b.u(x, z), v = b.v(x, z), l = b.level(y);
      const ru = r * b.per, rl = (r * STRUCT_UNITS) / LEVEL_UNITS;
      if (b.reaches(u - ru, v - ru, u + ru, v + ru, l - rl, l + rl)) return true;
    }
    return false;
  }
}

/** Finds which of a chunk's pieces are shell. One per scene; its scratch grows to the largest chunk. */
export class RoomFinder {
  /**
   * Per kind: what it is to its rooms, which air its mesh reaches besides what it stands between (REACH_), the levels it
   * stands, and its mesh's box about its origin in its own frame (middle x, y, z, then half x, y, z) in metres.
   */
  private readonly form: Uint8Array;
  private readonly reach: Uint8Array;
  private readonly span: Uint8Array;
  private readonly box: Float32Array;
  private readonly forms: FormTable;
  /** The slots changed since the rooms were last found (update), and how many. */
  private changed = new Int32Array(0);
  private count = 0;

  /** Metres a mesh must end under its storey's top: the most any floor's coarser levels lie from its finest. */
  private under = 0;

  /** `meshes` are the pack's, with their bounds over every level; `errors` each level's error by mesh (AssetTable). */
  constructor(reg: Registry, meshOf: Uint16Array, meshes: readonly { readonly center: readonly number[]; readonly half: readonly number[] }[], errors: readonly (readonly number[])[]) {
    const n = reg.defs.length;
    this.forms = reg.forms;
    this.form = new Uint8Array(n);
    this.reach = new Uint8Array(n);
    this.span = new Uint8Array(n);
    this.box = new Float32Array(n * 6);
    for (let k = 1; k < n; k++) {
      const mesh = meshes[meshOf[k]!];
      for (let i = 0; i < 3 && mesh; i++) {
        this.box[k * 6 + i] = mesh.center[i]!;
        this.box[k * 6 + 3 + i] = mesh.half[i]!;
      }
      const f = reg.forms.def[k];
      if (!f) continue;
      this.span[k] = f.span;
      // A piece over more than one edge, or with a sloped top, is judged by where its mesh stands.
      const wide = new Set((f.cells ?? []).map((c) => c[0])).size > 1;
      const flat = (f.edges ?? []).every((e) => e.profile === "flat");
      if (f.layer === "slab" && (f.size ?? SIDE) === SIDE) this.form[k] = SLAB;
      else if (f.layer === "wall" && !wide && flat && f.closes !== undefined && f.closes !== "none") this.form[k] = SIDE_PIECE;
      else if (f.layer === "leaf" && f.cls === "edge" && !wide && reg.opens[k] !== 0) this.form[k] = f.closes === "full" ? SHUT : OPEN;
    }
    // A mesh reaching a storey's top shows where a ceiling's coarser level sinks under it.
    for (let k = 1; k < n; k++) if (this.form[k] === SLAB) for (const e of errors[meshOf[k]!] ?? []) this.under = Math.max(this.under, e);
    for (let k = 1; k < n; k++) {
      const f = reg.forms.def[k];
      const form = this.form[k]!;
      if (!f || form === THING) continue;
      // The mesh's box from its slot's reference point: past its face sideways, or past its edge's ends, top, foot or thickness.
      const b = this.box, at = k * 6;
      const along = Math.abs(f.at[0] + b[at]!) + b[at + 3]!, across = Math.abs(f.at[2] + b[at + 2]!) + b[at + 5]!;
      const foot = f.at[1] + b[at + 1]! - b[at + 4]! + IN_FLOOR, top = f.at[1] + b[at + 1]! + b[at + 4]! + this.under;
      if (form === SLAB) this.reach[k] = f.cls === "triangle" || along > HALF_SIDE_M + IN_SIDE || across > HALF_SIDE_M + IN_SIDE ? REACH_ELSE : 0;
      else this.reach[k] = (along > HALF_SIDE_M + IN_SIDE ? REACH_ENDS : 0) | (top > f.span * LEVEL_M ? REACH_UP : 0) | (foot < 0 ? REACH_DOWN : 0) | (across > 2 * HALF_SIDE_M + IN_SIDE ? REACH_ELSE : 0);
    }
  }

  /** 0 for a kind that is a shut door, 1 for an open one, -1 for any other. */
  door(kind: number): number {
    const form = this.form[kind];
    return form === SHUT ? 0 : form === OPEN ? 1 : -1;
  }

  /**
   * Finds which pieces of the chunk at (x0, z0) metres are seen only from inside rooms, into `rooms`: what was found of
   * the chunk before, brought up to date by the slots changed since where they are few. `frames` are the store's. Whether
   * any piece is inside, and so whether its `shell` and `doors` stand.
   */
  find(t: ChunkTable, x0: number, z0: number, rooms: Rooms, frames: Frames): boolean {
    const kept = rooms.version >= 0 && this.update(t, x0, z0, rooms, frames);
    if (!kept) this.lay(t, x0, z0, rooms, frames);
    rooms.version = t.version;
    // Where the changes left every cell of air as open as it was, only the pieces changed are sorted again; where they
    // kept the cells and moved some across outside, those and the pieces that stand by the air that moved.
    let same = kept, whole = !kept || !rooms.sorted;
    for (const b of rooms.bases) {
      b.moved = false;
      if (!b.enc.stale && kept) continue;
      b.enc.flood();
      b.moved = b.enc.changed;
      same = same && !b.enc.changed;
      whole = whole || b.enc.rebuilt;
    }
    if (!same) {
      const box = rooms.box;
      box[0] = box[1] = box[2] = Infinity;
      box[3] = box[4] = box[5] = -Infinity;
      rooms.inside = false;
      for (const b of rooms.bases) {
        b.index(box);
        rooms.inside ||= b.faces > 0;
      }
    }
    if (!rooms.inside) rooms.sorted = false;
    else if (!same && whole) {
      rooms.doors.clear();
      for (let slot = 0; slot < t.high; slot++) this.sort(t, rooms, slot);
      rooms.sorted = true;
    } else {
      for (let slot = 0; !same && slot < t.high; slot++) if (this.moved(t, rooms, slot)) this.again(t, rooms, slot);
      for (let i = 0; i < this.count; i++) this.again(t, rooms, this.changed[i]!);
    }
    return rooms.inside;
  }

  /** Whether the piece in `slot` stands by air that the last flood moved across outside, or is judged by where its mesh stands. */
  private moved(t: ChunkTable, rooms: Rooms, slot: number): boolean {
    const kind = t.kind[slot]!, at = rooms.base[slot]!, form = this.form[kind]!;
    if (kind === 0) return false;
    if (at < 0 || form === THING || rooms.element[slot]! < 0 || (this.reach[kind]! & REACH_ELSE) !== 0) return true;
    const b = rooms.bases[at]!;
    return b.moved && (form === SLAB ? b.enc.faceMoved(rooms.element[slot]!) : b.enc.edgeMoved(rooms.element[slot]!));
  }

  private again(t: ChunkTable, rooms: Rooms, slot: number): void {
    rooms.doors.delete(slot);
    this.sort(t, rooms, slot);
  }

  /** Tells the frame of the keyed piece in `slot` of it, making the frame's part in this chunk where it is the first. */
  private enter(t: ChunkTable, x0: number, z0: number, rooms: Rooms, frames: Frames, slot: number): void {
    const gid = t.fr![slot]!;
    const bases = rooms.bases;
    let at = bases.length - 1;
    while (at >= 0 && bases[at]!.gid !== gid) at--;
    if (at < 0) {
      const f = frames.get(gid);
      if (!f || bases.length === 32767) return;
      at = bases.push(new Base(f, this.forms, x0, z0)) - 1;
    }
    rooms.base[slot] = at;
    rooms.kind[slot] = t.kind[slot]!;
    rooms.k0[slot] = t.k0![slot]!;
    rooms.k1[slot] = t.k1![slot]!;
    rooms.element[slot] = bases[at]!.enc.add(t.kind[slot]!, t.k0![slot]!, t.k1![slot]!, slot);
  }

  /** Tells every keyed piece of the chunk to its frame afresh. */
  private lay(t: ChunkTable, x0: number, z0: number, rooms: Rooms, frames: Frames): void {
    rooms.bases.length = 0;
    this.count = 0;
    if (rooms.base.length < t.high) {
      const n = Math.max(t.high, rooms.base.length * 2);
      rooms.base = new Int16Array(n);
      rooms.kind = new Uint16Array(n);
      rooms.k0 = new Uint32Array(n);
      rooms.k1 = new Uint32Array(n);
      rooms.element = new Int32Array(n);
      rooms.shell = new Uint8Array(n);
    }
    rooms.base.fill(-1);
    const fr = t.fr;
    for (let slot = 0; fr && slot < t.high; slot++) if (t.kind[slot] !== 0 && fr[slot] !== 0) this.enter(t, x0, z0, rooms, frames, slot);
  }

  /**
   * Brings the rooms up to date with the slots changed since they were found, where those are few: a slot written since,
   * or one whose key is no longer what its frame was told. Whether it could.
   */
  private update(t: ChunkTable, x0: number, z0: number, rooms: Rooms, frames: Frames): boolean {
    if (rooms.base.length < t.high) return false;
    const mod = t.mod, since = rooms.version, most = Math.max(64, t.high >> 4);
    const fr = t.fr, bases = rooms.bases;
    if (this.changed.length < most) this.changed = new Int32Array(most);
    this.count = 0;
    for (let slot = 0; slot < t.high; slot++) {
      const held = rooms.base[slot]!, keyed = fr !== null && fr[slot] !== 0 && t.kind[slot] !== 0;
      const told = held >= 0 && keyed && bases[held]!.gid === fr[slot] && rooms.kind[slot] === t.kind[slot] && rooms.k0[slot] === t.k0![slot] && rooms.k1[slot] === t.k1![slot];
      if (mod[slot]! <= since && (told || (held < 0 && !keyed))) continue;
      if (this.count === most) return false;
      this.changed[this.count++] = slot;
    }
    for (let i = 0; i < this.count; i++) {
      const slot = this.changed[i]!, held = rooms.base[slot]!;
      if (held >= 0) bases[held]!.enc.remove(rooms.kind[slot]!, rooms.k0[slot]!, rooms.k1[slot]!, slot);
      rooms.base[slot] = -1;
      if (fr !== null && fr[slot] !== 0 && t.kind[slot] !== 0) this.enter(t, x0, z0, rooms, frames, slot);
    }
    return true;
  }

  /** Sorts the piece in `slot`: 0 in the rooms' `shell` where it is seen only from inside rooms, else 1; and sets a door's flags. */
  private sort(t: ChunkTable, rooms: Rooms, slot: number): void {
    const kind = t.kind[slot]!, at = rooms.base[slot]!, form = this.form[kind]!;
    const e = at < 0 ? -1 : rooms.element[slot]!;
    let hidden = false;
    if (kind === 0) hidden = false;
    else if (e >= 0 && form !== THING) {
      const b = rooms.bases[at]!, enc = b.enc, lvl = keyLvl(rooms.k1[slot]!), r = this.reach[kind]!;
      if (form === SLAB) hidden = enc.filled(e, lvl, lvl + 1) === 1 && enc.filled(e, lvl - 1, lvl) === 1;
      else {
        const top = lvl + this.span[kind]!, ends = (r & REACH_ENDS) !== 0;
        if (form >= SHUT) rooms.doors.set(slot, (form === OPEN ? DOOR_OPEN : 0) | (enc.sideFilled(e, 0, lvl, top) !== enc.sideFilled(e, 1, lvl, top) ? DOOR_FRONTIER : 0));
        // The air its mesh reaches past its ends, over its top and under its foot is asked on both sides too.
        hidden = enc.edgeFilled(e, lvl, top, ends) && ((r & REACH_UP) === 0 || enc.edgeFilled(e, top, top + 1, ends)) && ((r & REACH_DOWN) === 0 || enc.edgeFilled(e, lvl - 1, lvl, ends));
      }
      if (hidden && (r & REACH_ELSE) !== 0) hidden = this.within(t, slot, b);
    } else {
      for (let i = 0; !hidden && i < rooms.bases.length; i++) hidden = this.within(t, slot, rooms.bases[i]!);
    }
    rooms.shell[slot] = hidden ? 0 : 1;
  }

  /** Whether all the air the mesh of the piece in `slot` reaches is room air of `b`. */
  private within(t: ChunkTable, slot: number, b: Base): boolean {
    if (b.faces === 0) return false;
    const kind = t.kind[slot]!, yaw = t.yaw[slot]!;
    const box = this.box, at = kind * 6;
    const cx = box[at]!, cy = box[at + 1]!, cz = box[at + 2]!, hx = box[at + 3]!, hy = box[at + 4]!, hz = box[at + 5]!;
    const x = t.x[slot]!, y = t.y[slot]!, z = t.z[slot]!;
    let du = 0, dv = 0, hu = hx, hv = hz;
    // Turned square to the frame, its box is its mesh's; turned otherwise, as far as the mesh reaches at any turn.
    if (((yaw - b.yaw) & (QUARTER - 1)) !== 0 || (t.tw !== null && t.tw[slot] !== 0)) hu = hv = Math.hypot(Math.abs(cx) + hx, Math.abs(cz) + hz);
    else {
      const q = ((b.yaw - yaw) >> 14) & 3;
      du = q === 0 ? cx : q === 1 ? -cz : q === 2 ? -cx : cz;
      dv = q === 0 ? cz : q === 1 ? cx : q === 2 ? -cz : -cx;
      if (q & 1) {
        hu = hz;
        hv = hx;
      }
    }
    const u = b.u(x, z) + du * b.per, v = b.v(x, z) + dv * b.per;
    const su = Math.max(0, hu - IN_SIDE) * b.per, sv = Math.max(0, hv - IN_SIDE) * b.per;
    const low = Math.floor(b.level(y + cy - hy + IN_FLOOR));
    return b.holds(u - su, v - sv, u + su, v + sv, low, Math.max(low + 1, Math.ceil(b.level(y + cy + hy + this.under))));
  }
}
