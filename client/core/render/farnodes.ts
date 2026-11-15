// Trees, rocks and bushes past the near node field, placed by the client from the map alone (shared/world/nodes.ts):
// the node the near field would hold, at its spot, as its variant, turned and sized as near, so the tree far is the
// tree near. Each is drawn flat at its mesh's coarsest levels to its kind's reach and dropped over the last share of
// it as far blocks are (far.ts). The nodes of 4 by 4 chunks are one instance buffer, sorted by mesh and by chunk, made
// again when a chunk of it changes hands with the near field, when the client is told of nodes used up there, when
// the far feed shows building there, and when a kind comes within reach of it.

import type { NodeDef } from "../../../shared/content/defs.ts";
import type { Registry } from "../../../shared/content/registry.ts";
import { CHUNK_SIZE, chunkCount, chunkCx, chunkCz, type MapDims } from "../../../shared/coords.ts";
import { INSTANCE_BYTES } from "../../../shared/pack/pack.ts";
import { SIZE_UNITS, nodeForms, type NodeForms, type NodeSource, type NodeSpot } from "../../../shared/world/nodes.ts";
import { TACTICAL_CELL } from "../../../shared/world/tactical.ts";
import type { Tier } from "../assets/tiers.ts";
import type { FarStore } from "../farcells.ts";
import type { Camera } from "./camera.ts";
import { FAR_TILE, FAR_TILE_METRES } from "./far.ts";
import { InstanceWriter, PASS_FAR, PASS_NEAR, type FramePacket } from "./packet.ts";

/** Instance buffers of far node tiles are numbered from here, clear of chunks, the node store's and the far blocks'. */
export const FAR_NODE_BUFFERS = 3 << 20;
/** The tier's reach each kind of node takes, by its family. */
export const FAMILIES = ["trees", "rocks", "bushes"] as const;
/**
 * Triangles of a far node's coarsest level that the round 8 plan's triangle rows assume, by family: a tree 12, a rock
 * or a bush 8. A kind whose level weighs more is drawn to a reach cut so that as many triangles are in view.
 */
export const FAMILY_TRIANGLES: readonly number[] = [12, 8, 8];
/** A form with nothing to draw, as the scene marks it. */
export const NO_MESH = 0xffff;
/** What the far nodes hold on the card, as residency.ts reserves it. */
const RESERVE = "far nodes";
/**
 * Tiles nearer than this may hold chunks the near field takes or lets go of (it holds 3 chunks round the body's), so
 * they keep their chunks' nodes worked out, to make again in the frame a chunk changes hands. Of tiles made for any
 * other reason, this many a frame, nearest first.
 */
const FAR_NOW = 512;
const FAR_MAKES = 2;
/** A tile holds the kinds whose reach comes within this of it, so a kind is there before it is in reach. */
const MARGIN = FAR_TILE_METRES / 2;
/** A draw costs about what drawing this many more triangles does: scene.ts's RUN_TRIANGLES (D289). */
const RUN_TRIANGLES = 4096;
/** Chunks in a tile, each a cell levels are chosen by, one row and then the next back the other way. */
const CELLS = FAR_TILE * FAR_TILE;
/** The far feed's 4 m cells along a chunk's side. */
const BUILT_SIDE = CHUNK_SIZE / TACTICAL_CELL;
/** Both depth ranges (packet.ts PASS_NEAR and PASS_FAR, a bit each). */
const BOTH = (1 << PASS_NEAR) | (1 << PASS_FAR);

/** Which family a node kind is: trees are cut with wood, rocks with stone, and the rest are picked by hand. */
export function familyOf(def: NodeDef): number {
  return def.material === "wood" ? 0 : def.material === "stone" ? 1 : 2;
}

/** How far a kind of `family` whose coarsest level has `triangles` is drawn on `tier`: the family's reach, cut as FAMILY_TRIANGLES says. */
export function farReach(tier: Tier, family: number, triangles: number): number {
  const reach = tier.reach[FAMILIES[family]!];
  const most = FAMILY_TRIANGLES[family]!;
  return triangles <= most ? reach : reach * Math.sqrt(most / triangles);
}

/**
 * Which chunks' far nodes may have changed: the near field took or let go of them, or the client was told which of
 * their nodes are used up. `changed` holds, per chunk, the `version` it last changed at, as FarStore.changed does.
 */
export class NodeChanges {
  version = 0;
  readonly changed: Uint32Array;
  private readonly dims: MapDims;

  constructor(dims: MapDims) {
    this.dims = dims;
    this.changed = new Uint32Array(chunkCount(dims));
  }

  touch(chunk: number): void {
    this.changed[chunk] = ++this.version;
  }

  /** The near field let go of the square of chunks `radius` round `from` (-1 for none) and took the one round `to`. */
  moved(from: number, to: number, radius: number): void {
    const d = this.dims;
    const within = (chunk: number, center: number): boolean => center >= 0 && Math.abs(chunkCx(d, chunk) - chunkCx(d, center)) <= radius && Math.abs(chunkCz(d, chunk) - chunkCz(d, center)) <= radius;
    for (const center of [from, to]) {
      if (center < 0) continue;
      const [cx, cz] = [chunkCx(d, center), chunkCz(d, center)];
      for (let z = Math.max(0, cz - radius); z <= Math.min(d.chunksZ - 1, cz + radius); z++) {
        for (let x = Math.max(0, cx - radius); x <= Math.min(d.chunksX - 1, cx + radius); x++) {
          const chunk = z * d.chunksX + x;
          if (within(chunk, from) !== within(chunk, to)) this.touch(chunk);
        }
      }
    }
  }
}

/** What far nodes are placed from: the map's nodes, the chunks the near field holds, and what the client was told is used up. */
export interface FarNodeSource {
  readonly nodes: NodeSource;
  held(chunk: number): boolean;
  /** The slots of `chunk` last said to be used up, if any were. */
  gone(chunk: number): readonly number[] | undefined;
  readonly changes: NodeChanges;
}

/** How the scene draws nodes: per form its mesh (or NO_MESH), its size in SIZE_UNITS and its colour, and per mesh its bounds and triangles. */
export interface NodeLooks {
  readonly meshOfForm: Uint16Array;
  readonly sizeOfForm: Uint8Array;
  readonly colorOfForm: Uint8Array;
  readonly side: Float32Array;
  readonly low: Float32Array;
  readonly high: Float32Array;
  readonly tris: readonly (readonly number[])[];
}

/** The level to draw a mesh at, `distance` metres off, given the level it had (or -1). */
export type ChooseLevel = (mesh: number, distance: number, was: number) => number;
/** A draw of `count` instances of a mesh at a level, gone at `fade` metres, the nearest of them `distance` off. */
export type PutDraw = (mesh: number, level: number, buffer: number, first: number, count: number, ox: number, oy: number, oz: number, passes: number, fade: number, distance: number) => void;

/** The nodes of a tile's chunks as the map places them. */
interface Spots {
  /** Per cell, 1 once its chunk's nodes are worked out. */
  readonly have: Uint8Array;
  /** Per cell and slot: its form (0 for none), place and turn. */
  readonly form: Uint16Array;
  readonly pos: Float32Array;
  readonly yaw: Uint16Array;
}

interface Tile {
  dirty: boolean;
  /** Made dirty by a chunk changing hands with the near field: made in this frame. */
  now: boolean;
  /** Its chunks' nodes, kept while it is within FAR_NOW. */
  spots: Spots | null;
  data: Uint8Array | null;
  slots: Uint16Array | null;
  uploaded: boolean;
  /** The farthest reach, plus MARGIN, of a kind it left out; a tile this near is made again. -1 for none. */
  next: number;
  /** Triples: mesh, first instance, instance count. */
  ranges: number[];
  /** Per range: the first instance of each cell and the end of the last. */
  cellFirst: Uint16Array;
  /** Per range, its box and then each cell's: x, y, z least then most, in the world. */
  box: Float32Array;
  /** Per range, the level it was last drawn at, and per range and cell, or -1. */
  level: Int8Array;
  cellLevel: Int8Array;
  /** The box of all of it, in the world. */
  readonly whole: Float64Array;
}

export class FarNodes {
  /** Bytes of tiles on the card. */
  bytes = 0;
  /** Tiles made a frame for any reason but a chunk changing hands, nearest first. */
  makes = FAR_MAKES;
  private readonly source: FarNodeSource;
  private readonly cells: FarStore | null;
  private readonly dims: MapDims;
  private readonly forms: NodeForms;
  private readonly looks: NodeLooks;
  private readonly tilesX: number;
  private readonly tilesZ: number;
  private readonly perChunk: number;
  /** Per content index of a node: its family, and the triangles of its coarsest level, the mean over its variants by weight. */
  private readonly family: Int8Array;
  private readonly triangles: Float32Array;
  /** Per content index, how far it is drawn on the tier last set, and the farthest of those. Per mesh and per form, its kind's. */
  private readonly reach: Float32Array;
  private readonly meshReach: Float32Array;
  private readonly formReach: Float32Array;
  private most = 0;
  private tier: Tier | null = null;
  private readonly tiles = new Map<number, Tile>();
  private seenNodes = 0;
  private seenCells = 0;
  private readonly waiting: number[] = [];
  private readonly spot: NodeSpot = { kind: 0, form: 0, x: 0, y: 0, z: 0, yaw: 0 };
  // Scratch for making a tile: per mesh and cell a count and then a cursor, which slots of a cell are used up, and which are kept.
  private readonly counts: Uint32Array;
  private readonly gone: Uint8Array;
  private readonly keep: Uint8Array;
  private readonly runs: number[] = [];

  constructor(source: FarNodeSource, cells: FarStore | null, dims: MapDims, reg: Registry, looks: NodeLooks) {
    this.source = source;
    this.cells = cells;
    this.dims = dims;
    this.looks = looks;
    this.forms = nodeForms(reg);
    this.perChunk = source.nodes.perChunk;
    this.tilesX = Math.ceil(dims.chunksX / FAR_TILE);
    this.tilesZ = Math.ceil(dims.chunksZ / FAR_TILE);
    const f = this.forms;
    const meshes = looks.tris.length;
    this.family = new Int8Array(reg.defs.length).fill(-1);
    this.triangles = new Float32Array(reg.defs.length);
    this.reach = new Float32Array(reg.defs.length);
    this.meshReach = new Float32Array(meshes);
    this.formReach = new Float32Array(f.count);
    for (let k = 1; k < reg.defs.length; k++) {
      const d = reg.defs[k];
      if (d?.type !== "node") continue;
      this.family[k] = familyOf(d);
      const sums = f.sums[k]!;
      let [sum, weights] = [0, 0];
      for (let v = 0; v < sums.length; v++) {
        const mesh = looks.meshOfForm[f.first[k]! + v * f.steps[k]!]!;
        const weight = sums[v]! - (v > 0 ? sums[v - 1]! : 0);
        if (mesh === NO_MESH) continue;
        sum += looks.tris[mesh]!.at(-1)! * weight;
        weights += weight;
      }
      this.triangles[k] = weights > 0 ? sum / weights : 0;
    }
    this.counts = new Uint32Array(meshes * CELLS);
    this.gone = new Uint8Array(256);
    this.keep = new Uint8Array(CELLS * this.perChunk);
  }

  /** How far nodes of a kind are drawn on the tier last set, 0 for not at all. */
  reachOf(kind: number): number {
    return this.reach[kind]!;
  }

  /** Tiles waiting to be made. */
  get pending(): number {
    let n = 0;
    for (const tile of this.tiles.values()) if (tile.dirty) n++;
    return n;
  }

  /** After a lost context: every tile goes on the card again. */
  reset(): void {
    for (const tile of this.tiles.values()) tile.uploaded = false;
  }

  /**
   * Brings the tiles within reach of the camera at (x, z) up to date and on the card, and lets go of those a tile past
   * reach. Uploads and drops go into the packet, and what they weigh is spent and reserved in `budget`.
   */
  update(p: FramePacket, budget: { spend(bytes: number): void; reserve(name: string, bytes: number): void }, x: number, z: number, tier: Tier): void {
    this.setTier(tier);
    const changes = this.source.changes;
    if (changes.version !== this.seenNodes) {
      for (let c = 0; c < changes.changed.length; c++) {
        if (changes.changed[c]! <= this.seenNodes) continue;
        const tile = this.tiles.get(this.tileOf(c));
        if (tile) tile.dirty = tile.now = true;
      }
      this.seenNodes = changes.version;
    }
    const cells = this.cells;
    if (cells && cells.version !== this.seenCells) {
      for (let c = 0; c < cells.changed.length; c++) {
        if (cells.changed[c]! <= this.seenCells) continue;
        const tile = this.tiles.get(this.tileOf(c));
        if (tile) tile.dirty = true;
      }
      this.seenCells = cells.version;
    }
    // Tiles come a margin before the farthest reach, so what they hold is there before it can be seen.
    const most = this.most;
    if (most > 0) {
      const span = most + MARGIN;
      const [t0x, t1x] = [Math.max(0, Math.floor((x - span) / FAR_TILE_METRES)), Math.min(this.tilesX - 1, Math.floor((x + span) / FAR_TILE_METRES))];
      const [t0z, t1z] = [Math.max(0, Math.floor((z - span) / FAR_TILE_METRES)), Math.min(this.tilesZ - 1, Math.floor((z + span) / FAR_TILE_METRES))];
      for (let tz = t0z; tz <= t1z; tz++) {
        for (let tx = t0x; tx <= t1x; tx++) {
          const t = tz * this.tilesX + tx;
          if (!this.tiles.has(t) && this.off(t, x, z) <= span) this.tiles.set(t, newTile());
        }
      }
    }
    const waiting = this.waiting;
    waiting.length = 0;
    for (const [t, tile] of this.tiles) {
      const off = this.off(t, x, z);
      if (most <= 0 || off > most + FAR_TILE_METRES) {
        if (tile.uploaded) p.drops.push(FAR_NODE_BUFFERS + t);
        this.tiles.delete(t);
        continue;
      }
      if (off > FAR_NOW) tile.spots = null;
      if (tile.next >= off) tile.dirty = true;
      if (!tile.dirty) continue;
      if (tile.now) this.remake(p, t, tile, off);
      else waiting.push(t);
    }
    waiting.sort((a, b) => this.off(a, x, z) - this.off(b, x, z));
    for (let k = 0; k < Math.min(this.makes, waiting.length); k++)this.remake(p, waiting[k]!, this.tiles.get(waiting[k]!)!, this.off(waiting[k]!, x, z));
    let bytes = 0;
    for (const [t, tile] of this.tiles) {
      if (!tile.data) continue;
      if (!tile.uploaded) {
        p.uploads.push({ buffer: FAR_NODE_BUFFERS + t, data: tile.data, slots: tile.slots! });
        budget.spend(tile.data.length);
        tile.uploaded = true;
      }
      bytes += tile.data.length;
    }
    if (bytes !== this.bytes) budget.reserve(RESERVE, bytes);
    this.bytes = bytes;
  }

  /**
   * Calls `put` for each run of nodes of one mesh on the card, in a tile in view, whose nearest is within its kind's
   * reach: at the level `choose` gives for the nearest point of the tile's nodes of that mesh where its farthest asks
   * the same and all of them are in view, and otherwise for each chunk's, neighbouring chunks one level apart sharing
   * the finer where that costs fewer triangles than a draw, as the near store chooses (scene.ts nodeRanges). A chunk
   * past reach or out of view is left out.
   */
  draw(cam: Camera, choose: ChooseLevel, put: PutDraw): void {
    const tris = this.looks.tris;
    for (const [t, tile] of this.tiles) {
      if (!tile.data || !tile.uploaded) continue;
      const w = tile.whole;
      if (near(w, 0, cam) >= this.most || !visible(w, 0, cam)) continue;
      const whole = inside(w, 0, cam);
      const [ox, oy, oz] = [(t % this.tilesX) * FAR_TILE_METRES - cam.x, -cam.y, Math.floor(t / this.tilesX) * FAR_TILE_METRES - cam.z];
      const buffer = FAR_NODE_BUFFERS + t;
      const b = tile.box;
      for (let r = 0, q = 0; r < tile.ranges.length; r += 3, q++) {
        const mesh = tile.ranges[r]!;
        const reach = this.meshReach[mesh]!;
        const at = q * (CELLS + 1) * 6;
        const dn = near(b, at, cam);
        if (dn >= reach || (!whole && !visible(b, at, cam))) continue;
        const seenAll = whole || inside(b, at, cam);
        const df = far(b, at, cam);
        const level = choose(mesh, dn, tile.level[q]!);
        const along = passes(b, at, cam);
        // One draw where every node of it is in view, in reach, of one level and in one depth range.
        if (seenAll && df < reach && along !== BOTH && level === choose(mesh, df, tile.level[q]!)) {
          tile.level[q] = level;
          tile.cellLevel.fill(level, q * CELLS, (q + 1) * CELLS);
          put(mesh, level, buffer, tile.ranges[r + 1]!, tile.ranges[r + 2]!, ox, oy, oz, along, reach, dn);
          continue;
        }
        tile.level[q] = -1;
        // Runs of neighbouring cells of the same depth ranges: first and end instance, the finer and the coarser level
        // asked, the nearest, and the ranges.
        const runs = this.runs;
        runs.length = 0;
        const cost = tris[mesh]!;
        for (let c = 0; c < CELLS; c++) {
          const first = tile.cellFirst[q * (CELLS + 1) + c]!;
          const end = tile.cellFirst[q * (CELLS + 1) + c + 1]!;
          if (end === first) continue;
          const k = at + (c + 1) * 6;
          const seen = near(b, k, cam);
          if (seen >= reach || (!seenAll && !visible(b, k, cam))) continue;
          const lv = (tile.cellLevel[q * CELLS + c] = choose(mesh, seen, tile.cellLevel[q * CELLS + c]!));
          const cp = passes(b, k, cam);
          const last = runs.length - 6;
          if (last >= 0 && runs[last + 1] === first && runs[last + 5] === cp) {
            const [finer, coarser] = [Math.min(runs[last + 2]!, lv), Math.max(runs[last + 3]!, lv)];
            const coarse = lv > runs[last + 2]! ? end - first : lv < runs[last + 2]! ? runs[last + 1]! - runs[last]! : 0;
            if (coarser - finer <= 1 && coarse * ((cost[finer] ?? 0) - (cost[coarser] ?? 0)) <= RUN_TRIANGLES) {
              [runs[last + 1], runs[last + 2], runs[last + 3], runs[last + 4]] = [end, finer, coarser, Math.min(runs[last + 4]!, seen)];
              continue;
            }
          }
          runs.push(first, end, lv, lv, seen, cp);
        }
        for (let k = 0; k < runs.length; k += 6) put(mesh, runs[k + 2]!, buffer, runs[k]!, runs[k + 1]! - runs[k]!, ox, oy, oz, runs[k + 5]!, reach, runs[k + 4]!);
      }
    }
  }

  /**
   * The tier sets each kind's reach. Where one grows, every tile is made again, nearest first; where none does, the
   * tiles hold what they need and what is past reach is not drawn.
   */
  private setTier(tier: Tier): void {
    if (tier === this.tier) return;
    this.tier = tier;
    this.most = 0;
    this.meshReach.fill(0);
    let grew = false;
    for (let k = 0; k < this.family.length; k++) {
      if (this.family[k]! < 0) continue;
      const reach = farReach(tier, this.family[k]!, this.triangles[k]!);
      grew ||= reach > this.reach[k]!;
      this.reach[k] = reach;
      this.most = Math.max(this.most, reach);
    }
    const f = this.forms;
    for (let form = 1; form < f.count; form++) {
      const mesh = this.looks.meshOfForm[form]!;
      this.formReach[form] = mesh === NO_MESH ? 0 : this.reach[f.kind[form]!]!;
      if (mesh !== NO_MESH) this.meshReach[mesh] = Math.max(this.meshReach[mesh]!, this.formReach[form]!);
    }
    if (grew) for (const tile of this.tiles.values()) tile.dirty = true;
  }

  private tileOf(chunk: number): number {
    return Math.floor(chunkCz(this.dims, chunk) / FAR_TILE) * this.tilesX + Math.floor(chunkCx(this.dims, chunk) / FAR_TILE);
  }

  private chunkOf(t: number, c: number): number {
    return chunkOfCell(this.dims, t, c);
  }

  /** Metres from (x, z) to tile `t`'s square. */
  private off(t: number, x: number, z: number): number {
    const ox = (t % this.tilesX) * FAR_TILE_METRES;
    const oz = Math.floor(t / this.tilesX) * FAR_TILE_METRES;
    return Math.hypot(Math.max(ox - x, x - ox - FAR_TILE_METRES, 0), Math.max(oz - z, z - oz - FAR_TILE_METRES, 0));
  }

  private remake(p: FramePacket, t: number, tile: Tile, off: number): void {
    tile.dirty = tile.now = false;
    this.make(t, tile, off);
    if (tile.data) tile.uploaded = false;
    else if (tile.uploaded) {
      p.drops.push(FAR_NODE_BUFFERS + t);
      tile.uploaded = false;
    }
  }

  /** The nodes of cell `c` of a tile, worked out from the map once while the tile keeps them. */
  private spotsOf(tile: Tile, c: number, chunk: number): Spots {
    const n = this.perChunk;
    const s = (tile.spots ??= { have: new Uint8Array(CELLS), form: new Uint16Array(CELLS * n), pos: new Float32Array(CELLS * n * 3), yaw: new Uint16Array(CELLS * n) });
    if (s.have[c]) return s;
    const spot = this.spot;
    for (let i = 0; i < n; i++) {
      this.source.nodes.at(chunk, i, spot);
      const at = c * n + i;
      s.form[at] = spot.kind === 0 ? 0 : spot.form;
      if (spot.kind === 0) continue;
      s.pos[at * 3] = spot.x;
      s.pos[at * 3 + 1] = spot.y;
      s.pos[at * 3 + 2] = spot.z;
      s.yaw[at] = spot.yaw;
    }
    s.have[c] = 1;
    return s;
  }

  /**
   * Makes tile `t`, `off` metres from the camera: the nodes of its chunks the near field does not hold, less those used
   * up, those under building, and those of kinds whose reach is short of it by more than MARGIN.
   */
  private make(t: number, tile: Tile, off: number): void {
    const { meshOfForm, sizeOfForm, colorOfForm, side, low, high } = this.looks;
    const formReach = this.formReach;
    const n = this.perChunk;
    const counts = this.counts.fill(0);
    const keep = this.keep.fill(0);
    const gone = this.gone;
    const [ox, oz] = [(t % this.tilesX) * FAR_TILE_METRES, Math.floor(t / this.tilesX) * FAR_TILE_METRES];
    let next = -1;
    let total = 0;
    let spots: Spots | null = null;
    for (let c = 0; c < CELLS; c++) {
      const chunk = this.chunkOf(t, c);
      if (chunk < 0 || this.source.held(chunk)) continue;
      const s = (spots = this.spotsOf(tile, c, chunk));
      const told = this.source.gone(chunk);
      if (told) for (const i of told) gone[i] = 1;
      // Building in the far feed's 4 m cells, counted from the chunk's corner.
      const built = this.cells?.chunks.get(chunk)?.top;
      const [x0, z0] = [chunkCx(this.dims, chunk) * CHUNK_SIZE, chunkCz(this.dims, chunk) * CHUNK_SIZE];
      for (let i = 0; i < n; i++) {
        const at = c * n + i;
        const form = s.form[at]!;
        if (form === 0 || gone[i]) continue;
        const reach = formReach[form]!;
        if (reach <= 0) continue;
        if (reach + MARGIN < off) {
          if (reach + MARGIN > next) next = reach + MARGIN;
          continue;
        }
        if (built && built[Math.floor((s.pos[at * 3 + 2]! - z0) / TACTICAL_CELL) * BUILT_SIDE + Math.floor((s.pos[at * 3]! - x0) / TACTICAL_CELL)] !== 0) continue;
        keep[at] = 1;
        counts[meshOfForm[form]! * CELLS + c]!++;
        total++;
      }
      if (told) for (const i of told) gone[i] = 0;
    }
    tile.next = next;
    if (total === 0 || !spots) {
      [tile.data, tile.slots, tile.ranges] = [null, null, []];
      return;
    }
    // Each mesh's instances together, a cell after another, and where each begins.
    const ranges: number[] = [];
    const meshes = counts.length / CELLS;
    let cursor = 0;
    for (let m = 0; m < meshes; m++) {
      const from = cursor;
      for (let c = 0; c < CELLS; c++) {
        const k = counts[m * CELLS + c]!;
        counts[m * CELLS + c] = cursor;
        cursor += k;
      }
      if (cursor > from) ranges.push(m, from, cursor - from);
    }
    const nr = ranges.length / 3;
    const cellFirst = new Uint16Array(nr * (CELLS + 1));
    const box = new Float32Array(nr * (CELLS + 1) * 6);
    for (let k = 0; k < box.length; k += 6) box.set(EMPTY, k);
    const rangeOf = new Int16Array(meshes).fill(-1);
    for (let q = 0; q < nr; q++) {
      const m = ranges[q * 3]!;
      rangeOf[m] = q;
      for (let c = 0; c < CELLS; c++) cellFirst[q * (CELLS + 1) + c] = counts[m * CELLS + c]!;
      cellFirst[q * (CELLS + 1) + CELLS] = ranges[q * 3 + 1]! + ranges[q * 3 + 2]!;
    }
    const data = new Uint8Array(total * INSTANCE_BYTES);
    const slots = new Uint16Array(total);
    const w = new InstanceWriter(data);
    const s = spots;
    for (let c = 0; c < CELLS; c++) {
      for (let i = 0; i < n; i++) {
        const at = c * n + i;
        if (!keep[at]) continue;
        const form = s.form[at]!;
        const mesh = meshOfForm[form]!;
        const k = counts[mesh * CELLS + c]!++;
        const [x, y, z] = [s.pos[at * 3]!, s.pos[at * 3 + 1]!, s.pos[at * 3 + 2]!];
        w.set(k, x - ox, y, z - oz, s.yaw[at]!, colorOfForm[form]!);
        w.size(k, sizeOfForm[form]!);
        slots[k] = (c << 8) | i;
        // A node is held by its mesh's own bounds at its size, as the near store holds it.
        const size = sizeOfForm[form]! / SIZE_UNITS;
        const r = side[mesh]! * size;
        const o = (rangeOf[mesh]! * (CELLS + 1) + c + 1) * 6;
        if (x - r < box[o]!) box[o] = x - r;
        if (y + low[mesh]! * size < box[o + 1]!) box[o + 1] = y + low[mesh]! * size;
        if (z - r < box[o + 2]!) box[o + 2] = z - r;
        if (x + r > box[o + 3]!) box[o + 3] = x + r;
        if (y + high[mesh]! * size > box[o + 4]!) box[o + 4] = y + high[mesh]! * size;
        if (z + r > box[o + 5]!) box[o + 5] = z + r;
      }
    }
    // Each range's box holds its cells', and the tile's holds the ranges'.
    const whole = tile.whole;
    whole.set(EMPTY);
    for (let q = 0; q < nr; q++) {
      for (let c = 1; c <= CELLS; c++) grow(box, q * (CELLS + 1) * 6, box, (q * (CELLS + 1) + c) * 6);
      grow(whole, 0, box, q * (CELLS + 1) * 6);
    }
    [tile.data, tile.slots, tile.ranges, tile.cellFirst, tile.box] = [data, slots, ranges, cellFirst, box];
    tile.level = new Int8Array(nr).fill(-1);
    tile.cellLevel = new Int8Array(nr * CELLS).fill(-1);
  }
}

/** The chunk of tile `t`'s cell `c`, or -1 off the map. Cells run along a row and back along the next. */
function chunkOfCell(dims: MapDims, t: number, c: number): number {
  const tilesX = Math.ceil(dims.chunksX / FAR_TILE);
  const j = c >> 2;
  const i = j & 1 ? 3 - (c & 3) : c & 3;
  const cx = (t % tilesX) * FAR_TILE + i;
  const cz = Math.floor(t / tilesX) * FAR_TILE + j;
  return cx < dims.chunksX && cz < dims.chunksZ ? cz * dims.chunksX + cx : -1;
}

/** The chunk and slot of a far node, from the buffer it is in and its pick slot there. -1 for a buffer that is no tile. */
export function farNodeOf(dims: MapDims, buffer: number, slot: number): [number, number] {
  const t = buffer - FAR_NODE_BUFFERS;
  if (t < 0 || t >= Math.ceil(dims.chunksX / FAR_TILE) * Math.ceil(dims.chunksZ / FAR_TILE)) return [-1, -1];
  return [chunkOfCell(dims, t, slot >> 8), slot & 255];
}

const EMPTY = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];

function newTile(): Tile {
  return { dirty: true, now: false, spots: null, data: null, slots: null, uploaded: false, next: -1, ranges: [], cellFirst: new Uint16Array(0), box: new Float32Array(0), level: new Int8Array(0), cellLevel: new Int8Array(0), whole: Float64Array.from(EMPTY) };
}

/** Widens the box at `o` of `box` to hold the one at `from` of `b`. */
function grow(box: Float32Array | Float64Array, o: number, b: Float32Array, from: number): void {
  for (let a = 0; a < 3; a++) {
    if (b[from + a]! < box[o + a]!) box[o + a] = b[from + a]!;
    if (b[from + a + 3]! > box[o + a + 3]!) box[o + a + 3] = b[from + a + 3]!;
  }
}

/** Metres from the camera to the nearest point of the world box at `o` of `b`. */
function near(b: Float32Array | Float64Array, o: number, cam: Camera): number {
  return Math.hypot(Math.max(b[o]! - cam.x, cam.x - b[o + 3]!, 0), Math.max(b[o + 1]! - cam.y, cam.y - b[o + 4]!, 0), Math.max(b[o + 2]! - cam.z, cam.z - b[o + 5]!, 0));
}

/** Metres from the camera to the farthest corner of the world box at `o` of `b`. */
function far(b: Float32Array, o: number, cam: Camera): number {
  return Math.hypot(Math.max(Math.abs(b[o]! - cam.x), Math.abs(b[o + 3]! - cam.x)), Math.max(Math.abs(b[o + 1]! - cam.y), Math.abs(b[o + 4]! - cam.y)), Math.max(Math.abs(b[o + 2]! - cam.z), Math.abs(b[o + 5]! - cam.z)));
}

function visible(b: Float32Array | Float64Array, o: number, cam: Camera): boolean {
  return cam.boxVisible(b[o]! - cam.x, b[o + 1]! - cam.y, b[o + 2]! - cam.z, b[o + 3]! - cam.x, b[o + 4]! - cam.y, b[o + 5]! - cam.z);
}

/** Whether the world box at `o` of `b` is wholly inside the view's planes. */
function inside(b: Float32Array | Float64Array, o: number, cam: Camera): boolean {
  const p = cam.planes;
  const [ax, ay, az, bx, by, bz] = [b[o]! - cam.x, b[o + 1]! - cam.y, b[o + 2]! - cam.z, b[o + 3]! - cam.x, b[o + 4]! - cam.y, b[o + 5]! - cam.z];
  for (let i = 0; i < 24; i += 4) {
    const [x, y, z] = [p[i]!, p[i + 1]!, p[i + 2]!];
    if (x * (x >= 0 ? ax : bx) + y * (y >= 0 ? ay : by) + z * (z >= 0 ? az : bz) + p[i + 3]! < 0) return false;
  }
  return true;
}

function passes(b: Float32Array, o: number, cam: Camera): number {
  return cam.passes(b[o]! - cam.x, b[o + 1]! - cam.y, b[o + 2]! - cam.z, b[o + 3]! - cam.x, b[o + 4]! - cam.y, b[o + 5]! - cam.z);
}
