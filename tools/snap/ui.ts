// Draws an interface frame over a picture with the browser binder's rectangles and colours, and a bitmap font in place of a real one.

import { K_BAR, K_IMAGE, K_INPUT, glyphAdvance, textWidth, type UiFrame } from "../../client/core/ui/nodes.ts";
import { STYLES } from "../../client/core/ui/style.ts";
import { GLYPH_HEIGHT, GLYPH_WIDTH, glyphPixel } from "./font.ts";

/** `color` is RGBA, `width` by `height`. */
export function drawUi(color: Uint8ClampedArray, width: number, height: number, f: UiFrame): void {
  const scale = height / f.height;
  const rect = (x: number, y: number, w: number, h: number, r: number, g: number, b: number, a: number): void => {
    const x0 = Math.max(0, Math.round(x * scale));
    const y0 = Math.max(0, Math.round(y * scale));
    const x1 = Math.min(width, Math.round((x + w) * scale));
    const y1 = Math.min(height, Math.round((y + h) * scale));
    for (let py = y0; py < y1; py++) {
      for (let px = x0; px < x1; px++) {
        const o = (py * width + px) * 4;
        color[o] = color[o]! + (r - color[o]!) * a;
        color[o + 1] = color[o + 1]! + (g - color[o + 1]!) * a;
        color[o + 2] = color[o + 2]! + (b - color[o + 2]!) * a;
        color[o + 3] = 255;
      }
    }
  };
  for (let i = 0; i < f.count; i++) {
    const n = f.nodes[i]!;
    const st = STYLES[n.style]!;
    const fa = (st.fill & 255) / 255;
    const ir = (st.ink >> 16) & 255;
    const ig = (st.ink >> 8) & 255;
    const ib = st.ink & 255;
    if (n.kind === K_IMAGE) {
      const image = f.images[n.image];
      // A picture in a file that a tool has not filled is not drawn, as a browser has not fetched it yet.
      if (!image || image.data.length < image.width * image.height * 4) continue;
      const x0 = Math.round(n.x * scale);
      const y0 = Math.round(n.y * scale);
      const w = Math.round(n.w * scale);
      const h = Math.round(n.h * scale);
      // The part of the image shown: all of it, or the source rectangle. Shrunk, each pixel is the mean of what it covers.
      const [sx, sy, sw, sh] = n.sw > 0 ? [n.sx, n.sy, n.sw, n.sh] : [0, 0, image.width, image.height];
      for (let py = 0; py < h; py++) {
        for (let px = 0; px < w; px++) {
          const dx = x0 + px;
          const dy = y0 + py;
          if (dx < 0 || dy < 0 || dx >= width || dy >= height) continue;
          const [u0, v0] = [sx + Math.floor((px * sw) / w), sy + Math.floor((py * sh) / h)];
          const [u1, v1] = [Math.max(u0 + 1, sx + Math.floor(((px + 1) * sw) / w)), Math.max(v0 + 1, sy + Math.floor(((py + 1) * sh) / h))];
          let [r, g, b, a] = [0, 0, 0, 0];
          for (let v = v0; v < v1; v++) {
            for (let u = u0; u < u1; u++) {
              const s = (v * image.width + u) * 4;
              const k = image.data[s + 3]! / 255;
              r += image.data[s]! * k;
              g += image.data[s + 1]! * k;
              b += image.data[s + 2]! * k;
              a += k;
            }
          }
          if (a === 0) continue;
          const o = (dy * width + dx) * 4;
          const cover = a / ((u1 - u0) * (v1 - v0)) * n.alpha;
          color[o] = color[o]! + (r / a - color[o]!) * cover;
          color[o + 1] = color[o + 1]! + (g / a - color[o + 1]!) * cover;
          color[o + 2] = color[o + 2]! + (b / a - color[o + 2]!) * cover;
          color[o + 3] = 255;
        }
      }
      continue;
    }
    if (n.tint >= 0) rect(n.x, n.y, n.w, n.h, n.tint >> 16, (n.tint >> 8) & 255, n.tint & 255, n.alpha);
    else if (fa > 0) rect(n.x, n.y, n.w, n.h, st.fill >>> 24, (st.fill >>> 16) & 255, (st.fill >>> 8) & 255, fa * n.alpha);
    if (n.kind === K_BAR) {
      rect(n.x, n.y, n.w * Math.max(0, Math.min(1, n.value)), n.h, ir, ig, ib, n.alpha);
      continue;
    }
    if (n.text === "") continue;
    // Each glyph sits in its character cell, so text takes the width core laid it out with.
    const dot = Math.max(1 / scale, st.font * .6 / (GLYPH_WIDTH + 1));
    const textW = textWidth(n.text, n.style);
    const pad = n.kind === K_INPUT ? 6 : 0;
    const tx = st.align === 1 ? n.x + (n.w - textW) / 2 : st.align === 2 ? n.x + n.w - textW : n.x + pad;
    const ty = n.y + (n.h - dot * GLYPH_HEIGHT) / 2;
    let advance = 0;
    for (const character of n.text) {
      const code = character.codePointAt(0)!;
      const cell = glyphAdvance(code, n.style), dx = Math.min(dot, cell / (GLYPH_WIDTH + 1));
      for (let col = 0; col < GLYPH_WIDTH; col++) {
        for (let row = 0; row < GLYPH_HEIGHT; row++) {
          if (!glyphPixel(code, col, row)) continue;
          const gx = tx + advance + col * dx;
          const gy = ty + row * dot;
          if (gx < n.x || gx + dot > n.x + n.w + 0.5) continue;
          if (st.shadow) rect(gx + dx, gy + dot, dx, dot, 0, 0, 0, 0.7 * n.alpha);
          rect(gx, gy, dx, dot, ir, ig, ib, n.alpha);
        }
      }
      advance += cell;
    }
  }
}
