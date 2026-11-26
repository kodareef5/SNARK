// The map's statics as a page holds them: a table a sector, set in as its part comes and let go when the page no longer
// wants it (client/core/map-want.ts). A chunk's rows are looked up by its sector, slot s the s-th static of that chunk in
// the map's order, as the server's are. The city the page draws follows the store a sector at a time (`follow`), sharing
// each sector's columns, so a sector's rows are kept once and one coming or going remakes nothing else. A tool that takes
// one MapStatics gets a copy of the sectors held (`table`).

import { SECTOR_CHUNKS, chunkCx, chunkCz } from "../../shared/coords.ts";
import type { Registry } from "../../shared/content/registry.ts";
import { CitySquare, CityStatics } from "../../shared/world/city.ts";
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

/** One sector's statics: its chunks' rows, row by row of its square, in the map's kinds. */
export class SectorTable {
  readonly part: MapPart;
  readonly cx0: number;
  readonly cz0: number;
  readonly cx1: number;
  readonly cz1: number;
  /** Rows of each of its chunks, by its place in the square. */
  readonly first: Uint32Array;
  readonly kind: Uint16Array;
  readonly yaw: Uint16Array;
  readonly x: Float32Array;
  readonly y: Float32Array;
  readonly z: Float32Array;
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
    return (Math.floor(chunk / chunksX) - this.cz0) * (this.cx1 - this.cx0) + (chunk % chunksX) - this.cx0;
  }

  /** Bytes it holds: its rows, a kind, a turn and a place a piece, its bends and its index. */
  get bytes(): number {
    return this.count * 16 + this.first.byteLength + [...this.bends.values()].reduce((n, b) => n + b.slot.byteLength + b.bend.byteLength, 0);
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
  /** Rows each sector holds, as the head counts them, its chunks, and the bytes its statics took once held. */
  readonly rows = new Map<MapPart, number>();
  private readonly chunks = new Map<MapPart, number>();
  private readonly took = new Map<MapPart, number>();
  /** Counts the sectors set in and let go. */
  version = 0;
  /** Sectors a reader waits for: chunks the server sent as the map has them (session.ts). */
  readonly needed = new Set<MapPart>();
  /** Sectors that came damaged too often, never asked for again (mapload.ts). */
  readonly broken = new Set<MapPart>();
  /** Sectors asked for once, past what is wanted, and who waits for each (`once`). */
  readonly asked = new Map<MapPart, ((rows: SectorTable) => void)[]>();
  private readonly told: ((part: MapPart) => void)[] = [];
  /** Called as a sector is first needed or asked for once, so that it is asked for at once. */
  wake: (() => void) | null = null;
  /** Whether a reader still holds chunks of a sector, which is then kept past the wanted set (session.ts). */
  keep: ((part: MapPart) => boolean) | null = null;
  /** Where the page tells the player of the map (the loader's line), or null. */
  say: ((line: string) => void) | null = null;
  /** The city that follows the sectors held, once one is made (`follow`): its own, not counted with the store's (mapheld.ts). */
  #city: CityStatics | null = null;
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
      this.chunks.set(p, (sq.cx1 - sq.cx0) * (sq.cz1 - sq.cz0));
    });
  }

  /** Calls `fn` with each sector's part as its statics are set in, and as one is found broken. */
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

  /** Whether `chunk`'s sector came damaged too often to be asked for again. */
  brokenAt(chunk: number): boolean {
    const p = this.partOf(chunk);
    return p !== null && this.broken.has(p);
  }

  /** Says a reader waits for `chunk`'s sector. */
  need(chunk: number): void {
    const p = this.partOf(chunk);
    if (!p || this.has(p) || this.needed.has(p) || this.broken.has(p)) return;
    this.needed.add(p);
    this.wake?.();
  }

  /**
   * Asks for `chunk`'s sector once, wherever it is, and hands `got` its rows as they come, without keeping them unless they
   * are wanted: at once where it is held. False where the map lists no statics there or the sector is broken.
   */
  once(chunk: number, got: (rows: SectorTable) => void): boolean {
    const p = this.partOf(chunk);
    if (!p || this.broken.has(p)) return false;
    const t = this.sectors[this.parts.indexOf(p)];
    if (t) {
      got(t);
      return true;
    }
    const waiting = this.asked.get(p);
    if (waiting) waiting.push(got);
    else {
      this.asked.set(p, [got]);
      this.wake?.();
    }
    return true;
  }

  /** Hands sector `part`'s rows, read as `t`, to whoever asked for them once. */
  answer(part: MapPart, t: SectorTable): void {
    const waiting = this.asked.get(part);
    this.asked.delete(part);
    for (const fn of waiting ?? []) fn(t);
  }

  /** Sector `part` came damaged too often: nothing waits for it any more, and readers are told. */
  broke(part: MapPart): void {
    this.broken.add(part);
    this.needed.delete(part);
    this.asked.delete(part);
    for (const fn of this.told) fn(part);
  }

  /** Pieces held. */
  get pieces(): number {
    return this.sectors.reduce((n, t) => n + (t?.count ?? 0), 0);
  }

  /**
   * Bytes held: the rows, a kind, a turn and a place a piece, their bends, and the indexes by chunk of the store and its
   * sectors; and where a city follows them, its own of each square and its index by chunk.
   */
  get bytes(): number {
    return this.parts.reduce((n, p, k) => n + (this.sectors[k] ? this.took.get(p)! : 0), this.index);
  }

  /** Bytes of the indexes by chunk alone: the store's, and a city's that follows it. */
  get index(): number {
    return this.sectorAt.byteLength * (this.#city ? 2 : 1);
  }

  /** Bytes sector `part`'s statics take: as they did when last held, else by the head's count of its rows and its index, with a city's kind a row. */
  bytesOf(part: MapPart): number {
    return this.took.get(part) ?? this.rows.get(part)! * (this.#city ? 18 : 16) + (this.chunks.get(part)! + 1) * 4;
  }

  /** Sectors held. */
  get size(): number {
    return this.sectors.reduce((n, t) => n + (t ? 1 : 0), 0);
  }

  /**
   * Sector `part`'s statics read as `piece` into a table, a slice of rows a step: each chunk's rows where the head's counts
   * lay them out, in the map's order. Throws unless they fill those rows.
   */
  *read(part: MapPart, piece: StaticsPiece): Generator<void, SectorTable> {
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
    return t;
  }

  /** Sets in sector `part`'s statics, read as `piece` a slice of rows a step (`read`), and the city's square of them. */
  *set(part: MapPart, piece: StaticsPiece): Generator<void, void> {
    const t = yield* this.read(part, piece);
    yield* this.put(t);
  }

  /** Sets in sector table `t`, and the city's square of it. */
  *put(t: SectorTable): Generator<void, void> {
    const k = this.parts.indexOf(t.part), city = this.#city;
    const square = city ? yield* this.squareOf(t, city) : null;
    this.sectors[k] = t;
    const followed = square !== null && this.#city === city;
    this.took.set(t.part, t.bytes + (followed ? square.bytes : 0));
    if (followed) city!.set(k, square);
    this.version++;
    this.needed.delete(t.part);
    this.answer(t.part, t);
    for (const fn of this.told) fn(t.part);
  }

  /** Lets sector `part`'s statics go, and the city's square of them. */
  drop(part: MapPart): void {
    const k = this.parts.indexOf(part);
    if (!this.sectors[k]) return;
    this.sectors[k] = null;
    this.#city?.drop(k);
    // The last rows found may be its own.
    [this.found.kind, this.found.yaw, this.found.x, this.found.y, this.found.z] = [NO_U16, NO_U16, NO_F32, NO_F32, NO_F32];
    this.version++;
  }

  /**
   * The city of the sectors held, with `reg`'s content, which from now on follows them: a square a sector set in as it
   * is, and let go as it is. One made before is followed no longer.
   */
  follow(reg: Registry): CityStatics {
    const city = CityStatics.held(this.head.dims, this.parts.length, this.kinds, reg);
    this.#city = city;
    this.sectors.forEach((t, k) => {
      if (!t) return;
      const steps = this.squareOf(t, city);
      for (let s = steps.next(); ; s = steps.next()) {
        if (!s.done) continue;
        city.set(k, s.value);
        this.took.set(t.part, t.bytes + s.value.bytes);
        break;
      }
    });
    return city;
  }

  /** The city's square of sector table `t`, sharing its columns where every row is a structure. */
  private squareOf(t: SectorTable, city: CityStatics): Generator<void, CitySquare> {
    return CitySquare.steps(this.head.dims, t, t, city.bentKind);
  }

  /** A copy of the rows of the sectors held as one table over the map's chunks, a slice of rows a step, in no map order (a page never reads it). */
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
    return out;
  }
}
