// A map's own buildings past the near rows (shared/world/city.ts). The client makes them from the map's statics, which
// it holds from the map file, in tiles of 3 by 3 chunks, each level of a tile a level of its own on the card. A chunk is
// drawn here while the near store does not hold it whole, and then the near store draws none of it, so its pieces are
// drawn one way or the other and never both or neither. A tile's mesh holds every chunk of it in order and a draw takes
// the runs of chunks drawn far, so a chunk changing hands remakes nothing. Nearest the near rows a tile is every box, the
// near drawing in one mesh, so the hand-over shows nothing; farther off it takes the lattice (boxes merged, the least
// left out), then a building's mass in cells. The lattice fades out over the last share of its reach as the mass fades in,
// pixel by pixel in the far fade's pattern; the other changes of level are a tile at a time.
//
// Levels are made where the scene's maker makes them (citymake.ts): in the browser on a worker, sent only what a level
// needs, and here a frame's budget at a time. What is made goes on the card and is not kept in the page.
//
// What stands: a chunk the near store holds whole says exactly which of the map's pieces stand, and that is kept when it
// is let go. Past that, the far feed's cells (farcells.ts) show a piece gone when its top stands over the top sent for a
// cell it fills. A piece gone either way is left out of every level of its chunk.

import { CHUNK_SIZE, chunkCount, type MapDims } from "../../../shared/coords.ts";
import { INSTANCE_BYTES } from "../../../shared/pack/pack.ts";
import { cityTops, goneByCells, goneByRows, type CityStatics, type Gone } from "../../../shared/world/city.ts";
import type { Heightfield } from "../../../shared/world/heightfield.ts";
import type { StructureStore } from "../../../shared/world/structures.ts";
import type { FarStore } from "../farcells.ts";
import type { Camera } from "./camera.ts";
import { InlineCityMaker, cityJob, cityKinds, type CityMade, type CityMaker } from "./citymake.ts";
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
/** Levels are made, nearest first and tiles with nothing on the card before the rest; here, until this much of a frame is spent. */
export const MAKE_MS = 2;
/** Levels a worker is asked for ahead of what it has made: it never waits on the page, and a tile come nearer soon goes first. */
const FLIGHTS = 3;
/** Milliseconds from some fixed moment: the page's clock in a browser and under Bun. */
const clock = (): number => (globalThis as { performance?: { now(): number } }).performance?.now() ?? Date.now();
/** A tile leaves a level for a coarser one this much past where the level ends, and comes back this much short of it. */
const HYSTERESIS = 1.08;
const LEVELS = 8;
/** The slot of a level made with no faces, which is never on the card. */
const EMPTY = -2;

/** Levels asked of makers, counted over every city of the page, so a maker's answer to one before is known for that. */
let levelsAsked = 0;

/** What the scene draws a map's buildings from: its statics, which chunks the near store holds whole, and where levels are made (here, if not given). */
export interface CitySource {
  readonly statics: CityStatics;
  complete(chunk: number): boolean;
  readonly maker?: CityMaker;
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

/** A tile's level on the card: its slot, its bytes there, and where each chunk's faces start in its indices and how many indices they take. */
interface Held {
  readonly level: number;
  readonly bytes: number;
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
  /** The levels it wanted when last in reach, and those being made, a bit each. */
  wants: number;
  making: number;
  /** Counts of its lettings go and of the changes to what stands that its levels show, so a level asked for before one is known. */
  epoch: number;
  version: number;
  /** Where its levels go in this frame's order of making: lower first. */
  rank: number;
}

/** A level asked of the maker, and its tile's counts then. */
interface Asked {
  readonly tile: number;
  readonly level: number;
  readonly epoch: number;
  readonly version: number;
}

export class FarCity {
  /** The pack mesh of the tiles' bounds (far.ts FAR_MESH), as a draw names it. */
  readonly mesh: number;
  /** Bytes of tiles on the card. */
  bytes = 0;
  /**
   * Last frame: milliseconds of the page's thread spent making tiles (here, or asking a worker and taking what it made)
   * and levels taken, tiles in reach with nothing on the card, and levels wanted and not yet made.
   */
  readonly stats = { makeMs: 0, made: 0, missing: 0, behind: 0, unseen: 0, unseenAt: Infinity, unseenFrames: 0, coarse: 0 };
  /** Triangles drawn this frame at each level. */
  readonly drawn = new Float64Array(LEVELS);
  /** Milliseconds of a frame levels may be made in here, after the first; Infinity makes every level wanted in the frame it is. */
  makeMs = MAKE_MS;
  private readonly source: CitySource;
  private readonly dims: MapDims;
  private readonly hf: Heightfield;
  private readonly maker: CityMaker;
  private readonly tilesX: number;
  private readonly tiles: Tile[] = [];
  private readonly tileOfChunk: Int32Array;
  /** Per chunk: which of its pieces are gone, as last seen near and as the far feed shows; and a count of changes to that. */
  private readonly gone = new Map<number, Uint8Array>();
  private readonly seenNear = new Map<number, Uint8Array>();
  private readonly seenShape: Int32Array;
  private readonly seenCells: Uint32Array;
  readonly goneVersion: Uint32Array;
  /** Chunks matched against the near store's rows and still held whole, and the far feed's count of messages when last looked at. */
  private readonly whole = new Set<number>();
  private cellsSeen = 0;
  private readonly changed = new Set<number>();
  /** Per chunk, the far feed's top byte of each cell as its standing pieces give it, made when asked for. */
  private readonly tops = new Map<number, Uint8Array>();
  private levels: readonly CityLevel[] = [];
  /** The share of a reach a far draw fades over (the tier's `fade`). */
  private share = 0.1;
  private next = 0;
  private sent = false;
  private on = false;
  /** This frame's levels to make, in order, how many of them the maker has been asked for, and how many it is making. */
  private readonly work: number[] = [];
  private fed = 0;
  private out = 0;
  /** Milliseconds spent asking the worker for levels since the last frame. */
  private fedMs = 0;
  private readonly asked = new Map<number, Asked>();
  private readonly arrived: CityMade[] = [];
  private readonly got: CityMade[] = [];
  /** The tiles that may be in reach: those within it and two tiles more of where the camera was when they were found. */
  private around: number[] = [];
  private readonly listed: Uint8Array;
  private readonly aroundAt = Float64Array.of(Infinity, Infinity, -1);
  /** Per chunk, the box its pieces' faces may reach, as a tile's; and per chunk of the tile being drawn, its depth ranges or 0. */
  private readonly chunkBox: Float64Array;
  private readonly ways = new Uint8Array(CITY_TILE * CITY_TILE);

  /** `bounds` is FAR_MESH's centre and half extent, as the pack has them. */
  constructor(source: CitySource, dims: MapDims, hf: Heightfield, mesh: number, bounds: { center: readonly number[]; half: readonly number[] }) {
    this.source = source;
    this.dims = dims;
    this.hf = hf;
    this.mesh = mesh;
    this.maker = source.maker ?? new InlineCityMaker();
    this.maker.start(cityKinds(source.statics, hf, bounds));
    this.maker.onMade = () => this.feed();
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
      this.tiles.push({ t, chunks: list, box, base, primary: -1, held: [], unseen: 0, wants: 0, making: 0, epoch: 0, version: 0, rank: 0 });
    }
    this.listed = new Uint8Array(this.tiles.length);
  }

  /** Whether `chunk`'s statics are drawn here this frame, so the near store draws none of that chunk. */
  isFar(chunk: number): boolean {
    return this.on && this.tileOfChunk[chunk]! >= 0 && !this.source.complete(chunk);
  }

  /** After a lost context: every tile is made again, and the instance buffer goes on the card again. */
  reset(): void {
    for (const tile of this.tiles) tile.held.length = 0;
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
      this.levels = levels;
    }
    this.on = reach > 0 && levels.length > 0;
    this.share = share;
    this.standing(near, cells);
    const stats = this.stats;
    const start = clock();
    this.collect();
    stats.made = this.take(p, budget);
    stats.missing = 0;
    let makeMs = clock() - start + this.fedMs;
    this.fedMs = 0;
    const work = this.work;
    work.length = 0;
    let lacking = 0;
    for (const n of this.nearby(p, cam, reach)) {
      const tile = this.tiles[n]!;
      const off = this.off(tile, cam);
      if (!this.on || off > reach + TILE_METRES) {
        this.letGo(p, tile);
        continue;
      }
      if (off > reach) continue;
      const needed = (tile.wants = this.needed(tile, cam, off, share));
      let any = false;
      let short = false;
      for (let l = 0; l < levels.length; l++) {
        const h = tile.held[l];
        if (h) any = true;
        if ((needed & (1 << l)) === 0 || (h && !h.stale)) continue;
        short = true;
        lacking++;
        if ((tile.making & (1 << l)) === 0) work.push(n * LEVELS + l);
      }
      if (!any) stats.missing++;
      if (short) {
        // Tiles with nothing on the card first, those in view before those not, then by distance.
        const b = tile.box;
        const seen = cam.boxVisible(b[0]! - cam.x, b[1]! - cam.y, b[2]! - cam.z, b[3]! - cam.x, b[4]! - cam.y, b[5]! - cam.z);
        tile.rank = (any ? 1e6 : 0) + (seen ? 0 : 5e5) + off;
        continue;
      }
      // Levels no longer wanted go once every wanted one is there to draw in their place.
      for (let l = 0; l < tile.held.length; l++) {
        const h = tile.held[l];
        if (!h || (needed & (1 << l)) !== 0) continue;
        if (h.slot >= 0) p.assetDrops.push(h.slot);
        tile.held[l] = null;
      }
    }
    const tiles = this.tiles;
    work.sort((a, b) => tiles[Math.floor(a / LEVELS)]!.rank - tiles[Math.floor(b / LEVELS)]!.rank);
    this.fed = 0;
    const asking = clock();
    if (this.maker.run) {
      // A level at a time, the nearest wanted first, and a chunk of it at a time, so no frame takes more than the budget and one of those.
      let made = 0;
      for (let once = true; once || clock() - asking < this.makeMs; once = false) {
        if (this.out === 0 && this.fed < work.length) this.post(work[this.fed++]!);
        if (this.out === 0) break;
        this.maker.run(this.makeMs - (clock() - asking));
        this.collect();
        made += this.take(p, budget);
      }
      stats.made += made;
      lacking -= made;
    } else this.feed();
    makeMs += clock() - asking;
    this.fedMs = 0;
    stats.makeMs = makeMs;
    stats.behind = lacking;
    let bytes = 0;
    for (const n of this.around) for (const h of this.tiles[n]!.held) if (h) bytes += h.bytes;
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
   * origin is from the camera, the depth ranges its box is in, and where it is gone (`drawFade`, below 0 to fade in, and
   * 0 for a tile wholly short of where the reach fades, so its draw may take the program that never discards).
   */
  draw(cam: Camera, reach: number, put: (slot: number, firstIndex: number, indexCount: number, ox: number, oy: number, oz: number, passes: number, fade: number) => void): void {
    const levels = this.levels;
    const stats = this.stats;
    this.drawn.fill(0);
    stats.unseen = 0;
    stats.unseenAt = Infinity;
    stats.unseenFrames = 0;
    stats.coarse = 0;
    const whole = reach * (1 - this.share);
    const cb = this.chunkBox;
    const ways = this.ways;
    for (const n of this.around) {
      const tile = this.tiles[n]!;
      const b = tile.box;
      const ax = b[0]! - cam.x;
      const ay = b[1]! - cam.y;
      const az = b[2]! - cam.z;
      const bx = b[3]! - cam.x;
      const by = b[4]! - cam.y;
      const bz = b[5]! - cam.z;
      const near = Math.hypot(Math.max(ax, -bx, 0), Math.max(ay, -by, 0), Math.max(az, -bz, 0));
      if (near >= reach || !cam.boxVisible(ax, ay, az, bx, by, bz)) {
        tile.unseen = 0;
        continue;
      }
      // A tile in view whose levels are none of them made yet, empty ones aside, is not drawn at all.
      let held = 0;
      for (let l = 0; l < tile.held.length; l++) if (tile.held[l]) held |= 1 << l;
      if (held === 0) {
        stats.unseen++;
        stats.unseenAt = Math.min(stats.unseenAt, near);
        stats.unseenFrames = Math.max(stats.unseenFrames, ++tile.unseen);
        continue;
      }
      tile.unseen = 0;
      // The levels wanted that are on the card; or, if none is yet, the one on the card nearest the first wanted.
      let drawn = this.needed(tile, cam, near, this.share) & held;
      if (drawn === 0) {
        let best = -1;
        for (let l = 0; l < tile.held.length; l++) if (tile.held[l] && (best < 0 || Math.abs(l - tile.primary) < Math.abs(best - tile.primary))) best = l;
        drawn = 1 << best;
        if (best > tile.primary) stats.coarse++;
      }
      // Each chunk drawn far, in view, and the depth ranges its own box is in: a run is chunks alike in those.
      for (let r = 0; r < tile.chunks.length; r++) {
        const c = tile.chunks[r]!;
        const k = c * 6;
        const x0 = cb[k]! - cam.x;
        const y0 = cb[k + 1]! - cam.y;
        const z0 = cb[k + 2]! - cam.z;
        const x1 = cb[k + 3]! - cam.x;
        const y1 = cb[k + 4]! - cam.y;
        const z1 = cb[k + 5]! - cam.z;
        ways[r] = this.source.complete(c) || !cam.boxVisible(x0, y0, z0, x1, y1, z1) ? 0 : cam.passes(x0, y0, z0, x1, y1, z1);
      }
      const tx = this.cornerX(tile.t), tz = this.cornerZ(tile.t);
      const ox = tx - LOCAL - cam.x, oy = tile.base - cam.y, oz = tz - LOCAL - cam.z;
      const most = Math.hypot(Math.max(-ax, bx), Math.max(-ay, by), Math.max(-az, bz));
      for (let l = 0; l < tile.held.length; l++) {
        const h = tile.held[l];
        if ((drawn & (1 << l)) === 0 || !h || h.slot < 0) continue;
        // The lattice fades out as the mass fades in, where both are drawn; else each is gone at the reach.
        const fade = this.blends(l + 1) && (drawn & (1 << (l + 1))) !== 0 ? levels[l]!.to : this.blends(l) && (drawn & (1 << (l - 1))) !== 0 ? -levels[l - 1]!.to : most < whole ? 0 : reach;
        let run = 0;
        for (let r = 1; r <= tile.chunks.length; r++) {
          if (r < tile.chunks.length && ways[r] === ways[run]) continue;
          const first = h.first[run]!;
          const count = h.first[r - 1]! + h.count[r - 1]! - first;
          if (ways[run] !== 0 && count > 0) {
            put(h.slot, first, count, ox, oy, oz, ways[run]!, fade);
            this.drawn[l]! += count / 3;
          }
          run = r;
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

  /**
   * The tiles that may be within `reach` of the camera, found again when it has moved a tile's side: within that of
   * where they were found, any other is farther than the reach and a tile, where update lets go of it. Those that leave
   * the list are let go of.
   */
  private nearby(p: FramePacket, cam: Camera, reach: number): readonly number[] {
    const at = this.aroundAt;
    if (reach === at[2] && Math.hypot(cam.x - at[0], cam.z - at[1]) < TILE_METRES) return this.around;
    at[0] = cam.x;
    at[1] = cam.z;
    at[2] = reach;
    const list: number[] = [];
    for (let n = 0; n < this.tiles.length; n++) {
      const b = this.tiles[n]!.box;
      if (Math.hypot(Math.max(b[0]! - cam.x, cam.x - b[3]!, 0), Math.max(b[2]! - cam.z, cam.z - b[5]!, 0)) > reach + 2 * TILE_METRES) continue;
      list.push(n);
      this.listed[n] = 2;
    }
    for (const n of this.around) {
      if (this.listed[n] === 2) continue;
      this.letGo(p, this.tiles[n]!);
      this.listed[n] = 0;
    }
    for (const n of list) this.listed[n] = 1;
    return (this.around = list);
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

  /** Lets go of every level of `tile` on the card, and of what is being made of it. */
  private letGo(p: FramePacket, tile: Tile): void {
    tile.unseen = 0;
    if (tile.held.length === 0 && tile.primary < 0 && tile.making === 0) return;
    for (const h of tile.held) if (h && h.slot >= 0) p.assetDrops.push(h.slot);
    tile.held.length = 0;
    tile.primary = -1;
    tile.wants = tile.making = 0;
    tile.epoch++;
  }

  /** Asks the maker for this frame's level `w` (a tile times LEVELS plus a level). */
  private post(w: number): void {
    const n = Math.floor(w / LEVELS);
    const level = w % LEVELS;
    const tile = this.tiles[n]!;
    const id = levelsAsked++;
    this.asked.set(id, { tile: n, level, epoch: tile.epoch, version: tile.version });
    tile.making |= 1 << level;
    this.out++;
    this.maker.make(cityJob(id, this.source.statics, this.hf, (c) => this.gone.get(c) ?? null, tile.chunks, this.levels[level]!, this.cornerX(tile.t) - LOCAL, tile.base, this.cornerZ(tile.t) - LOCAL));
  }

  /** Keeps a worker making a few levels ahead, in this frame's order: in update, and as each level comes back. */
  private feed(): void {
    const start = clock();
    this.collect();
    while (this.out < FLIGHTS && this.fed < this.work.length) this.post(this.work[this.fed++]!);
    this.fedMs += clock() - start;
  }

  /** What the maker has made of what was asked of it, to be taken in the next update. */
  private collect(): void {
    const n = this.maker.take(this.got);
    for (let i = 0; i < n; i++) {
      const made = this.got[i]!;
      if (!this.asked.has(made.id)) continue;
      this.arrived.push(made);
      this.out--;
    }
    this.got.length = 0;
  }

  /** Puts the levels made on the card, but for those of tiles let go since or no longer wanted. Returns how many. */
  private take(p: FramePacket, budget: { spend(bytes: number): void }): number {
    let n = 0;
    for (const made of this.arrived) {
      const a = this.asked.get(made.id)!;
      this.asked.delete(made.id);
      const tile = this.tiles[a.tile]!;
      if (a.epoch !== tile.epoch) continue;
      const bit = 1 << a.level;
      tile.making &= ~bit;
      if ((tile.wants & bit) === 0) continue;
      const old = tile.held[a.level];
      if (old && old.slot >= 0) p.assetDrops.push(old.slot);
      // A level with no faces is made but never on the card.
      let slot = EMPTY;
      if (made.data.length > 0) {
        slot = CITY_SLOTS + this.next;
        this.next = (this.next + 1) % CITY_SLOT_SPAN;
        p.assetUploads.push({ slot, mesh: this.mesh, level: 0, data: made.data, indexCount: made.first.at(-1)! + made.count.at(-1)!, indexBytes: made.indexBytes });
        budget.spend(made.data.length);
      }
      tile.held[a.level] = { level: a.level, bytes: made.data.length, first: made.first, count: made.count, slot, stale: a.version !== tile.version };
      n++;
    }
    this.arrived.length = 0;
    return n;
  }

  /** Brings what stands up to date: chunks the near store holds whole, and the far feed's cells of the rest. */
  private standing(near: StructureStore | null, cells: FarStore | null): void {
    const city = this.source.statics;
    const changed = this.changed;
    changed.clear();
    // A chunk let go and held again is matched again, whatever its table's count of changes says.
    for (const c of this.whole) {
      if (this.source.complete(c)) continue;
      this.seenShape[c] = -1;
      this.whole.delete(c);
    }
    const tables = near?.chunks;
    for (let c = 0; tables && c < tables.length; c++) {
      const table = tables[c];
      if (!table || table.shape === this.seenShape[c] || this.tileOfChunk[c]! < 0 || !this.source.complete(c)) continue;
      this.seenShape[c] = table.shape;
      this.whole.add(c);
      const g = new Uint8Array(city.in(c));
      goneByRows(city, c, table, g);
      this.seenNear.set(c, g);
      changed.add(c);
    }
    if (cells && cells.version !== this.cellsSeen) {
      this.cellsSeen = cells.version;
      for (let c = 0; c < cells.changed.length; c++) {
        if (cells.changed[c] === this.seenCells[c] || this.tileOfChunk[c]! < 0) continue;
        this.seenCells[c] = cells.changed[c]!;
        changed.add(c);
      }
    }
    for (const c of changed) {
      const g = this.seenNear.get(c)?.slice() ?? new Uint8Array(city.in(c));
      // Cells told since the chunk was last held whole say more; a chunk sent empty has none of its pieces left.
      if (cells && this.seenCells[c]! > 0 && !this.source.complete(c)) goneByCells(city, c, this.hf, cells.chunks.get(c)?.top ?? new Uint8Array(256), g);
      this.setGone(c, g);
    }
  }

  /** Says which pieces of `chunk` are gone, and marks what was made of it and its neighbours, whose faces it held, to be made again. */
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
        const n = this.tileOfChunk[(cz + dz) * this.dims.chunksX + cx + dx]!;
        if (n < 0) continue;
        const tile = this.tiles[n]!;
        tile.version++;
        for (const h of tile.held) if (h) h.stale = true;
      }
    }
  }
}
