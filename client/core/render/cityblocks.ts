// The city past what the far city draws: blocks from the map's tops (blocks.ts), to the end of the view. A tile of blocks
// is BLOCK_TILE chunks a side, made from the cells of its chunks that have come, its mesh holding them in groups of a far
// city tile's chunks, so a draw is a run of chunks the others leave to it. A chunk is drawn here where the near store does
// not hold it whole and whoever draws its buildings nearer (the far city, or before the map's statics have come the far
// blocks of the far feed's cells) does not draw it this frame; where that one fades out at its reach this fades in over
// the same pixels by the far fade's pattern (far.ts fadeKeeps), so the change is a fade. Once the statics have come, a
// chunk's pieces gone and a landmark's, which its far mesh draws, are left out of its blocks.
//
// Tiles are made where the far city's levels are made (citymake.ts), a few at a time, those in view before the rest and
// the nearest first, of 8 m blocks and past COARSER_FROM of 16 m ones, and made again when the ground under their blocks
// changes (an overview come over the coarse picture). A tile whose pieces go is made again GONE_EVERY after the first of
// them went, so one coming down wave by wave is made once. A tile a tile past the view is let go of. What is made goes
// on the card and is not kept in the page.

import { CHUNK_SIZE, chunkCount, type MapDims } from "../../../shared/coords.ts";
import { INSTANCE_BYTES } from "../../../shared/pack/pack.ts";
import { cityTops, type CityStatics, type Gone } from "../../../shared/world/city.ts";
import type { Heightfield } from "../../../shared/world/heightfield.ts";
import { BLOCK, BLOCK_TILE, BLOCK_TILE_METRES, FAR_BLOCK, FARTHEST_BLOCK, TOP_CELLS, blocksBounds, makeBlocks, type BlocksJob, type BlocksMade, type HeldTops } from "./blocks.ts";
import type { Camera } from "./camera.ts";
import type { CityMaker } from "./citymake.ts";
import { FAR_SLOTS, FAR_SPAN } from "./far.ts";
import { CITY_BUFFER, CITY_TILE } from "./farcity.ts";
import type { Hider } from "./hide.ts";
import type { TopFix, TopRows } from "./topfix.ts";
import type { FramePacket } from "./packet.ts";
import { COARSE } from "./terrain.ts";

/** Slots of tiles of blocks on the card: the span after the far blocks' (far.ts), short of the far city's. */
export const BLOCK_SLOTS = FAR_SLOTS + FAR_SPAN;
const RESERVE = "city blocks";
/** Tiles asked of a maker on other threads and not yet back; and where they are made here, how many a frame. */
const AHEAD = 2;
const HERE = 1;
/** Chunks along a side of a group within a tile: a far city tile's, whose chunks a tile's mesh holds together. */
const GROUP = CITY_TILE;
const ACROSS = BLOCK_TILE / GROUP;
const GROUPS = ACROSS * ACROSS;
/** Samples of the ground every COARSE-th along a tile's side, its far edge among them. */
const GROUND = BLOCK_TILE_METRES / BLOCK + 1;
/**
 * Metres from the camera to a tile's square past which its blocks are FAR_BLOCK across: past 4 km an 8 m block is a pixel
 * or less at 1080p, and the city's blocks to 8 km took 1.6 M triangles a frame from 300 m over downtown Miami on ultra.
 * A tile changes back this share nearer, and out this share farther.
 */
export const COARSER_FROM = 4000;
/** Metres past which the blocks are FARTHEST_BLOCK across: about three miles, where the view starts to fade out. */
export const COARSEST_FROM = 4800;
const HYSTERESIS = 1.1;
/** The block sizes, nearest first, and the distance each after the first starts at. */
const SIZES = [BLOCK, FAR_BLOCK, FARTHEST_BLOCK];
/** Milliseconds from a tile's first piece gone to its being made again without those gone since. */
export const GONE_EVERY = 5000;
const FROM = [COARSER_FROM, COARSEST_FROM];

/** What the blocks are drawn from: the map's tops as they come, and where tiles are made (here, without a maker that makes them). */
export interface BlocksSource {
  readonly tops: HeldTops;
  readonly maker?: CityMaker;
  /** Where a sector's rows are asked for once, for the tops that are wrong (topfix.ts), and the map's kinds they index. */
  readonly rows?: TopRows;
  readonly kinds?: readonly string[];
}

/** What stands of the map's pieces once its statics have come, as the far city follows it (farcity.ts goneOf, goneVersion). */
export interface Standing {
  goneOf(chunk: number): Gone;
  readonly goneVersion: Uint32Array;
}

/**
 * Who draws a chunk's buildings this frame other than the blocks: -1 for drawn whole (the near store, or short of its
 * drawer's fade), a reach in metres for drawn fading out at it, and 0 for not drawn.
 */
export type Shown = (chunk: number) => number;

/** A tile on the card as made: its slot and bytes there, what was made, each chunk's group, and each group's heights from its base. */
interface Held {
  readonly slot: number;
  readonly bytes: number;
  readonly made: BlocksMade;
  readonly group: Uint8Array;
  readonly low: Float32Array;
  readonly high: Float32Array;
}

interface Tile {
  held: Held | null;
  /** What it is made of has changed since it was asked for; the job asked for and not yet taken, or -1. */
  dirty: boolean;
  asked: number;
  /** When the first piece went that it is not yet made again for, or -1. */
  goneAt: number;
  /** A hash of the ground it was last asked of, 0 before; and the side of the blocks last asked of it, 0 before. */
  ground: number;
  size: number;
}

/** Jobs asked of makers, counted over every city of the page, so a maker's answer to one before is known for that. */
let jobsAsked = 0;

export class CityBlocks {
  /** The pack mesh a draw names (far.ts FAR_MESH). */
  readonly mesh: number;
  /** Bytes of tiles on the card. */
  bytes = 0;
  /** Last frame: tiles taken, tiles wanted in view and not on the card, and the draws and triangles drawn. */
  readonly stats = { made: 0, missing: 0, draws: 0, triangles: 0 };
  /** Tiles made here in a frame where there is no maker on other threads; Infinity makes every one wanted in the frame it is. */
  here = HERE;
  private readonly source: BlocksSource;
  private readonly dims: MapDims;
  private readonly hf: Heightfield;
  private readonly colours: Uint8Array;
  private readonly landmark: Uint8Array;
  private readonly tilesX: number;
  private readonly tiles: Tile[];
  /** Per chunk, the tops parts taken when its cells were last looked at, and its count of changes to what stands. */
  private readonly seenCame: Uint32Array;
  private readonly seenGone: Uint32Array;
  private seenTops = 0;
  /** The heightfield's changes taken in. */
  private seenGround: number;
  /** The map's statics and what stands of them, once they have come; per chunk, 1 where a landmark's piece stands in it. */
  private statics: CityStatics | null = null;
  private standing: Standing | null = null;
  private readonly landmarks: Uint8Array;
  /** The statics' squares as last taken in (CityStatics.news). */
  private seenSquares = new Uint32Array(0);
  /** The tops made of what stands where the map's are wrong past the statics held, and their count of changes taken in. */
  fix: TopFix | null = null;
  private seenFix = 0;
  private readonly asked = new Map<number, number>();
  private next = 0;
  private sent = false;
  private readonly made: BlocksMade[] = [];
  private readonly order: number[] = [];
  /** Per group of the tile being drawn: the depth ranges it is drawn in, 0 for none, and how far off its nearest is. */
  private readonly passes = new Uint8Array(GROUPS);
  private readonly nears = new Float64Array(GROUPS);

  /** `colours` is what far blocks draw each colour of the far feed in (far.ts farColours); `landmark` is 1 by content index for a kind a landmark brings. */
  constructor(source: BlocksSource, dims: MapDims, hf: Heightfield, mesh: number, colours: Uint8Array, landmark: Uint8Array) {
    if (hf.cell * COARSE !== BLOCK) throw new Error(`city blocks: a map's ground every ${COARSE}th sample is ${hf.cell * COARSE} m, and a block ${BLOCK}`);
    this.source = source;
    this.dims = dims;
    this.hf = hf;
    this.mesh = mesh;
    this.colours = colours;
    this.landmark = landmark;
    this.tilesX = Math.ceil(dims.chunksX / BLOCK_TILE);
    this.tiles = Array.from({ length: this.tilesX * Math.ceil(dims.chunksZ / BLOCK_TILE) }, () => ({ held: null, dirty: true, asked: -1, goneAt: -1, ground: 0, size: 0 }));
    this.seenCame = new Uint32Array(chunkCount(dims));
    this.seenGone = new Uint32Array(chunkCount(dims));
    this.landmarks = new Uint8Array(chunkCount(dims));
    this.seenGround = hf.changes.length;
  }

  /** After a lost context: every tile is made again, and the instance buffer goes on the card again. */
  reset(): void {
    for (const tile of this.tiles) {
      tile.held = null;
      tile.dirty = true;
      tile.asked = -1;
    }
    this.asked.clear();
    this.sent = false;
  }

  /**
   * Brings the tiles within `view` of the camera up to date and on the card, and lets go of those a tile farther.
   * `statics` and `standing` are the map's statics and the far city once they have come, and `now` the frame's time in
   * milliseconds. Uploads and drops go into the packet, and what they weigh is spent and reserved in `budget`.
   */
  update(p: FramePacket, budget: { spend(bytes: number): void; reserve(name: string, bytes: number): void }, cam: Camera, view: number, statics: CityStatics | null, standing: Standing | null, now = 0): void {
    this.changed(statics, standing, now);
    const maker = this.source.maker?.blocks ? this.source.maker : null;
    if (maker) for (let m = maker.built!(); m; m = maker.built!()) this.made.push(m);
    this.stats.made = this.take(p, budget);
    // The tiles to make, those in view before the rest, then the nearest.
    const order = this.order;
    order.length = 0;
    this.stats.missing = 0;
    for (let t = 0; t < this.tiles.length; t++) {
      const tile = this.tiles[t]!;
      const off = this.off(t, cam.x, cam.z);
      if (off > view + BLOCK_TILE_METRES) {
        this.letGo(p, tile);
        continue;
      }
      if (off > view) continue;
      if (tile.goneAt >= 0 && now - tile.goneAt >= GONE_EVERY) tile.dirty = true;
      if (tile.size !== 0 && this.size(tile, off) !== tile.size) tile.dirty = true;
      if (!tile.dirty) continue;
      if (tile.asked < 0) order.push(t);
      if (!tile.held && this.seen(t, cam)) this.stats.missing++;
    }
    const rank = (t: number): number => this.off(t, cam.x, cam.z) + (this.seen(t, cam) ? 0 : 1e6);
    order.sort((a, b) => rank(a) - rank(b));
    const most = maker ? AHEAD - this.asked.size : this.here;
    for (let k = 0, n = 0; k < order.length && n < most; k++) {
      const job = this.job(order[k]!, this.size(this.tiles[order[k]!]!, this.off(order[k]!, cam.x, cam.z)));
      if (!job) continue;
      n++;
      if (maker) maker.blocks!(job);
      else this.made.push(makeBlocks(job));
    }
    if (!maker) this.stats.made += this.take(p, budget);
    let bytes = 0;
    for (const tile of this.tiles) bytes += tile.held?.bytes ?? 0;
    if (bytes > 0 && !this.sent) {
      p.uploads.push({ buffer: CITY_BUFFER, data: new Uint8Array(INSTANCE_BYTES), slots: new Uint16Array(1) });
      this.sent = true;
    }
    if (bytes !== this.bytes) budget.reserve(RESERVE, bytes);
    this.bytes = bytes;
  }

  /**
   * Calls `put` for each run of a tile's chunks drawn here, where the tile is on the card, within `view` of the camera,
   * in its view and not wholly behind what `hider` says hides a camera-relative box: the slot, its first index and how
   * many, where its stored origin is from the camera, the depth ranges its faces are in, where it fades in (below 0) or 0
   * for drawn whole, and how far off its nearest is. `shown` says who else draws a chunk.
   */
  draw(cam: Camera, view: number, shown: Shown, put: (slot: number, firstIndex: number, indexCount: number, ox: number, oy: number, oz: number, passes: number, fade: number, near: number) => void, hider?: Hider): void {
    this.stats.draws = this.stats.triangles = 0;
    const { passes, nears } = this;
    const G = GROUP * CHUNK_SIZE;
    for (let t = 0; t < this.tiles.length; t++) {
      const held = this.tiles[t]!.held;
      if (!held) continue;
      const tx = this.cornerX(t), tz = this.cornerZ(t), base = held.made.base;
      if (this.off(t, cam.x, cam.z) >= view) continue;
      // Each group in view, short of the view's end and not hidden, and the depth ranges it is in.
      for (let g = 0; g < GROUPS; g++) {
        passes[g] = 0;
        if (!(held.high[g]! > held.low[g]!)) continue;
        const x0 = tx + (g % ACROSS) * G - cam.x, z0 = tz + Math.floor(g / ACROSS) * G - cam.z;
        const y0 = base + held.low[g]! - cam.y, y1 = base + held.high[g]! - cam.y;
        const near = (nears[g] = Math.hypot(Math.max(x0, -x0 - G, 0), Math.max(y0, -y1, 0), Math.max(z0, -z0 - G, 0)));
        if (near >= view || !cam.boxVisible(x0, y0, z0, x0 + G, y1, z0 + G) || (hider !== undefined && hider.hides(x0, y0, z0, x0 + G, y1, z0 + G))) continue;
        passes[g] = cam.passes(x0, y0, z0, x0 + G, y1, z0 + G);
      }
      const { chunks, first, count } = held.made;
      const group = held.group;
      const ox = tx - cam.x, oy = base - cam.y, oz = tz - cam.z;
      let run = 0;
      let kept = 0;
      let fade = 0;
      let near = Infinity;
      for (let k = 0; k <= chunks.length; k++) {
        let kk = 0;
        let ff = 0;
        if (k < chunks.length) {
          // A chunk with no blocks goes with whatever run it falls in.
          if (count[k] === 0) continue;
          const s = passes[group[k]!]!;
          const by = s > 0 ? shown(chunks[k]!) : -1;
          kk = by < 0 ? 0 : s;
          ff = by > 0 ? -by : 0;
          if (k > run && kk === kept && ff === fade) {
            near = Math.min(near, nears[group[k]!]!);
            continue;
          }
        }
        if (k > run && kept !== 0) {
          const n = first[k - 1]! + count[k - 1]! - first[run]!;
          if (n > 0) {
            put(held.slot, first[run]!, n, ox, oy, oz, kept, fade, near);
            this.stats.draws++;
            this.stats.triangles += n / 3;
          }
        }
        run = k;
        kept = kk;
        fade = ff;
        near = k < chunks.length ? nears[group[k]!]! : Infinity;
      }
    }
  }

  /**
   * Marks the tiles to make again: those whose chunks' cells have come, those whose chunks' standing pieces have changed or
   * whose statics have come with a landmark's piece or one gone, and those whose ground has changed under their blocks.
   */
  private changed(statics: CityStatics | null, standing: Standing | null, now: number): void {
    const tops = this.source.tops;
    if (statics !== this.statics) {
      for (let c = 0; c < this.landmarks.length; c++) if (this.landmarks[c] === 1) this.tiles[this.tileOf(c)]!.dirty = true;
      this.statics = statics;
      this.landmarks.fill(0);
      this.seenSquares = new Uint32Array(statics?.size ?? 0);
    }
    // A square set in or let go: its chunks with a landmark's piece, then and now, are made again.
    statics?.news(this.seenSquares, (sq, held) => {
      for (let cz = sq.cz0; cz < sq.cz1; cz++) {
        for (let cx = sq.cx0; cx < sq.cx1; cx++) {
          const c = cz * this.dims.chunksX + cx, t = held ? statics.rows(c) : null;
          if (this.landmarks[c] === 1) this.tiles[this.tileOf(c)]!.dirty = true;
          this.landmarks[c] = 0;
          for (let i = t?.from(c) ?? 0; t && i < t.to(c); i++) {
            if (this.landmark[t.kind[i]!] !== 1) continue;
            this.landmarks[c] = 1;
            this.tiles[this.tileOf(c)]!.dirty = true;
            break;
          }
        }
      }
    });
    this.standing = statics ? standing : null;
    const gone = this.standing?.goneVersion;
    const came = tops.version !== this.seenTops;
    this.seenTops = tops.version;
    if (came || gone) {
      for (let c = 0; c < this.seenCame.length; c++) {
        const g = gone?.[c] ?? 0;
        if (tops.came[c] === this.seenCame[c] && g === this.seenGone[c]) continue;
        const tile = this.tiles[this.tileOf(c)]!;
        // Cells come are drawn at once. Pieces gone from a tile on the card wait, where tiles are not all made in their frame.
        if (tops.came[c] !== this.seenCame[c] || !tile.held || this.here === Infinity) tile.dirty = true;
        else if (tile.goneAt < 0) tile.goneAt = now;
        this.seenCame[c] = tops.came[c]!;
        this.seenGone[c] = g;
      }
    }
    // Tops made of what stands past the statics held: a tile they change is made at once, the fetch having been the wait.
    const fix = this.fix;
    if (fix && fix.version !== this.seenFix) {
      for (const f of fix.fixes.values()) if (f.stamp > this.seenFix && !statics?.holds(f.chunk)) this.tiles[this.tileOf(f.chunk)]!.dirty = true;
      this.seenFix = fix.version;
    }
    // Ground that came: a tile whose blocks stand on samples that changed, or whose feet reach into them, is made again.
    const ch = this.hf.changes;
    for (; this.seenGround < ch.length; this.seenGround += 4) {
      const tx0 = Math.max(0, Math.floor((ch[this.seenGround]! - 1) / BLOCK_TILE)), tz0 = Math.max(0, Math.floor((ch[this.seenGround + 1]! - 1) / BLOCK_TILE));
      const tx1 = Math.min(this.tilesX - 1, Math.floor(ch[this.seenGround + 2]! / BLOCK_TILE)), tz1 = Math.min(this.tiles.length / this.tilesX - 1, Math.floor(ch[this.seenGround + 3]! / BLOCK_TILE));
      for (let tz = tz0; tz <= tz1; tz++) {
        for (let tx = tx0; tx <= tx1; tx++) {
          const tile = this.tiles[tz * this.tilesX + tx]!;
          if (tile.ground !== 0 && tile.ground !== this.groundHash(tz * this.tilesX + tx)) tile.dirty = true;
        }
      }
    }
  }

  /** The tile's corner sample of the ground every COARSE-th, and its side in those samples, short of the map's edge. */
  private groundOf(t: number): { i0: number; j0: number; w: number; rows: number } {
    const hf = this.hf;
    const lastI = Math.floor((hf.nx - 1) / COARSE), lastJ = Math.floor((hf.nz - 1) / COARSE);
    const i0 = Math.min(lastI, this.cornerX(t) / BLOCK), j0 = Math.min(lastJ, this.cornerZ(t) / BLOCK);
    return { i0, j0, w: Math.min(lastI, i0 + GROUND - 1) - i0 + 1, rows: Math.min(lastJ, j0 + GROUND - 1) - j0 + 1 };
  }

  /** A hash of the ground tile `t`'s blocks stand on, never 0. */
  private groundHash(t: number): number {
    const hf = this.hf, { i0, j0, w, rows } = this.groundOf(t);
    const v = hf.view(i0 * COARSE, j0 * COARSE, (i0 + w - 1) * COARSE, (j0 + rows - 1) * COARSE);
    let h = 2166136261;
    for (let j = 0; j < rows; j++) for (let i = 0; i < w; i++) h = Math.imul(h ^ v.heights[v.off + (j0 + j) * COARSE * v.stride + (i0 + i) * COARSE]!, 16777619);
    return h >>> 0 || 1;
  }

  /** The side of the blocks `tile`, `off` metres from the camera, is made of. */
  private size(tile: Tile, off: number): number {
    // A tile changes size a little past each line going out and a little short of it coming back, so it does not flicker.
    let k = 0;
    for (let i = 0; i < FROM.length; i++) if (off > FROM[i]! * (tile.size > SIZES[i]! ? 1 / HYSTERESIS : HYSTERESIS)) k = i + 1;
    return SIZES[k]!;
  }

  /** What tile `t` is made of now, of blocks `size` metres across, or null where none of its chunks has cells, which then holds nothing. */
  private job(t: number, size: number): BlocksJob | null {
    const tile = this.tiles[t]!;
    tile.dirty = false;
    tile.goneAt = -1;
    tile.size = size;
    const tops = this.source.tops;
    const { chunksX, chunksZ } = this.dims;
    const cx0 = (t % this.tilesX) * BLOCK_TILE, cz0 = Math.floor(t / this.tilesX) * BLOCK_TILE;
    // Its chunks a group at a time, so a run of them is a run of far city tiles.
    const chunks: number[] = [];
    for (let g = 0; g < GROUPS; g++) {
      const gx = cx0 + (g % ACROSS) * GROUP, gz = cz0 + Math.floor(g / ACROSS) * GROUP;
      for (let cz = gz; cz < Math.min(gz + GROUP, chunksZ); cz++) for (let cx = gx; cx < Math.min(gx + GROUP, chunksX); cx++) if (tops.top(cz * chunksX + cx)) chunks.push(cz * chunksX + cx);
    }
    if (chunks.length === 0) return null;
    const top = new Uint8Array(chunks.length * TOP_CELLS);
    const tint = new Uint8Array(chunks.length * TOP_CELLS);
    for (let k = 0; k < chunks.length; k++) {
      const c = chunks[k]!;
      top.set(this.standingTops(c) ?? tops.top(c)!, k * TOP_CELLS);
      const listed = tops.tint(c)!;
      for (let i = 0; i < TOP_CELLS; i++) tint[k * TOP_CELLS + i] = this.colours[listed[i]!]!;
    }
    const id = jobsAsked++;
    this.asked.set(id, t);
    tile.asked = id;
    tile.ground = this.groundHash(t);
    const hf = this.hf, { i0, j0, w, rows } = this.groundOf(t);
    const heights = new Uint16Array(w * rows);
    const v = hf.view(i0 * COARSE, j0 * COARSE, (i0 + w - 1) * COARSE, (j0 + rows - 1) * COARSE);
    for (let j = 0; j < rows; j++) for (let i = 0; i < w; i++) heights[j * w + i] = v.heights[v.off + (j0 + j) * COARSE * v.stride + (i0 + i) * COARSE]!;
    return { id, chunksX, ox: cx0 * CHUNK_SIZE, oz: cz0 * CHUNK_SIZE, chunks: Int32Array.from(chunks), size, top, tint, i0, j0, w, heights, minY: hf.minY, stepY: hf.stepY };
  }

  /**
   * `chunk`'s tops as its standing pieces but a landmark's make them, where it has a piece gone or a landmark's: of its
   * statics where they are held, else as made where the map's are wrong (topfix.ts); else null.
   */
  private standingTops(chunk: number): Uint8Array | null {
    const statics = this.statics, gone = this.standing?.goneOf(chunk) ?? null;
    if (!statics?.holds(chunk)) return this.fix?.fixOf(chunk)?.blocks ?? null;
    if (!statics || statics.in(chunk) === 0 || (gone === null && this.landmarks[chunk] === 0)) return null;
    const t = statics.rows(chunk)!, from = t.from(chunk);
    const left = new Uint8Array(statics.in(chunk));
    for (let i = 0; i < left.length; i++) left[i] = gone?.[i] === 1 || this.landmark[t.kind[from + i]!] === 1 ? 1 : 0;
    return cityTops(statics, chunk, this.hf, left);
  }

  /** Puts the tiles made on the card, but for those let go of since. Returns how many. */
  private take(p: FramePacket, budget: { spend(bytes: number): void }): number {
    let n = 0;
    for (const made of this.made) {
      const t = this.asked.get(made.id);
      this.asked.delete(made.id);
      const tile = t === undefined ? undefined : this.tiles[t];
      if (!tile || tile.asked !== made.id) continue;
      tile.asked = -1;
      if (tile.held) p.assetDrops.push(tile.held.slot);
      tile.held = null;
      if (made.data.length === 0) continue;
      const slot = BLOCK_SLOTS + this.next;
      this.next = (this.next + 1) % FAR_SPAN;
      p.assetUploads.push({ slot, mesh: this.mesh, level: 0, data: made.data, indexCount: made.first.at(-1)! + made.count.at(-1)!, indexBytes: made.indexBytes, quads: true, bounds: blocksBounds(made.tall) });
      budget.spend(made.data.length);
      tile.held = { slot, bytes: made.data.length, ...this.grouped(t!, made) };
      n++;
    }
    this.made.length = 0;
    return n;
  }

  /** Each chunk's group in tile `t` as `made` holds them, and each group's lowest and highest face from the tile's base. */
  private grouped(t: number, made: BlocksMade): Pick<Held, "made" | "group" | "low" | "high"> {
    const { chunksX } = this.dims;
    const cx0 = (t % this.tilesX) * BLOCK_TILE, cz0 = Math.floor(t / this.tilesX) * BLOCK_TILE;
    const group = Uint8Array.from(made.chunks, (c) => Math.floor((Math.floor(c / chunksX) - cz0) / GROUP) * ACROSS + Math.floor(((c % chunksX) - cx0) / GROUP));
    const low = new Float32Array(GROUPS).fill(Infinity), high = new Float32Array(GROUPS).fill(-Infinity);
    for (let k = 0; k < group.length; k++) {
      if (made.count[k] === 0) continue;
      low[group[k]!] = Math.min(low[group[k]!]!, made.low[k]!);
      high[group[k]!] = Math.max(high[group[k]!]!, made.high[k]!);
    }
    for (let g = 0; g < GROUPS; g++) if (!(high[g]! > low[g]!)) low[g] = high[g] = 0;
    return { made, group, low, high };
  }

  /** Lets go of what `tile` holds on the card and of what is being made of it, to be made again if it comes back. */
  private letGo(p: FramePacket, tile: Tile): void {
    if (tile.held) p.assetDrops.push(tile.held.slot);
    if (tile.asked >= 0) this.asked.delete(tile.asked);
    tile.held = null;
    tile.asked = -1;
    tile.dirty = true;
  }

  /** Whether tile `t`'s square, from under the ground to the tallest tower over it, is in view. */
  private seen(t: number, cam: Camera): boolean {
    const x = this.cornerX(t) - cam.x, z = this.cornerZ(t) - cam.z;
    return cam.boxVisible(x, this.hf.minY - cam.y, z, x + BLOCK_TILE_METRES, this.hf.minY + this.hf.stepY * 65535 - cam.y, z + BLOCK_TILE_METRES);
  }

  /** Metres from (x, z) to tile `t`'s square. */
  private off(t: number, x: number, z: number): number {
    const ox = this.cornerX(t), oz = this.cornerZ(t);
    return Math.hypot(Math.max(ox - x, x - ox - BLOCK_TILE_METRES, 0), Math.max(oz - z, z - oz - BLOCK_TILE_METRES, 0));
  }

  private tileOf(chunk: number): number {
    const cx = chunk % this.dims.chunksX;
    const cz = Math.floor(chunk / this.dims.chunksX);
    return Math.floor(cz / BLOCK_TILE) * this.tilesX + Math.floor(cx / BLOCK_TILE);
  }

  private cornerX(t: number): number {
    return (t % this.tilesX) * BLOCK_TILE_METRES;
  }

  private cornerZ(t: number): number {
    return Math.floor(t / this.tilesX) * BLOCK_TILE_METRES;
  }
}
