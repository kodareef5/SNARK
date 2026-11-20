import type { Heightfield } from "./heightfield.ts";

/** The colour outside the map and where no tile has come yet. */
export const MAP_VOID = 0xff30241a;

/** Paints one tile of the pyramid from the heightfield: each sample's colour, shaded by its slope with the light from the north-west, and water over what lies under the sea or a lake. */
export function paintRelief(hf: Heightfield, palette: Uint8Array, zoom: number, col: number, row: number, size: number, out: Uint32Array): void {
  const whole = Math.max(hf.sizeX, hf.sizeZ);
  const side = whole / (1 << zoom);
  // The slope is taken over about a pixel, so a far zoom shows the broad shape of the land.
  const reach = Math.max(1, Math.round(side / size / hf.cell));
  for (let py = 0; py < size; py++) {
    const z = (hf.sizeZ + whole) / 2 - (row + (py + 0.5) / size) * side;
    const j = Math.max(0, Math.min(hf.nz - 1 - reach, Math.floor(z / hf.cell)));
    for (let px = 0; px < size; px++) {
      const x = (hf.sizeX + whole) / 2 - (col + (px + 0.5) / size) * side;
      if (x < 0 || z < 0 || x > hf.sizeX || z > hf.sizeZ) {
        out[py * size + px] = MAP_VOID;
        continue;
      }
      const i = Math.max(0, Math.min(hf.nx - 1 - reach, Math.floor(x / hf.cell)));
      const tint = hf.tint[j * hf.nx + i]! * 4;
      const h = hf.sample(i, j);
      const relief = (hf.sample(Math.min(hf.nx - 1, i + reach), j) - h + hf.sample(i, Math.min(hf.nz - 1, j + reach)) - h) / (reach * hf.cell);
      const shade = Math.max(0.55, Math.min(1.3, 0.9 + relief * 0.35));
      let r = palette[tint]! * shade;
      let g = palette[tint + 1]! * shade;
      let b = palette[tint + 2]! * shade;
      const water = hf.waterAt(x, z);
      if (h < water) {
        // Deeper water is more of the water's colour.
        const k = Math.min(0.9, 0.55 + (water - h) * 0.08);
        r += (40 - r) * k;
        g += (92 - g) * k;
        b += (140 - b) * k;
      }
      out[py * size + px] = 0xff000000 | (Math.min(255, b) << 16) | (Math.min(255, g) << 8) | Math.min(255, r);
    }
  }
}
