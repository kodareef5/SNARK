// A map's own buildings past the near rows (shared/world/city.ts). The client makes them from the map's statics, which
// it holds from the map file, in tiles of 4 by 4 chunks, each level of a tile a level of its own on the card. A
// landmark's pieces are left out, as its far mesh draws them (farlandmarks.ts). A chunk is drawn here while the near
// store does not hold it whole, and then the near store draws none of it, so its pieces are drawn one way or the other
// and never both or neither. A tile's mesh holds every chunk of it in order and a draw takes the runs of chunks drawn
// far, so a chunk changing hands remakes nothing. Nearest the near rows a tile is every box, the
// near drawing in one mesh, so the hand-over shows nothing; farther off it takes the lattice (boxes merged, the least
// left out), then a building's mass in cells. The lattice fades out over the last share of its reach as the mass fades in,
// and the mass in finer cells as that in coarser ones does, pixel by pixel in the far fade's pattern; the other changes
// of level are a tile at a time.
//
// Levels are made where the scene's maker makes them (citymake.ts): in the browser on a worker, sent only what a level
// needs, and here a frame's budget at a time. What is made goes on the card and is not kept in the page. A tile holds
// its levels by their form, not by where they stand in the tier's list, so another tier, or the governor bringing the
// distances in, makes only the forms a tile comes to; and until they are made it draws what it holds.
//
// What stands: a chunk the near store holds whole says exactly which of the map's pieces stand, and that is kept when it
// is let go. Past that, the server's list of a chunk's pieces gone (gonelists.ts) says it, a hole under a standing top
// too. Where neither is known, the far feed's cells (farcells.ts), while they count the map's pieces, show a piece gone
// when its top stands over the top sent for a cell it fills. A piece gone any way is left out of every level of its
// chunk. What stands is followed for a landmark's pieces too, so the far blocks leave their cells alone.
//
// A change to what stands is known at once to whoever asks (goneOf, goneVersion), and a tile's levels are made again for
// it once the tile has been quiet a moment, so a building that comes down wave by wave is remade once.

import { CHUNK_SIZE, chunkCount, type MapDims } from "../../../shared/coords.ts";
import { INSTANCE_BYTES } from "../../../shared/pack/pack.ts";
import { cityTops, goneByCells, goneByRows, type ChunkSquare, type CityStatics, type Gone } from "../../../shared/world/city.ts";
import type { Heightfield } from "../../../shared/world/heightfield.ts";
import type { StructureStore } from "../../../shared/world/structures.ts";
import type { FarStore } from "../farcells.ts";
import type { GoneStore } from "../gonelists.ts";
import type { Camera } from "./camera.ts";
import { WORTH, type Hider } from "./hide.ts";
import { InlineCityMaker, cityJob, cityKinds, type CityMade, type CityMaker } from "./citymake.ts";
import { CITY_BUFFER, FAR_HEIGHT } from "./far.ts";
export { CITY_BUFFER } from "./far.ts";
import type { FramePacket } from "./packet.ts";

/** Chunks along a tile's side, a whole number of tiles to a sector of 16, and its side in metres. */
export const CITY_TILE = 4;
const TILE_METRES = CITY_TILE * CHUNK_SIZE;
/**
 * A tile's vertices are stored from its corner less this across, within bounds of the city's own: a square this much
 * wider than the tile each way, so faces reaching past its edges stay within it, and FAR_MESH's heights.
 */
const LOCAL = 32;
/**
 * How far past its pieces a tile's box reaches, by which its levels are chosen, and its stored heights begin below them;
 * and how much farther across a face of its may lie, for what is in view: a cell's face may lie a cell past a box along
 * the axes of the box's own turned frame, so across by a cell's diagonal, 11.3 m for the widest cells, 8 m.
 */
const BELOW = 8;
const ACROSS = 4;
/** Slots of tiles on the card start here, past the far blocks' (far.ts FAR_SLOTS up to twice that). */
export const CITY_SLOTS = 2 ** 31;
const CITY_SLOT_SPAN = 2 ** 30;
const RESERVE = "far city";
/** Levels are made, nearest first and tiles with nothing on the card before the rest; here, until this much of a frame is spent. */
export const MAKE_MS = 2;
/** Levels a maker on other threads is asked for ahead of what it has made, if it does not say. */
const FLIGHTS = 3;
/**
 * Milliseconds a tile whose standing pieces changed goes without another change before its levels are made again, and the
 * longest it waits while they keep changing: within QUIET_WITHIN metres of the eye, and past that.
 */
export const QUIET_WITHIN = 700;
export const QUIET_NEAR = 500;
export const QUIET_FAR = 2000;
export const WAIT_NEAR = 3000;
export const WAIT_FAR = 10000;
/** Milliseconds a tile come into reach waits for the lists of its chunks' pieces gone before it is first made. */
export const FIRST_WAIT = 300;
/** Milliseconds from some fixed moment: the page's clock in a browser and under Bun. */
const clock = (): number => (globalThis as { performance?: { now(): number } }).performance?.now() ?? Date.now();
/** A tile leaves a level for a coarser one this much past where the level ends, and comes back this much short of it. */
const HYSTERESIS = 1.08;
/**
 * Updates a tile looked at through a sight keeps the levels its distance over the zoom asked for, after the sight is
 * lowered or turned off it: one raised again within it makes nothing (D1078).
 */
const ZOOM_LINGER = 180;
/** The most levels a tier has, and the most forms a city is drawn in (a bit each in a tile's `wants`). */
const LEVELS = 8;
const FORMS = 30;
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
 * How a level of the far city is made, its form, and to how many metres from the camera to a tile's nearest point it is
 * drawn: every box (`gap` below 0 and `least` 0); boxes merged across gaps up to `gap` metres with those no longer than
 * `least` left out (shared/world/city.ts mergedPart); or with `cell` above 0, cells that wide and `tall` tall (cellPart).
 * A level of cells after one of boxes, or of cells of another size, fades in over the last share of that level's reach
 * as it fades out.
 */
export interface CityLevel extends LevelForm {
  readonly to: number;
}

export interface LevelForm {
  readonly gap: number;
  readonly least: number;
  readonly cell: number;
  readonly tall: number;
  /** Pieces whose middle extent is under this many metres are left out, none if not given: a beam, a fin, a pier, a sill. */
  readonly thin?: number;
}

/** A tile's level on the card: its slot, its bytes there, and where each chunk's faces start in its indices and how many indices they take. */
interface Held {
  readonly bytes: number;
  readonly first: Uint32Array;
  readonly count: Uint32Array;
  slot: number;
  /** The tile's count of changes to what stands when it was asked for, and whether it is to be made again for one since. */
  version: number;
  stale: boolean;
}

interface Tile {
  readonly t: number;
  /** Its chunks that have pieces, in the order its mesh holds them, and the box each one's pieces but a landmark's reach (CityStatics.reachOf). */
  readonly chunks: readonly number[];
  readonly boxes: Float64Array;
  /** The box its pieces stand in, in the world, and where its stored heights begin. */
  readonly box: Float64Array;
  readonly base: number;
  /** The level its nearest point asks for, kept a little past where it ends; -1 before it is first asked. */
  primary: number;
  /** Its levels on the card, by their form. */
  readonly held: (Held | null)[];
  /** Frames in a row it has been in view and reach with nothing made to draw. */
  unseen: number;
  /** The forms it wanted when last in reach, and those being made, a bit each. */
  wants: number;
  making: number;
  /** Counts of its lettings go and of the changes to what stands that its levels show, so a level asked for before one is known. */
  epoch: number;
  version: number;
  /** When what stands in it last changed, and first changed since its levels were last marked to be made again, or -1. */
  changedAt: number;
  changedFrom: number;
  /** The update in which the near store last let go of a chunk of it: levels that wait then are made again at once. */
  letGoAt: number;
  /** When it came into reach with nothing made, or -1. */
  entered: number;
  /** Where its levels go in this frame's order of making: lower first. */
  rank: number;
  /** The levels it last wanted through a sight, a bit each, and the update until which it keeps them (ZOOM_LINGER). */
  zoomed: number;
  zoomedUntil: number;
  /**
   * The reach it was last given in a sight's window, its zoom times the tier's as far as the view ends, and the update until
   * which it keeps it (D1088); and the reach it was drawn to last.
   */
  farReach: number;
  farUntil: number;
  shownReach: number;
}

/** A level asked of the maker, by its form, and its tile's counts then. */
interface Asked {
  readonly tile: number;
  readonly form: number;
  readonly epoch: number;
  readonly version: number;
}

export class FarCity {
  /** The pack mesh a draw names (far.ts FAR_MESH), and the bounds the tiles' vertices are stored within in place of its. */
  readonly mesh: number;
  private readonly bounds: { readonly center: readonly number[]; readonly half: readonly number[] };
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
  /** Tiles by their place on the map, null for one none of whose chunks has pieces held; and per chunk, its tile's place where it has pieces, else -1. */
  private readonly tiles: (Tile | null)[];
  private readonly tileOfChunk: Int32Array;
  /** The landmark kinds, and per chunk with any, a byte a piece: 1 for a landmark's, which no level holds. */
  private readonly landmark: Uint8Array;
  private readonly left = new Map<number, Uint8Array>();
  /** The statics' squares as last taken in (CityStatics.news). */
  private readonly seenSquares: Uint32Array;
  /** Tiles to make again from the squares set in or let go, taken in at the next update. */
  private readonly regrow = new Set<number>();
  /** Per chunk: which of its pieces are gone, as last seen near and as the far feed shows; and a count of changes to that. */
  private readonly gone = new Map<number, Uint8Array>();
  private readonly seenNear = new Map<number, Uint8Array>();
  private readonly seenShape: Int32Array;
  private readonly seenCells: Uint32Array;
  readonly goneVersion: Uint32Array;
  /** Changes to what stands over every chunk: the sum of `goneVersion`. */
  goneChanges = 0;
  /** Per kind, a wreck's break set and 0 for any other, where who made the city says: a wreck's lesser look still stands in its slot. */
  wreckSets: Uint16Array | null = null;
  /** Chunks matched against the near store's rows and still held whole, and the far feed's count of messages when last looked at. */
  private readonly whole = new Set<number>();
  private cellsSeen = 0;
  private readonly changed = new Set<number>();
  /** Per chunk: its list's count of changes when last looked at, and when its rows were last matched; and the lists' count of messages. */
  private readonly seenLists: Uint32Array;
  private readonly rowsAt: Uint32Array;
  private listsSeen = 0;
  /** The tiles whose levels wait to be made again for a change to what stands, and this update's time in milliseconds. */
  private readonly pending = new Set<number>();
  private now = 0;
  /** Per chunk, the far feed's top byte of each cell as its standing pieces give it, made when asked for. */
  private readonly tops = new Map<number, Uint8Array>();
  private levels: readonly CityLevel[] = [];
  /**
   * Every form levels have been drawn in, by what it is, and the form of each of this tier's levels: a tile holds its
   * levels by form, so other levels that share a form, of another tier or at other distances, remake nothing.
   */
  private readonly forms: LevelForm[] = [];
  private formOf: number[] = [];
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
  /** Slots of levels of a city before this one that it did not take over, let go at its first update. */
  private readonly dropping: number[] = [];
  private readonly arrived: CityMade[] = [];
  private readonly got: CityMade[] = [];
  /** The tiles that may be in reach: those within it and two tiles more of where the camera was when they were found. */
  private around: number[] = [];
  private readonly listed: Uint8Array;
  private readonly aroundAt = Float64Array.of(Infinity, Infinity, -1);
  /**
   * Per chunk of the tile being drawn, 1 where it is drawn far, its box from the camera, and at the level being drawn, the
   * depth ranges its faces are in or 0 for none, and 1 where it is in that level's fade.
   */
  private readonly far = new Uint8Array(CITY_TILE * CITY_TILE);
  private readonly from = new Float64Array(CITY_TILE * CITY_TILE * 6);
  private readonly kept = new Uint8Array(CITY_TILE * CITY_TILE);
  private readonly band = new Uint8Array(CITY_TILE * CITY_TILE);
  private readonly nearest = new Float64Array(CITY_TILE * CITY_TILE);
  /** Per tile, the `draw` that last looked at it and how it drew it: 0 not, 1 whole, 2 fading out at the reach (shows). */
  private readonly shownAt: Uint32Array;
  private readonly shownAs: Uint8Array;
  private drawCount = 0;

  /**
   * `bounds` is FAR_MESH's centre and half extent, as the pack has them. `landmark` is 1 by content index for a kind a
   * landmark brings. Its tiles follow the squares of the statics as they are set in and let go. `before` is the far city
   * of other statics, whose forms and slots it takes over, letting go of its levels at its first update.
   */
  constructor(source: CitySource, dims: MapDims, hf: Heightfield, mesh: number, bounds: { center: readonly number[]; half: readonly number[] }, landmark: Uint8Array = new Uint8Array(0), before: FarCity | null = null) {
    this.source = source;
    this.dims = dims;
    this.hf = hf;
    this.mesh = mesh;
    this.maker = source.maker ?? new InlineCityMaker();
    const across = TILE_METRES / 2 + LOCAL;
    this.bounds = { center: [across, bounds.center[1]!, across], half: [across, bounds.half[1]!, across] };
    this.maker.start(cityKinds(source.statics, hf, this.bounds));
    this.maker.onMade = () => this.feed();
    this.tilesX = Math.ceil(dims.chunksX / CITY_TILE);
    const chunks = chunkCount(dims);
    this.tileOfChunk = new Int32Array(chunks).fill(-1);
    this.seenShape = new Int32Array(chunks).fill(-1);
    this.seenCells = new Uint32Array(chunks);
    this.seenLists = new Uint32Array(chunks);
    this.rowsAt = new Uint32Array(chunks);
    this.goneVersion = new Uint32Array(chunks);
    this.landmark = landmark;
    const tiles = this.tilesX * Math.ceil(dims.chunksZ / CITY_TILE);
    this.tiles = Array.from({ length: tiles }, () => null);
    this.listed = new Uint8Array(tiles);
    this.shownAt = new Uint32Array(tiles);
    this.shownAs = new Uint8Array(tiles);
    this.seenSquares = new Uint32Array(source.statics.size);
    this.follow();
    for (const t of this.regrow) this.grow(t);
    this.regrow.clear();
    if (before) this.adopt(before);
  }

  /**
   * Takes over from `before` its forms, its next slot, and the levels of each tile whose chunks with pieces are the same in
   * both, which are made of the same pieces; its other levels go at this city's first update. Then a skyline shown goes on
   * being shown while the tiles that differ are made again.
   */
  private adopt(before: FarCity): void {
    this.forms.push(...before.forms);
    this.next = before.next;
    before.tiles.forEach((was, t) => {
      const tile = this.tiles[t];
      if (was && tile && was.chunks.length === tile.chunks.length && was.chunks.every((c, k) => c === tile.chunks[k])) {
        tile.held.push(...was.held);
        // Made of what stood for the city before: any change this one finds makes them again.
        for (const h of tile.held) if (h) h.version = -1;
        tile.primary = was.primary;
        return;
      }
      for (const h of was?.held ?? []) if (h && h.slot >= 0) this.dropping.push(h.slot);
    });
  }

  /** Notes the tiles of each square of the statics set in or let go since last, and lets go of what stood in one let go. */
  private follow(): void {
    this.source.statics.news(this.seenSquares, (sq: ChunkSquare, held: boolean) => {
      const x0 = Math.floor(sq.cx0 / CITY_TILE), x1 = Math.floor((sq.cx1 - 1) / CITY_TILE);
      const z0 = Math.floor(sq.cz0 / CITY_TILE), z1 = Math.floor((sq.cz1 - 1) / CITY_TILE);
      for (let tz = z0; tz <= z1; tz++) for (let tx = x0; tx <= x1; tx++) this.regrow.add(tz * this.tilesX + tx);
      for (let cz = sq.cz0; cz < sq.cz1; cz++) {
        for (let cx = sq.cx0; cx < sq.cx1; cx++) {
          const c = cz * this.dims.chunksX + cx;
          this.tops.delete(c);
          if (!held) this.seenShape[c] = -1;
          // Held again: what is known of its pieces gone is taken in again (`standing`).
          else this.seenLists[c] = this.seenCells[c] = 0xffffffff;
        }
      }
    });
  }

  /**
   * Makes tile `t` again of the chunks of it whose pieces are held, its levels on the card let go into `drops` where given:
   * a tile of no such chunk is none. A level asked for before is not taken.
   */
  private grow(t: number, drops: number[] | null = null): void {
    const was = this.tiles[t];
    if (was) {
      for (const h of was.held) if (h && h.slot >= 0) drops?.push(h.slot);
      for (const c of was.chunks) this.tileOfChunk[c] = -1;
      this.pending.delete(t);
    }
    const d = this.dims, city = this.source.statics;
    const cx0 = (t % this.tilesX) * CITY_TILE, cz0 = Math.floor(t / this.tilesX) * CITY_TILE;
    const list: number[] = [], boxes: number[] = [], one = this.reachBox;
    for (let cz = cz0; cz < Math.min(cz0 + CITY_TILE, d.chunksZ); cz++) {
      for (let cx = cx0; cx < Math.min(cx0 + CITY_TILE, d.chunksX); cx++) {
        const c = cz * d.chunksX + cx;
        const left = city.reachOf(c, this.landmark, one);
        if (left) this.left.set(c, left);
        else this.left.delete(c);
        if (!(one[0]! <= one[3]!)) continue;
        list.push(c);
        boxes.push(...one);
      }
    }
    if (list.length === 0) {
      this.tiles[t] = null;
      return;
    }
    const box = Float64Array.from([Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity]);
    for (let r = 0; r < list.length; r++) {
      for (let a = 0; a < 3; a++) {
        box[a] = Math.min(box[a]!, boxes[r * 6 + a]! - BELOW);
        box[a + 3] = Math.max(box[a + 3]!, boxes[r * 6 + a + 3]! + BELOW);
      }
    }
    const base = Math.floor(box[1]!);
    if (box[4]! - base > FAR_HEIGHT) throw new Error(`far city: the pieces of tile ${t} stand ${Math.round(box[4]! - base)} m tall, and a tile holds ${FAR_HEIGHT}`);
    for (const c of list) this.tileOfChunk[c] = t;
    this.tiles[t] = { t, chunks: list, boxes: Float64Array.from(boxes), box, base, primary: -1, held: [], unseen: 0, wants: 0, making: 0, epoch: (was?.epoch ?? 0) + 1, version: 0, changedAt: 0, changedFrom: -1, letGoAt: -1, entered: -1, rank: 0, zoomed: 0, zoomedUntil: 0, farReach: 0, farUntil: 0, shownReach: 0 };
  }

  /** Scratch: one chunk's reach. */
  private readonly reachBox = new Float64Array(6);

  /** Whether `chunk`'s statics are drawn here this frame, so the near store draws none of that chunk. */
  isFar(chunk: number): boolean {
    return this.on && this.tileOfChunk[chunk]! >= 0 && !this.source.complete(chunk);
  }

  /** After a lost context: every tile is made again, and the instance buffer goes on the card again. */
  reset(): void {
    for (const tile of this.tiles) if (tile) tile.held.length = 0;
    this.sent = false;
  }

  /** Which pieces of `chunk` are gone, or null for none. */
  goneOf(chunk: number): Gone {
    return this.gone.get(chunk) ?? null;
  }

  /** The far feed's top byte of each cell of `chunk` as its standing pieces give it, or null for a chunk with none. */
  topsOf(chunk: number): Uint8Array | null {
    if (this.source.statics.in(chunk) === 0) return null;
    let tops = this.tops.get(chunk);
    if (!tops) this.tops.set(chunk, (tops = cityTops(this.source.statics, chunk, this.hf, this.goneOf(chunk))));
    return tops;
  }

  /**
   * Brings what stands and the tiles within the tier's reach up to date and on the card, and lets go of those a tile
   * farther. `near` is the near store, `cells` the far feed and `lists` the pieces gone as the server tells them, for
   * what stands. `now` is the frame's time in milliseconds, which the waits are counted in. Uploads and drops go into the
   * packet, and what they weigh is spent and reserved in `budget`.
   */
  update(p: FramePacket, budget: { spend(bytes: number): void; reserve(name: string, bytes: number): void }, cam: Camera, levels: readonly CityLevel[], reach: number, share: number, near: StructureStore | null, cells: FarStore | null, lists: GoneStore | null = null, now = clock()): void {
    if (levels !== this.levels) {
      this.levels = levels;
      this.formOf = levels.map((l) => this.formNumber(l));
    }
    this.on = reach > 0 && levels.length > 0;
    this.share = share;
    this.updates++;
    for (const slot of this.dropping) p.assetDrops.push(slot);
    this.dropping.length = 0;
    this.now = now;
    this.follow();
    // Tiles made again are found again among those in reach.
    if (this.regrow.size > 0) this.aroundAt[2] = -1;
    for (const t of this.regrow) this.grow(t, p.assetDrops);
    this.regrow.clear();
    this.standing(near, cells, lists);
    this.settle(cam, now);
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
      const tile = this.tiles[n];
      if (!tile) continue;
      const off = this.off(tile, cam);
      const tileReach = this.reachOf(tile, cam, reach);
      if (!this.on || off > tileReach + TILE_METRES) {
        this.letGo(p, tile);
        continue;
      }
      if (off > tileReach) continue;
      // Through a sight a tile in its window wants the levels its distance over the zoom asks for (Camera.zoom, D1078),
      // its own as well, so the view is whole the moment the sight is lowered; and keeps them for ZOOM_LINGER.
      const tb = tile.box;
      const z = cam.zoom > 1 && cam.boxVisible(tb[0]! - cam.x, tb[1]! - cam.y, tb[2]! - cam.z, tb[3]! - cam.x, tb[4]! - cam.y, tb[5]! - cam.z) ? cam.zoom : 1;
      let bits = this.needed(tile, cam, off, share, z);
      if (z > 1) {
        tile.zoomed = bits;
        tile.zoomedUntil = this.updates + ZOOM_LINGER;
        bits |= this.needed(tile, cam, off, share, 1, false);
      } else if (this.updates < tile.zoomedUntil) bits |= tile.zoomed;
      const needed = (tile.wants = this.formsOf(bits));
      const any = tile.held.some((h) => h !== null);
      // A tile come into reach waits a moment for the lists of its pieces gone, so it is not made and then made again.
      if (!any && tile.entered < 0) tile.entered = now;
      const waits = !any && lists !== null && this.makeMs !== Infinity && now - tile.entered < FIRST_WAIT && !this.told(tile, lists);
      let short = false;
      for (let f = 0; f < this.forms.length; f++) {
        const h = tile.held[f];
        if ((needed & (1 << f)) === 0 || (h && !h.stale)) continue;
        short = true;
        lacking++;
        if ((tile.making & (1 << f)) === 0 && !waits) work.push(n * FORMS + f);
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
      for (let f = 0; f < tile.held.length; f++) {
        const h = tile.held[f];
        if (!h || (needed & (1 << f)) !== 0) continue;
        if (h.slot >= 0) p.assetDrops.push(h.slot);
        tile.held[f] = null;
      }
    }
    const tiles = this.tiles;
    // Of one tile's levels, the one its distance asks for first: it is the one drawn.
    const drawn = (w: number): number => (w % FORMS === this.formOf[tiles[Math.floor(w / FORMS)]!.primary] ? 0 : 1);
    work.sort((a, b) => tiles[Math.floor(a / FORMS)]!.rank - tiles[Math.floor(b / FORMS)]!.rank || drawn(a) - drawn(b));
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
    for (const n of this.around) for (const h of this.tiles[n]?.held ?? []) if (h) bytes += h.bytes;
    if (bytes > 0 && !this.sent) {
      p.uploads.push({ buffer: CITY_BUFFER, data: new Uint8Array(INSTANCE_BYTES), slots: new Uint16Array(1) });
      this.sent = true;
    }
    if (bytes !== this.bytes) budget.reserve(RESERVE, bytes);
    this.bytes = bytes;
  }

  /**
   * Calls `put` for each run of a tile's chunks drawn far, at each level of the tile drawn, where the tile is on the
   * card, within `reach` of the camera and in its view and not wholly behind what `hides` says hides a camera-relative
   * box: the level's slot, its first index and how many, where its stored origin is from the camera, the depth ranges its
   * faces are in, where it is gone (`drawFade`, below 0 to fade in, and 0 for a run wholly short of where the reach fades
   * and of any fade between levels, so its draw may take the program that never discards), and how far off its nearest is.
   */
  draw(cam: Camera, reach: number, put: (slot: number, firstIndex: number, indexCount: number, ox: number, oy: number, oz: number, passes: number, fade: number, near: number) => void, hider?: Hider): void {
    const levels = this.levels;
    const stats = this.stats;
    this.drawn.fill(0);
    stats.unseen = 0;
    stats.unseenAt = Infinity;
    stats.unseenFrames = 0;
    stats.coarse = 0;
    const { far, from, kept, band, nearest: nears } = this;
    this.drawCount++;
    for (const n of this.around) {
      const tile = this.tiles[n];
      if (!tile) continue;
      const cb = tile.boxes;
      // Each tile to its own reach: a sight's window's farther (reachOf).
      const tileReach = (tile.shownReach = this.reachNow(tile, reach));
      const whole = tileReach * (1 - this.share);
      const b = tile.box;
      const ax = b[0]! - cam.x;
      const ay = b[1]! - cam.y;
      const az = b[2]! - cam.z;
      const bx = b[3]! - cam.x;
      const by = b[4]! - cam.y;
      const bz = b[5]! - cam.z;
      const near = Math.hypot(Math.max(ax, -bx, 0), Math.max(ay, -by, 0), Math.max(az, -bz, 0));
      this.shownAt[n] = this.drawCount;
      this.shownAs[n] = near >= tileReach || !tile.held.some((h) => h !== null) ? 0 : Math.hypot(Math.max(-ax, bx), Math.max(-ay, by), Math.max(-az, bz)) < whole ? 1 : 2;
      if (near >= tileReach || !cam.boxVisible(ax - ACROSS, ay, az - ACROSS, bx + ACROSS, by, bz + ACROSS)) {
        tile.unseen = 0;
        continue;
      }
      // A tile's box and ACROSS round it hold every chunk's faces at every form: one test where it is hidden whole, and
      // its chunks tested one by one only where much of it is.
      const hidden = hider ? hider.share(ax - ACROSS, ay, az - ACROSS, bx + ACROSS, by, bz + ACROSS) : 0;
      if (hidden === 1 && hider!.hides(ax - ACROSS, ay, az - ACROSS, bx + ACROSS, by, bz + ACROSS)) {
        tile.unseen = 0;
        continue;
      }
      const hides = hidden >= WORTH ? hider : undefined;
      // A tile in view whose levels are none of them made yet, empty ones aside, is not drawn at all.
      if (!tile.held.some((h) => h !== null)) {
        stats.unseen++;
        stats.unseenAt = Math.min(stats.unseenAt, near);
        stats.unseenFrames = Math.max(stats.unseenFrames, ++tile.unseen);
        continue;
      }
      tile.unseen = 0;
      const drawn = this.chosen(tile, cam, near), other = this.other;
      if (this.coarser) stats.coarse++;
      // Each chunk drawn far, and its pieces' box from the camera.
      for (let r = 0; r < tile.chunks.length; r++) {
        const c = tile.chunks[r]!;
        far[r] = this.source.complete(c) ? 0 : 1;
        for (let a = 0; a < 6; a++) from[r * 6 + a] = cb[r * 6 + a]! - (a % 3 === 0 ? cam.x : a % 3 === 1 ? cam.y : cam.z);
      }
      const tx = this.cornerX(tile.t), tz = this.cornerZ(tile.t);
      const ox = tx - LOCAL - cam.x, oy = tile.base - cam.y, oz = tz - LOCAL - cam.z;
      const most = Math.hypot(Math.max(-ax, bx), Math.max(-ay, by), Math.max(-az, bz));
      const plain = most < whole ? 0 : tileReach;
      // Each level drawn, and last another tier's form drawn in their place.
      for (let k = 0; k <= levels.length; k++) {
        const l = k < levels.length ? k : -1;
        if (l >= 0 ? (drawn & (1 << l)) === 0 : other < 0) continue;
        const f = l >= 0 ? this.formOf[l]! : other;
        const h = tile.held[f];
        if (!h || h.slot < 0) continue;
        // The lattice fades out as the mass fades in where both are drawn, over the last share of the lattice's end, and
        // finer cells as coarser ones; else each is gone at the reach. Across a fade a chunk wholly past the end draws
        // none of the one and one wholly short of the fade none of the other, and a run of chunks none of which is in the
        // fade draws as if there were none.
        const out = l >= 0 && this.blends(l + 1) && (drawn & (1 << (l + 1))) !== 0;
        const into = l >= 0 && this.blends(l) && (drawn & (1 << (l - 1))) !== 0;
        const end = (out ? levels[l]!.to : into ? levels[l - 1]!.to : 0) * cam.zoom;
        const start = end * (1 - this.share);
        // Each chunk in view and the depth ranges its faces are in, a run being chunks alike in those: a box's faces stay
        // within it, and a cell's may lie a cell past it.
        const { cell, tall } = this.forms[f]!;
        const across = cell > 0 ? cell * Math.SQRT2 : 0;
        const up = cell > 0 ? tall : 0;
        for (let r = 0; r < tile.chunks.length; r++) {
          const o = r * 6;
          const x0 = from[o]! - across, y0 = from[o + 1]! - up, z0 = from[o + 2]! - across;
          const x1 = from[o + 3]! + across, y1 = from[o + 4]! + up, z1 = from[o + 5]! + across;
          const nearest = Math.hypot(Math.max(x0, -x1, 0), Math.max(y0, -y1, 0), Math.max(z0, -z1, 0));
          const farthest = Math.hypot(Math.max(-x0, x1), Math.max(-y0, y1), Math.max(-z0, z1));
          const left = far[r] === 0 || (out && nearest >= end) || (into && farthest < start) || !cam.boxVisible(x0, y0, z0, x1, y1, z1) || (hides !== undefined && hides.hides(x0, y0, z0, x1, y1, z1));
          kept[r] = left ? 0 : cam.passes(x0, y0, z0, x1, y1, z1);
          nears[r] = nearest;
          band[r] = (out || into) && farthest >= start && nearest < end ? 1 : 0;
        }
        const size = tile.chunks.length;
        let run = 0;
        let fading = band[0]!, near = nears[0]!;
        for (let r = 1; r <= size; r++) {
          if (r < size && kept[r] === kept[run]) {
            fading |= band[r]!;
            near = Math.min(near, nears[r]!);
            continue;
          }
          const first = h.first[run]!;
          const count = h.first[r - 1]! + h.count[r - 1]! - first;
          if (kept[run] !== 0 && count > 0) {
            put(h.slot, first, count, ox, oy, oz, kept[run]!, fading === 0 ? plain : out ? end : -end, near);
            if (l >= 0) this.drawn[l]! += count / 3;
          }
          run = r;
          fading = r < size ? band[r]! : 0;
          near = r < size ? nears[r]! : 0;
        }
      }
    }
  }

  /**
   * How `chunk`'s pieces were drawn in the last `draw`, for the city's blocks drawn where they are not (cityblocks.ts
   * Shown): -1 whole, the reach where its tile fades out at it, and 0 where its tile was not drawn, being past the reach
   * or having nothing made.
   */
  shows(chunk: number): number {
    const n = this.tileOfChunk[chunk]!;
    if (!this.on || n < 0 || this.shownAt[n] !== this.drawCount) return 0;
    return this.shownAs[n] === 1 ? -1 : this.shownAs[n] === 2 ? this.tiles[n]?.shownReach ?? 0 : 0;
  }

  /** The form drawn in place of this tier's levels by the last `chosen`, or -1; and whether it chose coarser than wanted. */
  private other = -1;
  private coarser = false;
  /** Calls of `update`, the clock ZOOM_LINGER counts in. */
  private updates = 0;
  /** Metres to the view's end, which the scene sets: as far as a tile in a sight's window may reach. */
  view = Infinity;
  /** The last update any tile keeps a sight's reach to: till then the tiles are found each update. */
  private farUntil = 0;

  /** `tile`'s reach, `reach` the tier's: in a sight's window its zoom times that, as far as the view ends, kept ZOOM_LINGER. */
  private reachOf(tile: Tile, cam: Camera, reach: number): number {
    if (cam.zoom > 1 && this.view > reach) {
      const b = tile.box;
      if (cam.boxVisible(b[0]! - cam.x, b[1]! - cam.y, b[2]! - cam.z, b[3]! - cam.x, b[4]! - cam.y, b[5]! - cam.z)) {
        tile.farReach = Math.min(this.view, reach * cam.zoom);
        tile.farUntil = this.updates + ZOOM_LINGER;
        this.farUntil = Math.max(this.farUntil, tile.farUntil);
      }
    }
    return this.reachNow(tile, reach);
  }

  /** The reach `tile` has now, as `reachOf` last gave it. */
  private reachNow(tile: Tile, reach: number): number {
    return this.updates < tile.farUntil ? Math.max(reach, tile.farReach) : reach;
  }

  /**
   * The levels `tile`, `near` metres off, is drawn at, a bit each: those wanted that are on the card; or, if none is yet,
   * the one on the card nearest the first wanted; or, if none of this tier's is, none, and `other` a form of another's.
   */
  private chosen(tile: Tile, cam: Camera, near: number): number {
    const levels = this.levels;
    const needed = this.needed(tile, cam, near, this.share, cam.zoom);
    let drawn = 0;
    for (let l = 0; l < levels.length; l++) if ((needed & (1 << l)) !== 0 && tile.held[this.formOf[l]!]) drawn |= 1 << l;
    this.other = -1;
    this.coarser = false;
    if (drawn === 0) {
      let best = -1;
      for (let l = 0; l < levels.length; l++) if (tile.held[this.formOf[l]!] && (best < 0 || Math.abs(l - tile.primary) < Math.abs(best - tile.primary))) best = l;
      if (best >= 0) drawn = 1 << best;
      else this.other = tile.held.findIndex((h) => h !== null);
      this.coarser = best > tile.primary || this.other >= 0;
    }
    return drawn;
  }

  /**
   * Whether `chunk`, drawn here, is drawn this frame by `draw` with this camera and reach at a form that holds each of
   * its standing pieces whole as the near store's meshes do (every box, nothing left out or bridged past a centimetre),
   * and wholly short of where the reach fades; or has nothing on the card at such a form to draw.
   */
  exactly(chunk: number, cam: Camera, reach: number): boolean {
    const n = this.tileOfChunk[chunk]!;
    if (!this.on || n < 0 || this.listed[n] !== 1 || this.source.complete(chunk)) return false;
    const tile = this.tiles[n]!, b = tile.box;
    const ax = b[0]! - cam.x, ay = b[1]! - cam.y, az = b[2]! - cam.z, bx = b[3]! - cam.x, by = b[4]! - cam.y, bz = b[5]! - cam.z;
    const near = Math.hypot(Math.max(ax, -bx, 0), Math.max(ay, -by, 0), Math.max(az, -bz, 0));
    if (near >= reach || Math.hypot(Math.max(-ax, bx), Math.max(-ay, by), Math.max(-az, bz)) >= reach * (1 - this.share) || !tile.held.some((h) => h !== null)) return false;
    const drawn = this.chosen(tile, cam, near);
    const exact = (f: number): boolean => {
      const { gap, least, cell, thin = 0 } = this.forms[f]!;
      return gap <= 0.01 && least === 0 && cell === 0 && thin === 0 && tile.held[f] !== null && tile.held[f] !== undefined;
    };
    for (let l = 0; l < this.levels.length; l++) if ((drawn & (1 << l)) !== 0 && exact(this.formOf[l]!)) return true;
    return this.other >= 0 && exact(this.other);
  }

  /** Whether level `l` fades in as the one before it fades out: cells after boxes, or after cells of another size. */
  private blends(l: number): boolean {
    const levels = this.levels;
    return l > 0 && l < levels.length && levels[l]!.cell > 0 && levels[l]!.cell !== levels[l - 1]!.cell;
  }

  /**
   * The levels `tile`, `off` metres away, wants on the card, a bit each: the one its nearest point asks for, and across
   * a fade between the lattice and the mass, both.
   */
  private needed(tile: Tile, cam: Camera, off: number, share: number, zoom = 1, keep = true): number {
    const levels = this.levels;
    // Through a sight `zoom` times, a tile is chosen for as if it stood that many times nearer (D1078).
    const at = off / zoom;
    let l = levels.length - 1;
    for (let k = 0; k < levels.length - 1; k++) {
      const end = levels[k]!.to * (k === tile.primary ? HYSTERESIS : k < tile.primary ? 1 / HYSTERESIS : 1);
      if (at < end) {
        l = k;
        break;
      }
    }
    if (keep) tile.primary = l;
    let bits = 1 << l;
    const b = tile.box;
    const most = Math.hypot(Math.max(cam.x - b[0]!, b[3]! - cam.x), Math.max(cam.y - b[1]!, b[4]! - cam.y), Math.max(cam.z - b[2]!, b[5]! - cam.z)) / zoom;
    if (this.blends(l + 1) && most > levels[l]!.to * (1 - share)) bits |= 1 << (l + 1);
    if (this.blends(l) && at < levels[l - 1]!.to) bits |= 1 << (l - 1);
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
    // Through a sight, or while a tile keeps a sight's reach, they are found each update: the window turns as the camera does.
    const sighted = cam.zoom > 1 && this.view > reach;
    if (!sighted && this.updates >= this.farUntil && reach === at[2] && Math.hypot(cam.x - at[0], cam.z - at[1]) < TILE_METRES) return this.around;
    at[0] = cam.x;
    at[1] = cam.z;
    at[2] = sighted || this.updates < this.farUntil ? NaN : reach;
    const most = sighted ? Math.min(this.view, reach * cam.zoom) : reach;
    const list: number[] = [];
    for (let n = 0; n < this.tiles.length; n++) {
      const tile = this.tiles[n];
      if (!tile) continue;
      const b = tile.box;
      const off = Math.hypot(Math.max(b[0]! - cam.x, cam.x - b[3]!, 0), Math.max(b[2]! - cam.z, cam.z - b[5]!, 0));
      const windowed = sighted && off <= most + TILE_METRES && cam.boxVisible(b[0]! - cam.x, b[1]! - cam.y, b[2]! - cam.z, b[3]! - cam.x, b[4]! - cam.y, b[5]! - cam.z);
      if (off > reach + 2 * TILE_METRES && !windowed && !(this.updates < tile.farUntil && off <= tile.farReach + 2 * TILE_METRES)) continue;
      list.push(n);
      this.listed[n] = 2;
    }
    for (const n of this.around) {
      if (this.listed[n] === 2) continue;
      const tile = this.tiles[n];
      if (tile) this.letGo(p, tile);
      this.listed[n] = 0;
    }
    for (const n of list) this.listed[n] = 1;
    return (this.around = list);
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
    tile.entered = -1;
    tile.epoch++;
  }

  /** Whether the server has told of the pieces gone in any chunk of `tile`. */
  private told(tile: Tile, lists: GoneStore): boolean {
    for (const c of tile.chunks) if (lists.lists.has(c)) return true;
    return false;
  }

  /**
   * Marks the levels of each tile whose standing pieces changed to be made again, once the tile has gone quiet or has
   * waited its longest. Where every level wanted is made in its frame (`makeMs` Infinity) none waits.
   */
  private settle(cam: Camera, now: number): void {
    for (const n of this.pending) {
      const tile = this.tiles[n];
      if (!tile) {
        this.pending.delete(n);
        continue;
      }
      if (this.makeMs !== Infinity && tile.letGoAt !== this.updates) {
        const near = this.off(tile, cam) < QUIET_WITHIN;
        if (now - tile.changedAt < (near ? QUIET_NEAR : QUIET_FAR) && now - tile.changedFrom < (near ? WAIT_NEAR : WAIT_FAR)) continue;
      }
      this.pending.delete(n);
      tile.changedFrom = -1;
      for (const h of tile.held) if (h && h.version !== tile.version) h.stale = true;
    }
  }

  /** Asks the maker for this frame's level `w` (a tile times FORMS plus a form). */
  private post(w: number): void {
    const n = Math.floor(w / FORMS);
    const form = w % FORMS;
    const tile = this.tiles[n]!;
    const id = levelsAsked++;
    this.asked.set(id, { tile: n, form, epoch: tile.epoch, version: tile.version });
    tile.making |= 1 << form;
    this.out++;
    this.maker.make(cityJob(id, this.source.statics, this.hf, (c) => this.leftOut(c), tile.chunks, this.forms[form]!, this.cornerX(tile.t) - LOCAL, tile.base, this.cornerZ(tile.t) - LOCAL));
  }

  /** The number of `form` among the forms levels are drawn in, given one if it has none. */
  private formNumber(form: LevelForm): number {
    const { gap, least, cell, tall, thin = 0 } = form;
    const known = this.forms.findIndex((f) => f.gap === gap && f.least === least && f.cell === cell && f.tall === tall && f.thin === thin);
    if (known >= 0) return known;
    if (this.forms.length === FORMS) throw new Error(`far city: levels in more than ${FORMS} forms`);
    return this.forms.push({ gap, least, cell, tall, thin }) - 1;
  }

  /** The forms of the levels `levels` names, a bit each. */
  private formsOf(levels: number): number {
    let forms = 0;
    for (let l = 0; l < this.formOf.length; l++) if ((levels & (1 << l)) !== 0) forms |= 1 << this.formOf[l]!;
    return forms;
  }

  /** Which pieces of `chunk` no level holds: those gone, and a landmark's. */
  private leftOut(chunk: number): Gone {
    const gone = this.gone.get(chunk) ?? null, left = this.left.get(chunk);
    return !left ? gone : !gone ? left : left.map((l, i) => l | gone[i]!);
  }

  /** Keeps a worker making a few levels ahead, in this frame's order: in update, and as each level comes back. */
  private feed(): void {
    const start = clock();
    this.collect();
    while (this.out < (this.maker.flights ?? FLIGHTS) && this.fed < this.work.length) this.post(this.work[this.fed++]!);
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
      const tile = this.tiles[a.tile];
      if (!tile || a.epoch !== tile.epoch) continue;
      const bit = 1 << a.form;
      tile.making &= ~bit;
      if ((tile.wants & bit) === 0) continue;
      const old = tile.held[a.form];
      if (old && old.slot >= 0) p.assetDrops.push(old.slot);
      // A level with no faces is made but never on the card.
      let slot = EMPTY;
      if (made.data.length > 0) {
        slot = CITY_SLOTS + this.next;
        this.next = (this.next + 1) % CITY_SLOT_SPAN;
        p.assetUploads.push({ slot, mesh: this.mesh, level: 0, data: made.data, indexCount: made.first.at(-1)! + made.count.at(-1)!, indexBytes: made.indexBytes, quads: true, bounds: this.bounds });
        budget.spend(made.data.length);
      }
      // One asked for before a change the tile still waits on is drawn until the wait ends, and is made again then.
      tile.held[a.form] = { bytes: made.data.length, first: made.first, count: made.count, slot, version: a.version, stale: a.version !== tile.version && tile.changedFrom < 0 };
      n++;
    }
    this.arrived.length = 0;
    return n;
  }

  /** Brings what stands up to date: chunks the near store holds whole, and of the rest the lists of pieces gone and the far feed's cells. */
  private standing(near: StructureStore | null, cells: FarStore | null, lists: GoneStore | null): void {
    const city = this.source.statics;
    const changed = this.changed;
    changed.clear();
    // A chunk let go and held again is matched again, whatever its table's count of changes says.
    for (const c of this.whole) {
      if (this.source.complete(c)) continue;
      this.seenShape[c] = -1;
      this.whole.delete(c);
      // A list told since its rows were last matched now says more than they do.
      if (lists && (lists.changed[c] ?? 0) !== this.rowsAt[c]) changed.add(c);
      // It is drawn from its tile's levels from this frame on, so they do not wait to leave out what went while it was near.
      const n = this.tileOfChunk[c]!;
      const tile = n >= 0 ? this.tiles[n] : null;
      if (tile) tile.letGoAt = this.updates;
    }
    // The chunks the near store has a table for, not every chunk of the map.
    for (const c of near?.held ?? []) {
      const table = near!.chunks[c];
      if (!table || table.shape === this.seenShape[c] || city.in(c) === 0 || !this.source.complete(c)) continue;
      this.seenShape[c] = table.shape;
      this.whole.add(c);
      const g = new Uint8Array(city.in(c));
      goneByRows(city, c, table, g);
      this.salvaged(c, table, g);
      this.seenNear.set(c, g);
      this.rowsAt[c] = lists?.changed[c] ?? 0;
      changed.add(c);
    }
    if (cells && cells.version !== this.cellsSeen) {
      this.cellsSeen = cells.version;
      for (let c = 0; c < cells.changed.length; c++) {
        if (cells.changed[c] === this.seenCells[c] || city.in(c) === 0) continue;
        this.seenCells[c] = cells.changed[c]!;
        changed.add(c);
      }
    }
    if (lists && lists.version !== this.listsSeen) {
      this.listsSeen = lists.version;
      // A list of a chunk whose statics have not come is looked at again when a city is made of them.
      for (const c of lists.lists.keys()) {
        if (lists.changed[c] === this.seenLists[c] || city.in(c) === 0) continue;
        this.seenLists[c] = lists.changed[c]!;
        changed.add(c);
      }
    }
    for (const c of changed) this.setGone(c, this.goneNow(c, cells, lists));
  }

  /**
   * Unmarks in `gone` each wreck of `chunk` whose slot of `table` holds a lesser look of it. Salvaged a rung it stands
   * where the map set it, so a rung makes no far layer again; cut up, its slot is empty and it is gone.
   */
  private salvaged(chunk: number, table: { readonly high: number; readonly kind: Uint16Array; readonly x: Float32Array; readonly z: Float32Array }, gone: Uint8Array): void {
    const sets = this.wreckSets, t = this.source.statics.rows(chunk), first = t?.from(chunk) ?? 0;
    for (let s = 0; t && sets && s < gone.length && s < table.high; s++) {
      const set = gone[s] === 1 ? sets[t.kind[first + s]!]! : 0;
      if (set !== 0 && sets[table.kind[s]!] === set && table.x[s] === t.x[first + s] && table.z[s] === t.z[first + s]) gone[s] = 0;
    }
  }

  /**
   * Which pieces of `chunk` are gone by what is known of it, the most trusted first: its rows, while the near store holds
   * it whole and after that until a list is told; then its list, whose slot `s` is the chunk's `s`-th piece; then, with
   * no list, the far feed's tops where they count the map's pieces.
   */
  private goneNow(chunk: number, cells: FarStore | null, lists: GoneStore | null): Uint8Array {
    const city = this.source.statics;
    const rows = this.seenNear.get(chunk);
    const list = lists?.lists.get(chunk);
    const held = this.source.complete(chunk);
    if (rows && (held || (list && this.rowsAt[chunk] === lists!.changed[chunk]))) return rows.slice();
    const g = (!list && rows?.slice()) || new Uint8Array(city.in(chunk));
    if (list) {
      for (let i = 0; i < list.length && list[i]! < g.length; i++) g[list[i]!] = 1;
      return g;
    }
    // Cells told since the chunk was last held whole say more; a chunk sent empty has none of its pieces left.
    if (!held && cells && cells.full[chunk] === 1) goneByCells(city, chunk, this.hf, cells.chunks.get(chunk)?.top ?? new Uint8Array(256), g);
    return g;
  }

  /**
   * Says which pieces of `chunk` are gone, at once for whoever asks, and notes that what was made of it and its neighbours,
   * whose faces it held, is to be made again once their tiles have gone quiet (`settle`).
   */
  private setGone(chunk: number, gone: Uint8Array): void {
    const was = this.gone.get(chunk);
    const none = !gone.includes(1);
    if (none ? !was : was && was.every((g, i) => g === gone[i])) return;
    if (none) this.gone.delete(chunk);
    else this.gone.set(chunk, gone);
    this.tops.delete(chunk);
    this.goneVersion[chunk]!++;
    this.goneChanges++;
    const cx = chunk % this.dims.chunksX;
    const cz = Math.floor(chunk / this.dims.chunksX);
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (cx + dx < 0 || cz + dz < 0 || cx + dx >= this.dims.chunksX || cz + dz >= this.dims.chunksZ) continue;
        const n = this.tileOfChunk[(cz + dz) * this.dims.chunksX + cx + dx]!;
        const tile = n >= 0 ? this.tiles[n] : null;
        if (!tile) continue;
        tile.version++;
        tile.changedAt = this.now;
        if (tile.changedFrom < 0) tile.changedFrom = this.now;
        this.pending.add(n);
      }
    }
  }
}
