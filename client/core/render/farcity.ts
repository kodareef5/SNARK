// A map's own buildings past the near rows (shared/world/city.ts). The client makes them from the map's statics, which
// it holds from the map file, in tiles of 3 by 3 chunks, each level of a tile a level of its own on the card. A chunk is
// drawn here while the near store does not hold it whole, and then the near store draws none of it, so its pieces are
// drawn one way or the other and never both or neither. A tile's mesh holds every chunk of it in order and a draw takes
// the runs of chunks drawn far, so a chunk changing hands remakes nothing. Nearest the near rows a tile is every box, the
// near drawing in one mesh, so the hand-over shows nothing; farther off it takes the lattice (boxes merged, the least
// left out), then a building's mass in cells. The lattice fades out over the last share of its reach as the mass fades in,
// pixel by pixel in the far fade's pattern; the other changes of level are a tile at a time.
//
// What stands: a chunk the near store holds whole says exactly which of the map's pieces stand, and that is kept when it
// is let go. Past that, the far feed's cells (farcells.ts) show a piece gone when its top stands over the top sent for a
// cell it fills. A piece gone either way is left out of every level of its chunk.

import { CHUNK_SIZE, chunkCount, type MapDims } from "../../../shared/coords.ts";
import { INSTANCE_BYTES, VERTEX_BYTES } from "../../../shared/pack/pack.ts";
import { cellPart, cityTops, goneByCells, goneByRows, mergedPart, type CityPart, type CityStatics, type Gone } from "../../../shared/world/city.ts";
import type { Heightfield } from "../../../shared/world/heightfield.ts";
import type { StructureStore } from "../../../shared/world/structures.ts";
import type { FarStore } from "../farcells.ts";
import type { Camera } from "./camera.ts";
import { FAR_BUFFER, FAR_HEIGHT, FAR_TILE_METRES } from "./far.ts";
import type { FramePacket } from "./packet.ts";

/** Chunks along a tile's side, and its side in metres. */
export const CITY_TILE = 3;
const TILE_METRES = CITY_TILE * CHUNK_SIZE;
/** A tile's vertices are stored from its corner less this, so faces reaching past its edges stay within FAR_MESH's square. */
const LOCAL = (FAR_TILE_METRES - TILE_METRES) / 2;
/** How far past its pieces a tile's box reaches, and its stored heights begin below them: a cell's face may lie a cell past a box. */
const BELOW = 8;
/** Slots of tiles on the card start here, past the far blocks' (far.ts FAR_SLOTS up to twice that). */
export const CITY_SLOTS = 2 ** 31;
const CITY_SLOT_SPAN = 2 ** 30;
/** The instance buffer every tile is drawn with: one instance at the origin. */
export const CITY_BUFFER = FAR_BUFFER + 1;
const RESERVE = "far city";
/** Tiles are made, nearest first and those with nothing on the card before the rest, until this much of a frame is spent. */
export const MAKE_MS = 2;
/** Milliseconds from some fixed moment: the page's clock in a browser and under Bun. */
const clock = (): number => (globalThis as { performance?: { now(): number } }).performance?.now() ?? Date.now();
/** A tile leaves a level for a coarser one this much past where the level ends, and comes back this much short of it. */
const HYSTERESIS = 1.08;
const LEVELS = 8;
/** The slot of a level made with no faces, which is never on the card. */
const EMPTY = -2;

/** What the scene draws a map's buildings from: its statics, and which chunks the near store holds whole. */
export interface CitySource {
  readonly statics: CityStatics;
  complete(chunk: number): boolean;
}

/**
 * How a level of the far city is made, and to how many metres from the camera to a tile's nearest point it is drawn:
 * every box (`gap` below 0 and `least` 0); boxes merged across gaps up to `gap` metres with those no longer than `least`
 * left out (shared/world/city.ts mergedPart); or with `cell` above 0, cells that wide and `tall` tall (cellPart). The
 * first level of cells after one of boxes fades in over the last share of that level's reach as it fades out.
 */
export interface CityLevel {
  readonly to: number;
  readonly gap: number;
  readonly least: number;
  readonly cell: number;
  readonly tall: number;
}

/** A tile's level on the card: its slot, and where each chunk's faces start in its indices and how many indices they take. */
interface Held {
  readonly level: number;
  readonly data: Uint8Array;
  readonly indexBytes: 2 | 4;
  readonly first: Uint32Array;
  readonly count: Uint32Array;
  slot: number;
  /** A piece of the tile's chunks has gone since it was made. */
  stale: boolean;
}

interface Tile {
  readonly t: number;
  /** Its chunks that have pieces, in the order its mesh holds them. */
  readonly chunks: readonly number[];
  /** The box its pieces stand in, in the world, and where its stored heights begin. */
  readonly box: Float64Array;
  readonly base: number;
  /** The level its nearest point asks for, kept a little past where it ends; -1 before it is first asked. */
  primary: number;
  readonly held: (Held | null)[];
  /** Frames in a row it has been in view and reach with nothing made to draw. */
  unseen: number;
}

/** One chunk's faces at a level, as the card takes them within its tile: VERTEX_BYTES a vertex, four a face. */
interface Piece {
  readonly verts: Uint8Array;
  readonly faces: number;
}

export class FarCity {
  /** The pack mesh of the tiles' bounds (far.ts FAR_MESH), as a draw names it. */
  readonly mesh: number;
  /** Bytes of tiles on the card. */
  bytes = 0;
  /** Last frame: milliseconds spent making tiles and tiles made, tiles in reach with nothing on the card, and levels wanted and not yet made. */
  readonly stats = { makeMs: 0, made: 0, missing: 0, behind: 0, unseen: 0, unseenAt: Infinity, unseenFrames: 0, coarse: 0 };
  /** Triangles drawn this frame at each level. */
  readonly drawn = new Float64Array(LEVELS);
  /** Milliseconds of a frame tiles may be made in, after the first; Infinity makes every tile wanted in the frame it is. */
  makeMs = MAKE_MS;
  private readonly source: CitySource;
  private readonly dims: MapDims;
  private readonly hf: Heightfield;
  private readonly center: readonly number[];
  private readonly half: readonly number[];
  private readonly tilesX: number;
  private readonly tiles: Tile[] = [];
  private readonly tileOfChunk: Int32Array;
  /** Pieces made, by chunk times LEVELS plus level. */
  private readonly pieces = new Map<number, Piece>();
  /** Per chunk: which of its pieces are gone, as last seen near and as the far feed shows; and a count of changes to that. */
  private readonly gone = new Map<number, Uint8Array>();
  private readonly seenNear = new Map<number, Uint8Array>();
  private readonly seenShape: Int32Array;
  private readonly seenCells: Uint32Array;
  readonly goneVersion: Uint32Array;
  /** Per chunk, the far feed's top byte of each cell as its standing pieces give it, made when asked for. */
  private readonly tops = new Map<number, Uint8Array>();
  private levels: readonly CityLevel[] = [];
  /** The share of a reach a far draw fades over (the tier's `fade`). */
  private share = 0.1;
  private next = 0;
  private sent = false;
  private on = false;
  private readonly work: number[] = [];
  /** Per chunk, the box its pieces' faces may reach, as a tile's; and per chunk of the tile being drawn, its depth ranges or 0. */
  private readonly chunkBox: Float64Array;
  private readonly ways = new Uint8Array(CITY_TILE * CITY_TILE);

  /** `bounds` is FAR_MESH's centre and half extent, as the pack has them. */
  constructor(source: CitySource, dims: MapDims, hf: Heightfield, mesh: number, bounds: { center: readonly number[]; half: readonly number[] }) {
    this.source = source;
    this.dims = dims;
    this.hf = hf;
    this.mesh = mesh;
    this.center = bounds.center;
    this.half = bounds.half;
    this.tilesX = Math.ceil(dims.chunksX / CITY_TILE);
    const chunks = chunkCount(dims);
    this.tileOfChunk = new Int32Array(chunks).fill(-1);
    this.seenShape = new Int32Array(chunks).fill(-1);
    this.seenCells = new Uint32Array(chunks);
    this.goneVersion = new Uint32Array(chunks);
    const { first, x, y, z, kind, halfX, halfY, halfZ } = source.statics;
    const byTile = new Map<number, number[]>();
    for (let c = 0; c < chunks; c++) {
      if (first[c + 1] === first[c]) continue;
      const t = this.tileOf(c);
      byTile.set(t, [...(byTile.get(t) ?? []), c]);
    }
    const cb = (this.chunkBox = new Float64Array(chunks * 6));
    for (const t of byTile.keys()) {
      const list = byTile.get(t)!;
      const box = Float64Array.from([Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity]);
      for (const c of list) {
        cb.fill(Infinity, c * 6, c * 6 + 3).fill(-Infinity, c * 6 + 3, c * 6 + 6);
        for (let i = first[c]!; i < first[c + 1]!; i++) {
          const k = kind[i]!;
          // A turned piece reaches no farther than its half diagonal.
          const r = Math.hypot(halfX[k]!, halfZ[k]!);
          cb[c * 6] = Math.min(cb[c * 6]!, x[i]! - r);
          cb[c * 6 + 1] = Math.min(cb[c * 6 + 1]!, y[i]! - halfY[k]!);
          cb[c * 6 + 2] = Math.min(cb[c * 6 + 2]!, z[i]! - r);
          cb[c * 6 + 3] = Math.max(cb[c * 6 + 3]!, x[i]! + r);
          cb[c * 6 + 4] = Math.max(cb[c * 6 + 4]!, y[i]! + halfY[k]!);
          cb[c * 6 + 5] = Math.max(cb[c * 6 + 5]!, z[i]! + r);
        }
        // A cell's face may lie a cell past the boxes it was made of.
        for (let a = 0; a < 3; a++) {
          cb[c * 6 + a] -= BELOW;
          cb[c * 6 + a + 3] += BELOW;
          box[a] = Math.min(box[a]!, cb[c * 6 + a]!);
          box[a + 3] = Math.max(box[a + 3]!, cb[c * 6 + a + 3]!);
        }
      }
      const base = Math.floor(box[1]!);
      if (box[4]! - base > FAR_HEIGHT) throw new Error(`far city: the pieces of tile ${t} stand ${Math.round(box[4]! - base)} m tall, and a tile holds ${FAR_HEIGHT}`);
      for (const c of list) this.tileOfChunk[c] = this.tiles.length;
      this.tiles.push({ t, chunks: list, box, base, primary: -1, held: [], unseen: 0 });
    }
  }

  /** Whether `chunk`'s statics are drawn here this frame, so the near store draws none of that chunk. */
  isFar(chunk: number): boolean {
    return this.on && this.tileOfChunk[chunk]! >= 0 && !this.source.complete(chunk);
  }

  /** After a lost context: every tile and the instance buffer go on the card again. */
  reset(): void {
    for (const tile of this.tiles) for (const h of tile.held) if (h && h.data.length > 0) h.slot = -1;
    this.sent = false;
  }

  /** Which pieces of `chunk` are gone, or null for none. */
  goneOf(chunk: number): Gone {
    return this.gone.get(chunk) ?? null;
  }

  /** The far feed's top byte of each cell of `chunk` as its standing pieces give it, or null for a chunk with none. */
  topsOf(chunk: number): Uint8Array | null {
    if (this.tileOfChunk[chunk]! < 0) return null;
    let tops = this.tops.get(chunk);
    if (!tops) this.tops.set(chunk, (tops = cityTops(this.source.statics, chunk, this.hf, this.goneOf(chunk))));
    return tops;
  }

  /**
   * Brings what stands and the tiles within the tier's reach up to date and on the card, and lets go of those a tile
   * farther. `near` is the near store and `cells` the far feed, for what stands. Uploads and drops go into the packet,
   * and what they weigh is spent and reserved in `budget`.
   */
  update(p: FramePacket, budget: { spend(bytes: number): void; reserve(name: string, bytes: number): void }, cam: Camera, levels: readonly CityLevel[], reach: number, share: number, near: StructureStore | null, cells: FarStore | null): void {
    if (levels !== this.levels) {
      // Another tier: what was made at the old levels is let go.
      for (const tile of this.tiles) this.letGo(p, tile);
      this.pieces.clear();
      this.levels = levels;
    }
    this.on = reach > 0 && levels.length > 0;
    this.share = share;
    this.standing(near, cells);
    const stats = this.stats;
    stats.makeMs = 0;
    stats.made = 0;
    stats.missing = 0;
    stats.behind = 0;
    const work = this.work;
    work.length = 0;
    for (let n = 0; n < this.tiles.length; n++) {
      const tile = this.tiles[n]!;
      const off = this.off(tile, cam);
      if (!this.on || off > reach + TILE_METRES) {
        this.letGo(p, tile);
        continue;
      }
      if (off > reach) continue;
      const needed = this.needed(tile, cam, off, share);
      let any = false;
      for (let l = 0; l < levels.length; l++) {
        const h = tile.held[l];
        if (h) any = true;
        if ((needed & (1 << l)) !== 0 && (!h || h.stale)) work.push(n * LEVELS + l);
      }
      if (!any) stats.missing++;
      // Levels no longer wanted go once every wanted one is there to draw in their place.
      if (work.length === 0 || Math.floor(work.at(-1)! / LEVELS) !== n) {
        for (let l = 0; l < tile.held.length; l++) {
          const h = tile.held[l];
          if (!h || (needed & (1 << l)) !== 0) continue;
          if (h.slot >= 0) p.assetDrops.push(h.slot);
          tile.held[l] = null;
          for (const c of tile.chunks) this.pieces.delete(c * LEVELS + l);
        }
      }
    }
    if (work.length > 0) {
      // Tiles with nothing on the card first, those in view before those not, then by distance.
      const key = (w: number): number => {
        const tile = this.tiles[Math.floor(w / LEVELS)]!;
        const b = tile.box;
        const seen = cam.boxVisible(b[0]! - cam.x, b[1]! - cam.y, b[2]! - cam.z, b[3]! - cam.x, b[4]! - cam.y, b[5]! - cam.z);
        return (tile.held.some((h) => h !== null) ? 1e6 : 0) + (seen ? 0 : 5e5) + this.off(tile, cam);
      };
      work.sort((a, b) => key(a) - key(b));
      // A chunk or a tile's putting together at a time, so no frame takes more than the budget and one of those.
      const start = clock();
      let made = 0;
      let k = 0;
      next: for (; k < work.length; k++) {
        const tile = this.tiles[Math.floor(work[k]! / LEVELS)]!, level = work[k]! % LEVELS;
        for (const c of tile.chunks) {
          if (this.pieces.has(c * LEVELS + level)) continue;
          if (made > 0 && clock() - start >= this.makeMs) break next;
          this.piece(c, level, tile);
          made++;
        }
        if (made > 0 && clock() - start >= this.makeMs) break;
        this.make(p, tile, level);
        made++;
      }
      stats.makeMs = clock() - start;
      stats.made = k;
      stats.behind = work.length - k;
    }
    let bytes = 0;
    for (const tile of this.tiles) {
      for (const h of tile.held) {
        if (!h) continue;
        if (h.slot === -1) {
          h.slot = CITY_SLOTS + this.next;
          this.next = (this.next + 1) % CITY_SLOT_SPAN;
          p.assetUploads.push({ slot: h.slot, mesh: this.mesh, level: 0, data: h.data, indexCount: h.first.at(-1)! + h.count.at(-1)!, indexBytes: h.indexBytes });
          budget.spend(h.data.length);
        }
        bytes += h.data.length;
      }
    }
    if (bytes > 0 && !this.sent) {
      p.uploads.push({ buffer: CITY_BUFFER, data: new Uint8Array(INSTANCE_BYTES), slots: new Uint16Array(1) });
      this.sent = true;
    }
    if (bytes !== this.bytes) budget.reserve(RESERVE, bytes);
    this.bytes = bytes;
  }

  /**
   * Calls `put` for each run of a tile's chunks drawn far, at each level of the tile drawn, where the tile is on the
   * card, within `reach` of the camera and in its view: the level's slot, its first index and how many, where its stored
   * origin is from the camera, the depth ranges its box is in, and where it is gone (`drawFade`, below 0 to fade in).
   */
  draw(cam: Camera, reach: number, put: (slot: number, firstIndex: number, indexCount: number, ox: number, oy: number, oz: number, passes: number, fade: number) => void): void {
    const levels = this.levels;
    const stats = this.stats;
    this.drawn.fill(0);
    stats.unseen = 0;
    stats.unseenAt = Infinity;
    stats.unseenFrames = 0;
    stats.coarse = 0;
    for (const tile of this.tiles) {
      const b = tile.box;
      const ax = b[0]! - cam.x, ay = b[1]! - cam.y, az = b[2]! - cam.z, bx = b[3]! - cam.x, by = b[4]! - cam.y, bz = b[5]! - cam.z;
      const near = Math.hypot(Math.max(ax, -bx, 0), Math.max(ay, -by, 0), Math.max(az, -bz, 0));
      if (near >= reach || !cam.boxVisible(ax, ay, az, bx, by, bz)) {
        tile.unseen = 0;
        continue;
      }
      // A tile in view whose levels are none of them made yet, empty ones aside, is not drawn at all.
      if (!tile.held.some((h) => h !== null)) {
        stats.unseen++;
        stats.unseenAt = Math.min(stats.unseenAt, near);
        stats.unseenFrames = Math.max(stats.unseenFrames, ++tile.unseen);
        continue;
      }
      tile.unseen = 0;
      // The levels wanted that are on the card; or, if none is yet, the one on the card nearest the first wanted.
      const needed = this.needed(tile, cam, near, this.share);
      let drawn = 0;
      for (let l = 0; l < tile.held.length; l++) if (tile.held[l] && (needed & (1 << l)) !== 0) drawn |= 1 << l;
      if (drawn === 0) {
        let best = -1;
        for (let l = 0; l < tile.held.length; l++) if (tile.held[l] && (best < 0 || Math.abs(l - tile.primary) < Math.abs(best - tile.primary))) best = l;
        drawn = 1 << best;
        if (best > tile.primary) stats.coarse++;
      }
      // Each chunk drawn far, in view, and the depth ranges its own box is in: a run is chunks alike in those.
      const ways = this.ways;
      tile.chunks.forEach((c, n) => {
        const k = c * 6;
        const cb = this.chunkBox;
        const cx0 = cb[k]! - cam.x, cy0 = cb[k + 1]! - cam.y, cz0 = cb[k + 2]! - cam.z, cx1 = cb[k + 3]! - cam.x, cy1 = cb[k + 4]! - cam.y, cz1 = cb[k + 5]! - cam.z;
        ways[n] = this.source.complete(c) || !cam.boxVisible(cx0, cy0, cz0, cx1, cy1, cz1) ? 0 : cam.passes(cx0, cy0, cz0, cx1, cy1, cz1);
      });
      const tx = this.cornerX(tile.t), tz = this.cornerZ(tile.t);
      const ox = tx - LOCAL - cam.x, oy = tile.base - cam.y, oz = tz - LOCAL - cam.z;
      for (let l = 0; l < tile.held.length; l++) {
        const h = tile.held[l];
        if ((drawn & (1 << l)) === 0 || !h || h.slot < 0) continue;
        // The lattice fades out as the mass fades in, where both are drawn; else each is gone at the reach.
        const fade = this.blends(l + 1) && (drawn & (1 << (l + 1))) !== 0 ? levels[l]!.to : this.blends(l) && (drawn & (1 << (l - 1))) !== 0 ? -levels[l - 1]!.to : reach;
        let run = 0;
        for (let n = 1; n <= tile.chunks.length; n++) {
          if (n < tile.chunks.length && ways[n] === ways[run]) continue;
          const first = h.first[run]!;
          const count = h.first[n - 1]! + h.count[n - 1]! - first;
          if (ways[run] !== 0 && count > 0) {
            put(h.slot, first, count, ox, oy, oz, ways[run]!, fade);
            this.drawn[l]! += count / 3;
          }
          run = n;
        }
      }
    }
  }

  /** Whether level `l` is the first of cells after one of boxes, which fades in as that one fades out. */
  private blends(l: number): boolean {
    const levels = this.levels;
    return l > 0 && l < levels.length && levels[l]!.cell > 0 && levels[l - 1]!.cell === 0;
  }

  /**
   * The levels `tile`, `off` metres away, wants on the card, a bit each: the one its nearest point asks for, and across
   * a fade between the lattice and the mass, both.
   */
  private needed(tile: Tile, cam: Camera, off: number, share: number): number {
    const levels = this.levels;
    let l = levels.length - 1;
    for (let k = 0; k < levels.length - 1; k++) {
      const end = levels[k]!.to * (k === tile.primary ? HYSTERESIS : k < tile.primary ? 1 / HYSTERESIS : 1);
      if (off < end) {
        l = k;
        break;
      }
    }
    tile.primary = l;
    let bits = 1 << l;
    const b = tile.box;
    const most = Math.hypot(Math.max(cam.x - b[0]!, b[3]! - cam.x), Math.max(cam.y - b[1]!, b[4]! - cam.y), Math.max(cam.z - b[2]!, b[5]! - cam.z));
    if (this.blends(l + 1) && most > levels[l]!.to * (1 - share)) bits |= 1 << (l + 1);
    if (this.blends(l) && off < levels[l - 1]!.to) bits |= 1 << (l - 1);
    return bits;
  }

  /** Metres from the camera to tile's box. */
  private off(tile: Tile, cam: Camera): number {
    const b = tile.box;
    return Math.hypot(Math.max(b[0]! - cam.x, cam.x - b[3]!, 0), Math.max(b[1]! - cam.y, cam.y - b[4]!, 0), Math.max(b[2]! - cam.z, cam.z - b[5]!, 0));
  }

  private tileOf(chunk: number): number {
    const cx = chunk % this.dims.chunksX;
    const cz = Math.floor(chunk / this.dims.chunksX);
    return Math.floor(cz / CITY_TILE) * this.tilesX + Math.floor(cx / CITY_TILE);
  }

  /** Tile `t`'s corner nearest the map's origin, in metres. */
  private cornerX(t: number): number {
    return (t % this.tilesX) * TILE_METRES;
  }

  private cornerZ(t: number): number {
    return Math.floor(t / this.tilesX) * TILE_METRES;
  }

  /** Lets go of every level of `tile` on the card and the pieces made for it. */
  private letGo(p: FramePacket, tile: Tile): void {
    if (tile.held.length === 0 && tile.primary < 0) return;
    for (const h of tile.held) if (h && h.slot >= 0) p.assetDrops.push(h.slot);
    tile.held.length = 0;
    tile.primary = -1;
    for (const c of tile.chunks) for (let l = 0; l < LEVELS; l++) this.pieces.delete(c * LEVELS + l);
  }

  /** Brings what stands up to date: chunks the near store holds whole, and the far feed's cells of the rest. */
  private standing(near: StructureStore | null, cells: FarStore | null): void {
    const city = this.source.statics;
    for (const tile of this.tiles) {
      for (const c of tile.chunks) {
        let changed = false;
        const table = near?.chunks[c];
        const whole = this.source.complete(c);
        // A chunk let go and held again is matched again, whatever its table's count of changes says.
        if (!whole) this.seenShape[c] = -1;
        else if (table && table.shape !== this.seenShape[c]) {
          this.seenShape[c] = table.shape;
          const g = new Uint8Array(city.in(c));
          goneByRows(city, c, table, g);
          this.seenNear.set(c, g);
          changed = true;
        }
        const stamp = cells?.changed[c] ?? 0;
        if (stamp !== this.seenCells[c]) {
          this.seenCells[c] = stamp;
          changed = true;
        }
        if (!changed) continue;
        const g = this.seenNear.get(c)?.slice() ?? new Uint8Array(city.in(c));
        // Cells told since the chunk was last held whole say more; a chunk sent empty has none of its pieces left.
        if (cells && stamp > 0 && !whole) goneByCells(city, c, this.hf, cells.chunks.get(c)?.top ?? new Uint8Array(256), g);
        this.setGone(c, g);
      }
    }
  }

  /** Says which pieces of `chunk` are gone, and lets go of what was made of it and its neighbours, whose faces it held. */
  private setGone(chunk: number, gone: Uint8Array): void {
    const was = this.gone.get(chunk);
    const none = !gone.includes(1);
    if (none ? !was : was && was.every((g, i) => g === gone[i])) return;
    if (none) this.gone.delete(chunk);
    else this.gone.set(chunk, gone);
    this.tops.delete(chunk);
    this.goneVersion[chunk]!++;
    const cx = chunk % this.dims.chunksX;
    const cz = Math.floor(chunk / this.dims.chunksX);
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (cx + dx < 0 || cz + dz < 0 || cx + dx >= this.dims.chunksX || cz + dz >= this.dims.chunksZ) continue;
        const c = (cz + dz) * this.dims.chunksX + cx + dx;
        for (let l = 0; l < LEVELS; l++) this.pieces.delete(c * LEVELS + l);
        const n = this.tileOfChunk[c]!;
        if (n >= 0) for (const h of this.tiles[n]!.held) if (h) h.stale = true;
      }
    }
  }

  /** `chunk`'s faces at `level`, quantized within its tile. */
  private piece(chunk: number, level: number, tile: Tile): Piece {
    const key = chunk * LEVELS + level;
    const made = this.pieces.get(key);
    if (made) return made;
    const l = this.levels[level]!;
    const city = this.source.statics;
    const gone = (c: number): Gone => this.gone.get(c) ?? null;
    const part: CityPart = l.cell > 0 ? cellPart(city, chunk, this.hf, gone(chunk), l.cell, l.tall) : mergedPart(city, chunk, this.hf, gone, l.gap, l.least);
    const tx = this.cornerX(tile.t), tz = this.cornerZ(tile.t);
    const dx = (chunk % this.dims.chunksX) * CHUNK_SIZE - tx + LOCAL;
    const dz = Math.floor(chunk / this.dims.chunksX) * CHUNK_SIZE - tz + LOCAL;
    const verts = new Uint8Array(part.faces * 4 * VERTEX_BYTES);
    const view = new DataView(verts.buffer);
    const c = this.center, h = this.half;
    const q = (v: number, a: number): number => Math.max(-32767, Math.min(32767, Math.round(((v - c[a]!) / h[a]!) * 32767)));
    const { pos, color } = part;
    for (let v = 0; v < part.faces * 4; v++) {
      const o = v * VERTEX_BYTES;
      view.setInt16(o, q(pos[v * 3]! + dx, 0), true);
      view.setInt16(o + 2, q(pos[v * 3 + 1]! - tile.base, 1), true);
      view.setInt16(o + 4, q(pos[v * 3 + 2]! + dz, 2), true);
      verts[o + 6] = color[v >> 2]!;
    }
    const piece = { verts, faces: part.faces };
    this.pieces.set(key, piece);
    return piece;
  }

  /** Makes `tile` at `level`, every chunk of it in order, letting go of what the card held of that level. */
  private make(p: FramePacket, tile: Tile, level: number): void {
    const old = tile.held[level];
    if (old && old.slot >= 0) p.assetDrops.push(old.slot);
    const pieces = tile.chunks.map((c) => this.piece(c, level, tile));
    const faces = pieces.reduce((n, piece) => n + piece.faces, 0);
    const verts = faces * 4;
    const indexBytes = verts > 65535 ? 4 : 2;
    const at = (faces * 6 * indexBytes + 3) & ~3;
    const data = new Uint8Array(at + verts * VERTEX_BYTES);
    const index = indexBytes === 4 ? new Uint32Array(data.buffer, 0, faces * 6) : new Uint16Array(data.buffer, 0, faces * 6);
    const first = new Uint32Array(pieces.length);
    const count = new Uint32Array(pieces.length);
    let v = 0;
    let k = 0;
    pieces.forEach((piece, n) => {
      first[n] = k;
      count[n] = piece.faces * 6;
      data.set(piece.verts, at + v * VERTEX_BYTES);
      // Kept as its part of the tile's level, so a chunk's faces are held once.
      this.pieces.set(tile.chunks[n]! * LEVELS + level, { verts: data.subarray(at + v * VERTEX_BYTES, at + (v + piece.faces * 4) * VERTEX_BYTES), faces: piece.faces });
      for (let f = 0; f < piece.faces; f++, v += 4) {
        index[k++] = v;
        index[k++] = v + 1;
        index[k++] = v + 2;
        index[k++] = v;
        index[k++] = v + 2;
        index[k++] = v + 3;
      }
    });
    // A level with no faces is made but never on the card.
    tile.held[level] = { level, data, indexBytes, first, count, slot: faces > 0 ? -1 : EMPTY, stale: false };
  }
}
