// Bases past the near rows, drawn as blocks from the far feed's cells (farcells.ts): a column per filled 4 m cell from
// under the ground to its top, in its colour. A chunk is drawn far while it has far cells and the near store does not
// hold it whole, so its real pieces and its blocks are never both drawn and never neither. The blocks of 4 by 4 chunks
// are one mesh, a level in a slot range of its own, quantized by the pack mesh FAR_MESH, and made again when a chunk of
// it changes its cells or turns near or far. Each is drawn to the tier's reach and dropped over the last share of it
// by a 4 by 4 ordered pattern on the pixel (FAR_FADE in glsl.ts, `fadeKeeps` here), the same in the rasterizer.

import type { Registry } from "../../../shared/content/registry.ts";
import { CHUNK_SIZE, chunkCount, type MapDims } from "../../../shared/coords.ts";
import { INSTANCE_BYTES, VERTEX_BYTES, lodVertices, readIndices, type Pack } from "../../../shared/pack/pack.ts";
import { REGION_BASE, nearestColour } from "../../../shared/pack/palette.ts";
import type { Heightfield } from "../../../shared/world/heightfield.ts";
import { TACTICAL_CELL, farTopMetres, pieceShapes, type FarCells } from "../../../shared/world/tactical.ts";
import type { FarStore } from "../farcells.ts";
import type { GoneStore } from "../gonelists.ts";
import type { Camera } from "./camera.ts";
import { columnFaces, type Columns } from "./blocks.ts";
import { FADE_ORDER } from "./hand.ts";
import type { Hider } from "./hide.ts";
import { quadBytes, type FramePacket } from "./packet.ts";
import { linearToSrgb, srgbToLinear } from "./surface.ts";

/** The pack mesh whose bounds every tile's vertices are stored within: FAR_TILE_METRES square and FAR_HEIGHT tall. */
export const FAR_MESH = "core:far";
/** Chunks along a tile's side, and its side in metres. */
export const FAR_TILE = 4;
export const FAR_TILE_METRES = FAR_TILE * CHUNK_SIZE;
/** Metres from a tile's lowest foot that its blocks may reach. A tower's top is at most 318 m over its ground. */
export const FAR_HEIGHT = 1024;
/**
 * Slots of tiles on the card start here, clear of every level, surface and texture of the manifest, FAR_SPAN of them;
 * the city's blocks take the span after (cityblocks.ts).
 */
export const FAR_SLOTS = 1 << 30;
export const FAR_SPAN = 1 << 29;
/** The last of that span is the fragments' meshes' (fragment-meshes.ts): a tile's slot wraps short of them. */
export const FAR_TILE_SPAN = FAR_SPAN - 4096;
/** The instance buffer every tile is drawn with: one instance at the origin. Clear of chunk indices and the node store's. */
export const FAR_BUFFER = 2 << 20;
/** The far city's tiles and the city's blocks are drawn with the next one (farcity.ts, cityblocks.ts). */
export const CITY_BUFFER = FAR_BUFFER + 1;
/** What the far blocks hold on the card, as residency.ts reserves it. */
const RESERVE = "far blocks";
/**
 * Tiles nearer than this hold every chunk the near store may hold (4 chunks round the body's, under 450 m off), so they
 * are made in the frame a chunk of theirs changes. Of the rest, this many a frame, nearest first.
 */
const FAR_NOW = 512;
const FAR_MAKES = 4;
/**
 * Quads of the drawn ground are 2 m to 32 m across (terrain.ts, at most 16 m within 2.56 km). A column's foot goes 1 m
 * under the lowest sample of every quad of those sizes that holds its cell, so it stands in whatever level is drawn.
 */
const FOOT_LEVELS = 5;
const FOOT = 1;

const SIDE = CHUNK_SIZE / TACTICAL_CELL;
const CELLS = SIDE * SIDE;

/**
 * Whether the far fade keeps a fragment `dist` metres off at window pixel (x, y), counted from the bottom left, of a
 * draw gone at `gone` metres that fades over the last `share` of it. A draw at -`gone` fades in over the same distances,
 * keeping exactly the fragments the other drops. FAR_FADE's twin.
 */
export function fadeKeeps(dist: number, gone: number, share: number, x: number, y: number): boolean {
  const g = Math.abs(gone);
  return (g - dist) * 16 > (FADE_ORDER[(y & 3) * 4 + (x & 3)]! + 0.5) * g * share === gone > 0;
}

/**
 * What the scene draws far bases from: the far feed's cells, and which chunks the near store holds whole. `lists` are the
 * map's own pieces gone, which the far city leaves out.
 */
export interface FarSource {
  readonly cells: FarStore;
  readonly lists?: GoneStore;
  /** Whether the near store holds `chunk` whole: its last row has come since it was last dropped. */
  complete(chunk: number): boolean;
}

/**
 * The far city (farcity.ts) as the far blocks see it: per chunk, the far feed's top byte of each cell as the map's own
 * standing pieces make it, which the blocks leave to the city, and a count of changes to that.
 */
export interface FarCityCells {
  topsOf(chunk: number): Uint8Array | null;
  readonly goneVersion: Uint32Array;
}

/** One chunk's blocks: four corners a face, x and z from its tile's corner, y in the world, and a palette colour a corner. */
export interface FarPart {
  readonly pos: Float32Array;
  readonly color: Uint8Array;
  readonly faces: number;
  /** The box that holds it, x and z from the tile's corner. */
  readonly box: readonly number[];
}

// Scratch for a chunk: which cells are filled, each one's top and foot in metres, and how close a top is one roof with another.
const filled = new Uint8Array(CELLS);
const tops = new Float64Array(CELLS);
const feet = new Float64Array(CELLS);
const close = new Float64Array(CELLS);

/** The colour each palette colour is drawn in, the same unless `farColours` says. */
const SAME_COLOURS = Uint8Array.from({ length: 256 }, (_, i) => i);

/**
 * The colour far blocks draw each palette colour of the far feed in: the palette colour nearest the mean, in light and
 * by area, of the coarsest level of every piece of that colour the feed shows, as `meshOf` binds them. A piece's art
 * is not the colour its kind is listed in (the wood pieces are listed orange and drawn brown), and the feed sends the
 * listed one. `meshOf` gives -1 for a kind with no mesh of its own.
 */
export function farColours(reg: Registry, pack: Pack, meshOf: (kind: number) => number): Uint8Array {
  const shapes = pieceShapes(reg);
  const sums = new Float64Array(256 * 4);
  const pal = pack.palette;
  for (let k = 1; k < reg.defs.length; k++) {
    const mesh = shapes.far[k] === 1 ? meshOf(k) : -1;
    const m = mesh >= 0 ? pack.header.meshes[mesh] : undefined;
    if (!m) continue;
    const lod = m.lods.at(-1)!;
    const verts = lodVertices(pack, lod);
    const view = new DataView(verts.buffer, verts.byteOffset, verts.byteLength);
    const at = (v: number, a: number): number => (view.getInt16(v * VERTEX_BYTES + a * 2, true) / 32767) * m.half[a]!;
    const index = readIndices(pack, lod);
    const own = shapes.tint[k]!;
    for (let t = 0; t < index.length; t += 3) {
      const a = index[t]!, b = index[t + 1]!, c = index[t + 2]!;
      const u = [0, 1, 2].map((i) => at(b, i) - at(a, i));
      const v = [0, 1, 2].map((i) => at(c, i) - at(a, i));
      const area = Math.hypot(u[1]! * v[2]! - u[2]! * v[1]!, u[2]! * v[0]! - u[0]! * v[2]!, u[0]! * v[1]! - u[1]! * v[0]!);
      const col = verts[c * VERTEX_BYTES + 6]!;
      const shown = col === REGION_BASE ? own : col > REGION_BASE ? 0 : col;
      for (let i = 0; i < 3; i++) sums[own * 4 + i]! += srgbToLinear(pal[shown * 4 + i]! / 255) * area;
      sums[own * 4 + 3]! += area;
    }
  }
  const out = SAME_COLOURS.slice();
  for (let c = 0; c < 256; c++) {
    const area = sums[c * 4 + 3]!;
    if (area === 0) continue;
    const r = Math.round(linearToSrgb(sums[c * 4]! / area) * 255);
    const g = Math.round(linearToSrgb(sums[c * 4 + 1]! / area) * 255);
    const b = Math.round(linearToSrgb(sums[c * 4 + 2]! / area) * 255);
    if (r !== pal[c * 4] || g !== pal[c * 4 + 1] || b !== pal[c * 4 + 2]) out[c] = nearestColour(pal, r, g, b);
  }
  return out;
}

/** The lowest ground any level of the drawn terrain puts under the cell of samples (i0, j0) to (i0 + n, j0 + n). */
function lowestUnder(hf: Heightfield, i0: number, j0: number, n: number): number {
  let low = Infinity;
  for (let level = 0; level < FOOT_LEVELS; level++) {
    const s = 1 << level;
    const ib = Math.ceil((i0 + n) / s) * s;
    const jb = Math.ceil((j0 + n) / s) * s;
    for (let j = Math.floor(j0 / s) * s; j <= jb; j += s) {
      for (let i = Math.floor(i0 / s) * s; i <= ib; i += s) {
        const y = hf.sample(i < hf.nx ? i : hf.nx - 1, j < hf.nz ? j : hf.nz - 1);
        if (y < low) low = y;
      }
    }
  }
  return low;
}

/** How far apart two tops the far feed sends may be and still be one height: a step of farTopByte's, at the coarser of the two. */
const step = (byte: number): number => (byte > 128 ? 2 : 0.5);

/**
 * The blocks of a chunk whose corner is (x0, z0), in a tile whose corner is (ox, oz), each cell in the colour `colours`
 * gives its own, as columns of its cells (blocks.ts columnFaces): a chunk's blocks do not depend on its neighbours.
 */
export function farPart(cells: FarCells, x0: number, z0: number, ox: number, oz: number, hf: Heightfield, colours: Uint8Array = SAME_COLOURS, city: Uint8Array | null = null): FarPart {
  // A cell no taller than the map's own pieces make it is the far city's to draw (farcity.ts); one taller is drawn above them.
  const top = city ? cells.top.map((t, c) => (t <= city[c]! ? 0 : t)) : cells.top;
  const tint = cells.tint.map((t) => colours[t]!);
  const n = Math.round(TACTICAL_CELL / hf.cell);
  for (let c = 0; c < CELLS; c++) {
    filled[c] = top[c] === 0 ? 0 : 1;
    if (top[c] === 0) continue;
    close[c] = step(top[c]!);
    const x = x0 + (c % SIDE) * TACTICAL_CELL;
    const z = z0 + Math.floor(c / SIDE) * TACTICAL_CELL;
    const ground = hf.heightAt(x + TACTICAL_CELL / 2, z + TACTICAL_CELL / 2);
    tops[c] = ground + farTopMetres(top[c]!);
    feet[c] = city && city[c]! > 0 ? ground + farTopMetres(city[c]!) : Math.min(ground, lowestUnder(hf, Math.round(x / hf.cell), Math.round(z / hf.cell), n)) - FOOT;
  }
  // A top is kept over the ground at its cell's middle, to a step, so a level roof over rough ground comes in steps.
  const out: Columns = { pos: [], color: [], box: [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity] };
  columnFaces(SIDE, TACTICAL_CELL, x0, z0, ox, oz, filled, tops, feet, tint, close, out);
  return { pos: Float32Array.from(out.pos), color: Uint8Array.from(out.color), faces: out.color.length / 4, box: out.box };
}

interface Tile {
  /** Its chunks turned near or far, or changed their cells, since it was made. */
  dirty: boolean;
  /** What goes on the card, kept to send again after a lost context: its vertices, drawn with the quads' indices (packet.ts quadIndices). */
  data: Uint8Array | null;
  indexCount: number;
  indexBytes: 2 | 4;
  /** Its slot on the card, or -1. */
  slot: number;
  /** Where its vertices' heights start, and the box that holds it, in the world. */
  base: number;
  readonly box: Float64Array;
  /** The `draw` that last looked at it, and how it drew it: 0 not, 1 whole, 2 fading out at the reach (FarBlocks.shows). */
  shownAt: number;
  shownAs: number;
}

export class FarBlocks {
  /** The pack mesh of the tiles' bounds, as a draw names it. */
  readonly mesh: number;
  /** Bytes of tiles on the card. */
  bytes = 0;
  private readonly source: FarSource;
  private readonly dims: MapDims;
  private readonly hf: Heightfield;
  private readonly center: readonly number[];
  private readonly half: readonly number[];
  private readonly tilesX: number;
  /** Per chunk: 1 while it is drawn far, and its cells' change count (FarStore.changed) when last looked at. */
  private readonly far: Uint8Array;
  private readonly stamp: Uint32Array;
  /** Chunks with cells as last looked at, and the parts made of them. */
  private readonly known = new Set<number>();
  private readonly parts = new Map<number, FarPart>();
  private readonly tiles = new Map<number, Tile>();
  private seen = -1;
  /** The heightfield's changes taken in. */
  private ground: number;
  private next = 0;
  /** The instance buffer is on the card, and blocks are drawn at all (the tier reaches past 0). */
  private sent = false;
  private on = false;
  private readonly list: FarPart[] = [];
  private readonly waiting: number[] = [];
  private readonly colours: Uint8Array;
  /** The far city, whose cells these leave to it, and per chunk its count of changes when last looked at. */
  private city: FarCityCells | null;
  private readonly cityStamp: Uint32Array;
  /** Counts the calls to `draw`, and the camera's place and the reach at the last. */
  private drawn = 0;
  private drawnX = 0;
  private drawnZ = 0;
  private drawnReach = 0;

  /** `bounds` is FAR_MESH's centre and half extent, as the pack has them, and `colours` what farColours gives. */
  constructor(source: FarSource, dims: MapDims, hf: Heightfield, mesh: number, bounds: { center: readonly number[]; half: readonly number[] }, colours: Uint8Array = SAME_COLOURS, city: FarCityCells | null = null) {
    this.source = source;
    this.dims = dims;
    this.hf = hf;
    this.mesh = mesh;
    this.center = bounds.center;
    this.half = bounds.half;
    this.colours = colours;
    this.city = city;
    this.tilesX = Math.ceil(dims.chunksX / FAR_TILE);
    this.far = new Uint8Array(chunkCount(dims));
    this.stamp = new Uint32Array(chunkCount(dims));
    this.cityStamp = new Uint32Array(chunkCount(dims));
    this.ground = hf.changes.length;
  }

  /** A far city come after these: every chunk's blocks are made again, without the cells it draws. */
  leaveTo(city: FarCityCells): void {
    this.city = city;
    this.cityStamp.fill(0xffffffff);
  }

  /** Whether `chunk` is drawn far this frame, so its real pieces are not. */
  isFar(chunk: number): boolean {
    return this.on && this.far[chunk] === 1;
  }

  /** After a lost context: every tile and the instance buffer go on the card again. */
  reset(): void {
    for (const tile of this.tiles.values()) tile.slot = -1;
    this.sent = false;
  }

  /**
   * Brings the tiles within `reach` of the camera at (x, z) up to date and on the card, and lets go of those a tile
   * farther. Uploads and drops go into the packet, and what they weigh is spent and reserved in `budget`.
   */
  update(p: FramePacket, budget: { spend(bytes: number): void; reserve(name: string, bytes: number): void }, x: number, z: number, reach: number): void {
    this.on = reach > 0;
    // Ground that came: the blocks on it are made again, and those a chunk past it, whose feet may reach across.
    const c = this.hf.changes, { chunksX, chunksZ } = this.dims;
    for (; this.ground < c.length; this.ground += 4) {
      for (let cz = Math.max(0, c[this.ground + 1]! - 1); cz < Math.min(chunksZ, c[this.ground + 3]! + 1); cz++) {
        for (let cx = Math.max(0, c[this.ground]! - 1); cx < Math.min(chunksX, c[this.ground + 2]! + 1); cx++) {
          if (!this.known.has(cz * chunksX + cx)) continue;
          this.parts.delete(cz * chunksX + cx);
          this.touch(cz * chunksX + cx);
        }
      }
    }
    const cells = this.source.cells;
    for (const chunk of cells.chunks.keys()) {
      const far = this.source.complete(chunk) ? 0 : 1;
      const stamp = cells.changed[chunk]!;
      const cityStamp = this.city?.goneVersion[chunk] ?? 0;
      if (far === this.far[chunk] && stamp === this.stamp[chunk] && cityStamp === this.cityStamp[chunk]) continue;
      if (stamp !== this.stamp[chunk] || cityStamp !== this.cityStamp[chunk]) {
        this.parts.delete(chunk);
        this.stamp[chunk] = stamp;
        this.cityStamp[chunk] = cityStamp;
        this.known.add(chunk);
      }
      this.far[chunk] = far;
      this.touch(chunk);
    }
    if (cells.version !== this.seen) {
      this.seen = cells.version;
      for (const chunk of this.known) {
        if (cells.chunks.has(chunk)) continue;
        this.known.delete(chunk);
        this.parts.delete(chunk);
        this.far[chunk] = this.stamp[chunk] = 0;
        this.touch(chunk);
      }
    }
    // A tile that may hold a chunk the near store holds or let go of is made in this frame, so the chunk is never drawn
    // both ways or neither. Any other waits its turn, nearest first, a few a frame.
    const waiting = this.waiting;
    waiting.length = 0;
    for (const t of this.tiles.keys()) {
      const tile = this.tiles.get(t)!;
      const off = this.off(t, x, z);
      if (!this.on || off > reach + FAR_TILE_METRES) {
        // Out of reach by a tile: let go of it, and make it again if it comes back.
        if (tile.slot >= 0) p.assetDrops.push(tile.slot);
        tile.slot = -1;
        tile.data = null;
        tile.dirty = true;
        this.forget(t);
      } else if (off <= reach && tile.dirty) {
        if (off < FAR_NOW) this.remake(p, t, tile);
        else waiting.push(t);
      }
    }
    waiting.sort((a, b) => this.off(a, x, z) - this.off(b, x, z));
    for (let k = 0; k < Math.min(FAR_MAKES, waiting.length); k++) this.remake(p, waiting[k]!, this.tiles.get(waiting[k]!)!);
    let bytes = 0;
    for (const t of this.tiles.keys()) {
      const tile = this.tiles.get(t)!;
      if (!tile.data) continue;
      if (tile.slot < 0 && this.off(t, x, z) <= reach) {
        tile.slot = FAR_SLOTS + this.next;
        this.next = (this.next + 1) % FAR_TILE_SPAN;
        p.assetUploads.push({ slot: tile.slot, mesh: this.mesh, level: 0, data: tile.data, indexCount: tile.indexCount, indexBytes: tile.indexBytes, quads: true });
        budget.spend(tile.data.length);
      }
      if (tile.slot >= 0) bytes += tile.data.length;
    }
    if (bytes > 0 && !this.sent) {
      p.uploads.push({ buffer: FAR_BUFFER, data: new Uint8Array(INSTANCE_BYTES), slots: new Uint16Array(1) });
      this.sent = true;
    }
    if (bytes !== this.bytes) budget.reserve(RESERVE, bytes);
    this.bytes = bytes;
  }

  /**
   * Calls `put` for each tile on the card whose nearest point is within `reach` of the camera and in its view: the
   * tile's slot and triangles, where its corner is from the camera, the depth ranges its box is in, where it is gone (the
   * reach, or 0 for a tile wholly short of the last `share` of it, where nothing fades) and how far off its nearest is.
   * A tile whose box `hider` says is hidden is left out.
   */
  draw(cam: Camera, reach: number, share: number, put: (slot: number, triangles: number, ox: number, oy: number, oz: number, passes: number, fade: number, near: number) => void, hider?: Hider): void {
    this.drawn++;
    this.drawnX = cam.x;
    this.drawnZ = cam.z;
    this.drawnReach = reach;
    for (const t of this.tiles.keys()) {
      const tile = this.tiles.get(t)!;
      if (tile.slot < 0) continue;
      const b = tile.box;
      const ax = b[0]! - cam.x, ay = b[1]! - cam.y, az = b[2]! - cam.z, bx = b[3]! - cam.x, by = b[4]! - cam.y, bz = b[5]! - cam.z;
      const near = Math.hypot(Math.max(ax, -bx, 0), Math.max(ay, -by, 0), Math.max(az, -bz, 0));
      const most = Math.hypot(Math.max(-ax, bx), Math.max(-ay, by), Math.max(-az, bz));
      tile.shownAt = this.drawn;
      tile.shownAs = near >= reach ? 0 : most < reach * (1 - share) ? 1 : 2;
      if (near >= reach || !cam.boxVisible(ax, ay, az, bx, by, bz) || (hider !== undefined && hider.hides(ax, ay, az, bx, by, bz))) continue;
      const ox = this.cornerX(t), oz = this.cornerZ(t);
      put(tile.slot, tile.indexCount / 3, ox - cam.x, tile.base - cam.y, oz - cam.z, cam.passes(ax, ay, az, bx, by, bz), most < reach * (1 - share) ? 0 : reach, near);
    }
  }

  /**
   * How `chunk`'s buildings were drawn here in the last `draw` while no far city takes the map's own pieces from these
   * (cityblocks.ts Shown): -1 whole, the reach where its tile fades out at it, and 0 not. A chunk the far feed has told
   * of whose tile holds no faces is drawn as nothing, whole, within the reach.
   */
  shows(chunk: number): number {
    if (this.city || !this.on || (this.source.cells.changed[chunk] ?? 0) === 0 || this.source.complete(chunk)) return 0;
    const t = this.tileOf(chunk), tile = this.tiles.get(t);
    if (!tile) return this.off(t, this.drawnX, this.drawnZ) < this.drawnReach ? -1 : 0;
    if (tile.slot < 0 || tile.shownAt !== this.drawn) return 0;
    return tile.shownAs === 1 ? -1 : tile.shownAs === 2 ? this.drawnReach : 0;
  }

  /** Metres from (x, z) to tile `t`'s square. */
  private off(t: number, x: number, z: number): number {
    const ox = this.cornerX(t), oz = this.cornerZ(t);
    return Math.hypot(Math.max(ox - x, x - ox - FAR_TILE_METRES, 0), Math.max(oz - z, z - oz - FAR_TILE_METRES, 0));
  }

  /** Makes tile `t` again, letting go of what the card held of it. A tile with no chunk drawn far is forgotten. */
  private remake(p: FramePacket, t: number, tile: Tile): void {
    if (tile.slot >= 0) p.assetDrops.push(tile.slot);
    tile.slot = -1;
    tile.dirty = false;
    this.make(t, tile);
    if (!tile.data) this.tiles.delete(t);
  }

  private tileOf(chunk: number): number {
    const cx = chunk % this.dims.chunksX;
    const cz = Math.floor(chunk / this.dims.chunksX);
    return Math.floor(cz / FAR_TILE) * this.tilesX + Math.floor(cx / FAR_TILE);
  }

  /** Tile `t`'s corner nearest the map's origin, in metres. */
  private cornerX(t: number): number {
    return (t % this.tilesX) * FAR_TILE_METRES;
  }

  private cornerZ(t: number): number {
    return Math.floor(t / this.tilesX) * FAR_TILE_METRES;
  }

  private touch(chunk: number): void {
    const t = this.tileOf(chunk);
    const tile = this.tiles.get(t);
    if (tile) tile.dirty = true;
    else this.tiles.set(t, { dirty: true, data: null, indexCount: 0, indexBytes: 2, slot: -1, base: 0, box: new Float64Array(6), shownAt: 0, shownAs: 0 });
  }

  /** The chunks of tile `t`, by calling `each` with each that is on the map. */
  private chunks(t: number, each: (chunk: number, x0: number, z0: number) => void): void {
    const ox = this.cornerX(t), oz = this.cornerZ(t);
    const cx0 = ox / CHUNK_SIZE, cz0 = oz / CHUNK_SIZE;
    for (let cz = cz0; cz < Math.min(cz0 + FAR_TILE, this.dims.chunksZ); cz++) for (let cx = cx0; cx < Math.min(cx0 + FAR_TILE, this.dims.chunksX); cx++) each(cz * this.dims.chunksX + cx, cx * CHUNK_SIZE, cz * CHUNK_SIZE);
  }

  private forget(t: number): void {
    this.chunks(t, (chunk) => this.parts.delete(chunk));
  }

  /** Makes tile `t`'s mesh of the parts of its chunks drawn far, or none if it has none. */
  private make(t: number, tile: Tile): void {
    const ox = this.cornerX(t), oz = this.cornerZ(t);
    const list = this.list;
    list.length = 0;
    let faces = 0;
    const box = tile.box.fill(Infinity, 0, 3).fill(-Infinity, 3, 6);
    this.chunks(t, (chunk, x0, z0) => {
      if (this.far[chunk] !== 1) return;
      let part = this.parts.get(chunk);
      const cells = this.source.cells.chunks.get(chunk);
      if (!part && cells) this.parts.set(chunk, (part = farPart(cells, x0, z0, ox, oz, this.hf, this.colours, this.city?.topsOf(chunk) ?? null)));
      if (!part || part.faces === 0) return;
      list.push(part);
      faces += part.faces;
      for (let a = 0; a < 3; a++) {
        box[a] = Math.min(box[a]!, part.box[a]!);
        box[a + 3] = Math.max(box[a + 3]!, part.box[a + 3]!);
      }
    });
    if (faces === 0) {
      tile.data = null;
      return;
    }
    const base = (tile.base = Math.floor(box[1]!));
    box[0] = box[0]! + ox;
    box[2] = box[2]! + oz;
    box[3] = box[3]! + ox;
    box[5] = box[5]! + oz;
    const data = new Uint8Array(faces * 4 * VERTEX_BYTES);
    const view = new DataView(data.buffer);
    const c = this.center, h = this.half;
    const q = (v: number, a: number): number => Math.max(-32767, Math.min(32767, Math.round(((v - c[a]!) / h[a]!) * 32767)));
    let o = 0;
    for (const part of list) {
      const { pos, color } = part;
      for (let i = 0; i < color.length; i++, o += VERTEX_BYTES) {
        view.setInt16(o, q(pos[i * 3]!, 0), true);
        view.setInt16(o + 2, q(pos[i * 3 + 1]! - base, 1), true);
        view.setInt16(o + 4, q(pos[i * 3 + 2]!, 2), true);
        data[o + 6] = color[i]!;
      }
    }
    tile.data = data;
    tile.indexCount = faces * 6;
    tile.indexBytes = quadBytes(faces);
  }
}
