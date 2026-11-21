// The streets round the camera on the card, for the ground's straight edges (planning/workstreams/streets.md): two
// pictures STREET_SIDE samples a side (1 km at 2 m), each sample at its map sample modulo STREET_SIDE, so the region
// follows the camera a chunk at a time and only the chunks it gains are worked out and put on the card. Each chunk's
// samples are its streets' planes (shared/world/streets.ts chunkPlanes): distances read filtered, kinds read at the
// nearest sample, which also says which chunk the place holds (its tag). The ground's text (world-surfaces.ts
// STREETS_GLSL) reads them on the desktop's lit tiers; StreetPlanes is its twin for a picture drawn on the CPU.

import { CHUNK_SIZE } from "../../../shared/coords.ts";
import { CHUNK_SIDE, PLANE_BYTES, chunkPlanes, chunkTag, planeMetres, type StreetSectors } from "../../../shared/world/streets.ts";
import type { FramePacket } from "./packet.ts";

/** Chunks a side of the region round the camera, and its pictures' side in samples. */
export const STREET_CHUNKS = 16;
export const STREET_SIDE = STREET_CHUNKS * CHUNK_SIDE;
/** A chunk tile's side in samples, and its bytes in each picture. */
export const STREET_TILE_SIDE = CHUNK_SIDE;
export const STREET_TILE_BYTES = CHUNK_SIDE * CHUNK_SIDE * PLANE_BYTES;
/**
 * Chunk tiles worked out and put on the card in a frame at most: a dense chunk's planes take about a tenth of a
 * millisecond on a desktop (tools/bench/streets.ts), and moving a chunk across brings in a row of 15.
 */
export const STREET_TILES_FRAME = 8;

/**
 * The region of the streets' pictures round the camera: which chunk each tile of the pictures holds, and the work of a
 * frame. A region drawn before its tiles have come reads a tile that holds another chunk, which its tag tells, or
 * zeros, which say no street is near; either way the ground is drawn as it was without the streets.
 */
export class StreetRegion {
  /** The chunk each tile holds, cz * 65536 + cx, or -1. */
  private readonly held = new Int32Array(STREET_CHUNKS * STREET_CHUNKS).fill(-1);
  /** The streets' version the tiles were worked out at. */
  private version = -1;
  /** Tiles put on the card in all: for the frame's numbers. */
  tiles = 0;
  private readonly order: number[] = [];

  /**
   * This frame's tiles: those of the chunks within the region round chunk (x, z) of the camera that the pictures do not
   * hold, nearest first, STREET_TILES_FRAME at most.
   */
  follow(streets: StreetSectors | null, x: number, z: number, p: FramePacket): void {
    p.streetTiles = 0;
    if (!streets) return;
    if (streets.version !== this.version) {
      this.held.fill(-1);
      this.version = streets.version;
    }
    const ccx = Math.floor(x / CHUNK_SIZE), ccz = Math.floor(z / CHUNK_SIZE), half = STREET_CHUNKS / 2;
    const order = this.order;
    order.length = 0;
    for (let dz = -half + 1; dz < half; dz++) for (let dx = -half + 1; dx < half; dx++) {
      const cx = ccx + dx, cz = ccz + dz;
      if (cx < 0 || cz < 0) continue;
      const slot = (cz & (STREET_CHUNKS - 1)) * STREET_CHUNKS + (cx & (STREET_CHUNKS - 1));
      if (this.held[slot] !== cz * 65536 + cx) order.push(dx * dx + dz * dz, cx, cz);
    }
    // Nearest first: the nearest left each time, of triples of distance and chunk.
    while (p.streetTiles < STREET_TILES_FRAME) {
      let k = -1;
      for (let m = 0; m < order.length; m += 3) if (order[m]! >= 0 && (k < 0 || order[m]! < order[k]!)) k = m;
      if (k < 0) break;
      const cx = order[k + 1]!, cz = order[k + 2]!, t = p.streetTiles;
      order[k] = -1;
      chunkPlanes(streets, cx, cz, p.streetDist.subarray(t * STREET_TILE_BYTES, (t + 1) * STREET_TILE_BYTES), p.streetKinds.subarray(t * STREET_TILE_BYTES, (t + 1) * STREET_TILE_BYTES));
      p.streetAt[t * 2] = (cx & (STREET_CHUNKS - 1)) * CHUNK_SIDE;
      p.streetAt[t * 2 + 1] = (cz & (STREET_CHUNKS - 1)) * CHUNK_SIDE;
      this.held[(cz & (STREET_CHUNKS - 1)) * STREET_CHUNKS + (cx & (STREET_CHUNKS - 1))] = cz * 65536 + cx;
      p.streetTiles++;
    }
    this.tiles += p.streetTiles;
  }

  reset(): void {
    this.held.fill(-1);
    this.version = -1;
  }
}

/**
 * The streets' pictures as the card reads them, for a picture drawn on the CPU (tools/snap/raster.ts): each chunk's
 * planes worked out once it is asked, and a point read as the ground's text reads it, its distances between its four
 * samples and its kinds at the nearest.
 */
export class StreetPlanes {
  private readonly chunks = new Map<number, { dist: Uint8Array; kinds: Uint8Array }>();
  private seen = -1;
  private readonly streets: StreetSectors;
  constructor(streets: StreetSectors) {
    this.streets = streets;
  }

  private chunk(cx: number, cz: number): { dist: Uint8Array; kinds: Uint8Array } {
    if (this.streets.version !== this.seen) { this.chunks.clear(); this.seen = this.streets.version; }
    const key = cz * 65536 + cx;
    let c = this.chunks.get(key);
    if (!c) {
      c = { dist: new Uint8Array(STREET_TILE_BYTES), kinds: new Uint8Array(STREET_TILE_BYTES) };
      chunkPlanes(this.streets, cx, cz, c.dist, c.kinds);
      this.chunks.set(key, c);
    }
    return c;
  }

  /** Sample (i, j)'s byte k of a picture. */
  private byte(i: number, j: number, k: number, kinds: boolean): number {
    if (i < 0 || j < 0) return 0;
    const c = this.chunk(Math.floor(i / CHUNK_SIDE), Math.floor(j / CHUNK_SIDE));
    return (kinds ? c.kinds : c.dist)[((j % CHUNK_SIDE) * CHUNK_SIDE + (i % CHUNK_SIDE)) * PLANE_BYTES + k]!;
  }

  /**
   * The streets at map point (x, z) as STREETS_GLSL `streetsAt` reads them: into `e` the distances to the kerb, the
   * verge's end and the walk's end, between the four samples round it; into `k` the nearest sample's kinds, tag and type,
   * way along and seed bytes. False where none is near, or where the nearest sample's tag is not its chunk's.
   */
  at(x: number, z: number, e: Float64Array, k: Uint8Array): boolean {
    const s = x / 2, t = z / 2, i = Math.floor(s), j = Math.floor(t), fx = s - i, fz = t - j;
    for (let c = 0; c < 3; c++) {
      // The card filters the bytes as eighths of 255 at least as fine as these; the twin takes them exactly.
      const b = (this.byte(i, j, c, false) * (1 - fx) + this.byte(i + 1, j, c, false) * fx) * (1 - fz) + (this.byte(i, j + 1, c, false) * (1 - fx) + this.byte(i + 1, j + 1, c, false) * fx) * fz;
      e[c] = planeMetres(b);
    }
    if (Math.min(e[0]!, e[1]!, e[2]!) >= 7.9) return false;
    const ni = Math.floor(s + 0.5), nj = Math.floor(t + 0.5);
    for (let c = 0; c < 4; c++) k[c] = this.byte(ni, nj, c, true);
    return (k[1]! & 15) === chunkTag(Math.floor(ni / CHUNK_SIDE), Math.floor(nj / CHUNK_SIDE));
  }
}
