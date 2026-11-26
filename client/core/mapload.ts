// A map as the page takes it in parts (shared/world/mapfile.ts). Its head holds the whole map at every chunk's corner,
// its ground, its sea and its lakes, which stands in for each overview until it comes, as an overview's ground stands in
// for each sector's (shared/world/heightfield.ts). Before anything is drawn: the head and its landmarks' definitions,
// which the welcome's registry holds. Then the ground of the sectors within reach of the body and the overviews they lie
// in, which the first frame waits for and which come alone (firstFrameParts says which, for the loader and for the map's
// build). Then, while the game is played, the parts the page wants (map-want.ts) from where the body is and is heading,
// the camera, a sight's focus and the map screen, looked at again each LOOK_EVERY ms and as parts come, nearest first:
// the overviews, ground and statics within RING and the statics a chunk the server sent waits for, then the overviews
// within the statics reach, then its sectors, then the rest, each sector's ground before its statics; URGENT_AT_ONCE at
// once while what is urgent is wanted, AFTER_AT_ONCE otherwise. A part no longer wanted is let go a sector past its reach,
// but statics of a sector the session still holds chunks of; statics and ground pages past their budgets farthest first,
// but ground round the body, the camera and a focus; an overview a band at a time. Each sector's statics are a table of their own (map-statics.ts), which the city follows. Whenever those held
// change and every overview, ground and statics part within the statics reach of the body has come, the statics are
// handed over: to a tool, a copy of them all, a step at a time. A sector asked for once (HeldStatics.once) comes after
// what is urgent and is handed to who asked, not kept unless it is wanted. The city's tops come with the
// overviews past that reach once the statics have first been handed over, each square's after its overview, and nothing
// waits for them; nor for a sector's buildings, which come after its statics. A part that fails is asked for again after
// a wait that grows to a cap, for as long as the page lives, and what has come is kept. One that comes damaged or as
// another's is refused by name and asked for again, until the DAMAGED_MOST-th time breaks the map; a sector's statics
// broken so are never asked for again, and their pieces are left out (session.ts).

import { CHUNK_SIZE, SECTOR_CHUNKS, chunkCount } from "../../shared/coords.ts";
import type { Def } from "../../shared/content/defs.ts";
import { Buildings } from "../../shared/world/buildings.ts";
import { TERRAIN_CELL } from "../../shared/world/heightfield.ts";
import { OVERVIEW_CHUNKS, listedRows, partHash, partSteps, readHead, readPart, squareOf, type GroundPiece, type MapContent, type MapHead, type MapPart, type MapPiece, type MapStatics, type NodeLayer, type StaticsPiece } from "../../shared/world/mapfile.ts";
import { HeldWater } from "./ground/held-water.ts";
import { Overviews } from "./ground/overviews.ts";
import { GroundPages, pageBytes, type Chunks } from "./ground/pages.ts";
import { MapWater } from "../../shared/world/water.ts";
import { DEFAULT_TIER, tierOf } from "./assets/tiers.ts";
import { fetchBytes, within, type Get } from "./fetched.ts";
import { HeldTops } from "./render/blocks.ts";
import { everywhere, firstFrameParts, overviewOf, partDistance, squareKey } from "./map-first.ts";
export { FIRST_REACH, firstFrameParts } from "./map-first.ts";
import { HeldStatics } from "./map-statics.ts";
import { KEEP_PAST, PartBoxes, ROAD_REACH, Wanted, centresOf, tierWant, type WantFrom } from "./map-want.ts";
export { ROAD_REACH } from "./map-want.ts";
import { holdRoad, holdStreets } from "../../shared/world/mapfile.ts";
import { RoadSectors } from "../../shared/world/roadframe.ts";
import { StreetSectors } from "../../shared/world/streets.ts";

/**
 * Parts asked for at once before the first frame: as many as a browser opens to a host over HTTP/1.1, so that on a link of
 * 100 ms a request one part's round trip is mostly hidden by the others' bytes.
 */
export const PARTS_AT_ONCE = 6;
/**
 * Parts asked for at once while the game is played: while the nearest part left is urgent (MapLoader.urgent), and
 * otherwise. Fewer than a browser's six connections to a host, so the art always has some.
 */
export const URGENT_AT_ONCE = 4;
export const AFTER_AT_ONCE = 2;
/** Metres round the body, and round where it will be LEAD seconds on, whose ground and statics are urgent once the game is played. */
export const RING = 600;
/** Seconds of the body's way ahead of it whose ground is asked for as if the body were there. */
export const LEAD = 2;
/** Milliseconds between two looks at which parts are wanted, and at which road parts are. */
export const LOOK_EVERY = 1000;
export const ROAD_EVERY = 1000;
/** Road and streets parts asked for at once, besides the rest of the map's. */
export const ROADS_AT_ONCE = 2;
/** Milliseconds before a part that failed is asked for again: RETRY_FIRST, doubled at each failure in a row, to RETRY_MOST. */
export const RETRY_FIRST = 500;
export const RETRY_MOST = 8000;
/** Times a part may come damaged or as another's before the map is taken as broken. */
export const DAMAGED_MOST = 3;
/** Failures in a row of one part, after the first frame, at which the player is told; and again each time they double. */
export const TELL_AFTER = 3;
/** Chunk rows of an overview filled between two pauses: a sixteenth of its 4.2 M samples. */
export const BAND_CHUNKS = 4;

/** The wait after a part's `fails`-th failure in a row, in milliseconds. */
export const retryWait = (fails: number): number => Math.min(RETRY_MOST, RETRY_FIRST * 2 ** Math.min(16, fails - 1));

/** Where a body is and how fast it goes, in metres and metres a second. */
export interface Place {
  readonly x: number;
  readonly z: number;
  readonly vx: number;
  readonly vz: number;
}

/**
 * Every part but the tops, the roads' frame, the streets' lines and the buildings: what a page that held the whole map's
 * statics on exact ground fetched first (tools/map/trip.ts).
 */
export function handOverParts(head: MapHead): MapPart[] {
  return head.parts.filter((p) => p.kind !== "tops" && p.kind !== "road" && p.kind !== "streets" && p.kind !== "buildings");
}

/**
 * A map as a client holds it while its parts come: its ground, in which a sample of a sector not held is its overview's,
 * and one of an overview not held the head's coarse picture's; its node layers, its water, its landmarks and its city's
 * tops. A sector's ground waits until its overview has come, and is then a page of the ground (ground/pages.ts); of a
 * listed node layer's rows, only those are kept. Overviews and pages come and go as the loader wants them.
 */
export class StagedMap {
  readonly head: MapHead;
  readonly hf: GroundPages;
  /** The overviews held: their every fourth sample, node pictures and bits (ground/overviews.ts). */
  readonly overviews: Overviews;
  readonly nodes: NodeLayer[];
  /** The city's tops as their parts come. */
  readonly tops: HeldTops;
  /** The map's buildings, each sector's set in as its part comes; null where the map has none. */
  readonly buildings: Buildings | null;
  /** The landmarks the head places and the definitions the land part adds, or undefined where the head has none. */
  content: MapContent | undefined;
  /** The water as its overviews come and go, an overview's square at a time; null where the head has none. */
  readonly waters: HeldWater | null;
  /** Each sector's come so far that has rows of a listed node layer: those rows, and none of its ground. */
  private readonly listed: GroundPiece[] = [];
  /** The overviews' squares held, and the sectors' grounds come before their overview, by its square. */
  private readonly came = new Set<number>();
  private readonly early = new Map<number, GroundPiece[]>();
  /**
   * Per chunk, 1 once its bound (Heightfield `bounds`) is its own samples' range, its overview's or its sector's: every
   * sample it will hold is the map's own or between two of its own, so that bound stands.
   */
  private readonly sure: Uint8Array;

  constructor(head: MapHead) {
    this.head = head;
    const { dims } = head;
    // A page holds the ground's classes a wheel feels, so the page's own car grips as the server's does (D811). Where no
    // page is held its cells read as plain ground, where no body is predicted (D756).
    this.overviews = new Overviews(head);
    this.hf = new GroundPages(dims, head.minY, head.stepY, this.overviews);
    this.hf.seaLevel = head.seaLevel;
    // Every sector with streets is listed from the start, so a car is predicted only where its own are held (session.ts).
    for (const p of head.parts) {
      if (p.kind !== "streets") continue;
      const sq = squareOf(dims, SECTOR_CHUNKS, p.col, p.row)!;
      (this.hf.streets ??= new StreetSectors()).list(squareKey(p.col, p.row), sq.cx0, sq.cz0, sq.cx1, sq.cz1);
    }
    // Every sample stands in with the coarse picture's from the start.
    this.hf.standing(0, 0, dims.chunksX, dims.chunksZ);
    this.hf.bounds = coarseBounds(head);
    this.sure = new Uint8Array(chunkCount(dims));
    // No node stands until its chunk's overview says which do, so none stands on the coarse ground.
    this.nodes = this.overviews.layers();
    this.tops = new HeldTops(dims);
    this.buildings = head.buildings ? new Buildings(dims, head.buildings) : null;
    this.content = head.landmarks ? { landmarks: head.landmarks, defs: [] } : undefined;
    this.waters = head.water ? new HeldWater(head, coarseWater(head)) : null;
    if (this.waters) this.hf.water = this.waters.water;
  }

  /** Takes in a part read: the land's definitions, an overview's ground, node pictures and water, a sector's ground and its listed nodes, a square's tops, or a sector's buildings. */
  take(piece: MapPiece): void {
    const steps = this.steps(piece);
    while (!steps.next().done);
  }

  /** `take` a step at a time: an overview's water at once, its ground and bounds BAND_CHUNKS chunk rows a step, and its nodes at the last. */
  *steps(piece: MapPiece): Generator<void, void> {
    const { dims } = this.head;
    if (piece.kind === "land") {
      if (this.content) this.content = { landmarks: this.content.landmarks, defs: piece.defs as Def[] };
    } else if (piece.kind === "overview") {
      const sq = piece.sq, w = sq.cx1 - sq.cx0;
      // Its water first, so each band's change carries it to the lakes, as a release lets its water go before its bands.
      if (piece.water && this.waters) this.hf.water = takeWater(this.waters, piece.sq, piece.water);
      // Its samples stand in a band at a time, each a change to the ground taken with its chunks' own bounds.
      const block = this.overviews.begin(piece);
      for (let z = sq.cz0; z < sq.cz1; z += BAND_CHUNKS) {
        const z1 = Math.min(sq.cz1, z + BAND_CHUNKS);
        for (let k = (z - sq.cz0) * w; k < (z1 - sq.cz0) * w; k++) this.bound(sq.cx0 + (k % w), sq.cz0 + Math.floor(k / w), piece.low[k]!, piece.high[k]!);
        block.to = z1;
        this.hf.standing(sq.cx0, z, sq.cx1, z1);
        if (z1 < sq.cz1) yield;
        if (!this.overviews.holds(block)) return;
      }
      block.nodes = true;
      this.overviews.version++;
      const key = squareKey(sq.col, sq.row);
      this.came.add(key);
      for (const g of this.early.get(key) ?? []) this.take(g);
      this.early.delete(key);
    } else if (piece.kind === "ground") {
      const under = overviewOf(piece.sq);
      if (!this.came.has(under)) {
        this.early.set(under, [...(this.early.get(under) ?? []), piece]);
        return;
      }
      this.hf.put(piece);
      this.measureSector(piece);
      if (piece.listed.every((rows) => rows === null)) return;
      this.listed.push({ kind: "ground", sq: piece.sq, heights: NO_HEIGHTS, tint: NO_TINT, ground: NO_TINT, listed: piece.listed });
      // Listed layer k's rows from the sectors come so far, set in the layer the node source reads.
      this.head.layers.forEach((rule, k) => rule.type === 1 && piece.listed[k]!.count.some((n) => n > 0) && Object.assign(this.nodes[k]!, listedRows(dims, rule.kinds, k, this.listed)));
    } else if (piece.kind === "tops") this.tops.take(piece);
    else if (piece.kind === "buildings") this.buildings?.set(piece.table);
  }

  /**
   * Overview (col, row) let go a step at a time: its nodes and water at once, then its samples a band at a time, each a
   * change to the ground, which then stand in with the coarse picture's where no page holds them.
   */
  *release(col: number, row: number): Generator<void, void> {
    const block = this.overviews.at(col, row);
    if (!block) return;
    const sq = block.sq;
    this.came.delete(squareKey(col, row));
    block.nodes = false;
    this.overviews.version++;
    if (this.waters) this.hf.water = coarseAgain(this.head, this.waters, sq);
    for (let z = sq.cz0; z < sq.cz1; z += BAND_CHUNKS) {
      if (!this.overviews.holds(block)) return;
      const z1 = Math.min(sq.cz1, z + BAND_CHUNKS);
      block.from = z1;
      this.hf.standing(sq.cx0, z, sq.cx1, z1);
      if (z1 < sq.cz1) yield;
    }
    this.overviews.end(block);
  }

  /** Whether sector `sq`'s ground has come but waits for its overview. */
  waits(sq: Chunks & { readonly col: number; readonly row: number }): boolean {
    return this.early.get(overviewOf(sq))?.some((g) => g.sq.cx0 === sq.cx0 && g.sq.cz0 === sq.cz0) ?? false;
  }

  /** Sector `sq`'s ground let go: its samples stand in with its overview's, else the coarse picture's. */
  drop(sq: Chunks): void {
    this.hf.drop(sq);
    // One still waiting for its overview is let go with it.
    for (const [key, waiting] of this.early) this.early.set(key, waiting.filter((g) => g.sq.cx0 !== sq.cx0 || g.sq.cz0 !== sq.cz0));
  }

  /**
   * Chunk (cx, cz)'s bound its own samples' range, `lo` to `hi`; and each chunk round it whose bound is still the coarse
   * picture's takes that range in, as the samples on the edge they share may now be any of this chunk's.
   */
  private bound(cx: number, cz: number, lo: number, hi: number): void {
    const { chunksX, chunksZ } = this.head.dims, b = this.hf.bounds!;
    const c = cz * chunksX + cx;
    b[c * 2] = lo;
    b[c * 2 + 1] = hi;
    this.sure[c] = 1;
    for (let z = Math.max(0, cz - 1); z <= Math.min(chunksZ - 1, cz + 1); z++) {
      for (let x = Math.max(0, cx - 1); x <= Math.min(chunksX - 1, cx + 1); x++) {
        const n = z * chunksX + x;
        if (this.sure[n] === 1) continue;
        b[n * 2] = Math.min(b[n * 2]!, lo);
        b[n * 2 + 1] = Math.max(b[n * 2 + 1]!, hi);
      }
    }
  }

  /** The bounds of sector `piece.sq`'s chunks from its own samples. */
  private measureSector(piece: GroundPiece): void {
    const { sq, heights } = piece, per = CHUNK_SIZE / TERRAIN_CELL, nx = (sq.cx1 - sq.cx0) * per + 1;
    for (let cz = sq.cz0; cz < sq.cz1; cz++) {
      for (let cx = sq.cx0; cx < sq.cx1; cx++) {
        let a = 65535, b = 0;
        for (let j = (cz - sq.cz0) * per; j <= (cz - sq.cz0) * per + per; j++) {
          for (let k = j * nx + (cx - sq.cx0) * per, end = k + per; k <= end; k++) {
            const q = heights[k]!;
            if (q < a) a = q;
            if (q > b) b = q;
          }
        }
        this.bound(cx, cz, a, b);
      }
    }
  }
}

/**
 * Each chunk's bound while only the head has come: the least and most of its four corners in the coarse picture, which
 * its samples are laid between (Heightfield.fill).
 */
function coarseBounds(head: MapHead): Uint16Array {
  const { dims, coarse } = head, across = dims.chunksX + 1;
  const out = new Uint16Array(chunkCount(dims) * 2);
  for (let cz = 0; cz < dims.chunksZ; cz++) {
    for (let cx = 0; cx < dims.chunksX; cx++) {
      const k = cz * across + cx, h = coarse.heights;
      const c = cz * dims.chunksX + cx;
      out[c * 2] = Math.min(h[k]!, h[k + 1]!, h[k + across]!, h[k + across + 1]!);
      out[c * 2 + 1] = Math.max(h[k]!, h[k + 1]!, h[k + across]!, h[k + across + 1]!);
    }
  }
  return out;
}

/**
 * The map's water before its overviews come, laid out once over every chunk the head says the overviews hold water for
 * and every chunk a coarse sample's body reaches: each square the body of the coarse sample nearest it, so the lakes stand
 * flat over the coarse ground from the first frame.
 */
function coarseWater(head: MapHead): MapWater {
  const { dims, coarse } = head;
  const { cell, bodies } = head.water!;
  const [side, across] = [CHUNK_SIZE / cell, dims.chunksX + 1];
  const held = new Uint8Array(chunkCount(dims));
  for (const c of coarse.water) held[c] = 1;
  coarse.bodies!.forEach((b, k) => {
    if (b === 0) return;
    const [i, j] = [k % across, Math.floor(k / across)];
    for (let cz = Math.max(0, j - 1); cz <= Math.min(dims.chunksZ - 1, j); cz++) for (let cx = Math.max(0, i - 1); cx <= Math.min(dims.chunksX - 1, i); cx++) held[cz * dims.chunksX + cx] = 1;
  });
  const chunks: number[] = [];
  held.forEach((h, c) => h === 1 && chunks.push(c));
  const squares = new Uint16Array(chunks.length * side * side);
  chunks.forEach((c, k) => coarseSquares(head, c, squares, k * side * side));
  return new MapWater(dims, head.minY, head.stepY, cell, bodies, Uint32Array.from(chunks), squares);
}

/** Chunk `c`'s water squares as the coarse picture has them, into `out` from `at`: each the body of its nearest corner. */
function coarseSquares(head: MapHead, c: number, out: Uint16Array, at: number): void {
  const { dims, coarse } = head, cell = head.water!.cell, side = CHUNK_SIZE / cell, across = dims.chunksX + 1;
  // A square's nearest corner along an axis, from its chunk's column or row and its own.
  const nearest = (chunk: number, s: number): number => Math.round(chunk + ((s + 0.5) * cell) / CHUNK_SIZE);
  for (let s = 0; s < side * side; s++) out[at + s] = coarse.bodies![nearest(Math.floor(c / dims.chunksX), Math.floor(s / side)) * across + nearest(c % dims.chunksX, s % side)]!;
}

/** The water once an overview's square `sq` is let go: its chunks' squares the coarse picture's again, in the same layout. */
function coarseAgain(head: MapHead, held: HeldWater, sq: Chunks & { readonly col: number; readonly row: number }): MapWater {
  return held.change(sq, (chunks, was) => chunks.forEach((c) => coarseSquares(head, c, was.squares, was.block[c]!)));
}

/**
 * The water once an overview's has come: its chunks' squares its own, none where it holds none, in the same layout and
 * the same squares, so whatever was made of the water before reads them where they lie.
 */
function takeWater(held: HeldWater, sq: Chunks & { readonly col: number; readonly row: number }, water: { readonly chunks: Uint32Array; readonly squares: Uint16Array }): MapWater {
  const { squares, block, side } = held.water, per = side * side;
  for (const c of water.chunks) if (block[c]! < 0) throw new Error("map: an overview holds water where its head says there is none");
  return held.change(sq, (chunks) => {
    for (const c of chunks) squares.fill(0, block[c]!, block[c]! + per);
    water.chunks.forEach((c, k) => squares.set(water.squares.subarray(k * per, k * per + per), block[c]!));
  });
}

const NO_HEIGHTS = new Uint16Array(0);
const NO_TINT = new Uint8Array(0);

/** What the page tells the player of its map as it comes, and how it waits. */
export interface LoaderOptions {
  /**
   * Told a line when a part fails before the first frame, keeps failing after it, or comes damaged; and "" once the first
   * frame waits for nothing that failed.
   */
  readonly say?: (line: string) => void;
  /** Resolves after `ms` milliseconds: the wait before a part that failed is asked for again. */
  readonly wait: (ms: number) => Promise<void>;
  /** A pause between the steps the statics are read in, so frames go on (fetched.ts nextTask). */
  readonly pause?: () => Promise<void>;
  /**
   * Resolves after `ms` milliseconds, as `wait`: the clock the wanted parts are looked at by, each LOOK_EVERY. Without it
   * they are looked at as parts come and when MapLoader.look is called.
   */
  readonly every?: (ms: number) => Promise<void>;
}

/** An error's message. */
const why = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** Asks for a map's files, and keeps what has failed of each: the wait before it is asked for again, and what the player is told. */
class Asker {
  say: (line: string) => void;
  /** Past the first frame: a part that fails is told of only once it keeps failing, and when it comes after that. */
  late = false;
  private readonly get: Get;
  private readonly fails = new Map<string, { net: number; damaged: number; told: boolean }>();

  constructor(get: Get, say: (line: string) => void) {
    this.get = get;
    this.say = say;
  }

  /**
   * `url`, the file `name`, asked for once and read by `read`: what that gives, or the milliseconds to wait before asking
   * again. Throws once it has come damaged DAMAGED_MOST times.
   */
  async ask<T>(name: string, url: string, read: (bytes: Uint8Array) => T): Promise<{ value: T } | { wait: number }> {
    const f = this.fails.get(name) ?? { net: 0, damaged: 0, told: false };
    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(await fetchBytes(f.damaged ? (path) => this.get(path, { cache: "reload" }) : this.get, url));
    } catch (e) {
      return { wait: this.failed(name, f, why(e), false) };
    }
    let value: T;
    try {
      value = read(bytes);
    } catch (e) {
      return { wait: this.failed(name, f, why(e), true) };
    }
    if (f.told) this.say(`the map's ${name} came, at ask ${f.net + f.damaged + 1}`);
    this.fails.delete(name);
    return { value };
  }

  /**
   * Keeps that `name` failed, `line` saying how, and tells the player what fits: before the first frame every failure,
   * after it a part damaged, or one that keeps failing at TELL_AFTER failures in a row and each doubling of that.
   */
  private failed(name: string, f: { net: number; damaged: number; told: boolean }, line: string, damaged: boolean): number {
    this.fails.set(name, f);
    if (damaged && ++f.damaged >= DAMAGED_MOST) throw new Error(`${line}, at each of ${DAMAGED_MOST} asks: the map is broken`);
    if (!damaged) f.net++;
    const n = f.net + f.damaged, wait = retryWait(n), times = n / TELL_AFTER;
    const again = `asking again in ${wait / 1000} s`;
    if (!this.late) this.say(`loading the map: ${line}; ${again}`);
    else if (damaged) this.say(`${line}; ${again}`);
    else if (Number.isInteger(times) && (times & (times - 1)) === 0) this.say(`the map is coming slowly: ${line}, ${n} times in a row; ${again}`);
    else return wait;
    f.told ||= this.late;
    return wait;
  }
}

/** How much of a map a page has (MapLoader.progress), for a bench that waits for what it wants (bench-run.ts). */
export interface MapProgress {
  /** Parts wanted not yet held, those under way or waiting to be asked again among them, and how many are wanted. */
  readonly left: number;
  readonly parts: number;
  /** Whether the statics round the body have been handed over, to the hand-over's last step. */
  readonly near: boolean;
  /** Whether every part wanted is held, nothing is under way, and the statics held have been handed over as they stand. */
  readonly settled: boolean;
  /** Road and streets parts within ROAD_REACH of the body not yet held. */
  readonly roads: number;
}

/** The page's map as its parts come, each checked against the hash its head names. */
export class MapLoader {
  readonly staged: StagedMap;
  /** The statics held, a table a sector. */
  readonly held: HeldStatics;
  private readonly asker: Asker;
  private readonly wait: (ms: number) => Promise<void>;
  private readonly every: ((ms: number) => Promise<void>) | undefined;
  private readonly pause: () => Promise<void>;
  private readonly at: (p: MapPart) => string;
  private readonly boxes: PartBoxes;
  /** The parts wanted, and those held of them and of the first frame's; those under way, waiting out a failure, or broken. */
  private readonly want = new Wanted();
  private readonly came = new Set<MapPart>();
  private readonly going = new Set<MapPart>();
  private readonly waiting = new Set<MapPart>();
  private readonly broken = new Set<MapPart>();
  /** Past the first frame: parts are wanted and the statics handed over. */
  private followed = false;
  private from: () => WantFrom = () => tierWant(tierOf(DEFAULT_TIER));
  /** To whom the statics are handed over, the store's version last handed over, and whether one is under way or done. */
  private arrived: ((statics: MapStatics) => void) | undefined;
  private arriving: (() => Generator<void, void>) | undefined;
  private handedAt = -1;
  private handing = false;
  private handedOnce = false;
  private stopped = false;
  private heldBack: () => boolean = () => false;
  private where: () => Place | null = () => null;
  private last: { x: number; z: number; vx: number; vz: number } | null = null;

  private constructor(asker: Asker, opts: LoaderOptions, at: (p: MapPart) => string, staged: StagedMap) {
    this.asker = asker;
    this.wait = opts.wait;
    this.every = opts.every;
    this.pause = opts.pause ?? (() => Promise.resolve());
    this.at = at;
    this.staged = staged;
    this.held = new HeldStatics(staged.head);
    this.held.wake = () => this.look();
    this.held.say = (line) => this.asker.say(line);
    this.boxes = new PartBoxes(staged.head);
  }

  /**
   * The map whose head is at `url`, once its head and the parts its first frame waits for wherever the body is have come,
   * six at once: its landmarks' definitions, and on a map with a listed node layer all its overviews and ground.
   */
  static async start(get: Get, url: string, opts: LoaderOptions): Promise<MapLoader> {
    const asker = new Asker(get, opts.say ?? (() => {}));
    const wait = opts.wait;
    const base = url.slice(0, url.lastIndexOf("/") + 1);
    let got = await asker.ask(url.slice(base.length), url, (bytes) => within(url, () => readHead(bytes)));
    while ("wait" in got) {
      await wait(got.wait);
      got = await asker.ask(url.slice(base.length), url, (bytes) => within(url, () => readHead(bytes)));
    }
    const head = got.value;
    const loader = new MapLoader(asker, opts, (p) => base + p.name, new StagedMap(head));
    const first = head.parts.filter((p) => everywhere(head, p));
    let next = 0;
    const lane = async (): Promise<void> => {
      for (let k = next++; k < first.length; k = next++) await loader.must(first[k]!);
    };
    await Promise.all(Array.from({ length: Math.min(PARTS_AT_ONCE, first.length) }, lane));
    asker.say("");
    return loader;
  }

  /**
   * From now on the parts the page wants come (map-want.ts), from where `where` has the body, else where it last had it,
   * else the map's first spawn point, and whatever `then.want` names besides: nearest first, what is within RING and the statics a chunk the server
   * sent waits for before the rest, then the overviews and then the sectors within the statics reach, then the rest, each
   * sector's ground before its statics. Resolves once the ground and the overviews the first frame waits for where it has
   * the body now have come, alone. From then on `then.say` is told what the player is; each time the statics held change
   * and every overview, ground and statics part within the statics reach of the body has come, `then.arrived` is handed a
   * copy of the statics held as one table, and `then.arriving`'s steps are taken with a pause between each. While
   * `then.held` says the game's socket is held back, one part at a time is under way.
   */
  async follow(where: () => Place | null, then: { readonly say?: (line: string) => void; readonly arrived?: (statics: MapStatics) => void; readonly arriving?: () => Generator<void, void>; readonly want?: () => WantFrom; readonly held?: () => boolean } = {}): Promise<void> {
    this.where = where;
    this.heldBack = then.held ?? (() => false);
    if (then.want) this.from = then.want;
    const head = this.staged.head;
    const { x, z } = this.place();
    const near = firstFrameParts(head, x, z).filter((p) => !this.came.has(p));
    await Promise.all(near.map((p) => this.must(p)));
    this.asker.say("");
    this.asker.late = true;
    if (then.say) this.asker.say = then.say;
    this.arrived = then.arrived;
    this.arriving = then.arriving;
    this.followed = true;
    this.look();
    void this.followRoads();
    if (this.every) void this.followWant(this.every);
  }

  /**
   * Looks again at which parts are wanted, from where the body and the rest are now, lets go of the statics and buildings
   * no centre keeps, and asks for what is wanted. The clock given as `every` calls it each LOOK_EVERY ms; so does each
   * part that comes where none was given.
   */
  look(): void {
    if (!this.followed) return;
    const { x, z, vx, vz } = this.place(), from = this.from();
    this.want.look(this.boxes, centresOf({ x, z }, { x: x + vx * LEAD, z: z + vz * LEAD }, from), this.held.needed);
    this.cap(from.budget ?? Infinity);
    this.capGround(from.ground ?? Infinity);
    for (const p of this.came) {
      if (this.want.kept.has(p) || (p.kind === "statics" && this.held.keep?.(p))) continue;
      if (p.kind === "statics") this.held.drop(p);
      else if (p.kind === "buildings") this.staged.buildings?.drop(p.col, p.row);
      else if (p.kind === "tops") this.dropTops(p);
      else if (p.kind === "ground") this.staged.drop(squareOf(this.staged.head.dims, SECTOR_CHUNKS, p.col, p.row)!);
      else if (p.kind === "overview") void stepped(this.staged.release(p.col, p.row), this.pause);
      else continue;
      this.came.delete(p);
    }
    this.trim(0);
    this.trimGround(0);
    this.pump();
  }

  /** Metres from the body, the camera or a sight's focus to part `p`: a ground page within ROAD_REACH of any is pinned. */
  private pinOff(p: MapPart): number {
    const head = this.staged.head, { camera, focus } = this.from(), { x, z } = this.place();
    return Math.min(partDistance(head, p, x, z), camera ? partDistance(head, p, camera.x, camera.z) : Infinity, focus ? partDistance(head, p, focus.x, focus.z) : Infinity);
  }

  /** Whether part `p` has come and is in place: a sector's ground that waits for its overview is not. */
  private holds(p: MapPart): boolean {
    return this.came.has(p) && !(p.kind === "ground" && this.staged.waits(squareOf(this.staged.head.dims, SECTOR_CHUNKS, p.col, p.row)!));
  }

  /**
   * The ground wanted, nearest the body, where it heads, the camera or a focus first, as far as `budget` bytes of pages reach,
   * and none past but those pinned. A page held counts a sector nearer.
   */
  private capGround(budget: number): void {
    if (budget === Infinity) return;
    const head = this.staged.head, grounds: [MapPart, number][] = [];
    for (const p of this.want.parts.keys()) if (p.kind === "ground") grounds.push([p, Math.min(this.off(p), this.pinOff(p)) - (this.came.has(p) ? KEEP_PAST : 0)]);
    grounds.sort((a, b) => a[1] - b[1]);
    let room = budget;
    for (const [p] of grounds) {
      room -= pageBytes(squareOf(head.dims, SECTOR_CHUNKS, p.col, p.row)!);
      if (room >= 0 || this.pinOff(p) <= ROAD_REACH) continue;
      this.want.parts.delete(p);
      this.want.kept.delete(p);
    }
  }

  /** Ground pages kept beyond their reach let go, farthest first, until `more` bytes fit with those held in the budget. */
  private trimGround(more: number): void {
    const budget = this.from().ground ?? Infinity, hf = this.staged.hf;
    if (hf.bytes + more <= budget) return;
    const spare = [...this.came].filter((p) => p.kind === "ground" && !this.want.parts.has(p)).sort((a, b) => this.pinOff(b) - this.pinOff(a));
    for (const p of spare) {
      if (hf.bytes + more <= budget) break;
      this.came.delete(p);
      this.staged.drop(squareOf(this.staged.head.dims, SECTOR_CHUNKS, p.col, p.row)!);
    }
  }

  /**
   * The statics wanted, nearest first, as far as `budget` bytes of them reach, and none past: those a reader waits for
   * first, then by their metres, a sector held a sector nearer than it is so the edge does not let it go and ask again.
   */
  private cap(budget: number): void {
    if (budget === Infinity) return;
    const held = this.held, statics: [MapPart, number][] = [];
    let room = budget - held.index;
    for (const [p, off] of this.want.parts) {
      if (p.kind !== "statics") continue;
      if (held.needed.has(p)) room -= held.bytesOf(p);
      else statics.push([p, off - (held.has(p) ? KEEP_PAST : 0)]);
    }
    statics.sort((a, b) => a[1] - b[1]);
    for (const [p] of statics) {
      room -= held.bytesOf(p);
      if (room >= 0) continue;
      this.want.parts.delete(p);
      this.want.kept.delete(p);
      room = -Infinity;
    }
  }

  /** Statics kept beyond their reach let go, farthest first, until `more` bytes of them fit with those held in the budget. */
  private trim(more: number): void {
    const budget = this.from().budget ?? Infinity;
    if (this.held.bytes + more <= budget) return;
    const spare = [...this.came].filter((p) => p.kind === "statics" && !this.want.parts.has(p) && !this.held.keep?.(p)).sort((a, b) => this.off(b) - this.off(a));
    for (const p of spare) {
      if (this.held.bytes + more <= budget) break;
      this.came.delete(p);
      this.held.drop(p);
    }
  }

  /** Lets go of tops part `p`'s cells. */
  private dropTops(p: MapPart): void {
    const sq = squareOf(this.staged.head.dims, OVERVIEW_CHUNKS, p.col, p.row);
    if (sq) this.staged.tops.drop(sq.cx0, sq.cz0, sq.cx1, sq.cz1);
  }

  /** For as long as the page lives, a look at what is wanted each LOOK_EVERY ms of `every`. */
  private async followWant(every: (ms: number) => Promise<void>): Promise<void> {
    for (;;) {
      await every(LOOK_EVERY);
      this.look();
    }
  }

  /**
   * Hands the statics held over when they changed and all within the statics reach of the body have come; then asks for
   * the nearest parts wanted until as many are under way as the nearest allows (URGENT_AT_ONCE or AFTER_AT_ONCE, or one
   * while the game's socket is held back).
   */
  private pump(): void {
    this.handOut();
    for (let p = this.next(); p && this.going.size < (this.heldBack() ? 1 : this.urgent(p) ? URGENT_AT_ONCE : AFTER_AT_ONCE); p = this.next()) {
      const part = p;
      this.going.add(part);
      void this.ask(part).then(
        (got) => {
          // A part that failed waits out of its lane, which the next part takes at once.
          this.going.delete(part);
          if (got !== 0) {
            this.waiting.add(part);
            void this.wait(got).then(() => (this.waiting.delete(part), this.pump()));
          }
          if (this.every) this.pump();
          else this.look();
        },
        // Broken: it is never asked for again. A sector's statics so: their pieces are left out; any other: nothing more is handed over.
        (e: unknown) => {
          this.going.delete(part);
          this.broken.add(part);
          if (part.kind === "statics") {
            this.held.broke(part);
            this.asker.say(`${why(e)}; the pieces of sector ${part.col}, ${part.row} are left out`);
          } else {
            this.stopped = true;
            this.asker.say(why(e));
          }
          this.pump();
        },
      );
    }
  }

  /** Whether every overview, ground and statics part wanted within the statics reach of the body has come. */
  private statsIn(): boolean {
    const reach = this.from().statics;
    for (const p of this.want.parts.keys()) if ((p.kind === "statics" || p.kind === "ground" || p.kind === "overview") && !this.holds(p) && !this.broken.has(p) && this.off(p) <= reach) return false;
    return true;
  }

  /** The statics held handed over, a step at a time, where they changed since they last were and those round the body are in. */
  private handOut(): void {
    if (this.handing || this.stopped || !this.followed || this.held.version === this.handedAt || !this.statsIn()) return;
    this.handing = true;
    const version = this.held.version;
    void (async () => {
      if (this.arrived) this.arrived(await stepped(this.held.table(), this.pause));
      if (this.arriving) await stepped(this.arriving(), this.pause);
      this.handedAt = version;
      this.handedOnce = true;
    })()
      .catch((e: unknown) => this.asker.say(why(e)))
      .finally(() => {
        this.handing = false;
        this.pump();
      });
  }

  /**
   * Where the body is; while it has no place (dead, or the socket closed), where it last was, standing still; and before
   * any place is known, the map's first spawn point.
   */
  private place(): Place {
    const at = this.where();
    if (at) {
      const last = (this.last ??= { x: 0, z: 0, vx: 0, vz: 0 });
      [last.x, last.z] = [at.x, at.z];
      return at;
    }
    if (this.last) return this.last;
    const head = this.staged.head;
    const spawn = head.spawns[0] ?? { x: (head.dims.chunksX * CHUNK_SIZE) / 2, z: (head.dims.chunksZ * CHUNK_SIZE) / 2 };
    return { x: spawn.x, z: spawn.z, vx: 0, vz: 0 };
  }

  /** Metres from the body, or from where it will be LEAD seconds on if that is nearer, to part `p`'s square. */
  private off(p: MapPart): number {
    const head = this.staged.head;
    const { x, z, vx, vz } = this.place();
    return Math.min(partDistance(head, p, x, z), partDistance(head, p, x + vx * LEAD, z + vz * LEAD));
  }

  /**
   * Whether part `p` is an overview, ground or statics within RING of the body or of where it is heading, or statics a
   * chunk the server sent waits for.
   */
  private urgent(p: MapPart): boolean {
    return ((p.kind === "ground" || p.kind === "overview" || p.kind === "statics") && this.off(p) <= RING) || this.held.needed.has(p);
  }

  /**
   * Which part wanted goes next, nearest first within each of these in turn: what is urgent; the overviews within the
   * statics reach and then its sectors; the overviews past it and every square's tops, those once the statics round the
   * body have been handed over; the rest. A sector's ground goes before its statics, its statics before its buildings,
   * and a square's overview before its tops; null for none. A part wanted from elsewhere than the body is as near as that.
   */
  private next(): MapPart | null {
    const reach = this.from().statics;
    let best: MapPart | null = null;
    let least = Infinity;
    for (const [p, far] of this.want.parts) {
      if (this.came.has(p) || this.going.has(p) || this.waiting.has(p) || this.broken.has(p)) continue;
      // Nothing the statics round the body wait for shares the link with the tops.
      if (p.kind === "tops" && !this.handedOnce) continue;
      const off = Math.min(far, this.off(p));
      const turn = p.kind === "tops" ? 3 : this.urgent(p) ? 0 : (off <= reach ? 1 : 3) + (p.kind === "overview" ? 0 : 1);
      const rank = turn * 1e6 + off + (p.kind === "statics" ? 0.5 : p.kind === "buildings" ? 0.75 : p.kind === "tops" ? 0.25 : 0);
      if (rank < least) [best, least] = [p, rank];
    }
    // A sector asked for once goes after what is urgent and before the rest.
    for (const p of this.held.asked.keys()) {
      if (this.came.has(p) || this.going.has(p) || this.waiting.has(p) || this.broken.has(p) || this.want.parts.has(p)) continue;
      const rank = 0.5e6 + this.off(p);
      if (rank < least) [best, least] = [p, rank];
    }
    return best;
  }

  /** Part `p` asked for until it comes, and taken in. */
  private async must(p: MapPart): Promise<void> {
    for (let got = await this.ask(p); got !== 0; got = await this.ask(p)) await this.wait(got);
  }

  /**
   * Part `p` asked for once and checked against its hash: a sector's statics read and set in the store, any other read
   * and taken in. Statics or buildings let go while they came are not. Gives 0, or the milliseconds to wait before it is
   * asked for again.
   */
  private async ask(p: MapPart): Promise<number> {
    const head = this.staged.head;
    const got = await this.asker.ask(p.name, this.at(p), (bytes) => {
      if (p.kind !== "statics") return readPart(head, p, bytes);
      if (bytes.length !== p.length || partHash(bytes) !== p.hash) throw new Error(`map: its part ${p.name} is damaged or another's: its bytes are not those its head names`);
      return bytes;
    });
    if ("wait" in got) return got.wait;
    const gone = (): boolean => this.followed && !this.want.kept.has(p);
    if (got.value instanceof Uint8Array) {
      const piece = (await stepped(partSteps(head, p, got.value, false), this.pause)) as StaticsPiece;
      if (gone()) {
        // Asked for once: handed to who asked, and let go.
        if (this.held.asked.has(p)) this.held.answer(p, await stepped(this.held.read(p, piece), this.pause));
        return 0;
      }
      this.trim(this.held.bytesOf(p));
      await stepped(this.held.set(p, piece), this.pause);
    } else if (p.kind !== "land" && p.kind !== "statics" && gone()) return 0;
    else {
      if (got.value.kind === "ground") this.trimGround(pageBytes(got.value.sq));
      await stepped(this.staged.steps(got.value), this.pause);
    }
    this.came.add(p);
    return 0;
  }

  /**
   * The road and streets parts held, asked for or waiting to be asked for again, and of them those held and those
   * waiting; how many are under way; and those that came damaged DAMAGED_MOST times, never asked for again.
   */
  private readonly roads = new Set<MapPart>();
  private readonly roadsHeld = new Set<MapPart>();
  private readonly roadsWaiting = new Set<MapPart>();
  private roadsUnder = 0;
  private readonly roadsBroken = new Set<MapPart>();

  /** The map's statics held, a table a sector. */
  get statics(): HeldStatics {
    return this.held;
  }

  /** How much of what the page wants has come, and been handed over: what a bench waits for before it measures (bench-run.ts). */
  progress(): MapProgress {
    const head = this.staged.head;
    let roads = 0, left = 0;
    for (const p of head.parts) if ((p.kind === "road" || p.kind === "streets") && !this.roadsHeld.has(p) && this.off(p) <= ROAD_REACH) roads++;
    for (const p of this.want.parts.keys()) if (!this.holds(p)) left++;
    const settled = this.followed && left === 0 && this.going.size === 0 && this.waiting.size === 0 && !this.handing && this.handedAt === this.held.version;
    return { left, parts: this.want.parts.size, near: this.handedOnce, settled, roads };
  }

  /**
   * For as long as the page lives, the roads' frame and the streets' lines of the sectors round the body, a look every
   * ROAD_EVERY ms, where the map has them.
   */
  private async followRoads(): Promise<void> {
    const parts = this.staged.head.parts;
    if (!parts.some((p) => p.kind === "road" || p.kind === "streets")) return;
    if (parts.some((p) => p.kind === "road")) this.staged.hf.road ??= new RoadSectors();
    if (parts.some((p) => p.kind === "streets")) this.staged.hf.streets ??= new StreetSectors();
    for (;;) {
      this.lookRoads();
      await this.wait(ROAD_EVERY);
    }
  }

  /**
   * One look at the roads' frame and the streets: each road and streets part within ROAD_REACH of the body asked for,
   * nearest first, and held once it comes if it is still wanted; one that failed asked again after its wait, and one
   * broken never; each held past a sector further let go. Nothing else waits for them. The streets reach as far: they draw the ground's edges round the camera and give the page's own car its
   * grip at a street's edge.
   */
  lookRoads(): void {
    const hf = this.staged.hf;
    const wanted: MapPart[] = [];
    for (const p of this.staged.head.parts) {
      if (p.kind !== "road" && p.kind !== "streets") continue;
      const off = this.off(p);
      if (off <= ROAD_REACH && !this.roads.has(p) && !this.roadsBroken.has(p)) wanted.push(p);
      else if (off > ROAD_REACH + SECTOR_CHUNKS * CHUNK_SIZE && this.roads.delete(p)) {
        this.roadsHeld.delete(p);
        this.roadsWaiting.delete(p);
        (p.kind === "road" ? hf.road : hf.streets)?.drop(squareKey(p.col, p.row));
      }
    }
    // Nearest first, ROADS_AT_ONCE at a time, and while the game's socket is held back only when nothing else is under way.
    wanted.sort((a, b) => this.off(a) - this.off(b));
    for (const p of wanted) {
      if (this.roadsUnder >= (this.heldBack() ? (this.going.size === 0 ? 1 : 0) : ROADS_AT_ONCE)) break;
      this.roads.add(p);
      this.roadsUnder++;
      void this.asker.ask(p.name, this.at(p), (bytes) => readPart(this.staged.head, p, bytes)).then(
        (got) => {
          this.roadsUnder--;
          if (!("wait" in got)) {
            if (this.roads.has(p)) this.holdRoad(p, got.value);
          } else {
            this.roadsWaiting.add(p);
            void this.wait(got.wait).then(() => this.roadsWaiting.delete(p) && (this.roads.delete(p), this.lookRoads()));
          }
          this.lookRoads();
        },
        // Broken: it is never asked for again.
        (e: unknown) => {
          this.roadsUnder--;
          this.roadsBroken.add(p);
          this.asker.say(why(e));
          this.lookRoads();
        },
      );
    }
  }

  /** Road or streets part `p`, read as `piece`, held where it is drawn and asked from. */
  private holdRoad(p: MapPart, piece: MapPiece): void {
    const hf = this.staged.hf;
    if (piece.kind === "road") holdRoad(hf.road!, piece);
    else if (piece.kind === "streets") holdStreets(hf.streets!, piece);
    this.roadsHeld.add(p);
  }
}

/** `steps` taken to their end, with a pause after each. */
async function stepped<T>(steps: Generator<void, T>, pause: () => Promise<void>): Promise<T> {
  for (let s = steps.next(); ; s = steps.next()) {
    if (s.done) return s.value;
    await pause();
  }
}
