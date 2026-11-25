// The map's tops where they are wrong (blocks.ts HeldTops): a chunk with a piece gone, as the server's lists say (S_GONE,
// gonelists.ts), and a chunk with a landmark's piece, which its far mesh draws (farlandmarks.ts). The map's tops count
// both. Past the statics a page holds, the city's blocks (cityblocks.ts) and the far shadow (farshadow.ts) draw such a
// chunk from these instead: its tops as its standing pieces make them, 256 bytes a chunk. They are made from the server's
// far cells where those count the map's pieces (farcells.ts); else from the city's rows where its sector is held; else its
// sector is asked for once (HeldStatics.once), the chunk's tops made of it, and the rest let go. A chunk past the view
// is let go of, and made again when it comes back.

import { CHUNK_SIZE, chunkCx, chunkCz, type MapDims } from "../../../shared/coords.ts";
import type { Registry } from "../../../shared/content/registry.ts";
import { CityPieces, CityStatics, cityTops, floatingKinds, landmarkKinds, structureKinds, type CityTable, type Ground } from "../../../shared/world/city.ts";
import type { FarStore } from "../farcells.ts";
import type { GoneStore } from "../gonelists.ts";
import type { SectorTable } from "../map-statics.ts";
import { TOP_CELLS } from "./blocks.ts";

/** Asks once for the map's rows of `chunk`'s sector and hands them back: false where there are none to ask for. */
export interface TopRows {
  once(chunk: number, got: (rows: SectorTable) => void): boolean;
}

/** Milliseconds a chunk's list goes without changing before its sector is asked for, and the longest it waits while it keeps changing. */
export const FIX_QUIET = 1000;
export const FIX_WAIT = 3000;
/** Metres past the view a chunk's tops are kept. */
const KEEP = 2 * 16 * CHUNK_SIZE;

/** A chunk's tops as what stands makes them. */
export interface Fix {
  readonly chunk: number;
  /** Its standing pieces' tops, a landmark's left out; null where the map's tops are right. */
  readonly blocks: Uint8Array | null;
  /** With a landmark's pieces in, where it has any; else null. */
  readonly solid: Uint8Array | null;
  /** TopFix.version when it was made. */
  readonly stamp: number;
}

/** A chunk whose tops are to be made: since when its list has changed, and the list's count of changes it waits for. */
interface Due {
  readonly chunk: number;
  since: number;
  last: number;
  told: number;
}

export class TopFix {
  /** Counts the chunks made; each fix's stamp is the count when it was made. */
  version = 0;
  readonly fixes = new Map<number, Fix>();
  /** Last update: sectors asked for, and chunks made. */
  readonly stats = { asked: 0, made: 0 };
  private readonly dims: MapDims;
  private readonly hf: Ground;
  private readonly rows: TopRows | null;
  private readonly city: CityStatics;
  private readonly mapKinds: Uint16Array;
  private readonly landmark: Uint8Array;
  private readonly floating: Uint8Array;
  /** Chunks with a landmark's piece, whose tops are always made; and the chunks waiting to be. */
  private readonly marks = new Set<number>();
  private readonly due = new Map<number, Due>();
  /** Sectors asked for and not yet come, by a chunk of each. */
  private readonly asking = new Set<number>();
  private listsSeen = -1;
  private readonly seenLists = new Map<number, number>();

  /** `kinds` are the map's, which its rows' kinds index; `rows` asks for a sector's rows once, null where none can be. */
  constructor(dims: MapDims, hf: Ground, reg: Registry, kinds: readonly string[], rows: TopRows | null) {
    this.dims = dims;
    this.hf = hf;
    this.rows = rows;
    this.city = new CityStatics(dims, null, reg);
    this.mapKinds = structureKinds(kinds, reg);
    this.landmark = landmarkKinds(reg);
    this.floating = floatingKinds(reg);
  }

  /** Chunks a landmark's pieces stand in: their tops are made once they are in view. */
  mark(chunks: Iterable<number>): void {
    for (const c of chunks) {
      if (this.marks.has(c)) continue;
      this.marks.add(c);
      this.due.set(c, { chunk: c, since: -Infinity, last: -Infinity, told: 0 });
    }
  }

  /** `chunk`'s tops as what stands makes them, where they differ from the map's and are known; else null. */
  fixOf(chunk: number): Fix | null {
    const f = this.fixes.get(chunk);
    return f && f.blocks ? f : null;
  }

  /**
   * Each frame, with the camera at (x, z), the view, the city held, the lists of pieces gone, the far cells and the
   * frame's time in milliseconds: notes the chunks whose lists changed, makes the tops of those within the view that are
   * due, asking for their sectors where it must, and lets go of those past it.
   */
  update(x: number, z: number, view: number, city: CityStatics | null, lists: GoneStore | null, cells: FarStore | null, now: number): void {
    this.stats.asked = this.stats.made = 0;
    if (lists && lists.version !== this.listsSeen) {
      this.listsSeen = lists.version;
      for (const c of lists.lists.keys()) {
        const told = lists.changed[c]!;
        if (this.seenLists.get(c) === told) continue;
        this.seenLists.set(c, told);
        if (lists.lists.get(c)!.length === 0 && !this.fixes.has(c) && !this.marks.has(c)) continue;
        const d = this.due.get(c);
        if (d) {
          d.last = now;
          d.told = told;
        } else this.due.set(c, { chunk: c, since: now, last: now, told });
      }
    }
    for (const d of this.due.values()) {
      const c = d.chunk, off = this.off(c, x, z);
      if (off > view) continue;
      if (cells && cells.full[c] === 1) {
        // Sent empty, its cells are none: every piece is gone.
        const full = cells.chunks.get(c);
        this.put(c, full ? full.top.slice(0, TOP_CELLS) : new Uint8Array(TOP_CELLS), null);
        this.due.delete(c);
        continue;
      }
      if (city?.holds(c)) {
        this.made(c, city.rows(c), lists?.lists.get(c) ?? null);
        this.due.delete(c);
        continue;
      }
      // A sector is asked for once the list has been quiet a moment, or has waited its longest.
      if (this.asking.has(c) || !this.rows || (now - d.last < FIX_QUIET && now - d.since < FIX_WAIT)) continue;
      this.ask(c, lists);
    }
    for (const c of this.fixes.keys()) {
      if (this.off(c, x, z) <= view + KEEP) continue;
      this.fixes.delete(c);
      // Past the view its tops are made again when it comes back.
      if (this.marks.has(c) || (lists?.lists.get(c)?.length ?? 0) > 0) this.due.set(c, { chunk: c, since: -Infinity, last: -Infinity, told: lists?.changed[c] ?? 0 });
    }
  }

  /** Asks for `chunk`'s sector once, and makes the tops of every chunk of it that waits when it comes. */
  private ask(chunk: number, lists: GoneStore | null): void {
    this.asking.add(chunk);
    this.stats.asked++;
    const asked = this.rows!.once(chunk, (t) => {
      this.asking.delete(chunk);
      const w = t.cx1 - t.cx0;
      for (let cz = t.cz0; cz < t.cz1; cz++) {
        for (let cx = t.cx0; cx < t.cx1; cx++) {
          const c = cz * this.dims.chunksX + cx, d = this.due.get(c);
          if (!d) continue;
          const k = (cz - t.cz0) * w + cx - t.cx0;
          this.made(c, new CityPieces([c], [t.first[k + 1]! - t.first[k]!], this.cut(t, t.first[k]!, t.first[k + 1]!)), lists?.lists.get(c) ?? null);
          // A list told while the sector came waits for its own turn.
          if (lists && (lists.changed[c] ?? 0) !== d.told) continue;
          this.due.delete(c);
        }
      }
    });
    if (!asked) {
      this.asking.delete(chunk);
      this.due.delete(chunk);
    }
  }

  /** Rows `from` up to `to` of sector table `t`, their kinds as content indexes. */
  private cut(t: SectorTable, from: number, to: number): { kind: Uint16Array; yaw: Uint16Array; x: Float32Array; y: Float32Array; z: Float32Array } {
    return { kind: Uint16Array.from(t.kind.subarray(from, to), (k) => this.mapKinds[k]!), yaw: t.yaw.subarray(from, to), x: t.x.subarray(from, to), y: t.y.subarray(from, to), z: t.z.subarray(from, to) };
  }

  /**
   * Makes `chunk`'s tops of its rows in `t`, each slot `list` names gone; a landmark's pieces and those that float left
   * out, and with a landmark's in too where it has any.
   */
  private made(chunk: number, t: CityTable | null, list: Uint16Array | null): void {
    if (!t) return;
    const from = t.from(chunk), n = t.to(chunk) - from;
    const gone = new Uint8Array(n), bare = new Uint8Array(n);
    let marked = false;
    for (let i = 0; list && i < list.length; i++) if (list[i]! < n) gone[list[i]!] = 1;
    for (let i = 0; i < n; i++) {
      const k = t.kind[from + i]!;
      if (this.floating[k] === 1 || k === 0) gone[i] = 1;
      bare[i] = gone[i]! | this.landmark[k]!;
      if (this.landmark[k] === 1) marked = true;
    }
    const city = CityStatics.of(this.city, t);
    const blocks = cityTops(city, chunk, this.hf, bare);
    const right = !marked && (list?.length ?? 0) === 0;
    this.put(chunk, right ? null : blocks, marked ? cityTops(city, chunk, this.hf, gone) : null);
  }

  private put(chunk: number, blocks: Uint8Array | null, solid: Uint8Array | null): void {
    this.fixes.set(chunk, { chunk, blocks, solid, stamp: ++this.version });
    this.stats.made++;
  }

  /** Metres from (x, z) to `chunk`'s square. */
  private off(chunk: number, x: number, z: number): number {
    const x0 = chunkCx(this.dims, chunk) * CHUNK_SIZE, z0 = chunkCz(this.dims, chunk) * CHUNK_SIZE;
    return Math.hypot(Math.max(x0 - x, x - x0 - CHUNK_SIZE, 0), Math.max(z0 - z, z - z0 - CHUNK_SIZE, 0));
  }
}
