// Trees, rocks and bushes past the near store's hand-over band (hand.ts), placed by the client from the map alone
// (shared/world/nodes.ts): the node the near field would hold, at its spot, as its variant, turned and sized as near, so
// the tree far is the tree near. Each is drawn at its mesh's last level, which is flat, to its kind's reach, and dropped
// over the last share of it as far blocks are (far.ts). A mesh whose last level is a far level made for this is drawn as
// that. The nodes of 4 by 4 chunks are one instance buffer, whether the near field holds their chunks or not, made again
// when the client is told of nodes used up there, when the far feed shows building there, and when a kind comes within
// reach of it. Every mesh's last level is a row of one float texture (packet.ts `atlas`), so a tile is drawn in a draw
// or a few whatever meshes it holds (DRAW_PULLED), its instances sorted by how many vertices their meshes take and then
// by chunk. A chunk the near field holds is drawn from the band on, faded in over it; one it does not is drawn whole,
// which in play is always past the band.

import type { NodeDef } from "../../../shared/content/defs.ts";
import type { Registry } from "../../../shared/content/registry.ts";
import { CHUNK_SIZE, chunkCount, chunkCx, chunkCz, type MapDims } from "../../../shared/coords.ts";
import { INSTANCE_BYTES, VERTEX_BYTES } from "../../../shared/pack/pack.ts";
import { SIZE_UNITS, nodeForms, type NodeForms, type NodeSource, type NodeSpot } from "../../../shared/world/nodes.ts";
import { TACTICAL_CELL } from "../../../shared/world/tactical.ts";
import type { Tier } from "../assets/tiers.ts";
import type { FarStore } from "../farcells.ts";
import type { Camera } from "./camera.ts";
import { FAR_SLOTS, FAR_TILE, FAR_TILE_METRES } from "./far.ts";
import { HAND_FAR } from "./hand.ts";
import { ATLAS_REGION, ATLAS_ROWS, ATLAS_WIDTH, InstanceWriter, type FramePacket } from "./packet.ts";

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
/**
 * A pulled draw's level is a run of indices from 0 this many long, or twice or four times it: the vertices of 16
 * triangles, of 32, or of 64. Rows that take the same run are drawn together. Slots of those levels on the card.
 */
export const PULL_VERTICES = 48;
const SIZES = 3;
export const PULL_SLOTS = FAR_SLOTS - SIZES;
/** A tile's instances are drawn in groups: by family, so a kind of short reach goes with its own, and then by size. */
const GROUPS = SIZES * FAMILIES.length;
/** What the far nodes hold on the card, as residency.ts reserves it. */
const RESERVE = "far nodes";
/** Tiles nearer than this keep their chunks' nodes worked out, to make again in the frame a chunk's nodes are used up. */
const FAR_NOW = 512;
/** Of tiles made for any other reason, this many a frame, nearest first. */
const FAR_MAKES = 4;
/** A tile holds the kinds whose reach comes within this of it, so a kind is there before it is in reach. */
const MARGIN = FAR_TILE_METRES / 2;
/** Chunks in a tile, each a cell left out when out of view or reach, one row and then the next back the other way. */
const CELLS = FAR_TILE * FAR_TILE;
/** The far feed's 4 m cells along a chunk's side. */
const BUILT_SIDE = CHUNK_SIZE / TACTICAL_CELL;
/** A draw costs about what drawing this many more triangles does: a cell out of view that weighs less joins the draws either side. */
const RUN_TRIANGLES = 4096;

/** Which family a node kind is: trees are cut with wood, rocks with stone, and the rest are picked by hand. */
export function familyOf(def: NodeDef): number {
  return def.material === "wood" ? 0 : def.material === "stone" ? 1 : 2;
}

/**
 * How far a kind of `family` whose coarsest level has `triangles` is drawn on `tier`: the family's reach, cut as
 * FAMILY_TRIANGLES says. The plan's rows have the far layer begin at the near field's edge, a square of chunks as large
 * as a circle of radius `edge`; it begins at the hand-over band, nearer, so the reach is cut again to keep the ring it
 * covers as large.
 */
export function farReach(tier: Tier, family: number, triangles: number): number {
  const most = FAMILY_TRIANGLES[family]!;
  const reach = tier.reach[FAMILIES[family]!] * (triangles <= most ? 1 : Math.sqrt(most / triangles));
  const edge = ((2 * tier.nodes.chunks + 1) * CHUNK_SIZE) / Math.sqrt(Math.PI), from = tier.nodes.band[0];
  return reach > edge && from < edge ? Math.sqrt(reach * reach - edge * edge + from * from) : reach;
}

/** Which chunks' far nodes may have changed: the client was told which of their nodes are used up. `changed` holds, per chunk, the `version` it last changed at, as FarStore.changed does. */
export class NodeChanges {
  version = 0;
  readonly changed: Uint32Array;

  constructor(dims: MapDims) {
    this.changed = new Uint32Array(chunkCount(dims));
  }

  touch(chunk: number): void {
    this.changed[chunk] = ++this.version;
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

/** How the scene draws nodes: per form its mesh (or NO_MESH), its size in SIZE_UNITS and its colour, and per mesh its bounds, triangles and last level. */
export interface NodeLooks {
  readonly meshOfForm: Uint16Array;
  readonly sizeOfForm: Uint8Array;
  readonly colorOfForm: Uint8Array;
  readonly side: Float32Array;
  readonly low: Float32Array;
  readonly high: Float32Array;
  readonly tris: readonly (readonly number[])[];
  /** A mesh's last level: its vertices in metres from its origin, their palette colours and its triangles' corners, or null where there is none to hand. */
  last(mesh: number): { positions: Float32Array; colors: Uint8Array; indices: Uint32Array } | null;
}

/**
 * A pulled draw of `count` instances from `first` of a tile's buffer: the slot of its level, which `indices` long, a mesh
 * to name, where the tile's corner is from the camera, its depth ranges, its hand-over (hand.ts) and the farthest reach
 * of its rows.
 */
export type PutDraw = (slot: number, mesh: number, indices: number, buffer: number, first: number, count: number, ox: number, oy: number, oz: number, passes: number, hand: number, reach: number) => void;

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
  /** Made dirty by nodes told used up: made in this frame. */
  now: boolean;
  /** Its chunks' nodes, kept while it is within FAR_NOW. */
  spots: Spots | null;
  data: Uint8Array | null;
  slots: Uint16Array | null;
  /** What `data` and `slots` are the start of. */
  room: Uint8Array | null;
  roomSlots: Uint16Array | null;
  uploaded: boolean;
  /** The farthest reach, plus MARGIN, of a kind it left out; a tile this near is made again. -1 for none. */
  next: number;
  /** Triples: its group (GROUPS), first instance, instance count. */
  ranges: number[];
  /** Per range: the first instance of each cell and the end of the last. */
  cellFirst: Uint16Array;
  /** Per range, its box and then each cell's: x, y, z least then most, in the world. */
  box: Float32Array;
  /**
   * Per range, and then per cell of it, the kind of its nodes that reaches farthest. A range is of one family, whose
   * kinds reach in the same order on every tier, so this holds when the tier changes.
   */
  farthest: Int16Array;
  /** The box of all of it, in the world. */
  readonly whole: Float64Array;
}

export class FarNodes {
  /** Bytes of tiles on the card. */
  bytes = 0;
  /** Tiles made a frame for any reason but nodes used up, nearest first. */
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
  /** The tier's hand-over band. */
  private band: readonly [number, number] = [0, 0];
  /** Per mesh, its row of the atlas and how many vertices its row takes (0 to SIZES - 1), or -1; per row, its mesh. */
  private readonly meshRow: Int16Array;
  private readonly meshSize: Int8Array;
  /** Per form, its group. */
  private readonly formGroup: Uint8Array;
  private readonly rowMesh: number[] = [];
  private readonly atlas: Float32Array;
  /** Whether the card holds the atlas as it is, and the pulled draws' levels. */
  private atlasSent = false;
  private levelsSent = false;
  private readonly tiles = new Map<number, Tile>();
  private seenNodes = 0;
  private seenCells = 0;
  private readonly waiting: number[] = [];
  private readonly spot: NodeSpot = { kind: 0, form: 0, x: 0, y: 0, z: 0, yaw: 0 };
  // Scratch for making a tile: per size of row and cell a count and then a cursor, which slots of a cell are used up, and which are kept.
  private readonly counts: Uint32Array;
  private readonly gone: Uint8Array;
  private readonly keep: Uint8Array;
  private readonly rangeOf: Int16Array;
  private shared: Spots | null = null;
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
      let sum = 0, weights = 0;
      for (let v = 0; v < sums.length; v++) {
        const mesh = looks.meshOfForm[f.first[k]! + v * f.steps[k]!]!;
        const weight = sums[v]! - (v > 0 ? sums[v - 1]! : 0);
        if (mesh === NO_MESH) continue;
        sum += looks.tris[mesh]!.at(-1)! * weight;
        weights += weight;
      }
      this.triangles[k] = weights > 0 ? sum / weights : 0;
    }
    // A row of the atlas for the last level of each mesh a standing node is drawn as: in its first texel its reach and
    // its vertices, then each corner of each triangle. A mesh whose last level will not fit is not drawn far.
    this.meshRow = new Int16Array(meshes).fill(-1);
    this.meshSize = new Int8Array(meshes).fill(-1);
    this.atlas = new Float32Array(ATLAS_WIDTH * ATLAS_ROWS * 4);
    for (let form = 1; form < f.count; form++) {
      const mesh = looks.meshOfForm[form]!;
      if (mesh === NO_MESH || f.depleted[form] === 1 || this.meshRow[mesh]! >= 0 || this.rowMesh.length === ATLAS_ROWS) continue;
      const level = looks.last(mesh);
      if (!level || level.indices.length > PULL_VERTICES << (SIZES - 1)) continue;
      const row = (this.meshRow[mesh] = this.rowMesh.length);
      this.rowMesh.push(mesh);
      this.meshSize[mesh] = level.indices.length <= PULL_VERTICES ? 0 : level.indices.length <= PULL_VERTICES * 2 ? 1 : 2;
      const at = row * ATLAS_WIDTH * 4;
      this.atlas[at + 1] = level.indices.length;
      level.indices.forEach((v, i) => {
        const o = at + (i + 1) * 4;
        this.atlas[o] = level.positions[v * 3]!;
        this.atlas[o + 1] = level.positions[v * 3 + 1]!;
        this.atlas[o + 2] = level.positions[v * 3 + 2]!;
        this.atlas[o + 3] = level.colors[v]!;
      });
    }
    this.formGroup = Uint8Array.from({ length: f.count }, (_, form) => {
      const mesh = looks.meshOfForm[form]!;
      return form === 0 || mesh === NO_MESH ? 0 : Math.max(0, this.meshSize[mesh]!) + SIZES * Math.max(0, this.family[f.kind[form]!]!);
    });
    this.counts = new Uint32Array(GROUPS * CELLS);
    this.gone = new Uint8Array(256);
    this.keep = new Uint8Array(CELLS * this.perChunk);
    this.rangeOf = new Int16Array(GROUPS);
  }

  /** How far nodes of a kind are drawn on the tier last set, 0 for not at all. */
  reachOf(kind: number): number {
    return this.reach[kind]!;
  }

  /** The mesh of a row of the atlas, which a far instance names in its region ATLAS_REGION. */
  meshOfRow(row: number): number {
    return this.rowMesh[row]!;
  }

  /** Tiles waiting to be made. */
  get pending(): number {
    let n = 0;
    for (const tile of this.tiles.values()) if (tile.dirty) n++;
    return n;
  }

  /** After a lost context: every tile, the atlas and the levels go on the card again. */
  reset(): void {
    for (const tile of this.tiles.values()) tile.uploaded = false;
    this.atlasSent = this.levelsSent = false;
  }

  /**
   * Brings the tiles within reach of the camera at (x, z) up to date and on the card, and lets go of those a tile past
   * reach. Uploads and drops go into the packet, and what they weigh is spent and reserved in `budget`.
   */
  update(p: FramePacket, budget: { spend(bytes: number): void; reserve(name: string, bytes: number): void }, x: number, z: number, tier: Tier): void {
    this.setTier(tier);
    const rows = this.rowMesh.length;
    if (rows > 0 && !this.levelsSent) {
      for (let k = 0; k < SIZES; k++) p.assetUploads.push({ slot: PULL_SLOTS + k, mesh: this.rowMesh[0]!, level: 0, data: pullLevel(PULL_VERTICES << k), indexCount: PULL_VERTICES << k, indexBytes: 2 });
      this.levelsSent = true;
    }
    if (rows > 0 && !this.atlasSent) {
      p.atlas.set(this.atlas.subarray(0, rows * ATLAS_WIDTH * 4));
      p.atlasRows = rows;
      budget.spend(rows * ATLAS_WIDTH * 16);
      this.atlasSent = true;
    }
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
      const t0x = Math.max(0, Math.floor((x - span) / FAR_TILE_METRES)), t1x = Math.min(this.tilesX - 1, Math.floor((x + span) / FAR_TILE_METRES));
      const t0z = Math.max(0, Math.floor((z - span) / FAR_TILE_METRES)), t1z = Math.min(this.tilesZ - 1, Math.floor((z + span) / FAR_TILE_METRES));
      for (let tz = t0z; tz <= t1z; tz++) {
        for (let tx = t0x; tx <= t1x; tx++) {
          const t = tz * this.tilesX + tx;
          if (!this.tiles.has(t) && this.off(t, x, z) <= span) this.tiles.set(t, newTile());
        }
      }
    }
    const waiting = this.waiting;
    waiting.length = 0;
    for (const t of this.tiles.keys()) {
      const tile = this.tiles.get(t)!;
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
    for (let k = 0; k < Math.min(this.makes, waiting.length); k++) this.remake(p, waiting[k]!, this.tiles.get(waiting[k]!)!, this.off(waiting[k]!, x, z));
    let bytes = 0;
    for (const t of this.tiles.keys()) {
      const tile = this.tiles.get(t)!;
      if (!tile.data) continue;
      if (!tile.uploaded) {
        p.uploads.push({ buffer: FAR_NODE_BUFFERS + t, data: tile.data, slots: tile.slots! });
        budget.spend(tile.data.length);
        tile.uploaded = true;
      }
      bytes += tile.data.length;
    }
    // The atlas is on the card while there are tiles to draw from it.
    if (bytes > 0) bytes += rows * ATLAS_WIDTH * 16;
    if (bytes !== this.bytes) budget.reserve(RESERVE, bytes);
    this.bytes = bytes;
  }

  /**
   * Calls `put` for the nodes on the card in each tile in view whose nearest is within reach, a draw for each run of
   * neighbouring chunks of rows of one size with the same hand-over, in every depth range one of them is in: a range
   * clips what is not in it, and a draw saved is worth more than the vertices. A chunk the near field holds is drawn
   * faded in over the band, and left out where all of it is short of the band. A chunk out of view or reach is left out,
   * or drawn with its neighbours where it weighs less than a draw does.
   */
  draw(cam: Camera, put: PutDraw): void {
    const [from, to] = this.band;
    for (const t of this.tiles.keys()) {
      const tile = this.tiles.get(t)!;
      if (!tile.data || !tile.uploaded) continue;
      const w = tile.whole;
      if (near(w, 0, cam) >= this.most || !visible(w, 0, cam)) continue;
      const whole = inside(w, 0, cam);
      const ox = (t % this.tilesX) * FAR_TILE_METRES - cam.x, oy = -cam.y, oz = Math.floor(t / this.tilesX) * FAR_TILE_METRES - cam.z;
      const buffer = FAR_NODE_BUFFERS + t;
      const b = tile.box;
      for (let r = 0, q = 0; r < tile.ranges.length; r += 3, q++) {
        const size = tile.ranges[r]! % SIZES;
        const reach = this.reach[tile.farthest[q * (CELLS + 1)]!]!;
        const at = q * (CELLS + 1) * 6;
        if (near(b, at, cam) >= reach || (!whole && !visible(b, at, cam))) continue;
        const seenAll = whole || inside(b, at, cam);
        // Runs of neighbouring cells: first and end instance, depth ranges and hand-over. `bridge` is where a run may go on from.
        const runs = this.runs;
        runs.length = 0;
        let bridge = -1;
        for (let c = 0; c < CELLS; c++) {
          const first = tile.cellFirst[q * (CELLS + 1) + c]!;
          const end = tile.cellFirst[q * (CELLS + 1) + c + 1]!;
          if (end === first) continue;
          const k = at + (c + 1) * 6;
          const seen = near(b, k, cam);
          const held = this.source.held(chunkOfCell(this.dims, t, c));
          if (held && far(b, k, cam) <= from) {
            bridge = -1;
            continue;
          }
          if (seen >= this.reach[tile.farthest[q * (CELLS + 1) + c + 1]!]! || (!seenAll && !visible(b, k, cam))) {
            bridge = bridge === first && (end - first) * (PULL_VERTICES << size) <= RUN_TRIANGLES * 3 ? end : -1;
            continue;
          }
          const hand = held || seen >= to ? HAND_FAR : 0;
          const cp = passes(b, k, cam);
          const last = runs.length - 4;
          if (last >= 0 && bridge === first && runs[last + 2] === cp && runs[last + 3] === hand) runs[last + 1] = end;
          else runs.push(first, end, cp, hand);
          bridge = end;
        }
        for (let k = 0; k < runs.length; k += 4) put(PULL_SLOTS + size, this.rowMesh[0]!, PULL_VERTICES << size, buffer, runs[k]!, runs[k + 1]! - runs[k]!, ox, oy, oz, runs[k + 2]!, runs[k + 3]!, reach);
      }
    }
  }

  /**
   * The tier sets each kind's reach, and so each row's, which the atlas takes at once. Where one grows, every tile is
   * made again, nearest first; where none does, the tiles hold what they need and what is past reach is not drawn.
   */
  private setTier(tier: Tier): void {
    if (tier === this.tier) return;
    this.tier = tier;
    this.band = tier.nodes.band;
    this.most = 0;
    let changed = false, grew = false;
    for (let k = 0; k < this.family.length; k++) {
      if (this.family[k]! < 0) continue;
      const reach = Math.fround(farReach(tier, this.family[k]!, this.triangles[k]!));
      changed = changed || reach !== this.reach[k]!;
      grew = grew || reach > this.reach[k]!;
      this.reach[k] = reach;
      this.most = Math.max(this.most, reach);
    }
    if (!changed) return;
    this.meshReach.fill(0);
    const f = this.forms;
    for (let form = 1; form < f.count; form++) {
      const mesh = this.looks.meshOfForm[form]!;
      this.formReach[form] = mesh === NO_MESH || this.meshRow[mesh]! < 0 ? 0 : this.reach[f.kind[form]!]!;
      if (this.formReach[form]! > 0) this.meshReach[mesh] = Math.max(this.meshReach[mesh]!, this.formReach[form]!);
    }
    this.rowMesh.forEach((mesh, row) => (this.atlas[row * ATLAS_WIDTH * 4] = this.meshReach[mesh]!));
    this.atlasSent = false;
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

  /** Room for a tile's nodes. */
  private newSpots(): Spots {
    const n = this.perChunk;
    return { have: new Uint8Array(CELLS), form: new Uint16Array(CELLS * n), pos: new Float32Array(CELLS * n * 3), yaw: new Uint16Array(CELLS * n) };
  }

  /** The nodes of cell `c` of chunk `chunk` into `s`, worked out from the map once while `s` keeps them. */
  private spotsOf(s: Spots, c: number, chunk: number): Spots {
    const n = this.perChunk;
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
   * Makes tile `t`, `off` metres from the camera: the nodes of its chunks less those used up, those under building, and
   * those of kinds whose reach is short of it by more than MARGIN.
   */
  private make(t: number, tile: Tile, off: number): void {
    const { meshOfForm, sizeOfForm, colorOfForm, side, low, high } = this.looks;
    const formReach = this.formReach;
    const n = this.perChunk;
    const counts = this.counts.fill(0);
    const keep = this.keep.fill(0);
    const gone = this.gone;
    const ox = (t % this.tilesX) * FAR_TILE_METRES, oz = Math.floor(t / this.tilesX) * FAR_TILE_METRES;
    let next = -1;
    let total = 0;
    // A tile near enough to be told of nodes used up keeps its nodes; any other works them out in shared room.
    const room = off <= FAR_NOW ? (tile.spots ??= this.newSpots()) : (this.shared ??= this.newSpots());
    if (room === this.shared) room.have.fill(0);
    let spots: Spots | null = null;
    for (let c = 0; c < CELLS; c++) {
      const chunk = this.chunkOf(t, c);
      if (chunk < 0) continue;
      const s = (spots = this.spotsOf(room, c, chunk));
      const told = this.source.gone(chunk);
      if (told) for (const i of told) gone[i] = 1;
      // Building in the far feed's 4 m cells, counted from the chunk's corner.
      const built = this.cells?.chunks.get(chunk)?.top;
      const x0 = chunkCx(this.dims, chunk) * CHUNK_SIZE, z0 = chunkCz(this.dims, chunk) * CHUNK_SIZE;
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
        counts[this.formGroup[form]! * CELLS + c]!++;
        total++;
      }
      if (told) for (const i of told) gone[i] = 0;
    }
    tile.next = next;
    if (total === 0 || !spots) {
      tile.data = null;
      tile.slots = null;
      tile.ranges = [];
      return;
    }
    // The instances of each group together, a cell after another, and where each begins.
    const ranges: number[] = [];
    let cursor = 0;
    for (let m = 0; m < GROUPS; m++) {
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
    const farthest = new Int16Array(nr * (CELLS + 1));
    for (let k = 0; k < box.length; k += 6) box.set(EMPTY, k);
    const rangeOf = this.rangeOf;
    for (let q = 0; q < nr; q++) {
      const m = ranges[q * 3]!;
      rangeOf[m] = q;
      for (let c = 0; c < CELLS; c++) cellFirst[q * (CELLS + 1) + c] = counts[m * CELLS + c]!;
      cellFirst[q * (CELLS + 1) + CELLS] = ranges[q * 3 + 1]! + ranges[q * 3 + 2]!;
    }
    // The tile's bytes go where its last ones were when they fit, so walking makes little for the collector.
    if (!tile.room || tile.room.length < total * INSTANCE_BYTES) {
      tile.room = new Uint8Array(Math.ceil(total * 1.25) * INSTANCE_BYTES);
      tile.roomSlots = new Uint16Array(tile.room.length / INSTANCE_BYTES);
    }
    const data = tile.room.subarray(0, total * INSTANCE_BYTES);
    const slots = tile.roomSlots!.subarray(0, total);
    const w = new InstanceWriter(data);
    const s = spots;
    for (let c = 0; c < CELLS; c++) {
      for (let i = 0; i < n; i++) {
        const at = c * n + i;
        if (!keep[at]) continue;
        const form = s.form[at]!;
        const mesh = meshOfForm[form]!;
        const group = this.formGroup[form]!;
        const k = counts[group * CELLS + c]!++;
        const x = s.pos[at * 3]!;
        const y = s.pos[at * 3 + 1]!;
        const z = s.pos[at * 3 + 2]!;
        w.set(k, x - ox, y, z - oz, s.yaw[at]!, colorOfForm[form]!);
        w.size(k, sizeOfForm[form]!);
        data[k * INSTANCE_BYTES + 14 + ATLAS_REGION] = this.meshRow[mesh]!;
        slots[k] = (c << 8) | i;
        // A node is held by its mesh's own bounds at its size, as the near store holds it.
        const scale = sizeOfForm[form]! / SIZE_UNITS;
        const r = side[mesh]! * scale;
        const q = rangeOf[group]! * (CELLS + 1) + c + 1;
        const o = q * 6;
        if (x - r < box[o]!) box[o] = x - r;
        if (y + low[mesh]! * scale < box[o + 1]!) box[o + 1] = y + low[mesh]! * scale;
        if (z - r < box[o + 2]!) box[o + 2] = z - r;
        if (x + r > box[o + 3]!) box[o + 3] = x + r;
        if (y + high[mesh]! * scale > box[o + 4]!) box[o + 4] = y + high[mesh]! * scale;
        if (z + r > box[o + 5]!) box[o + 5] = z + r;
        if (formReach[form]! > this.reach[farthest[q]!]!) farthest[q] = this.forms.kind[form]!;
      }
    }
    // Each range's box holds its cells' and its farthest kind is theirs, and the tile's box holds the ranges'.
    const whole = tile.whole;
    whole.set(EMPTY);
    for (let q = 0; q < nr; q++) {
      for (let c = 1; c <= CELLS; c++) {
        grow(box, q * (CELLS + 1) * 6, box, (q * (CELLS + 1) + c) * 6);
        const kind = farthest[q * (CELLS + 1) + c]!;
        if (this.reach[kind]! > this.reach[farthest[q * (CELLS + 1)]!]!) farthest[q * (CELLS + 1)] = kind;
      }
      grow(whole, 0, box, q * (CELLS + 1) * 6);
    }
    tile.data = data;
    tile.slots = slots;
    tile.ranges = ranges;
    tile.cellFirst = cellFirst;
    tile.box = box;
    tile.farthest = farthest;
  }
}

/** The level a pulled draw names: `n` vertices of nothing, which the program does not read, and the indices 0 to n - 1. */
function pullLevel(n: number): Uint8Array {
  const data = new Uint8Array(((n * 2 + 3) & ~3) + n * VERTEX_BYTES);
  const indices = new Uint16Array(data.buffer, 0, n);
  for (let i = 0; i < n; i++) indices[i] = i;
  return data;
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
  return { dirty: true, now: false, spots: null, data: null, slots: null, room: null, roomSlots: null, uploaded: false, next: -1, ranges: [], cellFirst: new Uint16Array(0), box: new Float32Array(0), farthest: new Int16Array(0), whole: Float64Array.from(EMPTY) };
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
  const ax = b[o]! - cam.x, ay = b[o + 1]! - cam.y, az = b[o + 2]! - cam.z, bx = b[o + 3]! - cam.x, by = b[o + 4]! - cam.y, bz = b[o + 5]! - cam.z;
  for (let i = 0; i < 24; i += 4) {
    const x = p[i]!, y = p[i + 1]!, z = p[i + 2]!;
    if (x * (x >= 0 ? ax : bx) + y * (y >= 0 ? ay : by) + z * (z >= 0 ? az : bz) + p[i + 3]! < 0) return false;
  }
  return true;
}

function passes(b: Float32Array, o: number, cam: Camera): number {
  return cam.passes(b[o]! - cam.x, b[o + 1]! - cam.y, b[o + 2]! - cam.z, b[o + 3]! - cam.x, b[o + 4]! - cam.y, b[o + 5]! - cam.z);
}
