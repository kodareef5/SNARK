// A map as the page takes it in parts (shared/world/mapfile.ts). Before anything is drawn: its head, its landmarks'
// definitions, which the welcome's registry holds, and every overview, whose ground stands in for each sector's until it
// comes (shared/world/heightfield.ts). Then the ground of the sectors within reach of the body, which the first frame waits
// for and which come alone; then the rest of the
// ground nearest first, by where the body is and where it is heading, a few at once and ordered again at each ask, so a
// jump goes first to where it lands; and last the statics, all of them, handed over once every part has come. A part that
// fails is asked for again after a wait that grows to a cap, for as long as the page lives, and what has come is kept. One
// that comes damaged or as another's is refused by name and asked for again, until the DAMAGED_MOST-th time breaks the map.

import { CHUNK_SIZE, SECTOR_CHUNKS } from "../../shared/coords.ts";
import type { Def } from "../../shared/content/defs.ts";
import { Heightfield, TERRAIN_CELL } from "../../shared/world/heightfield.ts";
import { OVERVIEW_STEP, blankLayers, joinWater, listedRows, partHash, readHead, readPart, setGround, setNodes, squareOf, type GroundPiece, type MapContent, type MapHead, type MapPart, type MapPiece, type MapStatics, type NodeLayer } from "../../shared/world/mapfile.ts";
import { fetchBytes, readStatics, within, type Get } from "./fetched.ts";
import { PREDICTED_REACH } from "./session.ts";

/**
 * Parts asked for at once: as many as a browser opens to a host over HTTP/1.1, so that on a link of 100 ms a request one
 * part's round trip is mostly hidden by the others' bytes.
 */
export const PARTS_AT_ONCE = 6;
/** Seconds of the body's way ahead of it whose ground is asked for as if the body were there. */
export const LEAD = 2;
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
 * Whether the first frame waits for part `p` wherever the body is: the landmarks' definitions, every overview, and on a map
 * with a listed node layer every sector's ground, since the head does not say that layer's slots a chunk and a node source
 * counts them as it is made.
 */
function everywhere(head: MapHead, p: MapPart): boolean {
  return p.kind === "land" || p.kind === "overview" || (p.kind === "ground" && head.layers.some((rule) => rule.type === 1));
}

/**
 * A map as a client holds it while its parts come: its ground, in which a sample not yet its sector's is its overview's,
 * its node layers, its water and its landmarks. Every overview is taken before anything reads it.
 */
export class StagedMap {
  readonly head: MapHead;
  readonly hf: Heightfield;
  readonly nodes: NodeLayer[];
  /** The landmarks the head places and the definitions the land part adds, or undefined where the head has none. */
  content: MapContent | undefined;
  private readonly grounds: GroundPiece[] = [];
  private readonly water: { readonly chunks: Uint32Array; readonly squares: Uint16Array }[] = [];

  constructor(head: MapHead) {
    this.head = head;
    this.hf = new Heightfield(head.dims, TERRAIN_CELL, head.minY, head.stepY);
    this.hf.seaLevel = head.seaLevel;
    this.hf.holdNone();
    this.nodes = blankLayers(head);
    this.content = head.landmarks ? { landmarks: head.landmarks, defs: [] } : undefined;
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
      if (piece.water) this.water.push(piece.water);
    } else if (piece.kind === "ground") {
      setGround(dims, this.hf.heights, this.hf.tint, piece);
      this.grounds.push(piece);
      // Listed layer k's rows from the sectors' grounds come so far, set in the layer the node source reads.
      this.head.layers.forEach((rule, k) => rule.type === 1 && piece.listed[k]!.count.some((n) => n > 0) && Object.assign(this.nodes[k]!, listedRows(dims, rule.kinds, k, this.grounds)));
      this.hf.hold(piece.sq.cx0, piece.sq.cz0, piece.sq.cx1, piece.sq.cz1);
    }
  }

  /** The water of every overview, once they have all come: as joinParts makes it (shared/world/mapfile.ts). */
  settle(): void {
    if (this.head.water) this.hf.water = joinWater(this.head, this.water);
  }
}

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
  /** The ground parts not yet asked for, or failed and to be asked for again; and the statics', in the head's order. */
  private readonly grounds: MapPart[];
  private readonly rest: MapPart[];
  /** The statics' bytes as each has come, until they are handed over. */
  private readonly kept = new Map<MapPart, Uint8Array>();
  private where: () => Place | null = () => null;

  private constructor(asker: Asker, opts: LoaderOptions, at: (p: MapPart) => string, staged: StagedMap) {
    this.asker = asker;
    this.wait = opts.wait;
    this.pause = opts.pause ?? (() => Promise.resolve());
    this.at = at;
    this.staged = staged;
    const head = staged.head;
    this.grounds = head.parts.filter((p) => p.kind === "ground" && !everywhere(head, p));
    this.rest = head.parts.filter((p) => p.kind === "statics");
  }

  /**
   * The map whose head is at `url`, once its head and the parts its first frame waits for wherever the body is have come,
   * six at once: its landmarks' definitions and its overviews, and on a map with a listed node layer all its ground.
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
    loader.staged.settle();
    asker.say("");
    return loader;
  }

  /**
   * From now on the rest of the map comes, the ground nearest first to where `where` has the body, else to the map's first
   * spawn point. Resolves once the ground the first frame waits for where it has the body now has come, alone. From then
   * on `then.say` is told what the player is, and once every part has come `then.arrived` is handed the map's statics,
   * read a step at a time.
   */
  async follow(where: () => Place | null, then: { readonly say?: (line: string) => void; readonly arrived?: (statics: MapStatics) => void } = {}): Promise<void> {
    this.where = where;
    const head = this.staged.head;
    const { x, z } = this.place(), r = PREDICTED_REACH;
    const near = this.grounds.filter((p) => {
      const sq = squareOf(head.dims, SECTOR_CHUNKS, p.col, p.row)!;
      return sq.cx0 * CHUNK_SIZE <= x + r && sq.cx1 * CHUNK_SIZE >= x - r && sq.cz0 * CHUNK_SIZE <= z + r && sq.cz1 * CHUNK_SIZE >= z - r;
    });
    for (const p of near) this.grounds.splice(this.grounds.indexOf(p), 1);
    await Promise.all(near.map((p) => this.must(p)));
    this.asker.say("");
    this.asker.late = true;
    if (then.say) this.asker.say = then.say;
    const lane = async (): Promise<void> => {
      for (let p = this.next(); p; p = this.next()) {
        const got = await this.ask(p);
        if (got === 0) continue;
        await this.wait(got);
        const k = this.rest.findIndex((q) => q.at > p.at);
        if (p.kind === "ground") this.grounds.push(p);
        else this.rest.splice(k < 0 ? this.rest.length : k, 0, p);
      }
    };
    void Promise.all(Array.from({ length: PARTS_AT_ONCE }, lane))
      .then(() => {
        const parts = head.parts.filter((p) => this.kept.has(p)).map((p) => ({ part: p, bytes: this.kept.get(p)! }));
        this.kept.clear();
        return readStatics({ head, parts }, this.pause);
      })
      .then((statics) => then.arrived?.(statics), (e: unknown) => this.asker.say(why(e)));
  }

  /** Where the body is, or the map's first spawn point standing still. */
  private place(): Place {
    const head = this.staged.head;
    const spawn = head.spawns[0] ?? { x: (head.dims.chunksX * CHUNK_SIZE) / 2, z: (head.dims.chunksZ * CHUNK_SIZE) / 2 };
    return this.where() ?? { x: spawn.x, z: spawn.z, vx: 0, vz: 0 };
  }

  /** The ground part nearest the body or where it will be LEAD seconds on, else the statics' next in order, else null. */
  private next(): MapPart | null {
    if (this.grounds.length === 0) return this.rest.shift() ?? null;
    const head = this.staged.head;
    const { x, z, vx, vz } = this.place();
    let best = 0;
    let least = Infinity;
    this.grounds.forEach((p, k) => {
      const off = Math.min(offOf(head, p, x, z), offOf(head, p, x + vx * LEAD, z + vz * LEAD));
      if (off < least) [best, least] = [k, off];
    });
    return this.grounds.splice(best, 1)[0]!;
  }

  /** Part `p` asked for until it comes, and taken in. */
  private async must(p: MapPart): Promise<void> {
    for (let got = await this.ask(p); got !== 0; got = await this.ask(p)) await this.wait(got);
  }

  /**
   * Part `p` asked for once and checked against its hash: a sector's statics kept, any other read and taken in. Gives 0, or
   * the milliseconds to wait before it is asked for again.
   */
  private async ask(p: MapPart): Promise<number> {
    const head = this.staged.head;
    const got = await this.asker.ask(p.name, this.at(p), (bytes) => {
      if (p.kind !== "statics") return readPart(head, p, bytes);
      if (bytes.length !== p.length || partHash(bytes) !== p.hash) throw new Error(`map: its part ${p.name} is damaged or another's: its bytes are not those its head names`);
      return bytes;
    });
    if ("wait" in got) return got.wait;
    if (got.value instanceof Uint8Array) this.kept.set(p, got.value);
    else this.staged.take(got.value);
    return 0;
  }
}

/** Metres from (x, z) to the map's part `p`'s square. */
function offOf(head: MapHead, p: MapPart, x: number, z: number): number {
  const sq = squareOf(head.dims, SECTOR_CHUNKS, p.col, p.row)!;
  return Math.hypot(Math.max(sq.cx0 * CHUNK_SIZE - x, x - sq.cx1 * CHUNK_SIZE, 0), Math.max(sq.cz0 * CHUNK_SIZE - z, z - sq.cz1 * CHUNK_SIZE, 0));
}
