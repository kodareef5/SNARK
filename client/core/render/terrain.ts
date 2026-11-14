// A quadtree over the map. A node far enough away is drawn as one tile of 32 x 32 quads. Otherwise its four children are considered.
// Every tile has the same triangle count, so cost follows screen coverage. Level 0 tiles are single chunks and match the collision surface.

import { CHUNK_SIZE } from "../../../shared/coords.ts";
import type { Heightfield } from "../../../shared/world/heightfield.ts";
import type { Camera } from "./camera.ts";
import { MAX_TILES, TILE_QUADS, type FramePacket } from "./packet.ts";

export class TerrainLod {
  /** Distance, in tile widths, beyond which a tile is detailed enough. */
  detail = 2.5;
  readonly levels: number;
  private readonly hf: Heightfield;
  private readonly minY: Float32Array[] = [];
  private readonly maxY: Float32Array[] = [];
  private readonly width: number[] = [];
  private readonly stack = new Int32Array(4 * 64);

  constructor(hf: Heightfield) {
    this.hf = hf;
    const cx = hf.dims.chunksX;
    const cz = hf.dims.chunksZ;
    let levels = 1;
    while (1 << (levels - 1) < Math.max(cx, cz)) levels++;
    this.levels = levels;

    // Height range per node, finest level first.
    const per = Math.round(CHUNK_SIZE / hf.cell);
    for (let level = 0; level < levels; level++) {
      const w = Math.ceil(cx / (1 << level));
      const d = Math.ceil(cz / (1 << level));
      const lo = new Float32Array(w * d).fill(Infinity);
      const hi = new Float32Array(w * d).fill(-Infinity);
      if (level === 0) {
        for (let tz = 0; tz < d; tz++) {
          for (let tx = 0; tx < w; tx++) {
            let a = Infinity;
            let b = -Infinity;
            for (let j = tz * per; j <= (tz + 1) * per; j++) {
              for (let i = tx * per; i <= (tx + 1) * per; i++) {
                const y = hf.sample(i, j);
                if (y < a) a = y;
                if (y > b) b = y;
              }
            }
            lo[tz * w + tx] = a;
            hi[tz * w + tx] = b;
          }
        }
      } else {
        const pw = this.width[level - 1]!;
        const plo = this.minY[level - 1]!;
        const phi = this.maxY[level - 1]!;
        const pd = plo.length / pw;
        for (let tz = 0; tz < d; tz++) {
          for (let tx = 0; tx < w; tx++) {
            for (let k = 0; k < 4; k++) {
              const px = tx * 2 + (k & 1);
              const pz = tz * 2 + (k >> 1);
              if (px >= pw || pz >= pd) continue;
              lo[tz * w + tx] = Math.min(lo[tz * w + tx]!, plo[pz * pw + px]!);
              hi[tz * w + tx] = Math.max(hi[tz * w + tx]!, phi[pz * pw + px]!);
            }
          }
        }
      }
      this.width.push(w);
      this.minY.push(lo);
      this.maxY.push(hi);
    }
  }

  select(cam: Camera, packet: FramePacket, viewDistance: number): void {
    const hf = this.hf;
    const top = this.levels - 1;
    const stack = this.stack;
    let sp = 0;
    const tw = this.width[top]!;
    const td = this.minY[top]!.length / tw;
    for (let tz = 0; tz < td; tz++) {
      for (let tx = 0; tx < tw; tx++) {
        stack[sp++] = top;
        stack[sp++] = tx;
        stack[sp++] = tz;
      }
    }
    while (sp > 0) {
      const tz = stack[--sp]!;
      const tx = stack[--sp]!;
      const level = stack[--sp]!;
      const w = this.width[level]!;
      if (tx >= w || tz >= this.minY[level]!.length / w) continue;
      const size = CHUNK_SIZE << level;
      const x0 = tx * size - cam.x;
      const z0 = tz * size - cam.z;
      const y0 = this.minY[level]![tz * w + tx]! - cam.y;
      const y1 = this.maxY[level]![tz * w + tx]! - cam.y;
      if (!cam.boxVisible(x0, y0, z0, x0 + size, y1, z0 + size)) continue;
      const dx = x0 > 0 ? x0 : x0 + size < 0 ? -(x0 + size) : 0;
      const dz = z0 > 0 ? z0 : z0 + size < 0 ? -(z0 + size) : 0;
      const dy = y0 > 0 ? y0 : y1 < 0 ? -y1 : 0;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (dist > viewDistance) continue;
      if (level > 0 && dist < size * this.detail) {
        for (let k = 0; k < 4; k++) {
          stack[sp++] = level - 1;
          stack[sp++] = tx * 2 + (k & 1);
          stack[sp++] = tz * 2 + (k >> 1);
        }
        continue;
      }
      const n = packet.tileCount;
      if (n === MAX_TILES) return;
      const stride = (size / hf.cell / TILE_QUADS) | 0;
      packet.tiles[n * 4] = x0;
      packet.tiles[n * 4 + 1] = z0;
      packet.tiles[n * 4 + 2] = stride * hf.cell;
      packet.tiles[n * 4 + 3] = stride;
      packet.tileOrigin[n * 2] = Math.round((tx * size) / hf.cell);
      packet.tileOrigin[n * 2 + 1] = Math.round((tz * size) / hf.cell);
      packet.tileCount = n + 1;
      packet.triangles += TILE_QUADS * TILE_QUADS * 2;
    }
  }
}
