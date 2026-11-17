// A map as the page takes it in parts (shared/world/mapfile.ts). Before anything is drawn: its head, its landmarks'
// definitions, which the welcome's registry holds, and every overview, whose ground stands in for each sector's until it
// comes (shared/world/heightfield.ts). Then the ground of the sectors within reach of the body, which the first frame waits
// for and which come alone; then the rest of the ground nearest first, by where the body is and where it is heading, a few
// at once and ordered again at each ask, so a jump goes first to where it lands; and last the statics, all of them.

import { CHUNK_SIZE, SECTOR_CHUNKS } from "../../shared/coords.ts";
import type { Def } from "../../shared/content/defs.ts";
import { Heightfield, TERRAIN_CELL } from "../../shared/world/heightfield.ts";
import { OVERVIEW_STEP, blankLayers, joinWater, listedRows, readPart, setGround, setNodes, squareOf, type GroundPiece, type MapContent, type MapHead, type MapPart, type MapPiece, type NodeLayer } from "../../shared/world/mapfile.ts";
import { fetchBytes, fetchHead, type FetchedStatics, type Get } from "./fetched.ts";
import { PREDICTED_REACH } from "./session.ts";

/**
 * Parts asked for at once: as many as a browser opens to a host over HTTP/1.1, so that on a link of 100 ms a request one
 * part's round trip is mostly hidden by the others' bytes.
 */
export const PARTS_AT_ONCE = 6;
/** Seconds of the body's way ahead of it whose ground is asked for as if the body were there. */
export const LEAD = 2;

/** Where a body is and how fast it goes, in metres and metres a second. */
export interface Place {
  readonly x: number;
  readonly z: number;
  readonly vx: number;
  readonly vz: number;
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

/** Metres from (x, z) to the map's part `p`'s square. */
function offOf(head: MapHead, p: MapPart, x: number, z: number): number {
  const sq = squareOf(head.dims, SECTOR_CHUNKS, p.col, p.row)!;
  return Math.hypot(Math.max(sq.cx0 * CHUNK_SIZE - x, x - sq.cx1 * CHUNK_SIZE, 0), Math.max(sq.cz0 * CHUNK_SIZE - z, z - sq.cz1 * CHUNK_SIZE, 0));
}

/** The page's map as its parts come, each checked against the hash its head names. */
export class MapLoader {
  readonly staged: StagedMap;
  /** Every statics part, in its head's order, once each has come and so has every part of the ground. */
  readonly statics: Promise<FetchedStatics>;
  private readonly get: Get;
  private readonly at: (p: MapPart) => string;
  /** The ground parts not yet asked for, and the statics'. */
  private readonly grounds: MapPart[];
  private readonly rest: MapPart[];
  private where: () => Place | null = () => null;
  private done!: (parts: FetchedStatics) => void;
  private failed!: (why: unknown) => void;

  private constructor(get: Get, at: (p: MapPart) => string, staged: StagedMap) {
    this.get = get;
    this.at = at;
    this.staged = staged;
    this.grounds = staged.head.parts.filter((p) => p.kind === "ground");
    this.rest = staged.head.parts.filter((p) => p.kind === "statics");
    this.statics = new Promise((done, failed) => ((this.done = done), (this.failed = failed)));
    // Read by readStatics, and failing there; a page that never asks for them leaves it.
    this.statics.catch(() => {});
  }

  /**
   * The map whose head is at `url`, once its head, its landmarks' definitions and its overviews have come, six at once.
   * A listed node layer's slots a chunk are the most rows a chunk of it has, which the head does not say, and a node
   * source counts its slots as it is made: a map with one comes with all its ground here, before any source is made.
   */
  static async start(get: Get, url: string): Promise<MapLoader> {
    const { head, at } = await fetchHead(get, url);
    const loader = new MapLoader(get, at, new StagedMap(head));
    const listed = head.layers.some((rule) => rule.type === 1);
    const first = head.parts.filter((p) => p.kind === "land" || p.kind === "overview" || (listed && p.kind === "ground"));
    if (listed) loader.grounds.length = 0;
    let next = 0;
    const lane = async (): Promise<void> => {
      for (let k = next++; k < first.length; k = next++) loader.staged.take(await loader.fetched(first[k]!));
    };
    await Promise.all(Array.from({ length: Math.min(PARTS_AT_ONCE, first.length) }, lane));
    loader.staged.settle();
    return loader;
  }

  /**
   * From now on the rest of the map comes, the ground nearest first to where `where` has the body, else to the map's
   * first spawn point. Resolves once the sectors within `reach` of where it has the body now are held, which come alone.
   */
  async follow(where: () => Place | null, reach = PREDICTED_REACH): Promise<void> {
    this.where = where;
    const { x, z } = this.place();
    const near = this.grounds.filter((p) => {
      const sq = squareOf(this.staged.head.dims, SECTOR_CHUNKS, p.col, p.row)!;
      return sq.cx0 * CHUNK_SIZE <= x + reach && sq.cx1 * CHUNK_SIZE >= x - reach && sq.cz0 * CHUNK_SIZE <= z + reach && sq.cz1 * CHUNK_SIZE >= z - reach;
    });
    for (const p of near) this.grounds.splice(this.grounds.indexOf(p), 1);
    try {
      await Promise.all(near.map(async (p) => this.staged.take(await this.fetched(p))));
    } catch (why) {
      this.failed(why);
      throw why;
    }
    const kept: { part: MapPart; bytes: Uint8Array }[] = [];
    const lane = async (): Promise<void> => {
      for (let p = this.next(); p; p = this.next()) {
        if (p.kind === "ground") this.staged.take(await this.fetched(p));
        else kept.push({ part: p, bytes: await this.bytes(p) });
      }
    };
    const head = this.staged.head;
    void Promise.all(Array.from({ length: PARTS_AT_ONCE }, lane)).then(() => this.done({ head, parts: head.parts.filter((p) => p.kind === "statics").map((p) => kept.find((k) => k.part === p)!) }), this.failed);
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

  private async bytes(p: MapPart): Promise<Uint8Array> {
    return new Uint8Array(await fetchBytes(this.get, this.at(p)));
  }

  /** Part `p` fetched and read, checked against its hash. */
  private async fetched(p: MapPart): Promise<MapPiece> {
    return readPart(this.staged.head, p, await this.bytes(p));
  }
}
