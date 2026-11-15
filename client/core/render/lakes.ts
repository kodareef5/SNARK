// Water standing on its own surfaces, apart from the sea (shared/world/water.ts): lakes, ponds and a river's reaches,
// drawn as the sea is, see-through, with the lit tiers' WATER program seen from above and the flat plane from under
// water, in both depth ranges and to the end of the view. Water does not change, so the tiles of 4 by 4 chunks that hold
// some are made once, with the map: each body's squares merged into rectangles at its surface, but for squares whose
// ground is all above it, since the flat plane is hidden only by the ground's depth; and a sheet of water down each step
// from a body to lower water beside it, a river's reach to the next or to the sea.
//
// The sea is one plane under everything, so it would show inside a body whose bed goes below it. A tile of the sea's
// (WATER_TILE) holding such a body is not drawn as the sea's mesh: its tiles here draw the sea too, on every square that
// is no body's, on the map and past it. A tile is a level in a slot range of its own, quantized by the pack mesh FAR_MESH
// as the far blocks are (far.ts), from its lowest surface, and drawn with one instance at the origin.

import { CHUNK_SIZE } from "../../../shared/coords.ts";
import { INSTANCE_BYTES, VERTEX_BYTES } from "../../../shared/pack/pack.ts";
import { WATER_COLOR } from "../../../shared/pack/palette.ts";
import type { Heightfield } from "../../../shared/world/heightfield.ts";
import type { MapWater } from "../../../shared/world/water.ts";
import type { Camera } from "./camera.ts";
import { FAR_BUFFER, FAR_HEIGHT, FAR_TILE, FAR_TILE_METRES } from "./far.ts";
import type { FramePacket } from "./packet.ts";
import { WATER_TILE } from "./shading.ts";

/** Slots of tiles on the card start here, past the far city's (farcity.ts, 2^31 up to three times 2^30). */
export const LAKE_SLOTS = 3 * 2 ** 30;
const LAKE_SLOT_SPAN = 2 ** 30;
/** The instance buffer every tile is drawn with: one instance at the origin. */
export const LAKE_BUFFER = FAR_BUFFER + 2;
/** What the tiles hold on the card, as residency.ts reserves it. */
const RESERVE = "water";
/** A square's value in a tile's grid that is the sea's, past every body's number. */
const SEA = 65536;
/** The sea's tiles a side of a tile here. */
const PER_SEA = WATER_TILE / FAR_TILE_METRES;
const WAYS: readonly (readonly [number, number])[] = [[1, 0], [-1, 0], [0, 1], [0, -1]];

interface Tile {
  /** Its corner in the world. */
  readonly x: number;
  readonly z: number;
  /** What goes on the card: indices, then vertices from the next multiple of 4. */
  readonly data: Uint8Array;
  readonly indexCount: number;
  readonly indexBytes: 2 | 4;
  /** Where its vertices' heights start, and the box that holds it, in the world. */
  readonly base: number;
  readonly box: Float64Array;
  /** Its slot on the card, or -1. */
  slot: number;
}

/** The lowest ground, in metres, under the square of `size` metres whose corner is (x, z). */
function lowest(hf: Heightfield, x: number, z: number, size: number): number {
  const i1 = Math.min(hf.nx - 1, Math.ceil((x + size) / hf.cell));
  const j1 = Math.min(hf.nz - 1, Math.ceil((z + size) / hf.cell));
  let low = 65535;
  for (let j = Math.max(0, Math.floor(z / hf.cell)); j <= j1; j++) for (let i = Math.max(0, Math.floor(x / hf.cell)); i <= i1; i++) low = Math.min(low, hf.heights[j * hf.nx + i]!);
  return hf.minY + low * hf.stepY;
}

export class Lakes {
  /** The pack mesh of the tiles' bounds, as a draw names it. */
  readonly mesh: number;
  /** Bytes of tiles on the card. */
  bytes = 0;
  private readonly tiles: Tile[] = [];
  /** By the sea's tile over the map, row by row, 1 where the tiles here draw the sea. */
  private readonly holes: Uint8Array;
  private readonly seaX: number;
  private readonly seaZ: number;
  private next = 0;
  private sent = false;

  /** `bounds` is FAR_MESH's centre and half extent, as the pack has them. */
  constructor(hf: Heightfield, water: MapWater, mesh: number, bounds: { center: readonly number[]; half: readonly number[] }) {
    this.mesh = mesh;
    const { cell, side, surface } = water;
    const sea = hf.seaLevel;
    const dims = hf.dims;
    [this.seaX, this.seaZ] = [Math.ceil(hf.sizeX / WATER_TILE), Math.ceil(hf.sizeZ / WATER_TILE)];
    this.holes = new Uint8Array(this.seaX * this.seaZ);
    // The body squares whose ground goes under their surface, the sea's tiles where a body's ground goes under the sea,
    // and the tiles here that hold a body's squares.
    const wet = new Uint8Array(water.squares.length);
    const tilesX = Math.ceil(dims.chunksX / FAR_TILE);
    const made = new Set<number>();
    for (const c of water.chunks()) {
      const [x0, z0] = [(c % dims.chunksX) * CHUNK_SIZE, Math.floor(c / dims.chunksX) * CHUNK_SIZE];
      const at = water.block[c]!;
      for (let s = 0; s < side * side; s++) {
        const b = water.squares[at + s]!;
        if (b === 0) continue;
        const [x, z] = [x0 + (s % side) * cell, z0 + Math.floor(s / side) * cell];
        const low = lowest(hf, x, z, cell);
        if (low < surface[b]!) wet[at + s] = 1;
        if (low < sea) this.holes[Math.floor(z / WATER_TILE) * this.seaX + Math.floor(x / WATER_TILE)] = 1;
      }
      made.add(Math.floor(z0 / FAR_TILE_METRES) * tilesX + Math.floor(x0 / FAR_TILE_METRES));
    }
    const tiles: [number, number][] = [...made].map((t) => [(t % tilesX) * FAR_TILE_METRES, Math.floor(t / tilesX) * FAR_TILE_METRES]);
    for (let k = 0; k < this.holes.length; k++) {
      if (this.holes[k] === 0) continue;
      const [sx, sz] = [(k % this.seaX) * WATER_TILE, Math.floor(k / this.seaX) * WATER_TILE];
      for (let j = 0; j < PER_SEA; j++) {
        for (let i = 0; i < PER_SEA; i++) {
          const [x, z] = [sx + i * FAR_TILE_METRES, sz + j * FAR_TILE_METRES];
          if (x >= hf.sizeX || z >= hf.sizeZ || !made.has((z / FAR_TILE_METRES) * tilesX + x / FAR_TILE_METRES)) tiles.push([x, z]);
        }
      }
    }
    for (const [x, z] of tiles) {
      const tile = this.make(hf, water, wet, bounds, x, z);
      if (tile) this.tiles.push(tile);
    }
  }

  /** Whether the sea's tile (tx, tz), its corner at WATER_TILE times them, is drawn here and not as the sea's mesh. */
  holed(tx: number, tz: number): boolean {
    return tx >= 0 && tz >= 0 && tx < this.seaX && tz < this.seaZ && this.holes[tz * this.seaX + tx] === 1;
  }

  /** After a lost context: every tile and the instance buffer go on the card again. */
  reset(): void {
    for (const tile of this.tiles) tile.slot = -1;
    this.sent = false;
  }

  /**
   * Puts the tiles within `reach` of the camera at (x, z) on the card, and lets go of those a tile farther. Uploads and
   * drops go into the packet, and what they weigh is spent and reserved in `budget`.
   */
  update(p: FramePacket, budget: { spend(bytes: number): void; reserve(name: string, bytes: number): void }, x: number, z: number, reach: number): void {
    let bytes = 0;
    for (const tile of this.tiles) {
      const off = Math.hypot(Math.max(tile.x - x, x - tile.x - FAR_TILE_METRES, 0), Math.max(tile.z - z, z - tile.z - FAR_TILE_METRES, 0));
      if (tile.slot >= 0 && off > reach + FAR_TILE_METRES) {
        p.assetDrops.push(tile.slot);
        tile.slot = -1;
      } else if (tile.slot < 0 && off <= reach) {
        tile.slot = LAKE_SLOTS + this.next;
        this.next = (this.next + 1) % LAKE_SLOT_SPAN;
        p.assetUploads.push({ slot: tile.slot, mesh: this.mesh, level: 0, data: tile.data, indexCount: tile.indexCount, indexBytes: tile.indexBytes });
        budget.spend(tile.data.length);
      }
      if (tile.slot >= 0) bytes += tile.data.length;
    }
    if (bytes > 0 && !this.sent) {
      p.uploads.push({ buffer: LAKE_BUFFER, data: new Uint8Array(INSTANCE_BYTES), slots: new Uint16Array(1) });
      this.sent = true;
    }
    if (bytes !== this.bytes) budget.reserve(RESERVE, bytes);
    this.bytes = bytes;
  }

  /**
   * Calls `put` for each tile on the card whose nearest point is within `reach` of the camera and in its view: the
   * tile's slot and triangles, where its corner is from the camera, and the depth ranges its box is in.
   */
  draw(cam: Camera, reach: number, put: (slot: number, triangles: number, ox: number, oy: number, oz: number, passes: number) => void): void {
    for (const tile of this.tiles) {
      if (tile.slot < 0) continue;
      const b = tile.box;
      const [ax, ay, az, bx, by, bz] = [b[0]! - cam.x, b[1]! - cam.y, b[2]! - cam.z, b[3]! - cam.x, b[4]! - cam.y, b[5]! - cam.z];
      const near = Math.hypot(Math.max(ax, -bx, 0), Math.max(ay, -by, 0), Math.max(az, -bz, 0));
      if (near >= reach || !cam.boxVisible(ax, ay, az, bx, by, bz)) continue;
      put(tile.slot, tile.indexCount / 3, tile.x - cam.x, tile.base - cam.y, tile.z - cam.z, cam.passes(ax, ay, az, bx, by, bz));
    }
  }

  /** The tile whose corner is (ox, oz), or null where it has nothing to draw. `wet` marks the body squares that hold water. */
  private make(hf: Heightfield, water: MapWater, wet: Uint8Array, bounds: { center: readonly number[]; half: readonly number[] }, ox: number, oz: number): Tile | null {
    const { cell, side, surface, dims } = water;
    const sea = hf.seaLevel;
    const n = FAR_TILE_METRES / cell;
    // Each square's water: a body's number where it holds some, SEA where the tile draws the sea, else 0.
    const grid = new Int32Array(n * n);
    if (this.holed(Math.floor(ox / WATER_TILE), Math.floor(oz / WATER_TILE))) grid.fill(SEA);
    for (let cz = oz / CHUNK_SIZE; cz < Math.min(oz / CHUNK_SIZE + FAR_TILE, dims.chunksZ); cz++) {
      for (let cx = ox / CHUNK_SIZE; cx < Math.min(ox / CHUNK_SIZE + FAR_TILE, dims.chunksX); cx++) {
        const at = water.block[cz * dims.chunksX + cx]!;
        if (at < 0) continue;
        const [i0, j0] = [(cx * CHUNK_SIZE - ox) / cell, (cz * CHUNK_SIZE - oz) / cell];
        for (let s = 0; s < side * side; s++) {
          if (water.squares[at + s] === 0) continue;
          grid[(j0 + Math.floor(s / side)) * n + i0 + (s % side)] = wet[at + s] === 1 ? water.squares[at + s]! : 0;
        }
      }
    }
    const level = (v: number): number => (v === SEA ? sea : surface[v]!);
    /** The surface of the water on the square whose corner is (x, z), -Infinity where it holds none. */
    const waterOn = (x: number, z: number): number => {
      if (x < 0 || z < 0 || x >= hf.sizeX || z >= hf.sizeZ) return sea;
      const b = water.bodyAt(x + cell / 2, z + cell / 2);
      const top = b === 0 ? sea : surface[b]!;
      return top > -Infinity && lowest(hf, x, z, cell) < top ? top : -Infinity;
    };
    const pos: number[] = [];
    // A face is a corner and two edges, x and z from the tile's corner, y in the world.
    const face = (x: number, y: number, z: number, ux: number, uy: number, uz: number, vx: number, vy: number, vz: number): void => {
      pos.push(x, y, z, x + ux, y + uy, z + uz, x + ux + vx, y + uy + vy, z + uz + vz, x + vx, y + vy, z + vz);
    };
    // The squares of one water merged into rectangles, facing up.
    const used = new Uint8Array(n * n);
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const c = j * n + i;
        const v = grid[c]!;
        if (v === 0 || used[c] === 1) continue;
        let w = 1;
        while (i + w < n && grid[c + w] === v && used[c + w] === 0) w++;
        let d = 1;
        grow: while (j + d < n) {
          for (let k = 0; k < w; k++) if (grid[(j + d) * n + i + k] !== v || used[(j + d) * n + i + k] === 1) break grow;
          d++;
        }
        for (let k = 0; k < d; k++) used.fill(1, (j + k) * n + i, (j + k) * n + i + w);
        face(i * cell, level(v), j * cell, 0, 0, d * cell, w * cell, 0, 0);
      }
    }
    // A sheet down each side of a body's square that has lower water beside it, merged along its row.
    for (const [di, dj] of WAYS) {
      for (let line = 0; line < n; line++) {
        let from = -1;
        let top = 0;
        let foot = 0;
        for (let step = 0; step <= n; step++) {
          let t = -Infinity;
          let f = -Infinity;
          if (step < n) {
            const i = di !== 0 ? line : step;
            const j = di !== 0 ? step : line;
            const v = grid[j * n + i]!;
            const ni = i + di;
            const nj = j + dj;
            if (v !== 0 && v !== SEA && (ni < 0 || nj < 0 || ni >= n || nj >= n || grid[nj * n + ni] !== v)) {
              const below = waterOn(ox + ni * cell, oz + nj * cell);
              if (below > -Infinity && below < surface[v]!) {
                t = surface[v]!;
                f = below;
              }
            }
          }
          if (from >= 0 && t === top && f === foot) continue;
          if (from >= 0) {
            const [a, e] = [from * cell, step * cell];
            if (di !== 0) face((line + (di > 0 ? 1 : 0)) * cell, foot, a, 0, top - foot, 0, 0, 0, e - a);
            else face(a, foot, (line + (dj > 0 ? 1 : 0)) * cell, 0, top - foot, 0, e - a, 0, 0);
          }
          from = t > -Infinity ? step : -1;
          top = t;
          foot = f;
        }
      }
    }
    const faces = pos.length / 12;
    if (faces === 0) return null;
    const box = Float64Array.of(Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity);
    for (let k = 0; k < pos.length; k++) {
      box[k % 3] = Math.min(box[k % 3]!, pos[k]!);
      box[(k % 3) + 3] = Math.max(box[(k % 3) + 3]!, pos[k]!);
    }
    const base = box[1]!;
    [box[0], box[2], box[3], box[5]] = [box[0]! + ox, box[2]! + oz, box[3]! + ox, box[5]! + oz];
    const verts = faces * 4;
    const indexBytes = verts > 65535 ? 4 : 2;
    const at = (faces * 6 * indexBytes + 3) & ~3;
    const data = new Uint8Array(at + verts * VERTEX_BYTES);
    const view = new DataView(data.buffer);
    const [c, h] = [bounds.center, bounds.half];
    const q = (v: number, a: number): number => Math.max(-32767, Math.min(32767, Math.round(((v - c[a]!) / h[a]!) * 32767)));
    for (let f = 0; f < faces; f++) {
      for (const [k, i] of [0, 1, 2, 0, 2, 3].entries()) {
        if (indexBytes === 4) view.setUint32((f * 6 + k) * 4, f * 4 + i, true);
        else view.setUint16((f * 6 + k) * 2, f * 4 + i, true);
      }
    }
    for (let v = 0; v < verts; v++) {
      const o = at + v * VERTEX_BYTES;
      view.setInt16(o, q(pos[v * 3]!, 0), true);
      view.setInt16(o + 2, q(Math.min(pos[v * 3 + 1]! - base, FAR_HEIGHT), 1), true);
      view.setInt16(o + 4, q(pos[v * 3 + 2]!, 2), true);
      data[o + 6] = WATER_COLOR;
    }
    return { x: ox, z: oz, data, indexCount: faces * 6, indexBytes, base, box, slot: -1 };
  }
}
