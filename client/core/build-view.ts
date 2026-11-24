// What the builder's preview asks in place of the world's store: a store of its own that holds the server's rows of the
// chunks round the builder, slot for slot, and over them the pieces set down that are not rows yet. Placing and support
// read it as they read any store, so a wall can be aimed at a foundation the server has not answered for. The world's
// store never holds such a piece: nothing collides with one and no chunk's version or row is changed by one.

import { CHUNK_SIZE, STRUCT_UNITS } from "../../shared/coords.ts";
import { PLACE_JOIN } from "../../shared/net/place.ts";
import type { CollisionWorld } from "../../shared/world/collide.ts";
import { baseOrigin, poseOf, type LatticePose } from "../../shared/world/lattice/frames.ts";
import { key0, key1 } from "../../shared/world/lattice/module.ts";
import { PUT_FREE, StructureStore, type ChunkTable } from "../../shared/world/structures.ts";

/** Metres round the builder whose chunks are copied, and past which a copied chunk is let go. */
const NEAR = 48;
const FAR = 160;
/** Rows copied in one frame while a chunk is first read: about a millisecond. */
const ROWS_A_FRAME = 2000;
/** A frame made here for a base the server has not answered for takes a gid from this up. The server's count up from 1. */
export const PROVISIONAL = 0x40000000;

/** A piece that is no row yet. A base's first piece names the frame it founds in `fr`; a thing has only its pose. */
export interface Overlaid {
  /** Its own number, never 0 and never given to another. */
  id: number;
  kind: number;
  /** A PLACE_ mode. */
  mode: number;
  fr: number;
  k0: number;
  k1: number;
  /** Lattice units and a facing in wire units, for a piece that joins nothing. */
  x: number;
  y: number;
  z: number;
  yaw: number;
}

const NONE: readonly number[] = [];

export class BuildView {
  /** The copy, and a world that is the real one with the copy for its structures. */
  readonly structs: StructureStore;
  readonly world: CollisionWorld;
  /** Bumped whenever the copy's rows change. */
  version = 0;
  private readonly real: StructureStore;
  /** Per chunk: the real table and its shape as last copied whole, and the slot a first reading has come to. */
  private readonly table: (ChunkTable | null)[];
  private readonly shape: Int32Array;
  private readonly cursor: Int32Array;
  private readonly mirrored: number[] = [];
  /** The pieces laid over the rows: each one's id and its ref here, in the order they were laid. */
  private readonly ids: number[] = [];
  private readonly refs: number[] = [];
  /** The caller's stamp the pieces were last laid at, and whether they still lie as they were laid then. */
  private stamp = -1;
  private fresh = false;
  private lifted = false;
  /** Per chunk, its shape when the reading under way began, or -1. */
  private readonly pass: Int32Array;
  /** Refs of rows left out of the copy. */
  private readonly gone: number[] = [];
  private readonly pose: LatticePose = { x: 0, y: 0, z: 0, yaw: 0, tw: 0 };
  private readonly origin = { ox: 0, oy: 0, oz: 0 };

  constructor(world: CollisionWorld, halfX: Float32Array, halfY: Float32Array, halfZ: Float32Array) {
    const real = (this.real = world.structs);
    this.structs = new StructureStore(real.dims, halfX, halfY, halfZ, null, real.parts);
    this.structs.frames.next = PROVISIONAL;
    this.world = { ...world, structs: this.structs };
    const n = real.chunks.length;
    this.table = new Array<ChunkTable | null>(n).fill(null);
    this.shape = new Int32Array(n).fill(-1);
    this.cursor = new Int32Array(n);
    this.pass = new Int32Array(n).fill(-1);
  }

  /** Whether this is the view of `world`'s structures. */
  of(world: CollisionWorld): boolean {
    return world.structs === this.real;
  }

  /**
   * Each frame: copies what changed in the chunks round (x, z), a first reading over several frames, and lays `over`
   * on the rows, in order, a piece on a piece before it. A piece whose cells a row has is left out. `stamp` is the
   * caller's count of changes to `over` and `gone`: the pieces are laid again when it or a row has changed. `gone` are
   * refs of rows the builder has asked to take back, which the copy leaves out.
   */
  update(x: number, z: number, over: readonly Overlaid[], stamp: number, team: number, gone: readonly number[] = NONE): void {
    const real = this.real;
    if (stamp !== this.stamp) {
      // A chunk with a row newly left out, or let back in, is read again.
      for (const ref of this.gone) if (!gone.includes(ref)) this.shape[Math.floor(ref / 65536)] = -1;
      for (const ref of gone) if (!this.gone.includes(ref)) this.shape[Math.floor(ref / 65536)] = -1;
      this.gone.length = 0;
      this.gone.push(...gone);
      // The pieces are lifted before the rows are read, so a row that has come where one lay is read as a row.
      this.lift();
    }
    const { chunksX, chunksZ } = real.dims;
    const span = (v: number, most: number): number => Math.min(most - 1, Math.max(0, Math.floor(v / CHUNK_SIZE)));
    // Chunks that have gone far, or that the world no longer holds, are let go.
    for (let i = this.mirrored.length - 1; i >= 0; i--) {
      const c = this.mirrored[i]!;
      const cx = (c % chunksX) * CHUNK_SIZE + CHUNK_SIZE / 2;
      const cz = Math.floor(c / chunksX) * CHUNK_SIZE + CHUNK_SIZE / 2;
      if (real.chunks[c] && Math.abs(cx - x) <= FAR + CHUNK_SIZE / 2 && Math.abs(cz - z) <= FAR + CHUNK_SIZE / 2) continue;
      this.drop(c);
    }
    let left = ROWS_A_FRAME;
    // Read again while a reading lifted the pieces: a row that came where one lay is then read as a row in this same frame.
    for (let round = 0; round < 3; round++) {
      this.lifted = false;
      for (let cz = span(z - NEAR, chunksZ); cz <= span(z + NEAR, chunksZ) && left > 0; cz++) {
        for (let cx = span(x - NEAR, chunksX); cx <= span(x + NEAR, chunksX) && left > 0; cx++) left = this.copy(cz * chunksX + cx, left);
      }
      // Chunks copied before and still held are kept as the world has them, wherever the builder now stands.
      for (let i = 0; i < this.mirrored.length && left > 0; i++) left = this.copy(this.mirrored[i]!, left);
      if (!this.lifted) break;
    }
    if (this.fresh && stamp === this.stamp) return;
    this.lift();
    this.stamp = stamp;
    this.fresh = true;
    for (const o of over) {
      const ref = this.lay(o, team);
      if (ref < 0) continue;
      this.ids.push(o.id);
      this.refs.push(ref);
    }
    if (over.length > 0) this.version++;
  }

  /** Asks for the chunks the box touches to be copied too, as a long row needs. */
  reach(minX: number, minZ: number, maxX: number, maxZ: number): void {
    const { chunksX, chunksZ } = this.real.dims;
    const span = (v: number, most: number): number => Math.min(most - 1, Math.max(0, Math.floor(v / CHUNK_SIZE)));
    let left = ROWS_A_FRAME;
    for (let cz = span(minZ, chunksZ); cz <= span(maxZ, chunksZ) && left > 0; cz++) {
      for (let cx = span(minX, chunksX); cx <= span(maxX, chunksX) && left > 0; cx++) left = this.copy(cz * chunksX + cx, left);
    }
  }

  private drop(c: number): void {
    this.lift();
    this.structs.dropChunk(c);
    this.table[c] = null;
    this.shape[c] = this.pass[c] = -1;
    this.mirrored.splice(this.mirrored.indexOf(c), 1);
    this.version++;
  }

  /** Whether every chunk the box touches is copied whole, so what is asked of it is asked of everything there. */
  ready(minX: number, minZ: number, maxX: number, maxZ: number): boolean {
    const { chunksX, chunksZ } = this.real.dims;
    const span = (v: number, most: number): number => Math.min(most - 1, Math.max(0, Math.floor(v / CHUNK_SIZE)));
    for (let cz = span(minZ, chunksZ); cz <= span(maxZ, chunksZ); cz++) {
      for (let cx = span(minX, chunksX); cx <= span(maxX, chunksX); cx++) {
        const c = cz * chunksX + cx;
        const t = this.real.chunks[c];
        if (t ? this.table[c] !== t || this.shape[c] !== t.shape : this.table[c] !== null) return false;
      }
    }
    return true;
  }

  /** The id of the piece laid at `ref` here, or 0 for a row. */
  idAt(ref: number): number {
    const i = this.refs.indexOf(ref);
    return i < 0 ? 0 : this.ids[i]!;
  }

  /** The ref here of the piece laid with `id`, or -1. */
  refOf(id: number): number {
    const i = this.ids.indexOf(id);
    return i < 0 ? -1 : this.refs[i]!;
  }

  /** Runs `ask` with the pieces `ids` taken off the rows, and lays them again as they were. */
  without<T>(ids: readonly number[], over: readonly Overlaid[], team: number, ask: () => T): T {
    const off: number[] = [];
    for (let i = this.ids.length - 1; i >= 0; i--) {
      if (!ids.includes(this.ids[i]!)) continue;
      off.push(i);
      this.erase(this.refs[i]!);
    }
    const answer = ask();
    // Laid again in the order they first were, each in the slot it had.
    for (let k = off.length - 1; k >= 0; k--) {
      const i = off[k]!;
      const o = over.find((q) => q.id === this.ids[i]);
      if (o) this.lay(o, team, this.refs[i]!);
    }
    return answer;
  }

  /** Copies chunk `c` as the world has it, up to `left` rows of a first reading. Returns what is left of them. */
  private copy(c: number, left: number): number {
    const real = this.real;
    const t = real.chunks[c] ?? null;
    if (!t) {
      if (this.table[c] !== null) this.drop(c);
      return left;
    }
    if (this.table[c] === t && this.shape[c] === t.shape) return left;
    const v = this.structs;
    if (this.table[c] !== t) {
      // Another table stands for the chunk: one kept aside and put back, or its first.
      if (this.table[c] !== null) this.drop(c);
      this.mirrored.push(c);
      this.table[c] = t;
    }
    // A reading goes from the first slot and writes only what differs. One a change overtook is made again.
    if (this.pass[c] === -1) {
      this.pass[c] = t.shape;
      this.cursor[c] = 0;
    }
    this.shape[c] = -1;
    const gone = this.gone.length;
    let s = this.cursor[c]!;
    const fr = t.fr, k0 = t.k0, k1 = t.k1;
    for (; s < Math.max(t.high, v.chunks[c]?.high ?? 0) && left > 0; s++) {
      const u = v.chunks[c];
      const kind = s < t.high && !(gone > 0 && this.gone.includes(c * 65536 + s)) ? t.kind[s]! : 0;
      const f = fr && kind !== 0 ? fr[s]! : 0;
      const there = u && s < u.high ? u.kind[s]! : 0;
      if (kind === 0 && there === 0) continue;
      if (u && there === kind && u.x[s] === t.x[s] && u.y[s] === t.y[s] && u.z[s] === t.z[s] && u.yaw[s] === t.yaw[s] && (u.fr ? u.fr[s]! : 0) === f && (f === 0 || (u.k0![s] === k0![s] && u.k1![s] === k1![s]))) continue;
      // Nothing laid over the rows stands while a row is written: a row may want its slot or its cells.
      if (this.ids.length > 0) {
        this.lift();
        s--;
        continue;
      }
      if (kind === 0) v.put(c, s, 0, 0, 0, 0, 0, 0, 0, 0);
      else {
        if (f !== 0) {
          const from = real.frames.get(f)!;
          const to = v.frames.get(f);
          if (!to) v.frames.make(from.ox, from.oy, from.oz, from.yaw, from.team, f);
          else to.team = from.team;
        }
        v.put(c, s, kind, t.x[s]!, t.y[s]!, t.z[s]!, t.yaw[s]!, t.owner[s]!, t.hp[s]!, 0, f !== 0 ? f : PUT_FREE, f !== 0 ? k0![s]! : 0, f !== 0 ? k1![s]! : 0);
      }
      this.version++;
      left--;
    }
    this.cursor[c] = s;
    if (s >= Math.max(t.high, v.chunks[c]?.high ?? 0)) {
      if (this.pass[c] === t.shape) this.shape[c] = t.shape;
      this.pass[c] = -1;
    }
    return left;
  }

  /** Takes every piece laid over the rows off them. */
  private lift(): void {
    if (this.ids.length === 0) return;
    for (let i = this.refs.length - 1; i >= 0; i--) {
      const ref = this.refs[i]!;
      this.erase(ref);
      // A row may have come to the slot it lay in: then the chunk is read again.
      const c = Math.floor(ref / 65536);
      if ((ref & 0xffff) < (this.real.chunks[c]?.high ?? 0)) this.shape[c] = -1;
    }
    this.ids.length = this.refs.length = 0;
    this.fresh = false;
    this.lifted = true;
    this.version++;
  }

  private erase(ref: number): void {
    this.structs.put(Math.floor(ref / 65536), ref & 0xffff, 0, 0, 0, 0, 0, 0, 0, 0);
  }

  /** Lays one piece on the rows, in the slot `at` or in one past every row of its chunk. Returns its ref here, or -1 where it has no place. */
  private lay(o: Overlaid, team: number, at = -1): number {
    const v = this.structs;
    const forms = v.forms;
    const keyed = forms !== null && forms.cls[o.kind]! >= 0;
    let [x, y, z, yaw, fr, k0, k1] = [o.x, o.y, o.z, o.yaw, PUT_FREE, 0, 0];
    if (keyed && o.mode !== PLACE_JOIN) {
      // A base's first piece: its frame is made as the server will make it, under a number of this view's own.
      [fr, k0, k1] = [o.fr, key0(forms.cls[o.kind]!, 0, 0, 0), key1(0, 0, 0, forms.layer[o.kind]!, 0, 0)];
      if (!v.frames.get(fr)) {
        baseOrigin(forms, o.kind, o.x, o.y, o.z, o.yaw, this.origin);
        v.frames.make(this.origin.ox, this.origin.oy, this.origin.oz, o.yaw, team, fr);
      }
      if (!v.fits(o.kind, fr, k0, k1)) return this.unmake(fr, -1);
    } else if (keyed) {
      const f = v.frames.get(o.fr);
      if (!f || !v.fits(o.kind, o.fr, o.k0, o.k1)) return -1;
      poseOf(f, o.k0, o.k1, forms, o.kind, this.pose);
      [x, y, z, yaw, fr, k0, k1] = [this.pose.x, this.pose.y, this.pose.z, this.pose.yaw, o.fr, o.k0, o.k1];
    }
    const mx = x / STRUCT_UNITS;
    const mz = z / STRUCT_UNITS;
    const { chunksX, chunksZ } = v.dims;
    if (!(mx >= 0 && mz >= 0 && mx < chunksX * CHUNK_SIZE && mz < chunksZ * CHUNK_SIZE)) return this.unmake(fr, -1);
    const c = Math.floor(mz / CHUNK_SIZE) * chunksX + Math.floor(mx / CHUNK_SIZE);
    const slot = at >= 0 ? at & 0xffff : Math.max(v.chunks[c]?.high ?? 0, this.real.chunks[c]?.high ?? 0);
    if (slot > 0xfffe) return this.unmake(fr, -1);
    v.put(c, slot, o.kind, mx, y / STRUCT_UNITS, mz, yaw, team, 1, 0, fr, k0, k1);
    return c * 65536 + slot;
  }

  /** Forgets a frame made for a piece that then had no place. */
  private unmake(fr: number, answer: number): number {
    if (fr >= PROVISIONAL) this.structs.frames.drop(fr);
    return answer;
  }
}
