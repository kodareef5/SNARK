import { K_IMAGE, K_PANEL, type UiFrame, type UiImage } from "./nodes.ts";
import { S_HUD_HIT, S_ICE } from "./style.ts";

const IMAGE_RADIO_GLASS = 36;
let radioGlass: UiImage | null = null;

/** The radio scrim loses its ink toward the open field. The same pixels serve every width. */
export function radioSurface(f: UiFrame, key: number, x: number, y: number, w: number, h: number, alpha: number): void {
  if (!radioGlass) {
    const width = 128, height = 4, data = new Uint8ClampedArray(width * height * 4);
    for (let row = 0; row < height; row++) for (let col = 0; col < width; col++) {
      const i = (row * width + col) * 4, strength = (1 - col / (width - 1)) ** 1.25;
      data[i] = 8; data[i + 1] = 29 + row * 2; data[i + 2] = 46 + row * 2;
      data[i + 3] = Math.round(240 * strength);
    }
    radioGlass = { width, height, data, version: 1, smooth: true };
  }
  f.images[IMAGE_RADIO_GLASS] = radioGlass;
  const sheet = f.add(key, K_IMAGE, x, y, w, h, S_HUD_HIT);
  sheet.image = IMAGE_RADIO_GLASS; sheet.alpha = alpha;
}

/** Dark backing and silver edges stay a pixel wide when the chart expands. */
export function chartEdge(f: UiFrame, base: number, x: number, y: number, side: number): void {
  const line = 1 / Math.max(1, f.unit);
  const top = f.add(base, K_PANEL, x, y - line, side, line, S_ICE);
  top.tint = 0xc6e1ed; top.alpha = .86;
  const left = f.add(base + 1, K_PANEL, x - line, y, line, side, S_ICE);
  left.tint = 0xa7cad8; left.alpha = .72;
  const right = f.add(base + 2, K_PANEL, x + side, y, line, side, S_ICE);
  right.tint = 0x132e41; right.alpha = .86;
  const bottom = f.add(base + 3, K_PANEL, x, y + side, side, line, S_ICE);
  bottom.tint = 0x132e41; bottom.alpha = .96;
}
