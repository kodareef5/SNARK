import type { Heightfield } from "../../shared/world/heightfield.ts";
import type { StreetSectors, StreetsPart } from "../../shared/world/streets.ts";

/** Blue water and slate relief leave tactical markers in their original team colours. */
export function tintChartRelief(out: Uint32Array): void {
  for (let i = 0; i < out.length; i++) {
    const c = out[i]!, r = c & 255, g = (c >>> 8) & 255, b = (c >>> 16) & 255;
    const tone = (r + g * 2 + b) >>> 2;
    const water = b > r + 20 && b > g + 8;
    const red = water ? 13 + (tone >> 4) : 26 + (tone >> 2);
    const green = water ? 49 + (tone >> 3) : 47 + (tone >> 2);
    const blue = water ? 74 + (tone >> 3) : 61 + (tone >> 2);
    out[i] = (0xff000000 | (blue << 16) | (green << 8) | red) >>> 0;
  }
}

/** Streets sit in the cached relief tiles, so a moving marker never redraws their lines. */
export class ChartStreets {
  private source: StreetSectors | null = null;
  private version = -1;
  private parts: readonly StreetsPart[] = [];

  changed(source: StreetSectors | null, regions: number[]): boolean {
    const version = source?.version ?? -1;
    if (source === this.source && version === this.version) return false;
    regions.length = 0;
    if (source && source === this.source) source.changedSince(this.version, regions);
    this.source = source;
    this.version = version;
    this.parts = source?.parts() ?? [];
    return true;
  }

  paint(hf: Heightfield, zoom: number, col: number, row: number, size: number, out: Uint32Array): void {
    const whole = Math.max(hf.sizeX, hf.sizeZ), side = whole / (1 << zoom);
    const west = (hf.sizeX + whole) / 2 - col * side;
    const north = (hf.sizeZ + whole) / 2 - row * side;
    const pixel = size / side;
    for (const part of this.parts) {
      for (const street of part.stretches) {
        const coords = street.xz;
        for (let i = 2; i < coords.length; i += 2) {
          const x0 = (west - coords[i - 2]!) * pixel, x1 = (west - coords[i]!) * pixel;
          const y0 = (north - coords[i - 1]!) * pixel, y1 = (north - coords[i + 1]!) * pixel;
          if (Math.min(x0, x1) >= size || Math.max(x0, x1) < 0 || Math.min(y0, y1) >= size || Math.max(y0, y1) < 0) continue;
          const steps = Math.max(1, Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0))));
          for (let k = 0; k <= steps; k++) {
            const t = k / steps, x = Math.floor(x0 + t * (x1 - x0)), y = Math.floor(y0 + t * (y1 - y0));
            if (x >= 0 && x < size && y >= 0 && y < size) out[y * size + x] = 0xffb7b6a2;
          }
        }
      }
    }
  }
}
