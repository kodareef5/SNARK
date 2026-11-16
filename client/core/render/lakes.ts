// Water standing on its own surfaces, apart from the sea (shared/world/water.ts): lakes, ponds and a river's reaches,
// drawn as the sea is, see-through, with the lit tiers' WATER program seen from above and the flat plane from under
// water, in both depth ranges and to the end of the view. Water does not change, so the tiles of LAKE_TILE that hold
// some are made once, with the map, 256 m at a time: each body's squares merged into rectangles at its surface, but for
// squares whose ground is all above it, since the flat plane is hidden only by the ground's depth; and a sheet of water
// down each step from a body to lower water beside it, a river's reach to the next or to the sea.
//
// The sea is one plane under everything, so it would show inside a body whose bed goes below it. A tile of the sea's
// (WATER_TILE) holding such a body is not drawn as the sea's mesh: the tile here that holds it draws the sea too, on every
// square of it that is no body's, on the map and past it. A tile is a level in a slot range of its own, its vertices
// stored within bounds of its own (AssetUpload `bounds`) from its corner and its lowest surface, and drawn with one
// instance at the origin.

import { CHUNK_SIZE } from "../../../shared/coords.ts";
import { INSTANCE_BYTES, VERTEX_BYTES } from "../../../shared/pack/pack.ts";
import { WATER_COLOR } from "../../../shared/pack/palette.ts";
import type { Heightfield } from "../../../shared/world/heightfield.ts";
import type { MapWater } from "../../../shared/world/water.ts";
import type { Camera } from "./camera.ts";
import { FAR_BUFFER, FAR_TILE, FAR_TILE_METRES } from "./far.ts";
import { quadBytes, type FramePacket } from "./packet.ts";
import { WATER_TILE } from "./shading.ts";

/** Slots of tiles on the card start here, past the far city's (farcity.ts, 2^31 up to three times 2^30). */
export const LAKE_SLOTS = 3 * 2 ** 30;
const LAKE_SLOT_SPAN = 2 ** 30;
/** The instance buffer every tile is drawn with: one instance at the origin. */
export const LAKE_BUFFER = FAR_BUFFER + 2;
/** A tile's side in metres, four of the sea's. */
const LAKE_TILE = 4 * WATER_TILE;
/** Half what a tile's vertices are stored within across: an eighth of a metre a step, so every square's corner is stored exactly. */
const ACROSS = 32767 / 8;
/** What the tiles hold on the card, as residency.ts reserves it. */
const RESERVE = "water";
/** A square's value in a tile's grid that is the sea's, past every body's number. */
const SEA = 65536;
/** A tile is made in parts of a far tile's side, PARTS a side. */
const PARTS = LAKE_TILE / FAR_TILE_METRES;
const WAYS: readonly (readonly [number, number])[] = [[1, 0], [-1, 0], [0, 1], [0, -1]];

interface Tile {
  /** Its corner in the world. */
  readonly x: number;
  readonly z: number;
  /** What goes on the card: its vertices, drawn with the quads' indices (packet.ts quadIndices). */
  readonly data: Uint8Array;
  readonly indexCount: number;
  readonly indexBytes: 2 | 4;
  /** Where its vertices' heights start, the box that holds it, in the world, and the bounds they are stored within. */
  readonly base: number;
  readonly box: Float64Array;
  readonly bounds: { readonly center: readonly number[]; readonly half: readonly number[] };
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
  /** The pack mesh a draw names (far.ts FAR_MESH), whose bounds the tiles' own stand in for. */
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

  constructor(hf: Heightfield, water: MapWater, mesh: number) {
    this.mesh = mesh;
    const { cell, side, surface } = water;
    const sea = hf.seaLevel;
    const dims = hf.dims;
    this.seaX = Math.ceil(hf.sizeX / WATER_TILE);
    this.seaZ = Math.ceil(hf.sizeZ / WATER_TILE);
    this.holes = new Uint8Array(this.seaX * this.seaZ);
    // The body squares whose ground goes under their surface, the sea's tiles where a body's ground goes under the sea,
    // and the parts and tiles that hold a body's squares.
    const wet = new Uint8Array(water.squares.length);
    const partsX = Math.ceil(dims.chunksX / FAR_TILE);
    const parts = new Set<number>();
    const tilesX = Math.ceil(hf.sizeX / LAKE_TILE);
    const tiles = new Set<number>();
    for (const c of water.chunks()) {
      const x0 = (c % dims.chunksX) * CHUNK_SIZE, z0 = Math.floor(c / dims.chunksX) * CHUNK_SIZE;
      const at = water.block[c]!;
      for (let s = 0; s < side * side; s++) {
        const b = water.squares[at + s]!;
        if (b === 0) continue;
        const x = x0 + (s % side) * cell, z = z0 + Math.floor(s / side) * cell;
        const low = lowest(hf, x, z, cell);
        if (low < surface[b]!) wet[at + s] = 1;
        if (low < sea) this.holes[Math.floor(z / WATER_TILE) * this.seaX + Math.floor(x / WATER_TILE)] = 1;
      }
      parts.add(Math.floor(z0 / FAR_TILE_METRES) * partsX + Math.floor(x0 / FAR_TILE_METRES));
      tiles.add(Math.floor(z0 / LAKE_TILE) * tilesX + Math.floor(x0 / LAKE_TILE));
    }
    // A tile is made a part at a time: those that hold a body's squares, and every part of a sea's tile it draws the sea of.
    for (const t of tiles) {
      const tx = (t % tilesX) * LAKE_TILE, tz = Math.floor(t / tilesX) * LAKE_TILE;
      const pos: number[] = [];
      for (let k = 0; k < PARTS * PARTS; k++) {
        const x = tx + (k % PARTS) * FAR_TILE_METRES, z = tz + Math.floor(k / PARTS) * FAR_TILE_METRES;
        if (this.holed(Math.floor(x / WATER_TILE), Math.floor(z / WATER_TILE)) || (x < hf.sizeX && z < hf.sizeZ && parts.has((z / FAR_TILE_METRES) * partsX + x / FAR_TILE_METRES))) this.part(hf, water, wet, x, z, x - tx, z - tz, pos);
      }
      const tile = this.tile(pos, tx, tz);
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
      const off = Math.hypot(Math.max(tile.x - x, x - tile.x - LAKE_TILE, 0), Math.max(tile.z - z, z - tile.z - LAKE_TILE, 0));
      if (tile.slot >= 0 && off > reach + LAKE_TILE) {
        p.assetDrops.push(tile.slot);
        tile.slot = -1;
      } else if (tile.slot < 0 && off <= reach) {
        tile.slot = LAKE_SLOTS + this.next;
        this.next = (this.next + 1) % LAKE_SLOT_SPAN;
        p.assetUploads.push({ slot: tile.slot, mesh: this.mesh, level: 0, data: tile.data, indexCount: tile.indexCount, indexBytes: tile.indexBytes, quads: true, bounds: tile.bounds });
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
      const ax = b[0]! - cam.x, ay = b[1]! - cam.y, az = b[2]! - cam.z, bx = b[3]! - cam.x, by = b[4]! - cam.y, bz = b[5]! - cam.z;
      const near = Math.hypot(Math.max(ax, -bx, 0), Math.max(ay, -by, 0), Math.max(az, -bz, 0));
      if (near >= reach || !cam.boxVisible(ax, ay, az, bx, by, bz)) continue;
      put(tile.slot, tile.indexCount / 3, tile.x - cam.x, tile.base - cam.y, tile.z - cam.z, cam.passes(ax, ay, az, bx, by, bz));
    }
  }

  /**
   * Adds to `pos` the faces of the part whose corner is (ox, oz), x and z from (ox - dx, oz - dz) and y in the world.
   * `wet` marks the body squares that hold water.
   */
  private part(hf: Heightfield, water: MapWater, wet: Uint8Array, ox: number, oz: number, dx: number, dz: number, pos: number[]): void {
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
        const i0 = (cx * CHUNK_SIZE - ox) / cell, j0 = (cz * CHUNK_SIZE - oz) / cell;
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
    // A face is a corner and two edges, x and z from the part's corner, y in the world.
    const face = (x: number, y: number, z: number, ux: number, uy: number, uz: number, vx: number, vy: number, vz: number): void => {
      x += dx;
      z += dz;
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
    for (const way of WAYS) {
      const di = way[0], dj = way[1];
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
            const a = from * cell, e = step * cell;
            if (di !== 0) face((line + (di > 0 ? 1 : 0)) * cell, foot, a, 0, top - foot, 0, 0, 0, e - a);
            else face(a, foot, (line + (dj > 0 ? 1 : 0)) * cell, 0, top - foot, 0, e - a, 0, 0);
          }
          from = t > -Infinity ? step : -1;
          top = t;
          foot = f;
        }
      }
    }
  }

  /** The tile whose corner is (ox, oz) with the faces `pos`, or null where it has none. */
  private tile(pos: readonly number[], ox: number, oz: number): Tile | null {
    const faces = pos.length / 12;
    if (faces === 0) return null;
    const box = Float64Array.of(Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity);
    for (let k = 0; k < pos.length; k++) {
      box[k % 3] = Math.min(box[k % 3]!, pos[k]!);
      box[(k % 3) + 3] = Math.max(box[(k % 3) + 3]!, pos[k]!);
    }
    const base = box[1]!;
    const up = Math.max(1, box[4]! - base) / 2;
    const bounds = { center: [ACROSS, up, ACROSS], half: [ACROSS, up, ACROSS] };
    box[0] = box[0]! + ox;
    box[2] = box[2]! + oz;
    box[3] = box[3]! + ox;
    box[5] = box[5]! + oz;
    const data = new Uint8Array(faces * 4 * VERTEX_BYTES);
    const view = new DataView(data.buffer);
    const q = (v: number, a: number): number => Math.max(-32767, Math.min(32767, Math.round(((v - bounds.center[a]!) / bounds.half[a]!) * 32767)));
    for (let v = 0; v < faces * 4; v++) {
      const o = v * VERTEX_BYTES;
      view.setInt16(o, q(pos[v * 3]!, 0), true);
      view.setInt16(o + 2, q(pos[v * 3 + 1]! - base, 1), true);
      view.setInt16(o + 4, q(pos[v * 3 + 2]!, 2), true);
      data[o + 6] = WATER_COLOR;
    }
    return { x: ox, z: oz, data, indexCount: faces * 6, indexBytes: quadBytes(faces), base, box, bounds, slot: -1 };
  }
}
