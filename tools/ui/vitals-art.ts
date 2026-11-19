// The HUD sheet's status icons from a generated picture (assets/source/ui/vitals-source.png), in place of the shapes
// client/core/ui/skin.ts draws by rule. The sheet keeps its layout and what each row is for (client/core/ui/vitals.ts):
// a dark silhouette behind, the fill that rises with the value, the same fill in the warning's colour, and an outline
// over all three. Only the pictures change, so a build without the generated picture draws as it did.
//
// The picture is glyphs with a glow on pure black, sixteen to a sheet, and the first seven are the vitals in the HUD's
// order. Each is lifted from the black, sized by eye as the touch glyphs are (tools/ui/touch-art.ts), and split: its
// solid part is the silhouette, its own light is the fill, and its edge and the glow beyond it are the outline.

import { resolve } from "node:path";
import { ICE, ICON_SIZE, SKIN_WIDTH, VITAL_KINDS, WARNING } from "../../client/core/ui/skin.ts";
import { extent, lift, resize, smooth, type Layer, type Picture } from "./touch-art.ts";

export const VITALS_SOURCE = resolve(import.meta.dir, "../../assets/source/ui/vitals-source.png");
/** The share of its cell a glyph may span, and how much its light is brought up. */
const SPAN = 0.8, GAIN = 1.2;
/** The silhouette behind a vital, the outline over it, and the glow beyond the outline. */
const DARK = 0x10283a, EDGE = 0xd6f3fb, GLOW = 0x6fd8f5;

const channel = (colour: number, c: number): number => (colour >> (16 - c * 8)) & 255;

/** A vital's glyph in a cell of the sheet's size: the picture's cell `k`, lifted, sized by eye and centred. */
function glyph(p: Picture, k: number): Layer {
  const cell = p.width / 4, l = lift(p, [(k % 4) * cell, Math.floor(k / 4) * cell, cell, cell], GAIN), b = extent(l, 0.3), w = b.r - b.l, h = b.b - b.t;
  const scale = Math.min((ICON_SIZE * SPAN) / Math.max(w, h), (ICON_SIZE * SPAN * 0.82) / Math.sqrt(w * h));
  return resize(l, scale, scale, ICON_SIZE, ICON_SIZE, (b.l + b.r) / 2, (b.t + b.b) / 2);
}

/** Paints the vitals' four rows of the sheet `data` (straight RGBA, SKIN_WIDTH across) from the picture. */
export function paintVitals(data: Uint8ClampedArray, p: Picture): void {
  // The sheet is fetched by every page, so its bytes count: what is clear is nothing at all, and a colour or an alpha
  // is kept to one part in 64, which the eye cannot tell at this size and the file's compression can.
  const coarse = (v: number): number => Math.min(255, Math.round(v / 4) * 4);
  const put = (x: number, y: number, r: number, g: number, b: number, a: number): void => {
    const at = (y * SKIN_WIDTH + x) * 4, alpha = coarse(a * 255);
    data[at] = alpha ? coarse(r) : 0; data[at + 1] = alpha ? coarse(g) : 0; data[at + 2] = alpha ? coarse(b) : 0; data[at + 3] = alpha;
  };
  for (let kind = 0; kind < VITAL_KINDS; kind++) {
    const g = glyph(p, kind), n = ICON_SIZE, solid = new Float32Array(n * n);
    for (let i = 0; i < n * n; i++) solid[i] = smooth(0.35, 0.75, g.data[i * 4 + 3]!);
    const at = (x: number, y: number): number => (x < 0 || y < 0 || x >= n || y >= n ? 0 : solid[y * n + x]!);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const o = (y * n + x) * 4, a = g.data[o + 3]!, m = solid[y * n + x]!, sx = kind * n + x;
      // The glyph's own colour, which is pale ice shading down to white-blue, leaned a little toward the HUD's ice.
      const r = a > 0 ? Math.min(255, (g.data[o]! / a) * 255) : 0, gr = a > 0 ? Math.min(255, (g.data[o + 1]! / a) * 255) : 0, b = a > 0 ? Math.min(255, (g.data[o + 2]! / a) * 255) : 0;
      const light = Math.max(r, gr, b) / 255;
      put(sx, y, channel(DARK, 0), channel(DARK, 1), channel(DARK, 2), m * 0.84);
      put(sx, y + n, r * 0.75 + channel(ICE, 0) * 0.25, gr * 0.75 + channel(ICE, 1) * 0.25, b * 0.75 + channel(ICE, 2) * 0.25, m * 0.94);
      // The warning's colour with the glyph's own shading.
      const shade = 0.72 + 0.28 * light;
      put(sx, y + n * 2, channel(WARNING, 0) * shade, channel(WARNING, 1) * shade, channel(WARNING, 2) * shade, m * 0.96);
      // The outline is where the silhouette ends; past it the glyph's glow carries on, fading to nothing at the cell's border.
      const edge = Math.min(1, Math.hypot(at(x + 1, y) - at(x - 1, y), at(x, y + 1) - at(x, y - 1)) * 1.6);
      const halo = a * (1 - m) * 0.7 * smooth(0, n / 12, Math.min(x + 0.5, y + 0.5, n - x - 0.5, n - y - 0.5));
      const line = edge * 0.95, tone = line >= halo ? EDGE : GLOW;
      put(sx, y + n * 3, channel(tone, 0), channel(tone, 1), channel(tone, 2), Math.max(line, halo));
    }
  }
}
