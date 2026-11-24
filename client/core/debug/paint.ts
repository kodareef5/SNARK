// A picture core paints and the interface shows as one image node: the debug bar's charts. Colours are 0xRRGGBBAA.

import type { UiImage } from "../ui/nodes.ts";

/** A colour as the picture's 32-bit words hold it (little-endian RGBA). */
const word = (rgba: number): number => ((rgba & 0xff) << 24 | ((rgba >>> 8) & 0xff) << 16 | ((rgba >>> 16) & 0xff) << 8 | (rgba >>> 24)) >>> 0;

export class Paint {
  readonly image: UiImage = { width: 1, height: 1, data: new Uint8ClampedArray(4), version: 0 };
  private words = new Uint32Array(this.image.data.buffer);

  get width(): number {
    return this.image.width;
  }

  get height(): number {
    return this.image.height;
  }

  /** Sizes it to `w` by `h` pixels. Its pixels are kept only where the size is the same. */
  size(w: number, h: number): void {
    w = Math.max(1, Math.round(w));
    h = Math.max(1, Math.round(h));
    const im = this.image;
    if (w === im.width && h === im.height) return;
    im.width = w;
    im.height = h;
    im.data = new Uint8ClampedArray(w * h * 4);
    this.words = new Uint32Array(im.data.buffer);
  }

  clear(rgba: number): void {
    this.words.fill(word(rgba));
  }

  /** Fills a rectangle, clipped to the picture. A colour with alpha under 255 is laid over what is there. */
  rect(x: number, y: number, w: number, h: number, rgba: number): void {
    const im = this.image, x0 = Math.max(0, Math.round(x)), y0 = Math.max(0, Math.round(y));
    const x1 = Math.min(im.width, Math.round(x + w)), y1 = Math.min(im.height, Math.round(y + h));
    if (x1 <= x0 || y1 <= y0) return;
    const a = rgba & 0xff, words = this.words, stride = im.width;
    if (a === 255) {
      const v = word(rgba);
      for (let row = y0; row < y1; row++) words.fill(v, row * stride + x0, row * stride + x1);
      return;
    }
    if (a === 0) return;
    const d = im.data, r = rgba >>> 24, g = (rgba >>> 16) & 0xff, b = (rgba >>> 8) & 0xff, k = a / 255, keep = 1 - k;
    for (let row = y0; row < y1; row++) for (let i = (row * stride + x0) * 4, end = (row * stride + x1) * 4; i < end; i += 4) {
      d[i] = d[i]! * keep + r * k;
      d[i + 1] = d[i + 1]! * keep + g * k;
      d[i + 2] = d[i + 2]! * keep + b * k;
      d[i + 3] = Math.max(d[i + 3]!, a);
    }
  }

  /** A column from `top` to the foot: a chart's bar. */
  bar(x: number, w: number, top: number, rgba: number): void {
    this.rect(x, top, w, this.image.height - top, rgba);
  }

  /** The picture changed: the interface draws it again. */
  done(): void {
    this.image.version++;
  }
}
