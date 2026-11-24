// What a base hides: plates in the middle of its walls and ceilings, for the picture of what hides what (hide.ts). A
// plate is a rectangle of no thickness that every line of sight through it meets the piece's own faces before. Walls
// of one kind in a row on one storey are one plate; rows alike on the storeys over them are one more where the tier's
// walls close on each other top to foot; and ceilings side by side are one. Only a piece drawn this frame, whole, from
// a mesh that is closed at every level may have one:
//
// - A full wall a storey high on one edge, and a whole square ceiling, of a tier OPAQUE names. A doorway, a window, a
//   door, a half wall, a sloped wall, a roof, a foundation and a triangle have none.
// - Drawn on its base's own vectors (piece-fit.ts PIECE_FRAMED), so it ends where its neighbour begins; a piece drawn by
//   its yaw alone may stand millimetres off.
// - Shell, where its chunk has rooms (rooms.ts): a piece inside them is drawn only from inside.
// - Its mesh known. One not yet come is drawn as a point.
// - A piece that gives way to a trim (FIT_YIELD) is a plate by itself, cut back by the band it gives.
//
// A plate is told from its piece's key, so it lies on the lattice exactly as the piece is drawn: a wall along direction
// d from corner A covers A to A + 2ζ^d, and a square those and a quarter turn on (shared/world/lattice/basis.ts).

import type { Registry } from "../../../shared/content/registry.ts";
import { STRUCT_UNITS } from "../../../shared/coords.ts";
import { INSTANCE_BYTES } from "../../../shared/pack/pack.ts";
import { LEVEL_UNITS, dirVector, worldOf } from "../../../shared/world/lattice/basis.ts";
import { STOREY_LEVELS } from "../../../shared/world/lattice/forms.ts";
import type { Frame, Frames } from "../../../shared/world/lattice/frames.ts";
import { SIDE, keyAnchor, keyDir, keyLvl, tupleTurn } from "../../../shared/world/lattice/module.ts";
import type { ChunkTable } from "../../../shared/world/structures.ts";
import { OCCLUDER } from "./hide.ts";
import { FIT_YIELD, PIECE_FIT_AT, PIECE_FRAMED, PIECE_STATE_AT, PIECE_YIELD } from "./piece-fit.ts";

/**
 * The tiers whose meshes are closed about the middle of a wall, and of a ceiling, at every level they are drawn at,
 * alone and beside another of any level; and with `stacks`, a wall under another of any level too
 * (tests/render/base-occluders.test.ts holds each to it). Wood is not: its finest wall is seen through between boards,
 * and its ceiling's deck lies over open joists. Thatch is cut out. Metal's ceiling is a sheet over open ribs. A stone
 * wall's top lies 3 mm under the foot of a coarser wall over it, so stone's rows are a plate a storey.
 */
const OPAQUE: Readonly<Record<string, { readonly wall: boolean; readonly slab: boolean; readonly stacks: boolean }>> = { stone: { wall: true, slab: true, stacks: false }, metal: { wall: true, slab: false, stacks: true } };

export const PLATE_NONE = 0;
export const PLATE_WALL = 1;
export const PLATE_SLAB = 2;
/** A plate is kept where it is this many square metres at least, and is shrunk this many metres a side: as hide.ts keeps the city's. */
const FACE_LEAST = 4;
const SHRINK = 0.03;
/** The most plates a chunk keeps, the largest first, and the most bases of a chunk whose pieces are looked at. */
const PLATES_MOST = 96;
const BASES_MOST = 32;
/** Metres from the camera within which a plate is left out, besides the near plane's reach: a piece's faces stand that far off its middle at most. */
export const PLATE_CLEAR = 0.3;
/** A tuple turned to its direction is within this of zero, either side. */
const M_BIAS = 4096;
const M_SPAN = 8192;
/** More pieces than a chunk holds side by side. */
const RUN_MOST = 128;

const NONE = new Float64Array(0);
const m = new Int32Array(8);
const at = new Int32Array(4);

export class BasePlates {
  /** Per kind: PLATE_WALL or PLATE_SLAB where its pieces may be plates, and whether its rows are one plate with the rows over them. */
  readonly plate: Uint8Array;
  readonly stacks: Uint8Array;
  /** Scratch, per piece that may be a plate: its slot, its row or plane among `groups`, its place along and across (a wall's level), whether it gives way, and its corner in lattice units. */
  private slot = new Int32Array(256);
  private group = new Int32Array(256);
  private along = new Int16Array(256);
  private across = new Int16Array(256);
  private cut = new Uint8Array(256);
  private wx = new Int32Array(256);
  private wz = new Int32Array(256);
  private key = new Float64Array(256);
  private order = new Int32Array(256);
  /** Runs of pieces side by side: the first piece, the run's row, from and to along it, its place across, and whether it is cut. */
  private runFirst = new Int32Array(64);
  private runFrom = new Int16Array(64);
  private runTo = new Int16Array(64);
  private runKey = new Float64Array(64);
  private runOrder = new Int32Array(64);
  /** Per row or plane: its base in `bases`, its direction, and whether it is of slabs. */
  private readonly groups = new Map<number, number>();
  private groupBase: number[] = [];
  private groupDir: number[] = [];
  private groupSlab: number[] = [];
  private readonly bases: Frame[] = [];
  private readonly out: number[] = [];

  constructor(reg: Registry) {
    this.plate = new Uint8Array(reg.defs.length);
    this.stacks = new Uint8Array(reg.defs.length);
    for (let k = 1; k < reg.defs.length; k++) {
      const d = reg.defs[k]!, f = reg.forms?.def[k];
      if (!f || d.type !== "structure") continue;
      const tier = OPAQUE[/^[^:]+:mat_(.+)$/.exec(d.material ?? "")?.[1] ?? ""];
      if (!tier || f.openings !== undefined || f.cells !== undefined) continue;
      const level = (f.edges ?? []).every((e) => e.profile === "flat");
      this.stacks[k] = tier.stacks ? 1 : 0;
      if (tier.wall && f.cls === "edge" && f.layer === "wall" && f.plane === "upright" && f.closes === "full" && f.span === STOREY_LEVELS && level) this.plate[k] = PLATE_WALL;
      else if (tier.slab && f.cls === "square" && f.layer === "slab" && f.plane === "flat" && (f.size ?? SIDE) === SIDE && f.span === 0 && f.root === undefined && f.corner === undefined && (f.closes === undefined || f.closes === "full")) this.plate[k] = PLATE_SLAB;
    }
  }

  /**
   * The plates of a chunk's pieces as its instances draw them (OCCLUDER numbers each, in metres in the world): `drawn`
   * is each slot's instance or -1, `data` the instances' bytes, `shell` 0 for a slot drawn only from inside rooms, or
   * null where the chunk has none, and `known` whether a kind's own mesh is here to be drawn.
   */
  of(t: ChunkTable, frames: Frames, drawn: Int32Array, data: Uint8Array, shell: Uint8Array | null, known: (kind: number) => boolean): Float64Array {
    const fr = t.fr, k0 = t.k0, k1 = t.k1, plate = this.plate, bases = this.bases;
    if (!fr || !k0 || !k1) return NONE;
    this.groups.clear();
    this.groupBase.length = this.groupDir.length = this.groupSlab.length = bases.length = 0;
    let n = 0, lastKind = 0, lastKnown = false, base = -1;
    for (let s = 0; s < t.high; s++) {
      const kind = t.kind[s]!, what = plate[kind]!;
      if (what === PLATE_NONE) continue;
      const i = s < drawn.length ? drawn[s]! : -1;
      if (i < 0 || fr[s] === 0 || (shell !== null && shell[s] === 0) || (data[i * INSTANCE_BYTES + PIECE_STATE_AT]! & PIECE_FRAMED) === 0) continue;
      if (kind !== lastKind) {
        lastKind = kind;
        lastKnown = known(kind);
      }
      if (!lastKnown) continue;
      if (base < 0 || bases[base]!.gid !== fr[s]) {
        const f = frames.get(fr[s]!);
        base = f ? bases.indexOf(f) : -1;
        if (f && base < 0 && bases.length < BASES_MOST) base = bases.push(f) - 1;
        if (base < 0) continue;
      }
      const f = bases[base]!, d = keyDir(k1[s]!), lvl = keyLvl(k1[s]!);
      keyAnchor(k0[s]!, k1[s]!, m, 0);
      // Turned back by its direction, the piece runs along the first number: pieces in one row differ in that alone.
      tupleTurn(m, 0, -d, m, 4);
      const slab = what === PLATE_SLAB;
      const a = slab ? lvl : m[5]!, b = slab ? m[5]! : m[6]!, c = slab ? m[6]! : m[7]!;
      if (Math.abs(m[4]!) >= M_BIAS || Math.abs(a) >= M_BIAS || Math.abs(b) >= M_BIAS || Math.abs(c) >= M_BIAS || Math.abs(m[7]!) >= M_BIAS) continue;
      const name = ((((slab ? 1 : 0) * BASES_MOST + base) * 16 + d) * M_SPAN + a + M_BIAS) * M_SPAN * M_SPAN + (b + M_BIAS) * M_SPAN + c + M_BIAS;
      let g = this.groups.get(name);
      if (g === undefined) {
        g = this.groupBase.length;
        this.groups.set(name, g);
        this.groupBase.push(base);
        this.groupDir.push(d);
        this.groupSlab.push(slab ? 1 : 0);
      }
      if (n === this.slot.length) this.grow();
      worldOf(f.basis, f.ox, f.oz, m, 0, at, 0);
      this.slot[n] = s;
      this.group[n] = g;
      this.along[n] = m[4]!;
      this.across[n] = slab ? m[7]! : lvl;
      this.cut[n] = (data[i * INSTANCE_BYTES + PIECE_FIT_AT]! & FIT_YIELD) !== 0 ? 1 : 0;
      this.wx[n] = at[0]!;
      this.wz[n] = at[1]!;
      // By row, then across, then along: pieces side by side follow each other.
      this.key[n] = (g * M_SPAN + this.across[n]! + M_BIAS) * M_SPAN + m[4]! + M_BIAS;
      this.order[n] = n;
      n++;
    }
    if (n === 0) return NONE;
    const key = this.key, order = this.order.subarray(0, n).sort((p, q) => key[p]! - key[q]!);
    // Runs of pieces side by side in one row. One that gives way at an end is a run by itself.
    let runs = 0;
    for (let e = 0; e < n; e++) {
      const p = order[e]!, last = runs - 1;
      const prev = e > 0 ? order[e - 1]! : -1;
      const joins = prev >= 0 && this.group[prev] === this.group[p] && this.across[prev] === this.across[p] && this.along[p] === this.along[prev]! + SIDE && this.cut[p] === 0 && this.cut[prev] === 0 && t.kind[this.slot[p]!] === t.kind[this.slot[prev]!];
      if (joins) {
        this.runTo[last] = this.along[p]! + SIDE;
        continue;
      }
      if (runs === this.runFirst.length) this.growRuns();
      this.runFirst[runs] = p;
      this.runFrom[runs] = this.along[p]!;
      this.runTo[runs] = this.along[p]! + SIDE;
      this.runOrder[runs] = runs;
      runs++;
    }
    // By row, then where it begins and how long it is, then across: runs alike over each other, or beside, follow each other.
    for (let r = 0; r < runs; r++) {
      const p = this.runFirst[r]!;
      this.runKey[r] = ((this.group[p]! * M_SPAN + this.runFrom[r]! + M_BIAS) * RUN_MOST + (this.runTo[r]! - this.runFrom[r]!) / SIDE) * M_SPAN + this.across[p]! + M_BIAS;
    }
    const runKey = this.runKey, runOrder = this.runOrder.subarray(0, runs).sort((p, q) => runKey[p]! - runKey[q]!);
    const out = this.out;
    out.length = 0;
    for (let e = 0; e < runs; ) {
      const r = runOrder[e]!, p = this.runFirst[r]!, g = this.group[p]!, slab = this.groupSlab[g] === 1, step = slab ? SIDE : STOREY_LEVELS;
      // The runs alike that follow it across, each where the one before ends: ceilings beside it, or walls over it that close on it.
      const kind = t.kind[this.slot[p]!]!;
      let to = this.across[p]! + step;
      let next = e + 1;
      for (; next < runs && this.cut[p] === 0 && (slab || this.stacks[kind] === 1); next++) {
        const q = runOrder[next]!, pq = this.runFirst[q]!;
        if (this.group[pq] !== g || this.runFrom[q] !== this.runFrom[r] || this.runTo[q] !== this.runTo[r] || this.across[pq] !== to || this.cut[pq] === 1 || t.kind[this.slot[pq]!] !== kind) break;
        to += step;
      }
      e = next;
      this.put(t, bases[this.groupBase[g]!]!, this.groupDir[g]!, slab, p, (this.runTo[r]! - this.runFrom[r]!) / SIDE, (to - this.across[p]!) / step);
    }
    if (out.length > PLATES_MOST * OCCLUDER) this.largest();
    return Float64Array.from(out);
  }

  /** Adds the plate of `across` rows of `along` pieces side by side whose first piece is `p`. */
  private put(t: ChunkTable, f: Frame, d: number, slab: boolean, p: number, along: number, across: number): void {
    dirVector(f.basis, d, at, 0);
    const vx = at[0]!, vz = at[1]!, long = Math.hypot(vx, vz), U = STRUCT_UNITS;
    const give = this.cut[p] === 1 ? PIECE_YIELD : 0;
    // A wall's row goes up by storeys; a ceiling's goes on a quarter turn from its direction, (-z, x).
    const lengthX = (2 * along * long) / U - 2 * give, lengthZ = slab ? (2 * across * long) / U - 2 * give : 0;
    const height = slab ? 0 : (across * STOREY_LEVELS * LEVEL_UNITS) / U;
    if (lengthX * (slab ? lengthZ : height) < FACE_LEAST) return;
    const hx = lengthX / 2 - SHRINK, hy = slab ? 0 : height / 2 - SHRINK, hz = slab ? lengthZ / 2 - SHRINK : 0;
    if (hx <= 0 || (slab ? hz : hy) <= 0) return;
    const x = (this.wx[p]! + along * vx - (slab ? across * vz : 0)) / U, z = (this.wz[p]! + along * vz + (slab ? across * vx : 0)) / U;
    // A ceiling lies about its row's own height; a wall stands from its level's plane.
    const y = slab ? t.y[this.slot[p]!]! : (f.oy + this.across[p]! * LEVEL_UNITS) / U + height / 2;
    this.out.push(x, y, z, hx, hy, hz, vx / long, -vz / long, Math.hypot(hx, hy, hz), 2 * Math.min(hx, slab ? hz : hy));
  }

  /** Keeps the PLATES_MOST largest of `out`. */
  private largest(): void {
    const out = this.out, count = out.length / OCCLUDER;
    const area = (k: number): number => 4 * out[k * OCCLUDER + 3]! * Math.max(out[k * OCCLUDER + 4]!, out[k * OCCLUDER + 5]!);
    const kept = Array.from({ length: count }, (_, k) => k).sort((p, q) => area(q) - area(p)).slice(0, PLATES_MOST).flatMap((k) => out.slice(k * OCCLUDER, (k + 1) * OCCLUDER));
    out.length = 0;
    for (const v of kept) out.push(v);
  }

  private grow(): void {
    const size = this.slot.length * 2;
    this.slot = grown(this.slot, size);
    this.group = grown(this.group, size);
    this.along = grown(this.along, size);
    this.across = grown(this.across, size);
    this.cut = grown(this.cut, size);
    this.wx = grown(this.wx, size);
    this.wz = grown(this.wz, size);
    this.key = grown(this.key, size);
    this.order = grown(this.order, size);
  }

  private growRuns(): void {
    const size = this.runFirst.length * 2;
    this.runFirst = grown(this.runFirst, size);
    this.runFrom = grown(this.runFrom, size);
    this.runTo = grown(this.runTo, size);
    this.runKey = grown(this.runKey, size);
    this.runOrder = grown(this.runOrder, size);
  }
}

function grown<T extends Int32Array | Int16Array | Uint8Array | Float64Array>(a: T, size: number): T {
  const b = new (a.constructor as new (n: number) => T)(size);
  b.set(a);
  return b;
}
