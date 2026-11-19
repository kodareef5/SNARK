// A map as the page takes it in parts (shared/world/mapfile.ts). Its head holds the whole map at every chunk's corner,
// its ground, its sea and its lakes, which stands in for each overview until it comes, as an overview's ground stands in
// for each sector's (shared/world/heightfield.ts). Before anything is drawn: the head and its landmarks' definitions,
// which the welcome's registry holds. Then the ground of the sectors within reach of the body and the overviews they lie
// in, which the first frame waits for and which come alone (firstFrameParts says which, for the loader and for the map's
// build). Then, while the game is played, the rest nearest first by where the body is and where it is heading, ordered
// again at each ask so a jump goes first to where it lands: the overviews and ground within RING, then the other overviews
// within CITY_NEAR, then its sectors, then the overviews past it, then the rest, each sector's ground before its statics;
// URGENT_AT_ONCE at once while what is within RING is wanted, AFTER_AT_ONCE otherwise. Once the overviews, the ground and the statics of every sector within CITY_NEAR of the
// body have come, those sectors' statics are handed over, for the far city round the body; and once every part has come,
// all of them. The map's statics are laid out whole from its head's counts, and each sector's set in as it comes, a step
// at a time, and its bytes let go: what is handed over is only ever whole sectors' rows, those round the body copied out
// and then the whole map's, and nothing of them is read again at the hand-over. A part that fails is asked for again
// after a wait that grows to a cap, for as long as the page lives, and what has come is kept. One that comes damaged or
// as another's is refused by name and asked for again, until the DAMAGED_MOST-th time breaks the map.

import { CHUNK_SIZE, SECTOR_CHUNKS, chunkCount } from "../../shared/coords.ts";
import type { Def } from "../../shared/content/defs.ts";
import { Heightfield, TERRAIN_CELL } from "../../shared/world/heightfield.ts";
import { COARSE_STEP, MapStatics, OVERVIEW_CHUNKS, OVERVIEW_STEP, blankLayers, blankStatics, listedRows, partHash, partSteps, readHead, readPart, setGround, setNodes, setStatics, squareOf, type GroundPiece, type MapContent, type MapHead, type MapPart, type MapPiece, type NodeLayer, type StaticsPiece } from "../../shared/world/mapfile.ts";
import { MapWater } from "../../shared/world/water.ts";
import { fetchBytes, within, type Get } from "./fetched.ts";
import { PREDICTED_REACH } from "./session.ts";

/**
 * Parts asked for at once before the first frame: as many as a browser opens to a host over HTTP/1.1, so that on a link of
 * 100 ms a request one part's round trip is mostly hidden by the others' bytes.
 */
export const PARTS_AT_ONCE = 6;
/**
 * Parts asked for at once while the game is played: while the nearest part left is ground within RING of the body or of
 * where it is heading, and otherwise. Fewer than a browser's six connections to a host, so the art always has some.
 */
export const URGENT_AT_ONCE = 4;
export const AFTER_AT_ONCE = 2;
/**
 * Metres round the body whose overviews the first frame waits for, so the ground there is drawn finer than the head's
 * coarse picture and its trees stand: the far trees' reach on the high tier (assets/tiers.ts), within half an overview's
 * side, so at most four.
 */
export const FIRST_REACH = 2048;
/** Metres round the body, and round where it will be LEAD seconds on, whose ground is urgent once the game is played. */
export const RING = 600;
/** Seconds of the body's way ahead of it whose ground is asked for as if the body were there. */
export const LEAD = 2;
/** Metres round the body whose sectors' statics are handed over before the rest: as far as any tier draws the far city. */
export const CITY_NEAR = 4096;
/** Milliseconds before a part that failed is asked for again: RETRY_FIRST, doubled at each failure in a row, to RETRY_MOST. */
export const RETRY_FIRST = 500;
export const RETRY_MOST = 8000;
/** Times a part may come damaged or as another's before the map is taken as broken. */
export const DAMAGED_MOST = 3;
/** Failures in a row of one part, after the first frame, at which the player is told; and again each time they double. */
export const TELL_AFTER = 3;

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
 * Whether the first frame waits for part `p` wherever the body is: the landmarks' definitions, and on a map with a listed
 * node layer every sector's ground and so every overview, since the head does not say that layer's slots a chunk and a
 * node source counts them as it is made.
 */
function everywhere(head: MapHead, p: MapPart): boolean {
  return p.kind === "land" || ((p.kind === "ground" || p.kind === "overview") && head.layers.some((rule) => rule.type === 1));
}

/** A square of the lattice by its column and row, as a number. */
const squareKey = (col: number, row: number): number => col * 4096 + row;
/** The overview's square a sector's lies in: both are squares of the lattice, and a sector's lies within one overview's. */
const overviewOf = (sector: { readonly col: number; readonly row: number }): number => squareKey(Math.floor((sector.col * SECTOR_CHUNKS) / OVERVIEW_CHUNKS), Math.floor((sector.row * SECTOR_CHUNKS) / OVERVIEW_CHUNKS));

/**
 * The parts the first frame waits for with the body at (x, z), besides the head, in the head's order: those it waits for
 * everywhere, the ground of each sector within PREDICTED_REACH of it on both axes, where the body is predicted from the
 * first frame on, the overviews those sectors lie in, which hold their nodes and their water, and those less than
 * FIRST_REACH from it. The loader asks by it, and the map's build holds its worst over the map to a budget
 * (tools/map/pack.ts).
 */
export function firstFrameParts(head: MapHead, x: number, z: number): MapPart[] {
  const r = PREDICTED_REACH;
  const grounds = head.parts.filter((p) => {
    if (p.kind !== "ground") return false;
    const sq = squareOf(head.dims, SECTOR_CHUNKS, p.col, p.row)!;
    return sq.cx0 * CHUNK_SIZE <= x + r && sq.cx1 * CHUNK_SIZE >= x - r && sq.cz0 * CHUNK_SIZE <= z + r && sq.cz1 * CHUNK_SIZE >= z - r;
  });
  const under = new Set(grounds.map(overviewOf));
  return head.parts.filter((p) => everywhere(head, p) || grounds.includes(p) || (p.kind === "overview" && (under.has(squareKey(p.col, p.row)) || offOf(head, p, x, z) < FIRST_REACH)));
}

/**
 * The parts the map's statics are handed over after, besides the head: every part but the tops, so that the far city, the
 * near city and the far shadow are made on exact ground. The map's build says what that is at its heaviest first frame.
 */
export function handOverParts(head: MapHead): MapPart[] {
  return head.parts.filter((p) => p.kind !== "tops");
}

/**
 * A map as a client holds it while its parts come: its ground, in which a sample not yet its sector's is its overview's,
 * and one not yet its overview's the head's coarse picture's; its node layers, its water and its landmarks. A sector's
 * ground waits until its overview has come, and is then copied into the heightfield and let go; of a listed node layer's
 * rows, only those are kept.
 */
export class StagedMap {
  readonly head: MapHead;
  readonly hf: Heightfield;
  readonly nodes: NodeLayer[];
  /** The landmarks the head places and the definitions the land part adds, or undefined where the head has none. */
  content: MapContent | undefined;
  /** Each sector's come so far that has rows of a listed node layer: those rows, and none of its ground. */
  private readonly listed: GroundPiece[] = [];
  /** The overviews' squares come so far, and the sectors' grounds come before their overview, by its square. */
  private readonly overviews = new Set<number>();
  private readonly early = new Map<number, GroundPiece[]>();

  constructor(head: MapHead) {
    this.head = head;
    const { dims, coarse } = head;
    // The ground's classes a wheel feels, a cell each two samples, filled as each sector's ground comes: the page's own
    // car steps on this heightfield, and without them it drove every street off-road where the server's grips (D811).
    // Before a sector comes its cells read as plain ground, where no body is predicted (D756).
    const cells = (chunks: number): number => (chunks * CHUNK_SIZE) / TERRAIN_CELL / 2 + 1;
    this.hf = new Heightfield(dims, TERRAIN_CELL, head.minY, head.stepY, undefined, undefined, new Uint8Array(cells(dims.chunksX) * cells(dims.chunksZ)));
    this.hf.seaLevel = head.seaLevel;
    this.hf.holdNone();
    this.hf.fill(0, 0, dims.chunksX, dims.chunksZ, COARSE_STEP, coarse.heights, coarse.tint);
    this.nodes = blankLayers(head);
    // Every slot is taken out until its chunk's overview says which stand, so no node stands on the coarse ground.
    for (const layer of this.nodes) if (!("first" in layer)) layer.out!.fill(255);
    this.content = head.landmarks ? { landmarks: head.landmarks, defs: [] } : undefined;
    if (head.water) this.hf.water = coarseWater(head);
  }

  /** Takes in a part read: the land's definitions, an overview's ground, node pictures and water, or a sector's ground and its listed nodes. */
  take(piece: MapPiece): void {
    const { dims } = this.head;
    if (piece.kind === "land") {
      if (this.content) this.content = { landmarks: this.content.landmarks, defs: piece.defs as Def[] };
    } else if (piece.kind === "overview") {
      const sq = piece.sq;
      this.hf.fill(sq.cx0, sq.cz0, sq.cx1, sq.cz1, OVERVIEW_STEP, piece.heights, piece.tint);
      setNodes(dims, this.nodes, piece);
      if (piece.water) this.hf.water = takeWater(this.head, this.hf.water!, piece.sq, piece.water);
      const key = squareKey(sq.col, sq.row);
      this.overviews.add(key);
      for (const g of this.early.get(key) ?? []) this.take(g);
      this.early.delete(key);
    } else if (piece.kind === "ground") {
      const under = overviewOf(piece.sq);
      if (!this.overviews.has(under)) {
        this.early.set(under, [...(this.early.get(under) ?? []), piece]);
        return;
      }
      setGround(dims, this.hf.heights, this.hf.tint, piece, this.hf.ground);
      this.hf.hold(piece.sq.cx0, piece.sq.cz0, piece.sq.cx1, piece.sq.cz1);
      if (piece.listed.every((rows) => rows === null)) return;
      this.listed.push({ kind: "ground", sq: piece.sq, heights: NO_HEIGHTS, tint: NO_TINT, ground: NO_TINT, listed: piece.listed });
      // Listed layer k's rows from the sectors come so far, set in the layer the node source reads.
      this.head.layers.forEach((rule, k) => rule.type === 1 && piece.listed[k]!.count.some((n) => n > 0) && Object.assign(this.nodes[k]!, listedRows(dims, rule.kinds, k, this.listed)));
    }
  }
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
  // A square's nearest corner along an axis, from its chunk's column or row and its own.
  const nearest = (chunk: number, s: number): number => Math.round(chunk + ((s + 0.5) * cell) / CHUNK_SIZE);
  chunks.forEach((c, k) => {
    for (let s = 0; s < side * side; s++) squares[k * side * side + s] = coarse.bodies![nearest(Math.floor(c / dims.chunksX), Math.floor(s / side)) * across + nearest(c % dims.chunksX, s % side)]!;
  });
  return new MapWater(dims, head.minY, head.stepY, cell, bodies, Uint32Array.from(chunks), squares);
}

/**
 * The water once an overview's has come: its chunks' squares its own, none where it holds none, in the same layout and
 * the same squares, so whatever was made of the water before reads them where they lie.
 */
function takeWater(head: MapHead, was: MapWater, sq: { readonly cx0: number; readonly cz0: number; readonly cx1: number; readonly cz1: number }, water: { readonly chunks: Uint32Array; readonly squares: Uint16Array }): MapWater {
  const { dims, squares, block } = was;
  const per = was.side * was.side;
  for (let cz = sq.cz0; cz < sq.cz1; cz++) for (let cx = sq.cx0; cx < sq.cx1; cx++) if (block[cz * dims.chunksX + cx]! >= 0) squares.fill(0, block[cz * dims.chunksX + cx]!, block[cz * dims.chunksX + cx]! + per);
  water.chunks.forEach((c, k) => {
    if (block[c]! < 0) throw new Error("map: an overview holds water where its head says there is none");
    squares.set(water.squares.subarray(k * per, k * per + per), block[c]!);
  });
  return new MapWater(dims, head.minY, head.stepY, was.cell, was.bodies, was.chunks(), squares);
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
      bytes = new Uint8Array(await fetchBytes(this.get, url));
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

/** The page's map as its parts come, each checked against the hash its head names. */
export class MapLoader {
  readonly staged: StagedMap;
  private readonly asker: Asker;
  private readonly wait: (ms: number) => Promise<void>;
  private readonly pause: () => Promise<void>;
  private readonly at: (p: MapPart) => string;
  /** The parts, overviews, ground and statics, not yet asked for, or failed and to be asked for again; and how many are under way. */
  private readonly left: MapPart[];
  private under = 0;
  /** The overviews and ground come so far, and the statics set in `table`, the map's laid out from its head once the first comes. */
  private readonly came = new Set<MapPart>();
  private table: MapStatics | null = null;
  /** To whom the statics are handed over, and whether those round the body and all of them have been; and the hand-overs in turn. */
  private arrived: ((statics: MapStatics, whole: boolean) => void) | undefined;
  private arriving: ((statics: MapStatics, whole: boolean) => Generator<void, void>) | undefined;
  private handing = Promise.resolve();
  private handedNear = false;
  private near = CITY_NEAR;
  private held: () => boolean = () => false;
  private handed = false;
  private where: () => Place | null = () => null;

  private constructor(asker: Asker, opts: LoaderOptions, at: (p: MapPart) => string, staged: StagedMap) {
    this.asker = asker;
    this.wait = opts.wait;
    this.pause = opts.pause ?? (() => Promise.resolve());
    this.at = at;
    this.staged = staged;
    const head = staged.head;
    this.left = handOverParts(head).filter((p) => p.kind !== "land" && !everywhere(head, p));
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
   * From now on the rest of the map comes, nearest first to where `where` has the body, else to the map's first spawn
   * point, the overviews within CITY_NEAR and then its sectors before the rest but for what is within RING, and the
   * overviews past it before their sectors, each sector's ground before its statics. Resolves once the ground and the overviews the first frame waits for where it has the body now have come,
   * alone. From then on `then.say` is told what the player is; `then.arrived` is handed the statics of the sectors within
   * CITY_NEAR of the body once their overviews, ground and statics have come and not every part has, and then the map's
   * statics once every part has come, `whole`; and `then.arriving` the same, whose steps are taken with a pause between
   * each, as the copy of those round the body is, before the next is handed over. `then.near` stands for CITY_NEAR. While
   * `then.held` says the game's socket is held back, one part at a time is under way.
   */
  async follow(where: () => Place | null, then: { readonly say?: (line: string) => void; readonly arrived?: (statics: MapStatics, whole: boolean) => void; readonly arriving?: (statics: MapStatics, whole: boolean) => Generator<void, void>; readonly near?: number; readonly held?: () => boolean } = {}): Promise<void> {
    this.where = where;
    this.near = then.near ?? CITY_NEAR;
    this.held = then.held ?? (() => false);
    const head = this.staged.head;
    const { x, z } = this.place();
    const near = firstFrameParts(head, x, z).filter((p) => this.left.includes(p));
    for (const p of near) this.left.splice(this.left.indexOf(p), 1);
    await Promise.all(near.map((p) => this.must(p)));
    this.asker.say("");
    this.asker.late = true;
    if (then.say) this.asker.say = then.say;
    this.arrived = then.arrived;
    this.arriving = then.arriving;
    this.pump();
  }

  /**
   * Asks for the nearest parts left until as many are under way as the nearest allows (URGENT_AT_ONCE or AFTER_AT_ONCE, or
   * one while the game's socket is held back); hands
   * the statics round the body over once their sectors have come, and all of them once every part has.
   */
  private pump(): void {
    for (let k = this.nearest(); k >= 0 && this.under < (this.held() ? 1 : this.urgent(this.left[k]!) ? URGENT_AT_ONCE : AFTER_AT_ONCE); k = this.nearest()) {
      const p = this.left.splice(k, 1)[0]!;
      this.under++;
      void this.ask(p).then(
        async (got) => {
          if (got !== 0) {
            await this.wait(got);
            this.left.push(p);
          }
          this.under--;
          this.pump();
        },
        // Broken: nothing more is handed over.
        (e: unknown) => ((this.handed = true), this.asker.say(why(e))),
      );
    }
    const head = this.staged.head;
    if (this.under > 0 || this.left.length > 0) {
      this.handNear();
      return;
    }
    if (this.handed) return;
    this.handed = true;
    const table = this.table ?? blankStatics(head, false);
    this.handOver(function* () {
      return table;
    }, true);
  }

  /** The statics of the sectors within `near` of the body handed over, once those sectors' overviews, ground and statics have all come. */
  private handNear(): void {
    if (this.handedNear || this.handed) return;
    const head = this.staged.head;
    const near = head.parts.filter((p) => (p.kind === "overview" || p.kind === "ground" || p.kind === "statics") && this.off(p) <= this.near);
    if (near.some((p) => !this.came.has(p) && !everywhere(head, p))) return;
    this.handedNear = true;
    const sectors = near.filter((p) => p.kind === "statics");
    if (sectors.length > 0) this.handOver(() => rowsOf(head, this.table!, sectors), false);
  }

  /**
   * Hands over the statics `make` makes, a step at a time, once those before them have been: to `arrived`, and then to
   * `arriving` a step at a time. Those round the body are let go once the whole map's are on their way.
   */
  private handOver(make: () => Generator<void, MapStatics>, whole: boolean): void {
    this.handing = this.handing
      .then(async () => {
        if (!whole && this.handed) return;
        const statics = await stepped(make(), this.pause);
        if (!whole && this.handed) return;
        this.arrived?.(statics, whole);
        if (this.arriving) await stepped(this.arriving(statics, whole), this.pause);
      })
      .catch((e: unknown) => this.asker.say(why(e)));
  }

  /** Where the body is, or the map's first spawn point standing still. */
  private place(): Place {
    const head = this.staged.head;
    const spawn = head.spawns[0] ?? { x: (head.dims.chunksX * CHUNK_SIZE) / 2, z: (head.dims.chunksZ * CHUNK_SIZE) / 2 };
    return this.where() ?? { x: spawn.x, z: spawn.z, vx: 0, vz: 0 };
  }

  /** Metres from the body, or from where it will be LEAD seconds on if that is nearer, to part `p`'s square. */
  private off(p: MapPart): number {
    const head = this.staged.head;
    const { x, z, vx, vz } = this.place();
    return Math.min(offOf(head, p, x, z), offOf(head, p, x + vx * LEAD, z + vz * LEAD));
  }

  /** Whether part `p` is an overview or ground within RING of the body or of where it is heading. */
  private urgent(p: MapPart): boolean {
    return (p.kind === "ground" || p.kind === "overview") && this.off(p) <= RING;
  }

  /**
   * Which of the parts left goes next, nearest first within each of these in turn: the overviews and ground within RING;
   * the overviews within CITY_NEAR and then its sectors, which the far city waits for; the overviews past it; the rest. A
   * sector's ground goes before its statics; -1 for none.
   */
  private nearest(): number {
    let best = -1;
    let least = Infinity;
    this.left.forEach((p, k) => {
      const off = this.off(p);
      const turn = this.urgent(p) ? 0 : (off <= this.near ? 1 : 3) + (p.kind === "overview" ? 0 : 1);
      const rank = turn * 1e6 + off + (p.kind === "statics" ? 0.5 : 0);
      if (rank < least) [best, least] = [k, rank];
    });
    return best;
  }

  /** Part `p` asked for until it comes, and taken in. */
  private async must(p: MapPart): Promise<void> {
    for (let got = await this.ask(p); got !== 0; got = await this.ask(p)) await this.wait(got);
  }

  /**
   * Part `p` asked for once and checked against its hash: a sector's statics read and set in the map's, any other read
   * and taken in. Gives 0, or the milliseconds to wait before it is asked for again.
   */
  private async ask(p: MapPart): Promise<number> {
    const head = this.staged.head;
    const got = await this.asker.ask(p.name, this.at(p), (bytes) => {
      if (p.kind !== "statics") return readPart(head, p, bytes);
      if (bytes.length !== p.length || partHash(bytes) !== p.hash) throw new Error(`map: its part ${p.name} is damaged or another's: its bytes are not those its head names`);
      return bytes;
    });
    if ("wait" in got) return got.wait;
    if (got.value instanceof Uint8Array) {
      const piece = await stepped(partSteps(head, p, got.value, false), this.pause);
      await stepped(setStatics(head, (this.table ??= blankStatics(head, false)), piece as StaticsPiece), this.pause);
    } else this.staged.take(got.value);
    this.came.add(p);
    return 0;
  }
}

/** `steps` taken to their end, with a pause after each. */
async function stepped<T>(steps: Generator<void, T>, pause: () => Promise<void>): Promise<T> {
  for (let s = steps.next(); ; s = steps.next()) {
    if (s.done) return s.value;
    await pause();
  }
}

/** Of `table`, the map's statics as its head lays them out, the rows of `sectors` alone, a table of their own, a slice of rows a step. */
function* rowsOf(head: MapHead, table: MapStatics, sectors: readonly MapPart[]): Generator<void, MapStatics> {
  const { dims, counts } = head;
  const kept = new Uint8Array(counts.length);
  for (const p of sectors) {
    const sq = squareOf(dims, SECTOR_CHUNKS, p.col, p.row)!;
    for (let cz = sq.cz0; cz < sq.cz1; cz++) for (let cx = sq.cx0; cx < sq.cx1; cx++) kept[cz * dims.chunksX + cx] = 1;
  }
  const out = MapStatics.blank(head.kinds, counts.length, counts.reduce((n, k, c) => n + kept[c]! * k, 0), false);
  for (let c = 0; c < counts.length; c++) out.first[c + 1] = out.first[c]! + kept[c]! * counts[c]!;
  for (let c = 0, since = 0; c < counts.length; c++) {
    const from = table.first[c]!, to = table.first[c + 1]!, at = out.first[c]!;
    if (kept[c] === 0 || to === from) continue;
    for (const k of ["kind", "yaw", "x", "y", "z"] as const) out[k].set(table[k].subarray(from, to), at);
    if ((since += to - from) >= COPY_SLICE) {
      since = 0;
      yield;
    }
  }
  return out;
}

/** Rows rowsOf copies between two pauses. */
const COPY_SLICE = 1 << 16;

/** Metres from (x, z) to the map's part `p`'s square, an overview's or a sector's. */
function offOf(head: MapHead, p: MapPart, x: number, z: number): number {
  const sq = squareOf(head.dims, p.kind === "overview" ? OVERVIEW_CHUNKS : SECTOR_CHUNKS, p.col, p.row)!;
  return Math.hypot(Math.max(sq.cx0 * CHUNK_SIZE - x, x - sq.cx1 * CHUNK_SIZE, 0), Math.max(sq.cz0 * CHUNK_SIZE - z, z - sq.cz1 * CHUNK_SIZE, 0));
}
