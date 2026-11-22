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
// is let go. Past that, the far feed's cells (farcells.ts) show a piece gone when its top stands over the top sent for a
// cell it fills. A piece gone either way is left out of every level of its chunk. What stands is followed for a
// landmark's pieces too, so the far blocks leave their cells alone.

import { CHUNK_SIZE, chunkCount, type MapDims } from "../../../shared/coords.ts";
import { INSTANCE_BYTES } from "../../../shared/pack/pack.ts";
import { cityReach, cityTops, goneByCells, goneByRows, type CityStatics, type Gone } from "../../../shared/world/city.ts";
import type { Heightfield } from "../../../shared/world/heightfield.ts";
import type { StructureStore } from "../../../shared/world/structures.ts";
import type { FarStore } from "../farcells.ts";
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
  /** Where its levels go in this frame's order of making: lower first. */
  rank: number;
  /** The levels it last wanted through a sight, a bit each, and the update until which it keeps them (ZOOM_LINGER). */
  zoomed: number;
  zoomedUntil: number;
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
  private readonly tiles: Tile[] = [];
  private readonly tileOfChunk: Int32Array;
  /** Per chunk with any, a byte a piece: 1 for a landmark's, which no level holds. */
  private readonly left: ReadonlyMap<number, Uint8Array>;
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
   * Per chunk, the box its pieces but a landmark's reach, which its boxes' faces do not leave (shared/world/city.ts
   * chunkReach); and per chunk of the tile being drawn, 1 where it is drawn far, its box from the camera, and at the
   * level being drawn, the depth ranges its faces are in or 0 for none, and 1 where it is in that level's fade.
   */
  private readonly chunkBox: Float64Array;
  private readonly far = new Uint8Array(CITY_TILE * CITY_TILE);
  private readonly from = new Float64Array(CITY_TILE * CITY_TILE * 6);
  private readonly kept = new Uint8Array(CITY_TILE * CITY_TILE);
  private readonly band = new Uint8Array(CITY_TILE * CITY_TILE);
  private readonly nearest = new Float64Array(CITY_TILE * CITY_TILE);
  /** Per tile, the `draw` that last looked at it and how it drew it: 0 not, 1 whole, 2 fading out at the reach (shows). */
  private readonly shownAt: Uint32Array;
  private readonly shownAs: Uint8Array;
  private drawCount = 0;
  private shownReach = 0;

  /**
   * `bounds` is FAR_MESH's centre and half extent, as the pack has them. `landmark` is 1 by content index for a kind a
   * landmark brings. `before` is the far city of statics handed over before these, whose levels it takes over (`adopt`).
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
    this.goneVersion = new Uint32Array(chunks);
    ({ reach: this.chunkBox, landmarks: this.left } = cityReach(source.statics, landmark));
    const cb = this.chunkBox;
    const byTile = new Map<number, number[]>();
    for (let c = 0; c < chunks; c++) {
      if (!(cb[c * 6]! <= cb[c * 6 + 3]!)) continue;
      const t = this.tileOf(c);
      byTile.set(t, [...(byTile.get(t) ?? []), c]);
    }
    for (const t of byTile.keys()) {
      const list = byTile.get(t)!;
      const box = Float64Array.from([Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity]);
      for (const c of list) {
        for (let a = 0; a < 3; a++) {
          box[a] = Math.min(box[a]!, cb[c * 6 + a]! - BELOW);
          box[a + 3] = Math.max(box[a + 3]!, cb[c * 6 + a + 3]! + BELOW);
        }
      }
      const base = Math.floor(box[1]!);
      if (box[4]! - base > FAR_HEIGHT) throw new Error(`far city: the pieces of tile ${t} stand ${Math.round(box[4]! - base)} m tall, and a tile holds ${FAR_HEIGHT}`);
      for (const c of list) this.tileOfChunk[c] = this.tiles.length;
      this.tiles.push({ t, chunks: list, box, base, primary: -1, held: [], unseen: 0, wants: 0, making: 0, epoch: 0, version: 0, rank: 0, zoomed: 0, zoomedUntil: 0 });
    }
    this.listed = new Uint8Array(this.tiles.length);
    this.shownAt = new Uint32Array(this.tiles.length);
    this.shownAs = new Uint8Array(this.tiles.length);
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
    const old = new Map(before.tiles.map((tile) => [tile.t, tile]));
    for (const tile of this.tiles) {
      const was = old.get(tile.t);
      if (!was || was.chunks.length !== tile.chunks.length || was.chunks.some((c, k) => c !== tile.chunks[k])) continue;
      tile.held.push(...was.held);
      tile.primary = was.primary;
      old.delete(tile.t);
    }
    for (const was of old.values()) for (const h of was.held) if (h && h.slot >= 0) this.dropping.push(h.slot);
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
    if (this.source.statics.in(chunk) === 0) return null;
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
      this.levels = levels;
      this.formOf = levels.map((l) => this.formNumber(l));
    }
    this.on = reach > 0 && levels.length > 0;
    this.share = share;
    this.updates++;
    for (const slot of this.dropping) p.assetDrops.push(slot);
    this.dropping.length = 0;
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
      let short = false;
      for (let f = 0; f < this.forms.length; f++) {
        const h = tile.held[f];
        if ((needed & (1 << f)) === 0 || (h && !h.stale)) continue;
        short = true;
        lacking++;
        if ((tile.making & (1 << f)) === 0) work.push(n * FORMS + f);
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
    work.sort((a, b) => tiles[Math.floor(a / FORMS)]!.rank - tiles[Math.floor(b / FORMS)]!.rank);
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
    const whole = reach * (1 - this.share);
    const { chunkBox: cb, far, from, kept, band, nearest: nears } = this;
    this.drawCount++;
    this.shownReach = reach;
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
      this.shownAt[n] = this.drawCount;
      this.shownAs[n] = near >= reach || !tile.held.some((h) => h !== null) ? 0 : Math.hypot(Math.max(-ax, bx), Math.max(-ay, by), Math.max(-az, bz)) < whole ? 1 : 2;
      if (near >= reach || !cam.boxVisible(ax - ACROSS, ay, az - ACROSS, bx + ACROSS, by, bz + ACROSS)) {
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
        for (let a = 0; a < 6; a++) from[r * 6 + a] = cb[c * 6 + a]! - (a % 3 === 0 ? cam.x : a % 3 === 1 ? cam.y : cam.z);
      }
      const tx = this.cornerX(tile.t), tz = this.cornerZ(tile.t);
      const ox = tx - LOCAL - cam.x, oy = tile.base - cam.y, oz = tz - LOCAL - cam.z;
      const most = Math.hypot(Math.max(-ax, bx), Math.max(-ay, by), Math.max(-az, bz));
      const plain = most < whole ? 0 : reach;
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
    return this.shownAs[n] === 1 ? -1 : this.shownAs[n] === 2 ? this.shownReach : 0;
  }

  /** The form drawn in place of this tier's levels by the last `chosen`, or -1; and whether it chose coarser than wanted. */
  private other = -1;
  private coarser = false;
  /** Calls of `update`, the clock ZOOM_LINGER counts in. */
  private updates = 0;

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
      const tile = this.tiles[a.tile]!;
      if (a.epoch !== tile.epoch) continue;
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
      tile.held[a.form] = { bytes: made.data.length, first: made.first, count: made.count, slot, stale: a.version !== tile.version };
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
    // The chunks the near store has a table for, not every chunk of the map.
    for (const c of near?.held ?? []) {
      const table = near!.chunks[c];
      if (!table || table.shape === this.seenShape[c] || city.in(c) === 0 || !this.source.complete(c)) continue;
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
        if (cells.changed[c] === this.seenCells[c] || city.in(c) === 0) continue;
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
