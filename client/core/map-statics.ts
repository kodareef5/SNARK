// The map's statics as a page holds them: a table a sector, set in as its part comes and let go when the page no longer
// wants it (client/core/map-want.ts). A chunk's rows are looked up by its sector, slot s the s-th static of that chunk in
// the map's order, as the server's are. Readers that take one MapStatics get one made of the sectors held (`table`), a
// slice of rows a step; the sectors it holds then read their rows from it, so a sector's rows are kept once.

import { SECTOR_CHUNKS, chunkCx, chunkCz } from "../../shared/coords.ts";
import { MapStatics, squareOf, type ChunkBends, type MapHead, type MapPart, type StaticsPiece } from "../../shared/world/mapfile.ts";

/** The columns a chunk's map rows are read from, and its rows' place in them, `from` up to `to`. */
export interface MapRows {
  kind: Uint16Array;
  yaw: Uint16Array;
  x: Float32Array;
  y: Float32Array;
  z: Float32Array;
  from: number;
  to: number;
}

/** Rows a step: as many as MapStatics.group or a city's steps take. */
const SLICE = 1 << 15;
const NO_U16 = new Uint16Array(0);
const NO_F32 = new Float32Array(0);

/** One sector's statics: its chunks' rows, row by row of its square, or those rows in a table made of several sectors. */
class SectorTable {
  readonly part: MapPart;
  readonly cx0: number;
  readonly cz0: number;
  readonly cx1: number;
  readonly cz1: number;
  /** Rows of each of its chunks, by its place in the square (local) or, once `merged`, by its place in the map. */
  first: Uint32Array;
  kind: Uint16Array;
  yaw: Uint16Array;
  x: Float32Array;
  y: Float32Array;
  z: Float32Array;
  merged = false;
  readonly bends = new Map<number, ChunkBends>();
  readonly count: number;

  constructor(part: MapPart, sq: { cx0: number; cz0: number; cx1: number; cz1: number }, first: Uint32Array) {
    this.part = part;
    [this.cx0, this.cz0, this.cx1, this.cz1] = [sq.cx0, sq.cz0, sq.cx1, sq.cz1];
    this.first = first;
    this.count = first[first.length - 1]!;
    [this.kind, this.yaw] = [new Uint16Array(this.count), new Uint16Array(this.count)];
    [this.x, this.y, this.z] = [new Float32Array(this.count), new Float32Array(this.count), new Float32Array(this.count)];
  }

  /** The place of `chunk`, one of its own, in `first`. */
  at(chunk: number, chunksX: number): number {
    if (this.merged) return chunk;
    return (Math.floor(chunk / chunksX) - this.cz0) * (this.cx1 - this.cx0) + (chunk % chunksX) - this.cx0;
  }
}

/** The map's statics held a sector at a time. */
export class HeldStatics {
  readonly head: MapHead;
  readonly kinds: readonly string[];
  /** The map's statics parts, and per chunk 1 + the place of its sector's among them, 0 for none. */
  readonly parts: readonly MapPart[];
  private readonly sectorAt: Uint16Array;
  private readonly sectors: (SectorTable | null)[];
  /** Rows each sector holds, as the head counts them, and the bytes its statics took once held. */
  readonly rows = new Map<MapPart, number>();
  private readonly took = new Map<MapPart, number>();
  /** Counts the sectors set in and let go. */
  version = 0;
  /** Sectors a reader waits for: chunks the server sent as the map has them (session.ts). */
  readonly needed = new Set<MapPart>();
  private readonly told: ((part: MapPart) => void)[] = [];
  private readonly found: MapRows = { kind: NO_U16, yaw: NO_U16, x: NO_F32, y: NO_F32, z: NO_F32, from: 0, to: 0 };

  constructor(head: MapHead) {
    this.head = head;
    this.kinds = head.kinds;
    this.parts = head.parts.filter((p) => p.kind === "statics");
    this.sectors = this.parts.map(() => null);
    this.sectorAt = new Uint16Array(head.counts.length);
    this.parts.forEach((p, k) => {
      const sq = squareOf(head.dims, SECTOR_CHUNKS, p.col, p.row)!;
      let n = 0;
      for (let cz = sq.cz0; cz < sq.cz1; cz++) {
        for (let cx = sq.cx0; cx < sq.cx1; cx++) {
          this.sectorAt[cz * head.dims.chunksX + cx] = k + 1;
          n += head.counts[cz * head.dims.chunksX + cx]!;
        }
      }
      this.rows.set(p, n);
    });
  }

  /** Calls `fn` with each sector's part as its statics are set in. */
  onSet(fn: (part: MapPart) => void): void {
    this.told.push(fn);
  }

  /** The statics part of `chunk`'s sector, or null for a chunk the map lists none in. */
  partOf(chunk: number): MapPart | null {
    return this.parts[this.sectorAt[chunk]! - 1] ?? null;
  }

  has(part: MapPart): boolean {
    return this.sectors[this.parts.indexOf(part)] != null;
  }

  /** The rows the map holds in `chunk`. */
  count(chunk: number): number {
    return this.head.counts[chunk] ?? 0;
  }

  /** Where `chunk`'s rows are read (the same object each call), or null while its sector is not held. */
  find(chunk: number): MapRows | null {
    const t = this.sectors[this.sectorAt[chunk]! - 1];
    if (!t) return null;
    const k = t.at(chunk, this.head.dims.chunksX), r = this.found;
    [r.kind, r.yaw, r.x, r.y, r.z, r.from, r.to] = [t.kind, t.yaw, t.x, t.y, t.z, t.first[k]!, t.first[k + 1]!];
    return r;
  }

  /** Says a reader waits for `chunk`'s sector. */
  need(chunk: number): void {
    const p = this.partOf(chunk);
    if (p && !this.has(p)) this.needed.add(p);
  }

  /** Pieces held. */
  get pieces(): number {
    return this.sectors.reduce((n, t) => n + (t?.count ?? 0), 0);
  }

  /** Bytes of the rows held, a kind, a turn and a place a piece, and of their bends. */
  get bytes(): number {
    return this.parts.reduce((n, p, k) => n + (this.sectors[k] ? this.took.get(p)! : 0), 0);
  }

  /** Bytes sector `part`'s statics take: as they did when last held, else by the head's count of its rows. */
  bytesOf(part: MapPart): number {
    return this.took.get(part) ?? this.rows.get(part)! * 16;
  }

  /** Sectors held. */
  get size(): number {
    return this.sectors.reduce((n, t) => n + (t ? 1 : 0), 0);
  }

  /**
   * Sets in sector `part`'s statics, read as `piece`, a slice of rows a step: each chunk's rows where the head's counts lay
   * them out, in the map's order. Throws unless they fill those rows.
   */
  *set(part: MapPart, piece: StaticsPiece): Generator<void, void> {
    const { dims, counts } = this.head;
    const sq = piece.sq, w = sq.cx1 - sq.cx0, n = w * (sq.cz1 - sq.cz0);
    const first = new Uint32Array(n + 1);
    for (let k = 0; k < n; k++) first[k + 1] = first[k]! + counts[(sq.cz0 + Math.floor(k / w)) * dims.chunksX + sq.cx0 + (k % w)]!;
    const t = new SectorTable(part, sq, first);
    const fail = (): Error => new Error(`map: the statics of sector ${sq.col}, ${sq.row} do not fill the rows laid out for them`);
    if (piece.id.length !== t.count) throw fail();
    const filled = first.slice(0, n);
    const lists = new Map<number, { slot: number[]; at: number[] }>();
    for (let i = 0, q = 0; i < piece.id.length; i++) {
      const c = piece.chunk[i]!, cx = chunkCx(dims, c), cz = chunkCz(dims, c);
      if (cx < sq.cx0 || cx >= sq.cx1 || cz < sq.cz0 || cz >= sq.cz1) throw fail();
      const k = (cz - sq.cz0) * w + cx - sq.cx0, r = filled[k]!++;
      if (r >= first[k + 1]!) throw fail();
      if (q < piece.bendAt.length && piece.bendAt[q] === i) {
        let l = lists.get(c);
        if (!l) lists.set(c, (l = { slot: [], at: [] }));
        l.slot.push(r - first[k]!);
        l.at.push(q++);
      }
      [t.kind[r], t.yaw[r], t.x[r], t.y[r], t.z[r]] = [piece.id[i]!, piece.yaw[i]!, piece.x[i]!, piece.y[i]!, piece.z[i]!];
      if (i % SLICE === SLICE - 1) yield;
    }
    for (const [c, l] of lists) {
      const bend = new Int16Array(l.at.length * 8);
      l.at.forEach((q, k) => bend.set(piece.bend.subarray(q * 8, q * 8 + 8), k * 8));
      t.bends.set(c, { slot: Uint16Array.from(l.slot), bend });
    }
    this.sectors[this.parts.indexOf(part)] = t;
    this.took.set(part, t.count * 16 + [...t.bends.values()].reduce((n, b) => n + b.slot.byteLength + b.bend.byteLength, 0));
    this.version++;
    this.needed.delete(part);
    for (const fn of this.told) fn(part);
  }

  /** Lets sector `part`'s statics go. */
  drop(part: MapPart): void {
    const k = this.parts.indexOf(part);
    if (!this.sectors[k]) return;
    this.sectors[k] = null;
    this.version++;
  }

  /**
   * The rows of the sectors held as one table over the map's chunks, a slice of rows a step, in no map order (a page never
   * reads it). Each sector held throughout then reads its rows from it, and its own let go.
   */
  *table(): Generator<void, MapStatics> {
    const { counts, dims } = this.head;
    const now = [...this.sectors];
    const out = MapStatics.blank(this.kinds, counts.length, now.reduce((n, t) => n + (t?.count ?? 0), 0), false);
    for (let c = 0; c < counts.length; c++) out.first[c + 1] = out.first[c]! + (now[this.sectorAt[c]! - 1] ? counts[c]! : 0);
    let since = 0;
    for (const t of now) {
      if (!t) continue;
      for (let cz = t.cz0; cz < t.cz1; cz++) {
        for (let cx = t.cx0; cx < t.cx1; cx++) {
          const c = cz * dims.chunksX + cx, k = t.at(c, dims.chunksX), [from, to, at] = [t.first[k]!, t.first[k + 1]!, out.first[c]!];
          if (to === from) continue;
          out.kind.set(t.kind.subarray(from, to), at);
          out.yaw.set(t.yaw.subarray(from, to), at);
          out.x.set(t.x.subarray(from, to), at);
          out.y.set(t.y.subarray(from, to), at);
          out.z.set(t.z.subarray(from, to), at);
          if ((since += to - from) >= SLICE) {
            since = 0;
            yield;
          }
        }
      }
      for (const [c, b] of t.bends) out.bends.set(c, b);
    }
    now.forEach((t, k) => {
      if (!t || this.sectors[k] !== t) return;
      [t.first, t.kind, t.yaw, t.x, t.y, t.z, t.merged] = [out.first, out.kind, out.yaw, out.x, out.y, out.z, true];
    });
    return out;
  }
}
